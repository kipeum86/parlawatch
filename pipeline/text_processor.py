"""자막 텍스트 처리: 키워드 필터 + LLM 2-pass 분석."""

import json
import logging
from typing import Any

from .llm.base import LLMClient
from .llm.prompts import (
    get_pass1_system_prompt,
    get_pass1_user_prompt,
    get_pass2_system_prompt,
    get_pass2_user_prompt,
)
from .utils import retry

logger = logging.getLogger(__name__)

CHUNK_SIZE = 80_000
CHUNK_OVERLAP = 5_000


def merge_keywords(
    config_include: list[str],
    config_exclude: list[str],
    user_include: list[str],
    user_exclude: list[str],
) -> tuple[list[str], list[str]]:
    """config 키워드와 사용자 키워드를 병합한다."""
    include = list(set(config_include + user_include))
    exclude = list(set(config_exclude + user_exclude))
    return include, exclude


def keyword_filter(text: str, include: list[str], exclude: list[str]) -> bool:
    """텍스트에 도메인 관련 키워드가 포함되어 있는지 판별한다."""
    if not include:
        return True

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
    domain_name: str,
    domain_description: str,
    entity_names: list[str],
    include_keywords: list[str],
    exclude_keywords: list[str],
) -> list[dict[str, Any]]:
    """자막 텍스트를 분석하여 구조화된 안건 리스트를 반환한다."""
    has_domain_content = keyword_filter(subtitle_text, include_keywords, exclude_keywords)
    logger.info("키워드 필터 결과: has_domain_content=%s", has_domain_content)

    chunks = _split_text(subtitle_text)
    logger.info("텍스트 청크 수: %d (총 %d자)", len(chunks), len(subtitle_text))

    all_agendas = []

    for i, chunk in enumerate(chunks):
        logger.info("Pass 1 처리 중: 청크 %d/%d", i + 1, len(chunks))
        pass1_result = _run_pass1(llm, chunk, domain_name, domain_description, entity_names, include_keywords)
        agendas = pass1_result.get("agendas", [])
        all_agendas.extend(agendas)

    if has_domain_content and include_keywords:
        general_agendas = [a for a in all_agendas if a.get("category") == "general"]
        if general_agendas:
            logger.info("Pass 2 검증 중: general 안건 %d개", len(general_agendas))
            all_agendas = _run_pass2(llm, all_agendas, subtitle_text, domain_name, entity_names, include_keywords)

    logger.info(
        "처리 완료: 총 %d개 안건 (domain: %d, general: %d)",
        len(all_agendas),
        sum(1 for a in all_agendas if a.get("category") == "domain"),
        sum(1 for a in all_agendas if a.get("category") == "general"),
    )

    return all_agendas


@retry(max_attempts=3, delay=5.0)
def _run_pass1(llm, text, domain_name, domain_description, entity_names, include_keywords):
    system_prompt = get_pass1_system_prompt(domain_name, domain_description, entity_names, include_keywords)
    user_prompt = get_pass1_user_prompt(text)
    return llm.process(system_prompt, user_prompt)


@retry(max_attempts=2, delay=5.0)
def _run_pass2_llm(llm, pass1_json, text, domain_name, entity_names, include_keywords):
    system_prompt = get_pass2_system_prompt(domain_name, entity_names, include_keywords)
    user_prompt = get_pass2_user_prompt(pass1_json, text)
    return llm.process(system_prompt, user_prompt)


def _run_pass2(llm, agendas, subtitle_text, domain_name, entity_names, include_keywords):
    pass1_json = json.dumps({"agendas": agendas}, ensure_ascii=False, indent=2)

    combined_len = len(pass1_json) + len(subtitle_text)
    if combined_len > CHUNK_SIZE * 2:
        subtitle_text = subtitle_text[:CHUNK_SIZE]

    try:
        pass2_result = _run_pass2_llm(llm, pass1_json, subtitle_text, domain_name, entity_names, include_keywords)
    except Exception as e:
        logger.warning("Pass 2 실패, Pass 1 결과만 사용: %s", e)
        return agendas

    reclassified = pass2_result.get("reclassified", [])
    if not reclassified:
        logger.info("Pass 2: 재분류 없음")
        return agendas

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

    reclass_titles = {r["original_title"] for r in valid_reclass}
    updated = []
    for agenda in agendas:
        if agenda.get("title") in reclass_titles:
            match = next((r for r in valid_reclass if r["original_title"] == agenda["title"]), None)
            if match:
                updated.append(match["updated_agenda"])
                logger.info("재분류: %s → domain", agenda["title"])
            else:
                updated.append(agenda)
        else:
            updated.append(agenda)

    return updated


def _split_text(text: str) -> list[str]:
    if len(text) <= CHUNK_SIZE:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end])
        start = end - CHUNK_OVERLAP
    return chunks
