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
        "summary": "상세 요약",
        "is_entity_mentioned": true 또는 false,
        "entity_mention_detail": "기관/기업 언급 맥락",
        "statements": [
          {{
            "speaker_name": "이름",
            "speaker_party": "당적",
            "speaker_role": "questioner 또는 respondent",
            "content": "구체적 서술"
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
