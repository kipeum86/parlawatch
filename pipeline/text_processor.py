"""자막 텍스트 처리: 키워드 필터 + LLM 2-pass 분석."""

import json
import logging
from typing import Any

from .config import DEFAULT_INCLUDE_KEYWORDS, DEFAULT_EXCLUDE_KEYWORDS
from .llm.base import LLMClient
from .llm.prompts import (
    get_pass1_system_prompt,
    get_pass1_user_prompt,
    get_pass2_system_prompt,
    get_pass2_user_prompt,
)
from .utils import retry

logger = logging.getLogger(__name__)

# 청크 분할 기준 (문자 수)
CHUNK_SIZE = 80_000
CHUNK_OVERLAP = 5_000


def merge_keywords(
    user_include: list[str],
    user_exclude: list[str],
) -> tuple[list[str], list[str]]:
    """기본 키워드와 사용자 키워드를 병합한다."""
    include = list(set(DEFAULT_INCLUDE_KEYWORDS + user_include))
    exclude = list(set(DEFAULT_EXCLUDE_KEYWORDS + user_exclude))
    return include, exclude


def keyword_filter(text: str, include: list[str], exclude: list[str]) -> bool:
    """텍스트에 게임 관련 키워드가 포함되어 있는지 판별한다.

    exclude 키워드에 해당하는 부분을 제거한 후 include 키워드를 검색한다.
    """
    filtered_text = text
    for ex_kw in exclude:
        filtered_text = filtered_text.replace(ex_kw, "")

    for kw in include:
        if kw in filtered_text:
            return True
    return False


def process_text(
    subtitle_text: str,
    llm: LLMClient,
    company_names: list[str],
    include_keywords: list[str],
    exclude_keywords: list[str],
) -> list[dict[str, Any]]:
    """자막 텍스트를 분석하여 구조화된 안건 리스트를 반환한다.

    1. 키워드 필터로 게임 관련 내용 존재 여부 확인
    2. LLM Pass 1: 전체 안건 구조화
    3. LLM Pass 2: 놓친 게임 관련 내용 검증 (게임 키워드가 있었을 경우)
    """
    has_game_content = keyword_filter(subtitle_text, include_keywords, exclude_keywords)
    logger.info("키워드 필터 결과: has_game_content=%s", has_game_content)

    # 긴 자막 분할 처리
    chunks = _split_text(subtitle_text)
    logger.info("텍스트 청크 수: %d (총 %d자)", len(chunks), len(subtitle_text))

    all_agendas = []

    for i, chunk in enumerate(chunks):
        logger.info("Pass 1 처리 중: 청크 %d/%d", i + 1, len(chunks))
        pass1_result = _run_pass1(llm, chunk, company_names)
        agendas = pass1_result.get("agendas", [])
        all_agendas.extend(agendas)

    # Pass 2: 게임 키워드가 있었다면 놓친 내용 검증
    if has_game_content:
        general_agendas = [a for a in all_agendas if a.get("category") == "general"]
        if general_agendas:
            logger.info("Pass 2 검증 중: general 안건 %d개", len(general_agendas))
            all_agendas = _run_pass2(llm, all_agendas, subtitle_text, company_names)

    logger.info(
        "처리 완료: 총 %d개 안건 (game: %d, general: %d)",
        len(all_agendas),
        sum(1 for a in all_agendas if a.get("category") == "game"),
        sum(1 for a in all_agendas if a.get("category") == "general"),
    )

    return all_agendas


@retry(max_attempts=3, delay=5.0)
def _run_pass1(llm: LLMClient, text: str, company_names: list[str]) -> dict:
    """Pass 1: 자막 → 구조화된 안건 JSON."""
    system_prompt = get_pass1_system_prompt(company_names)
    user_prompt = get_pass1_user_prompt(text)
    return llm.process(system_prompt, user_prompt)


@retry(max_attempts=2, delay=5.0)
def _run_pass2_llm(llm: LLMClient, pass1_json: str, text: str, company_names: list[str]) -> dict:
    """Pass 2 LLM 호출."""
    system_prompt = get_pass2_system_prompt(company_names)
    user_prompt = get_pass2_user_prompt(pass1_json, text)
    return llm.process(system_prompt, user_prompt)


def _run_pass2(
    llm: LLMClient,
    agendas: list[dict],
    subtitle_text: str,
    company_names: list[str],
) -> list[dict]:
    """Pass 2: general 안건 중 게임 관련 내용 누락 검증 후 병합."""
    pass1_json = json.dumps({"agendas": agendas}, ensure_ascii=False, indent=2)

    # Pass 2 입력이 너무 길면 자막을 축약
    combined_len = len(pass1_json) + len(subtitle_text)
    if combined_len > CHUNK_SIZE * 2:
        subtitle_text = subtitle_text[:CHUNK_SIZE]

    try:
        pass2_result = _run_pass2_llm(llm, pass1_json, subtitle_text, company_names)
    except Exception as e:
        logger.warning("Pass 2 실패, Pass 1 결과만 사용: %s", e)
        return agendas

    reclassified = pass2_result.get("reclassified", [])
    if not reclassified:
        logger.info("Pass 2: 재분류 없음")
        return agendas

    # 유효한 재분류 항목만 필터
    valid_reclass = []
    for r in reclassified:
        if not isinstance(r, dict):
            continue
        if "original_title" not in r or "updated_agenda" not in r:
            logger.warning("Pass 2: 불완전한 재분류 항목 스킵: %s", str(r)[:100])
            continue
        valid_reclass.append(r)

    if not valid_reclass:
        logger.info("Pass 2: 유효한 재분류 없음")
        return agendas

    # 재분류된 안건 병합
    reclass_titles = {r["original_title"] for r in valid_reclass}
    updated = []
    for agenda in agendas:
        if agenda.get("title") in reclass_titles:
            match = next((r for r in valid_reclass if r["original_title"] == agenda["title"]), None)
            if match:
                updated.append(match["updated_agenda"])
                logger.info("재분류: %s → game", agenda["title"])
            else:
                updated.append(agenda)
        else:
            updated.append(agenda)

    return updated


def _split_text(text: str) -> list[str]:
    """긴 텍스트를 오버랩 포함하여 청크로 분할한다."""
    if len(text) <= CHUNK_SIZE:
        return [text]

    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end])
        start = end - CHUNK_OVERLAP

    return chunks
