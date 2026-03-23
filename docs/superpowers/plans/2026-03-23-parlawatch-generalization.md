# ParlaWatch Generalization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform GamWatch (game-industry-specific Korean National Assembly monitoring) into ParlaWatch (domain-agnostic version for any industry).

**Architecture:** Fork & Refactor — copy GamWatch files, replace all game-industry hardcoding with config-driven values. No structural changes to the pipeline architecture (YouTube → Subtitles → LLM 2-pass → Google Sheets → Dashboard). Two new modules: setup wizard (CLAUDE.md) and setup helpers (validator.py, sheets_creator.py).

**Tech Stack:** Python 3.12, pytest, Google Sheets API, Anthropic Claude API, YouTube Data API, Naver News API, Vanilla JS (dashboard), GitHub Actions

**Source:** `/Users/kpsfamily/코딩 프로젝트/gamwatch-national-audit-monitoring/` (read-only reference)
**Target:** `/Users/kpsfamily/코딩 프로젝트/parlawatch/`

---

## Chunk 1: Project Initialization

### Task 1: Copy GamWatch files and initialize git

**Files:**
- Create: entire `parlawatch/` project structure

- [ ] **Step 1: Copy GamWatch files to parlawatch/**

```bash
cd "/Users/kpsfamily/코딩 프로젝트"
# Copy all files except .git, .venv, __pycache__, .DS_Store
rsync -av --exclude='.git' --exclude='.venv' --exclude='__pycache__' --exclude='.DS_Store' --exclude='.gstack' \
  gamwatch-national-audit-monitoring/ parlawatch/
```

- [ ] **Step 2: Initialize git repo**

```bash
cd "/Users/kpsfamily/코딩 프로젝트/parlawatch"
git init
echo ".venv/" >> .gitignore
echo "__pycache__/" >> .gitignore
echo "*.pyc" >> .gitignore
echo ".env" >> .gitignore
echo "sa.json" >> .gitignore
git add -A
git commit -m "chore: initial copy from GamWatch"
```

- [ ] **Step 3: Create Python virtual environment**

```bash
cd "/Users/kpsfamily/코딩 프로젝트/parlawatch"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install pytest
```

### Task 2: Global branding rename (GamWatch → ParlaWatch)

**Files:**
- Modify: all files containing "GamWatch" or "gamwatch"

- [ ] **Step 1: Rename all branding strings**

Use find-and-replace across the entire project:
- `GamWatch` → `ParlaWatch`
- `gamwatch` → `parlawatch`
- `GAMWATCH` → `PARLAWATCH` (if any)

Files to check (exhaustive list):
- `pipeline/config.py` line 1: docstring
- `pipeline/main.py` lines 49, 91, 121, 205: log messages
- `pipeline/cli.py` line 1, 37: docstring + argparse description
- `pipeline/sheets_client.py` line 1: docstring + lines 163, 172: `"gamwatch-header-"` protection ID prefix
- `docs/config.js` lines 1, 12-13: comments + GH_REPO
- `docs/app.js` lines 1, 7-8, 48: comments + localStorage keys
- `docs/index.html` line 6+: title, header text
- `docs/trigger.js`: localStorage keys
- `docs/report.js`: report title/header
- `.github/workflows/pipeline.yml` line 1: workflow name
- `CLAUDE.md` line 1+: all references
- `GamWatch_사용설명서.md`: filename + content

- [ ] **Step 2: Rename GamWatch_사용설명서.md → ParlaWatch_사용설명서.md**

```bash
mv "GamWatch_사용설명서.md" "ParlaWatch_사용설명서.md"
```

- [ ] **Step 3: Verify no gamwatch references remain**

```bash
grep -ri "gamwatch" . --include="*.py" --include="*.js" --include="*.yaml" --include="*.yml" --include="*.html" --include="*.md" --include="*.css" | grep -v ".git/"
```

Expected: 0 results (config.example.yaml doesn't exist yet)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: rename GamWatch → ParlaWatch branding"
```

---

## Chunk 2: Config and Pipeline Generalization

### Task 3: Generalize config.yaml

**Files:**
- Modify: `config.yaml` → empty template
- Create: `config.example.yaml` → game industry example

- [ ] **Step 1: Save current config.yaml as config.example.yaml**

```bash
cp config.yaml config.example.yaml
```

Add a header comment to config.example.yaml:
```yaml
# ParlaWatch 설정 예시 — 게임산업 모니터링
# 이 파일은 참고용입니다. 실제 설정은 config.yaml을 수정하세요.
```

- [ ] **Step 2: Replace config.yaml with empty template**

```yaml
# ParlaWatch Configuration

# LLM Provider Settings
llm:
  provider: "claude"
  model: "claude-haiku-4-5-20251001"
  max_tokens: 16384

# Google Sheets
sheets:
  spreadsheet_id: ""   # 셋업 시 자동 생성 또는 수동 입력

# YouTube Channels — 국회방송
youtube:
  channels:
    - id: "UCyYl7eNQ-JXtFnFMJFGZaOQ"
      name: "국회방송"

# 도메인 설정 (셋업 위저드가 채워넣음)
domain:
  name: ""              # 예: "의료/제약", "금융", "게임"
  description: ""       # LLM 프롬프트에 삽입될 도메인 설명

# 모니터링 대상 상임위원회
committees: []

# 모니터링 대상 기업/기관명
entity_names: []

# 키워드 필터
keywords:
  include: []
  exclude: []

# 국정감사/국회 모니터링 기간 (이 기간에만 자동 실행)
audit_period:
  start: ""
  end: ""

# Pipeline Settings
pipeline:
  retry_count: 3
  retry_delay_seconds: 5
  news_results_per_agenda: 5
  search_days_back: 7
```

- [ ] **Step 3: Commit**

```bash
git add config.yaml config.example.yaml
git commit -m "feat: generalize config.yaml with empty template + game example"
```

### Task 4: Generalize pipeline/config.py

**Files:**
- Modify: `pipeline/config.py`

- [ ] **Step 1: Remove DEFAULT keywords and add runtime validation**

Replace the entire file with:

```python
"""ParlaWatch 파이프라인 설정 및 상수."""

import os
import sys
import logging
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# 경로
# ──────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT_DIR / "config.yaml"


def load_config() -> dict:
    """config.yaml을 읽어 dict로 반환한다.

    파일 파싱은 항상 성공. 필수 필드 누락은 파이프라인 실행 시 별도 검증.
    """
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except FileNotFoundError:
        logger.error("config.yaml을 찾을 수 없습니다: %s", CONFIG_PATH)
        return {}
    except yaml.YAMLError as e:
        logger.error("config.yaml 파싱 오류: %s", e)
        return {}


def validate_config_for_pipeline(config: dict) -> bool:
    """파이프라인 실행에 필요한 필수 필드가 있는지 검증한다.

    필수: domain.name, domain.description
    spreadsheet_id는 환경 변수로 별도 검증 (main.py에서 처리).

    Returns:
        True면 실행 가능, False면 셋업 필요.
    """
    domain = config.get("domain", {})
    if not domain.get("name") or not domain.get("description"):
        logger.error(
            "셋업이 필요합니다. config.yaml에 domain.name과 domain.description을 설정하세요."
        )
        return False
    return True


# ──────────────────────────────────────────────
# Google Sheets 탭 이름
# ──────────────────────────────────────────────
TAB_PROCESSED_VIDEOS = "_processed_videos"
TAB_MANUAL_QUEUE = "_manual_queue"
TAB_KEYWORDS = "_keywords"
TAB_AGENDAS = "agendas"
TAB_STATEMENTS = "statements"
TAB_NEWS_ARTICLES = "news_articles"

# ──────────────────────────────────────────────
# 환경 변수 키
# ──────────────────────────────────────────────
ENV_GOOGLE_CREDENTIALS = "GOOGLE_APPLICATION_CREDENTIALS"
ENV_ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY"
ENV_NAVER_CLIENT_ID = "NAVER_CLIENT_ID"
ENV_NAVER_CLIENT_SECRET = "NAVER_CLIENT_SECRET"
ENV_SPREADSHEET_ID = "SPREADSHEET_ID"
```

- [ ] **Step 2: Commit**

```bash
git add pipeline/config.py
git commit -m "feat: generalize config.py — remove hardcoded keywords, add validation"
```

### Task 5: Generalize pipeline/llm/prompts.py

**Files:**
- Modify: `pipeline/llm/prompts.py`

- [ ] **Step 1: Template domain variables into prompts**

Replace the entire file. Key changes:
- `company_names` → `entity_names`
- `"게임 산업"` → `{domain_name}`
- `"game"` category → `"domain"`
- Pass 2: game-specific keywords → `{domain_name}` + `{include_keywords}`

```python
"""LLM 프롬프트 정의. Pass 1(구조화) + Pass 2(검증)."""


def get_pass1_system_prompt(
    domain_name: str,
    domain_description: str,
    entity_names: list[str],
    include_keywords: list[str],
) -> str:
    """Pass 1: 자막 텍스트 → 구조화된 안건 JSON."""
    entities = ", ".join(entity_names) if entity_names else "(없음)"
    keywords = ", ".join(include_keywords[:20]) if include_keywords else "(키워드 미설정 — 모든 안건을 domain으로 분류)"

    return f"""당신은 한국 국정감사 영상 자막을 분석하여 {domain_name} 분야 정책팀에 보고할 수 있는 수준으로 정리하는 전문가입니다.
주어진 자막 텍스트에서 모든 안건(질의 주제)을 식별하고, 정책 보고에 활용할 수 있도록 구체적으로 구조화해 주세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트를 포함하지 마세요.

```json
{{
  "agendas": [
    {{
      "title": "안건 제목 (핵심 키워드 중심, 간결하게)",
      "category": "domain" 또는 "general",
      "summary": "안건 요약 (아래 작성 기준 참고)",
      "is_entity_mentioned": true 또는 false,
      "entity_mention_detail": "주요 기관/기업 언급 맥락 (아래 작성 기준 참고)",
      "statements": [
        {{
          "speaker_name": "의원 또는 답변자 이름",
          "speaker_party": "당적 약칭 (민/국/조/진/개/무 등, 답변자는 빈 문자열)",
          "speaker_role": "questioner" 또는 "respondent",
          "content": "발언 내용 요약 (아래 작성 기준 참고)"
        }}
      ]
    }}
  ]
}}
```

## 도메인 정의

{domain_description}

## 분류 기준

**"domain" 카테고리** (상세 정리 대상):
- {domain_name} 분야와 직접 관련된 안건
- 관련 키워드: {keywords}
- 위 주제와 직접 관련된 질의·답변

**"general" 카테고리** (간략 정리):
- 그 외 모든 안건
- statements 배열을 빈 배열 []로 작성
- summary는 1줄로 간결하게

## 주요 기관/기업 목록
{entities}

## 작성 기준 (매우 중요)

### summary 작성법
- domain 안건: 어떤 문제가 제기되었고, 어떤 요구가 있었는지 맥락이 드러나도록 2-3문장으로 작성
- 나쁜 예: "관련 논의" (너무 짧고 구체성 없음)

### content(발언 요약) 작성법
- 의원이 어떤 문제를 지적했고, 무엇을 요구했는지 구체적으로 서술
- "~을 지적하며, ~을 촉구함" / "~을 비판하며, ~을 요구함" 등 실제 보고서 문체 사용

### entity_mention_detail 작성법
- 단순 나열이 아닌, 어떤 맥락에서 왜 언급되었는지 기술

### 답변자 speaker_name 작성법
- 직함으로 표기 (예: "문체부 장관", "위원장")

## 기타 규칙

1. 안건 구분은 질의 주제가 바뀌는 지점 기준
2. 당적 추론: "더불어민주당" → 민, "국민의힘" → 국, "조국혁신당" → 조, "진보당" → 진, "개혁신당" → 개, 무소속 → 무
3. 답변자의 speaker_party는 빈 문자열
4. domain 안건의 statements에는 주요 질의 의원과 답변자를 모두 포함
5. 모든 텍스트는 한국어로 작성
6. 안건이 없으면 빈 agendas 배열 반환"""


def get_pass1_user_prompt(subtitle_text: str) -> str:
    """Pass 1 사용자 프롬프트."""
    return f"""다음은 국정감사 영상의 자막 텍스트입니다. 모든 안건을 식별하고 구조화해 주세요.

---
{subtitle_text}
---"""


def get_pass2_system_prompt(
    domain_name: str,
    entity_names: list[str],
    include_keywords: list[str],
) -> str:
    """Pass 2: 놓친 도메인 관련 내용 검증."""
    entities = ", ".join(entity_names) if entity_names else ""
    keywords = ", ".join(include_keywords) if include_keywords else ""

    return f"""당신은 국정감사 자막 분석 검수자입니다.
1차 분석에서 "general"로 분류된 안건 중 실제로는 {domain_name} 분야와 관련된 내용이 포함된 것이 있는지 점검하세요.

관련 키워드:
{keywords}
{entities}

반드시 아래 JSON 형식으로만 응답하세요:

```json
{{
  "reclassified": [
    {{
      "original_title": "1차에서 분류된 안건 제목",
      "reason": "관련 내용이 포함된 이유",
      "updated_agenda": {{
        "title": "안건 제목",
        "category": "domain",
        "summary": "상세 요약 (어떤 문제가 제기되었고 어떤 요구가 있었는지 맥락이 드러나도록)",
        "is_entity_mentioned": true 또는 false,
        "entity_mention_detail": "기관/기업 언급 맥락 (단순 나열이 아닌 배경 설명)",
        "statements": [
          {{
            "speaker_name": "이름",
            "speaker_party": "당적",
            "speaker_role": "questioner 또는 respondent",
            "content": "~을 지적하며, ~을 촉구함 형태로 구체적 서술"
          }}
        ]
      }}
    }}
  ]
}}
```

수정할 안건이 없으면 reclassified를 빈 배열 []로 반환하세요."""


def get_pass2_user_prompt(pass1_result: str, subtitle_text: str) -> str:
    """Pass 2 사용자 프롬프트."""
    return f"""## 1차 분석 결과
{pass1_result}

## 원본 자막 텍스트
{subtitle_text}

위 1차 결과에서 "general"로 분류된 안건을 다시 검토하여, 관련 분야 내용이 누락된 것이 있는지 확인해 주세요."""
```

- [ ] **Step 2: Commit**

```bash
git add pipeline/llm/prompts.py
git commit -m "feat: template domain variables into LLM prompts"
```

### Task 6: Generalize pipeline/text_processor.py

**Files:**
- Modify: `pipeline/text_processor.py`

- [ ] **Step 1: Remove DEFAULT keyword imports, update function signatures**

Key changes:
- Remove `from .config import DEFAULT_INCLUDE_KEYWORDS, DEFAULT_EXCLUDE_KEYWORDS`
- `merge_keywords()` → no longer merges with defaults, just merges config + user
- `process_text()`: `company_names` → `entity_names`, pass domain info to prompts
- `_run_pass1()`: accepts domain info
- Pass 2 trigger: use `include_keywords` instead of hardcoded game keywords
- Log messages: "game" → "domain"

```python
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

# 청크 분할 기준 (문자 수)
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
    """텍스트에 도메인 관련 키워드가 포함되어 있는지 판별한다.

    exclude 키워드에 해당하는 부분을 제거한 후 include 키워드를 검색한다.
    include가 빈 리스트면 항상 True를 반환 (필터링 스킵).
    """
    if not include:
        return True  # 키워드 미설정 시 모든 안건을 domain으로 분류

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
    """자막 텍스트를 분석하여 구조화된 안건 리스트를 반환한다.

    1. 키워드 필터로 도메인 관련 내용 존재 여부 확인
    2. LLM Pass 1: 전체 안건 구조화
    3. LLM Pass 2: 놓친 도메인 관련 내용 검증 (키워드가 있었을 경우)
    """
    has_domain_content = keyword_filter(subtitle_text, include_keywords, exclude_keywords)
    logger.info("키워드 필터 결과: has_domain_content=%s", has_domain_content)

    # 긴 자막 분할 처리
    chunks = _split_text(subtitle_text)
    logger.info("텍스트 청크 수: %d (총 %d자)", len(chunks), len(subtitle_text))

    all_agendas = []

    for i, chunk in enumerate(chunks):
        logger.info("Pass 1 처리 중: 청크 %d/%d", i + 1, len(chunks))
        pass1_result = _run_pass1(llm, chunk, domain_name, domain_description, entity_names, include_keywords)
        agendas = pass1_result.get("agendas", [])
        all_agendas.extend(agendas)

    # Pass 2: 도메인 키워드가 있었고, include_keywords가 설정되어 있다면 놓친 내용 검증
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
def _run_pass1(
    llm: LLMClient,
    text: str,
    domain_name: str,
    domain_description: str,
    entity_names: list[str],
    include_keywords: list[str],
) -> dict:
    """Pass 1: 자막 → 구조화된 안건 JSON."""
    system_prompt = get_pass1_system_prompt(domain_name, domain_description, entity_names, include_keywords)
    user_prompt = get_pass1_user_prompt(text)
    return llm.process(system_prompt, user_prompt)


@retry(max_attempts=2, delay=5.0)
def _run_pass2_llm(
    llm: LLMClient,
    pass1_json: str,
    text: str,
    domain_name: str,
    entity_names: list[str],
    include_keywords: list[str],
) -> dict:
    """Pass 2 LLM 호출."""
    system_prompt = get_pass2_system_prompt(domain_name, entity_names, include_keywords)
    user_prompt = get_pass2_user_prompt(pass1_json, text)
    return llm.process(system_prompt, user_prompt)


def _run_pass2(
    llm: LLMClient,
    agendas: list[dict],
    subtitle_text: str,
    domain_name: str,
    entity_names: list[str],
    include_keywords: list[str],
) -> list[dict]:
    """Pass 2: general 안건 중 도메인 관련 내용 누락 검증 후 병합."""
    pass1_json = json.dumps({"agendas": agendas}, ensure_ascii=False, indent=2)

    # Pass 2 입력이 너무 길면 자막을 축약
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
                logger.info("재분류: %s → domain", agenda["title"])
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
```

- [ ] **Step 2: Commit**

```bash
git add pipeline/text_processor.py
git commit -m "feat: generalize text_processor — domain-driven keywords and prompts"
```

### Task 7: Generalize pipeline/main.py

**Files:**
- Modify: `pipeline/main.py`

- [ ] **Step 1: Update main.py**

Key changes:
- Add `validate_config_for_pipeline()` call
- `company_names` → `entity_names`
- `merge_keywords()` now takes 4 args (config + user)
- `process_text()` now takes domain info
- `"game"` category check → `"domain"`
- `"company_mention_detail"` → `"entity_mention_detail"` in `_write_results`
- `"is_company_mentioned"` → `"is_entity_mentioned"` in `_write_results`
- Log messages updated

Changes (not full file — use Edit tool on specific sections):

Line 49: `"=== ParlaWatch 파이프라인 시작 ==="`

After `config = load_config()` (line 52), add:
```python
    from .config import validate_config_for_pipeline
    if not validate_config_for_pipeline(config):
        sys.exit(1)
```

Line 76: `company_names = config.get("company_names", [])` →
```python
    entity_names = config.get("entity_names", [])
    domain = config.get("domain", {})
    domain_name = domain.get("name", "")
    domain_description = domain.get("description", "")
    config_include = config.get("keywords", {}).get("include", [])
    config_exclude = config.get("keywords", {}).get("exclude", [])
```

Line 80: `merge_keywords(user_include, user_exclude)` →
```python
    include_kw, exclude_kw = merge_keywords(config_include, config_exclude, user_include, user_exclude)
```

Line 167: `process_text(subtitle_text, llm, company_names, include_kw, exclude_kw)` →
```python
            agendas_raw = process_text(
                subtitle_text, llm, domain_name, domain_description,
                entity_names, include_kw, exclude_kw,
            )
```

Line 173: `agenda.get("category") == "game"` → `agenda.get("category") == "domain"`

In `_write_results`:
- `"is_company_mentioned"` → `"is_entity_mentioned"`
- `"company_mention_detail"` → `"entity_mention_detail"`

Line 205: `"=== ParlaWatch 파이프라인 종료 ==="`

- [ ] **Step 2: Commit**

```bash
git add pipeline/main.py
git commit -m "feat: generalize main.py — domain-driven pipeline"
```

### Task 8: Generalize pipeline/sheets_client.py

**Files:**
- Modify: `pipeline/sheets_client.py`

- [ ] **Step 1: Rename columns in HEADERS dict**

In the HEADERS dict, change the `TAB_AGENDAS` entry:
- `"is_company_mentioned"` → `"is_entity_mentioned"`
- `"company_mention_detail"` → `"entity_mention_detail"`

Also update any `"gamwatch-header-"` protection ID prefix → `"parlawatch-header-"` (should already be done by branding step, but verify).

- [ ] **Step 2: Commit**

```bash
git add pipeline/sheets_client.py
git commit -m "feat: rename company columns to entity in sheets_client"
```

### Task 9: Generalize pipeline/cli.py

**Files:**
- Modify: `pipeline/cli.py`

- [ ] **Step 1: Update cli.py**

Key changes with explicit code:

After `config = load_config()` (around line 80), add domain/entity extraction:
```python
    entity_names = config.get("entity_names", [])
    domain = config.get("domain", {})
    domain_name = domain.get("name", "")
    domain_description = domain.get("description", "")
    config_include = config.get("keywords", {}).get("include", [])
    config_exclude = config.get("keywords", {}).get("exclude", [])
```

Line 87: `company_names = config.get("company_names", [])` → delete (replaced above)

Line 99: `merge_keywords(user_include, user_exclude)` →
```python
    include_kw, exclude_kw = merge_keywords(config_include, config_exclude, user_include, user_exclude)
```

Line 102: `process_text(subtitle_text, llm, company_names, include_kw, exclude_kw)` →
```python
    agendas = process_text(
        subtitle_text, llm, domain_name, domain_description,
        entity_names, include_kw, exclude_kw,
    )
```

Line 114: `game_count = sum(1 for a in agendas if a.get("category") == "game")` →
```python
    domain_count = sum(1 for a in agendas if a.get("category") == "domain")
```

Line 115-116: Update display text:
```python
    print(f"  관심 분야: {domain_count}개")
    print(f"  일반: {len(agendas) - domain_count}개")
```

Line 120: `"[게임]"` → `"[관심]"`, `"[일반]"` stays
Line 121: `"게임사언급"` → `"기관언급"`
Line 125: `"is_company_mentioned"` → `"is_entity_mentioned"`, `"company_mention_detail"` → `"entity_mention_detail"`

In `_write_to_sheets()`:
- `"is_company_mentioned"` → `"is_entity_mentioned"`
- `"company_mention_detail"` → `"entity_mention_detail"`
- Add `"event_type": "국정감사"` to agenda_records (was missing in GamWatch cli.py)

- [ ] **Step 2: Commit**

```bash
git add pipeline/cli.py
git commit -m "feat: generalize cli.py — entity_names, domain category"
```

### Task 10: Generalize pipeline/news_searcher.py

**Files:**
- Modify: `pipeline/news_searcher.py`

- [ ] **Step 1: Remove game-specific publisher mappings**

In `_extract_publisher()`, remove these 4 entries from `publisher_map`:
```python
            "inven.co.kr": "인벤",
            "gamemeca.com": "게임메카",
            "thisisgame.com": "디스이즈게임",
            "gamevu.co.kr": "게임뷰",
```

Keep all general press mappings (조선일보, 동아일보, etc.)

- [ ] **Step 2: Commit**

```bash
git add pipeline/news_searcher.py
git commit -m "feat: remove game-specific publisher mappings from news_searcher"
```

---

## Chunk 3: Dashboard Generalization

### Task 11: Generalize docs/config.js

**Files:**
- Modify: `docs/config.js`

- [ ] **Step 1: Replace with empty template**

```javascript
/**
 * ParlaWatch 대시보드 설정.
 * 셋업 위저드가 SPREADSHEET_ID와 SHEETS_API_KEY를 채워넣습니다.
 * GH_PAT은 보안상 코드에 포함하지 않고, 브라우저 localStorage에서 관리합니다.
 */
const CONFIG = {
  // Google Sheets (셋업 시 자동 기입)
  SPREADSHEET_ID: '',
  SHEETS_API_KEY: '',

  // GitHub Actions 트리거 (셋업 시 자동 기입)
  GH_OWNER: '',
  GH_REPO: '',
  GH_WORKFLOW_ID: 'pipeline.yml',

  // GH_PAT은 localStorage에서 로드
  get GH_PAT() {
    return localStorage.getItem('parlawatch_gh_pat') || '';
  },
  set GH_PAT(val) {
    localStorage.setItem('parlawatch_gh_pat', val);
  },

  // Sheets 탭 이름
  TABS: {
    AGENDAS: 'agendas',
    STATEMENTS: 'statements',
    NEWS_ARTICLES: 'news_articles',
    PROCESSED_VIDEOS: '_processed_videos',
    KEYWORDS: '_keywords',
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add docs/config.js
git commit -m "feat: generalize docs/config.js — empty template"
```

### Task 12: Generalize docs/app.js

**Files:**
- Modify: `docs/app.js`

- [ ] **Step 1: Remove DEFAULT keyword arrays and update category references**

Key changes:
- Remove `DEFAULT_INCLUDE_KEYWORDS` array (lines 51-60)
- Remove `DEFAULT_EXCLUDE_KEYWORDS` array (lines 61-68)
- All `localStorage.getItem('gamwatch_*')` → `'parlawatch_*'` (should be done by branding step)
- All `"game"` category references → `"domain"`
- All `"게임 관련"` display text → `"관심 분야"`
- All `"게임사언급"` → `"기관언급"` or `"관심기관 언급"`
- Remove committee filter hardcoding → build dynamically from Sheets data

Since this is a large file, use targeted find-and-replace operations.

- [ ] **Step 2: Commit**

```bash
git add docs/app.js
git commit -m "feat: generalize app.js — remove hardcoded keywords, domain categories"
```

### Task 13: Generalize docs/index.html

**Files:**
- Modify: `docs/index.html`

- [ ] **Step 1: Update title, headers, filter labels**

- Title: `"ParlaWatch — 국회 모니터링 대시보드"`
- Filter options: `"게임 관련"` → `"관심 분야"`
- Stats labels: `"게임 관련"` → `"관심 분야"`, `"게임사 언급"` → `"기관 언급"`
- Remove any game-industry specific text

- [ ] **Step 2: Commit**

```bash
git add docs/index.html
git commit -m "feat: generalize index.html — domain-neutral branding"
```

### Task 14: Generalize remaining docs/ files

**Files:**
- Modify: `docs/trigger.js`, `docs/report.js`, `docs/styles.css`

- [ ] **Step 1: Update trigger.js**

`localStorage` keys: `gamwatch_*` → `parlawatch_*` (verify branding step covered this)

- [ ] **Step 2: Update report.js**

Report title/header branding

- [ ] **Step 3: Update styles.css**

Remove any game-specific icons/images (if any). Keep color scheme.

- [ ] **Step 4: Commit**

```bash
git add docs/trigger.js docs/report.js docs/styles.css
git commit -m "feat: generalize remaining dashboard files"
```

### Task 15: Update .github/workflows/pipeline.yml

**Files:**
- Modify: `.github/workflows/pipeline.yml`

- [ ] **Step 1: Update workflow name and add comment about cron**

Line 1: `name: ParlaWatch Pipeline` (should be done by branding)

Add comment to cron:
```yaml
  schedule:
    # 매일 새벽 2시 KST (국감 기간 중에만 실행). 필요시 시간 변경.
    - cron: '0 17 * * *'
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/pipeline.yml
git commit -m "chore: update workflow branding"
```

---

## Chunk 4: Setup Module + CLAUDE.md

### Task 16: Create pipeline/setup/ module

**Files:**
- Create: `pipeline/setup/__init__.py`
- Create: `pipeline/setup/validator.py`
- Create: `pipeline/setup/sheets_creator.py`

- [ ] **Step 1: Create __init__.py**

```python
"""ParlaWatch 셋업 도우미 모듈."""
```

- [ ] **Step 2: Create validator.py**

```python
"""API 키 유효성 검증."""

import logging

logger = logging.getLogger(__name__)


def validate_anthropic(api_key: str) -> dict:
    """Anthropic API 키를 검증한다."""
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=10,
            messages=[{"role": "user", "content": "test"}],
        )
        return {"status": "ok", "message": "Anthropic API 연결 성공"}
    except Exception as e:
        return {"status": "error", "message": f"Anthropic API 오류: {e}"}


def validate_google_sheets(service_account_file: str, spreadsheet_id: str = "") -> dict:
    """Google Sheets API 서비스 계정을 검증한다."""
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        creds = service_account.Credentials.from_service_account_file(
            service_account_file,
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        service = build("sheets", "v4", credentials=creds)
        # 서비스 계정 자체의 유효성만 확인
        if spreadsheet_id:
            service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        return {"status": "ok", "message": "Google Sheets API 연결 성공"}
    except Exception as e:
        return {"status": "error", "message": f"Google Sheets API 오류: {e}"}


def validate_youtube(api_key: str) -> dict:
    """YouTube Data API 키를 검증한다."""
    try:
        from googleapiclient.discovery import build

        youtube = build("youtube", "v3", developerKey=api_key)
        youtube.search().list(q="국회", part="snippet", maxResults=1).execute()
        return {"status": "ok", "message": "YouTube Data API 연결 성공"}
    except Exception as e:
        return {"status": "error", "message": f"YouTube Data API 오류: {e}"}


def validate_naver(client_id: str, client_secret: str) -> dict:
    """Naver Search API를 검증한다."""
    try:
        import requests

        headers = {
            "X-Naver-Client-Id": client_id,
            "X-Naver-Client-Secret": client_secret,
        }
        resp = requests.get(
            "https://openapi.naver.com/v1/search/news.json",
            headers=headers,
            params={"query": "테스트", "display": 1},
            timeout=10,
        )
        resp.raise_for_status()
        return {"status": "ok", "message": "Naver Search API 연결 성공"}
    except Exception as e:
        return {"status": "error", "message": f"Naver Search API 오류: {e}"}


def validate_all(
    anthropic_key: str = "",
    sa_file: str = "",
    spreadsheet_id: str = "",
    youtube_key: str = "",
    naver_id: str = "",
    naver_secret: str = "",
) -> dict:
    """모든 API를 검증하고 결과를 반환한다."""
    results = {}

    if anthropic_key:
        results["anthropic"] = validate_anthropic(anthropic_key)
    if sa_file:
        results["google_sheets"] = validate_google_sheets(sa_file, spreadsheet_id)
    if youtube_key:
        results["youtube"] = validate_youtube(youtube_key)
    if naver_id and naver_secret:
        results["naver"] = validate_naver(naver_id, naver_secret)

    return results
```

- [ ] **Step 3: Create sheets_creator.py**

```python
"""Google Sheets 자동 생성 — 6개 탭 + 헤더."""

import logging
from typing import Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

TABS_AND_HEADERS = {
    "_processed_videos": [
        "video_id", "committee", "date", "title", "video_url",
        "source", "subtitle_source", "processed_at", "status", "error_message",
    ],
    "_manual_queue": [
        "url", "category", "committee", "date", "status",
    ],
    "_keywords": [
        "keyword", "type", "note",
    ],
    "agendas": [
        "agenda_id", "video_id", "committee", "date", "category",
        "title", "summary", "is_entity_mentioned", "entity_mention_detail", "sort_order",
        "event_type",
    ],
    "statements": [
        "statement_id", "agenda_id", "speaker_name", "speaker_party",
        "speaker_role", "content", "sort_order",
    ],
    "news_articles": [
        "article_id", "agenda_id", "title", "url", "publisher", "published_at",
    ],
}


def create_spreadsheet(
    service_account_file: str,
    title: str = "ParlaWatch Data",
    share_email: Optional[str] = None,
) -> str:
    """새 스프레드시트를 생성하고 6개 탭 + 헤더를 추가한다.

    Returns:
        생성된 spreadsheet_id
    """
    creds = service_account.Credentials.from_service_account_file(
        service_account_file, scopes=SCOPES,
    )
    sheets_service = build("sheets", "v4", credentials=creds)
    drive_service = build("drive", "v3", credentials=creds)

    # 1. 스프레드시트 생성 (6개 시트 한 번에)
    body = {
        "properties": {"title": title},
        "sheets": [
            {"properties": {"title": tab_name}}
            for tab_name in TABS_AND_HEADERS
        ],
    }
    spreadsheet = sheets_service.spreadsheets().create(body=body).execute()
    spreadsheet_id = spreadsheet["spreadsheetId"]
    logger.info("스프레드시트 생성: %s (ID: %s)", title, spreadsheet_id)

    # 2. 각 탭에 헤더 행 추가 (batchUpdate)
    data = []
    for tab_name, headers in TABS_AND_HEADERS.items():
        data.append({
            "range": f"{tab_name}!A1",
            "values": [headers],
        })

    sheets_service.spreadsheets().values().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"valueInputOption": "RAW", "data": data},
    ).execute()
    logger.info("헤더 행 추가 완료: %d개 탭", len(TABS_AND_HEADERS))

    # 3. 사용자 이메일로 편집 권한 공유
    if share_email:
        drive_service.permissions().create(
            fileId=spreadsheet_id,
            body={
                "type": "user",
                "role": "writer",
                "emailAddress": share_email,
            },
            sendNotificationEmail=False,
        ).execute()
        logger.info("편집 권한 공유: %s", share_email)

    return spreadsheet_id
```

- [ ] **Step 4: Commit**

```bash
git add pipeline/setup/
git commit -m "feat: add setup module — validator.py + sheets_creator.py"
```

### Task 17: Write CLAUDE.md setup wizard

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write comprehensive CLAUDE.md**

Replace the entire file with the setup wizard guide. This is the file Claude Code reads as a system prompt when the user enters the project directory.

The CLAUDE.md should include:
- Project overview
- Tech stack
- File structure
- Setup wizard phases 1-6 (interactive guide)
- Test commands
- Common tasks

(Full content to be written during implementation — too long for plan. Follow the design doc's Phase 1-6 structure.)

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "feat: write CLAUDE.md setup wizard"
```

---

## Chunk 5: Tests, Docs, and Verification

### Task 18: Write pytest tests

**Files:**
- Create: `tests/__init__.py`
- Create: `tests/test_config.py`
- Create: `tests/test_text_processor.py`
- Create: `tests/test_prompts.py`
- Create: `tests/test_validator.py`

- [ ] **Step 1: Create tests directory**

```bash
mkdir -p tests
touch tests/__init__.py
```

- [ ] **Step 2: Write test_config.py**

```python
"""config.py 테스트."""
import os
import tempfile
import pytest
import yaml
from pipeline.config import load_config, validate_config_for_pipeline


def _write_config(path, data):
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True)


class TestLoadConfig:
    def test_valid_config(self, tmp_path, monkeypatch):
        cfg = {"domain": {"name": "의료", "description": "의료 분야"}, "entity_names": ["삼성"]}
        config_path = tmp_path / "config.yaml"
        _write_config(config_path, cfg)
        monkeypatch.setattr("pipeline.config.CONFIG_PATH", config_path)
        result = load_config()
        assert result["domain"]["name"] == "의료"

    def test_empty_config(self, tmp_path, monkeypatch):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("", encoding="utf-8")
        monkeypatch.setattr("pipeline.config.CONFIG_PATH", config_path)
        result = load_config()
        assert result == {}

    def test_missing_config(self, tmp_path, monkeypatch):
        config_path = tmp_path / "nonexistent.yaml"
        monkeypatch.setattr("pipeline.config.CONFIG_PATH", config_path)
        result = load_config()
        assert result == {}

    def test_malformed_yaml(self, tmp_path, monkeypatch):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("invalid: yaml: [broken", encoding="utf-8")
        monkeypatch.setattr("pipeline.config.CONFIG_PATH", config_path)
        result = load_config()
        assert result == {}


class TestValidateConfig:
    def test_valid(self):
        cfg = {"domain": {"name": "금융", "description": "금융 분야"}}
        assert validate_config_for_pipeline(cfg) is True

    def test_missing_name(self):
        cfg = {"domain": {"name": "", "description": "금융 분야"}}
        assert validate_config_for_pipeline(cfg) is False

    def test_missing_domain(self):
        cfg = {}
        assert validate_config_for_pipeline(cfg) is False
```

- [ ] **Step 3: Write test_text_processor.py**

```python
"""text_processor.py 테스트."""
from pipeline.text_processor import merge_keywords, keyword_filter


class TestMergeKeywords:
    def test_merge_all(self):
        inc, exc = merge_keywords(["a", "b"], ["x"], ["b", "c"], ["y"])
        assert set(inc) == {"a", "b", "c"}
        assert set(exc) == {"x", "y"}

    def test_empty_config(self):
        inc, exc = merge_keywords([], [], ["a"], ["b"])
        assert inc == ["a"]
        assert exc == ["b"]

    def test_both_empty(self):
        inc, exc = merge_keywords([], [], [], [])
        assert inc == []
        assert exc == []


class TestKeywordFilter:
    def test_match(self):
        assert keyword_filter("의료 산업 관련 논의", ["의료"], []) is True

    def test_no_match(self):
        assert keyword_filter("교육 관련 논의", ["의료"], []) is False

    def test_exclude(self):
        assert keyword_filter("의료 체인저", ["의료"], ["의료 체인저"]) is False

    def test_empty_include(self):
        # 키워드 미설정 시 항상 True
        assert keyword_filter("아무 텍스트", [], []) is True
```

- [ ] **Step 4: Write test_prompts.py**

```python
"""prompts.py 테스트."""
from pipeline.llm.prompts import get_pass1_system_prompt, get_pass2_system_prompt


class TestPass1Prompt:
    def test_domain_interpolation(self):
        prompt = get_pass1_system_prompt("의료/제약", "의료 분야 정책", ["삼성바이오"], ["의료"])
        assert "의료/제약" in prompt
        assert "삼성바이오" in prompt
        assert "domain" in prompt
        assert "game" not in prompt

    def test_empty_entities(self):
        prompt = get_pass1_system_prompt("금융", "금융 분야", [], ["금융"])
        assert "금융" in prompt
        assert "(없음)" in prompt

    def test_empty_keywords(self):
        prompt = get_pass1_system_prompt("교육", "교육 분야", [], [])
        assert "키워드 미설정" in prompt


class TestPass2Prompt:
    def test_domain_interpolation(self):
        prompt = get_pass2_system_prompt("의료", ["삼성바이오"], ["의료", "제약"])
        assert "의료" in prompt
        assert "삼성바이오" in prompt
        assert "game" not in prompt
```

- [ ] **Step 5: Run tests**

```bash
cd "/Users/kpsfamily/코딩 프로젝트/parlawatch"
source .venv/bin/activate
pytest tests/ -v
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "test: add pytest tests for config, text_processor, prompts"
```

### Task 19: Write README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md in Korean**

Cover: project description, features, setup instructions (pointing to CLAUDE.md), architecture diagram, tech stack, license.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README.md"
```

### Task 20: Final verification

- [ ] **Step 1: Verify no game-industry hardcoding remains**

```bash
grep -ri "게임" pipeline/ docs/ --include="*.py" --include="*.js" --include="*.html" | grep -v config.example.yaml | grep -v __pycache__
grep -ri "gamwatch" . --include="*.py" --include="*.js" --include="*.yaml" --include="*.yml" --include="*.html" --include="*.md" --include="*.css" | grep -v config.example.yaml | grep -v .git/
grep -ri "company_name" pipeline/ --include="*.py" | grep -v config.example.yaml | grep -v __pycache__
grep -ri "company_mention" pipeline/ --include="*.py" | grep -v config.example.yaml | grep -v __pycache__
```

Expected: All 0 results.

- [ ] **Step 2: Verify CLI works**

```bash
cd "/Users/kpsfamily/코딩 프로젝트/parlawatch"
source .venv/bin/activate
python -m pipeline.cli --help
```

Expected: Shows help text with "ParlaWatch" branding.

- [ ] **Step 3: Verify config loads**

```bash
python -c "from pipeline.config import load_config, validate_config_for_pipeline; c = load_config(); print('loaded:', bool(c)); print('valid:', validate_config_for_pipeline(c))"
```

Expected: `loaded: True`, `valid: False` (because domain.name is empty in template)

- [ ] **Step 4: Run all tests**

```bash
pytest tests/ -v
```

Expected: All PASS.

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: final verification fixes"
```

### Task 21: github-folio integration

**Files:**
- Modify: (external) `github-folio/src/repos.js`

- [ ] **Step 1: Add ParlaWatch entry to github-folio**

```javascript
{
  name: 'parlawatch',
  category: 'Legal AI',
  description: {
    ko: 'AI 기반 국회 모니터링 자동화 도구. 유튜브 국회방송 자막을 자동 추출 → Claude AI 분석 → Google Sheets 저장 → 실시간 대시보드. Claude Code로 원클릭 셋업.',
    en: 'AI-powered Korean National Assembly monitoring. Auto-extracts YouTube subtitles → Claude AI analysis → Google Sheets → real-time dashboard. One-click setup via Claude Code.',
  },
}
```

- [ ] **Step 2: Commit in github-folio repo**

---

## Summary

| Chunk | Tasks | Estimated CC Time |
|-------|-------|-------------------|
| 1: Initialization | Tasks 1-2 | ~15 min |
| 2: Pipeline | Tasks 3-10 | ~45 min |
| 3: Dashboard | Tasks 11-15 | ~20 min |
| 4: Setup Module | Tasks 16-17 | ~30 min |
| 5: Tests & Verify | Tasks 18-21 | ~20 min |
| **Total** | **21 tasks** | **~2-2.5 hours** |
