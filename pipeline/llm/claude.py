"""Claude (Anthropic) LLM 클라이언트 구현."""

import json
import logging
import re
from typing import Any

import anthropic

from .base import LLMClient

logger = logging.getLogger(__name__)


class ClaudeClient(LLMClient):
    """Claude API를 사용하는 LLM 클라이언트."""

    def __init__(self, api_key: str, model: str = "claude-haiku-4-5-20251001", max_tokens: int = 16384):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
        self.max_tokens = max_tokens

    def process(self, system_prompt: str, user_content: str) -> dict[str, Any]:
        """Claude API에 요청을 보내고 JSON 응답을 파싱하여 반환한다."""
        logger.info("Claude API 호출: model=%s, input_len=%d", self.model, len(user_content))

        response = self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = response.content[0].text
        stop_reason = response.stop_reason
        logger.info(
            "Claude 응답: input_tokens=%d, output_tokens=%d, stop_reason=%s",
            response.usage.input_tokens,
            response.usage.output_tokens,
            stop_reason,
        )

        # max_tokens로 잘린 경우 경고
        if stop_reason == "max_tokens":
            logger.warning("응답이 max_tokens에 의해 잘림 — JSON이 불완전할 수 있음")

        # JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
        json_text = _extract_json(raw_text)
        try:
            return json.loads(json_text)
        except json.JSONDecodeError as e:
            logger.warning("JSON 파싱 실패: %s — 복구 시도", e)
            repaired = _repair_json(json_text)
            return json.loads(repaired)


def _repair_json(text: str) -> str:
    """깨진 JSON을 최대한 복구한다."""
    # 1. trailing comma 제거: ,] → ] , ,} → }
    text = re.sub(r',\s*([}\]])', r'\1', text)

    try:
        json.loads(text)
        return text
    except json.JSONDecodeError:
        pass

    # 2. 마지막 완전한 객체까지 잘라서 복구
    #    마지막으로 완전히 닫힌 안건 객체(}]) 이후를 제거
    last_complete = _find_last_complete_object(text)
    if last_complete:
        try:
            json.loads(last_complete)
            logger.warning("JSON 복구: 마지막 완전 객체까지 잘라냄 (%d → %d자)", len(text), len(last_complete))
            return last_complete
        except json.JSONDecodeError:
            pass

    # 3. 최후 수단: 열린 괄호 자동 닫기
    truncated = text.rstrip()
    # 불완전한 문자열 닫기 (홀수 개 따옴표)
    if truncated.count('"') % 2 == 1:
        truncated += '"'
    # trailing comma 제거
    truncated = re.sub(r',\s*$', '', truncated)
    # 열린 괄호 닫기
    open_braces = truncated.count('{') - truncated.count('}')
    open_brackets = truncated.count('[') - truncated.count(']')
    truncated += ']' * max(0, open_brackets) + '}' * max(0, open_braces)
    logger.warning("JSON 복구(괄호 닫기): %d → %d자", len(text), len(truncated))
    return truncated


def _find_last_complete_object(text: str) -> str | None:
    """agendas 배열에서 마지막으로 완전히 닫힌 안건까지 잘라낸다."""
    # "agendas": [ ... ] 구조에서 마지막 }, 를 찾아서 배열 닫기
    # 역순으로 }를 찾으면서 유효한 JSON인지 시도
    positions = [m.start() for m in re.finditer(r'\}\s*,', text)]
    for pos in reversed(positions):
        candidate = text[:pos + 1]  # } 까지
        # 열린 괄호 닫기
        open_brackets = candidate.count('[') - candidate.count(']')
        open_braces = candidate.count('{') - candidate.count('}')
        closed = candidate + ']' * max(0, open_brackets) + '}' * max(0, open_braces)
        try:
            json.loads(closed)
            return closed
        except json.JSONDecodeError:
            continue
    return None


def _extract_json(text: str) -> str:
    """LLM 응답에서 JSON 부분을 추출한다."""
    # ```json ... ``` 블록이 있는 경우
    if "```json" in text:
        start = text.index("```json") + 7
        end = text.find("```", start)
        if end == -1:
            # 닫는 ``` 없으면 끝까지
            return text[start:].strip()
        return text[start:end].strip()

    # ``` ... ``` 블록이 있는 경우
    if "```" in text:
        start = text.index("```") + 3
        end = text.find("```", start)
        if end == -1:
            return text[start:].strip()
        return text[start:end].strip()

    # { 로 시작하는 JSON 직접 반환
    text = text.strip()
    if text.startswith("{"):
        return text

    # { ... } 블록을 찾아서 추출
    brace_start = text.find("{")
    if brace_start != -1:
        brace_end = text.rfind("}")
        if brace_end > brace_start:
            return text[brace_start:brace_end + 1]

    raise ValueError(f"JSON을 찾을 수 없음: {text[:200]}")
