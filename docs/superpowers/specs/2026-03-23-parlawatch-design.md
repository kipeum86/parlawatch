# ParlaWatch — 범용 국회 모니터링 도구

## Context

GamWatch는 게임산업 특화 국정감사 모니터링 시스템으로, 실제 업무에서 잘 쓰이고 있지만 도메인이 하드코딩되어 포트폴리오에 그대로 올릴 수 없다. **어떤 산업이든** 국회 모니터링에 활용할 수 있는 범용 버전 "ParlaWatch"를 만들어 github-folio에 showcase로 올린다.

**핵심 차별점**: Claude Code가 대화형으로 초기 셋업을 안내하는 온보딩 위저드.

## 결정 사항

- **범위**: 한국 국회 모니터링 특화 (산업/키워드만 사용자 지정)
- **이름**: ParlaWatch (Parliament + Watch)
- **접근법**: Fork & Refactor (GamWatch 코드 기반, 게임산업 요소만 제거/추상화)
- **셋업 방식**: CLAUDE.md 기반 대화형 셋업 (Claude Code가 위저드 역할)
- **언어**: 한국어 (한국 국회 특화 제품)
- **github-folio 카테고리**: Legal AI

---

## Step 1: 프로젝트 초기화

1. GamWatch 레포를 로컬에 복사하여 `parlawatch/` 디렉토리 생성
2. `.git` 초기화 (새 레포)
3. 파일 전체에서 "GamWatch", "gamwatch" → "ParlaWatch", "parlawatch" 브랜딩 변경
4. `README.md` 새로 작성 (한국어, ParlaWatch 소개 + 셋업 안내)

**대상 파일:**
- `/Users/kpsfamily/코딩 프로젝트/gamwatch-national-audit-monitoring/` (원본, 읽기 전용)

## Step 2: config.yaml 범용화

`config.yaml`을 빈 템플릿으로 변경:

```yaml
domain:
  name: ""              # 사용자 도메인 (예: "의료/제약", "금융")
  description: ""       # LLM 프롬프트에 삽입될 도메인 설명

committees: []          # 셋업 시 추가
entity_names: []        # 기존 company_names → 범용 이름
keywords:
  include: []
  exclude: []
audit_period:
  start: ""
  end: ""

sheets:
  spreadsheet_id: ""    # 셋업 시 자동 생성/입력

# 아래는 기본값 유지
llm:
  provider: "claude"
  model: "claude-haiku-4-5-20251001"
  max_tokens: 16384
youtube:
  channels:
    - id: ""
      name: "국회방송"
pipeline:
  retry_count: 3
  retry_delay_seconds: 5
  news_results_per_agenda: 5
  search_days_back: 7
```

참고용 `config.example.yaml` 제공 (게임산업 예시, 기존 config.yaml 내용).

## Step 3: pipeline/config.py 범용화

- `DEFAULT_INCLUDE_KEYWORDS`, `DEFAULT_EXCLUDE_KEYWORDS` 하드코딩 제거
- config.yaml의 `keywords.include`, `keywords.exclude`에서 로드
- 빈 키워드면 모든 안건을 domain으로 분류 (키워드 필터링 스킵)

## Step 4: LLM 프롬프트 템플릿화

`pipeline/llm/prompts.py` 변경:

- `get_pass1_system_prompt(company_names)` → `get_pass1_system_prompt(domain_name, domain_description, entity_names, include_keywords)`
- "게임 산업" 하드코딩 → `{domain_name}` 변수
- "game" 카테고리 → "domain" 카테고리
- 게임사 목록 → `entity_names`
- Pass 1 분류 기준: config의 keywords + domain description 기반으로 동적 생성
- `get_pass2_system_prompt` 동일하게 템플릿화
- 게임 관련 키워드 하드코딩 → config에서 주입

## Step 5: text_processor.py 수정

- 키워드 필터링 로직에서 하드코딩 키워드 대신 config에서 읽어온 키워드 사용
- "game" 카테고리 참조 → "domain"으로 변경
- `company_names` 파라미터명 → `entity_names`

## Step 6: main.py 수정

- config에서 `domain`, `entity_names`, `keywords` 읽어서 파이프라인에 전달
- `company_names` → `entity_names` 파라미터 변경
- "game" 카테고리 참조 → "domain"

## Step 7: 셋업 모듈 구현 (`pipeline/setup/`)

### 7-1: `pipeline/setup/sheets_creator.py`
- Google Sheets API로 새 스프레드시트 자동 생성
- 6개 탭 생성 + 각 탭에 헤더 행 추가 (기존 `HEADERS` dict 재사용)
- 사용자 이메일로 편집 권한 공유
- 생성된 spreadsheet_id 반환

### 7-2: `pipeline/setup/validator.py`
- API 키 유효성 검증:
  - Anthropic API: 간단한 테스트 호출
  - Google Sheets API: 서비스 계정 권한 확인
  - YouTube Data API: 쿼터 확인
  - Naver API: 검색 테스트 (선택)
- 검증 결과를 사람이 읽을 수 있는 형태로 반환

### 7-3: `pipeline/setup/__init__.py`
- setup 모듈 진입점

## Step 8: CLAUDE.md 작성 (셋업 위저드)

CLAUDE.md에 대화형 셋업 가이드를 내장. Claude Code가 이 파일을 읽고 사용자를 단계별로 안내.

### Phase 1: 사전 준비물 안내
1. Google Cloud 프로젝트 생성 안내 (Sheets API + YouTube API 활성화)
2. 서비스 계정 JSON 키 다운로드 안내 (단계별 링크 제공)
3. Anthropic API 키 안내
4. (선택) 네이버 검색 API 안내
5. GitHub PAT 안내
6. 각 항목 준비 완료 여부 하나씩 확인

### Phase 2: API 키 검증
- .env 파일 생성
- pipeline/setup/validator.py로 각 API 테스트
- 실패 시 구체적 해결 방법 안내

### Phase 3: Google Sheets 자동 생성
- pipeline/setup/sheets_creator.py 실행
- 6개 탭 + 헤더 자동 생성
- 사용자 이메일로 공유
- config.yaml에 spreadsheet_id 자동 기입

### Phase 4: 도메인 설정
- 산업/분야 질문
- 관련 상임위 선택 (전체 상임위 목록 제시)
- 키워드 설정 (AI 추천 + 사용자 입력)
- 주요 기업/기관 설정
- 감사 기간 설정
- config.yaml 자동 업데이트

### Phase 5: GitHub Actions 설정 안내
- Repository Secrets 설정 가이드
- workflow_dispatch 테스트

### Phase 6: 테스트 실행
- 샘플 영상으로 파이프라인 테스트
- 결과 확인

## Step 9: 대시보드 범용화 (`docs/`)

### 9-1: `docs/config.js`
- 하드코딩된 SPREADSHEET_ID, SHEETS_API_KEY, GH_OWNER, GH_REPO 제거
- 셋업 시 자동 생성되는 `docs/config.js`로 변경 (빈 템플릿 제공)
- `gamwatch_*` localStorage 키 → `parlawatch_*`

### 9-2: `docs/app.js`
- "GamWatch" 브랜딩 → "ParlaWatch"
- `DEFAULT_INCLUDE_KEYWORDS`, `DEFAULT_EXCLUDE_KEYWORDS` 하드코딩 제거
- Google Sheets의 `_keywords` 탭에서만 키워드 로드
- "게임" 관련 텍스트/레이블 → 도메인 중립적 표현으로
  - "게임 관련 안건" → "관심 분야 안건" 또는 config에서 읽은 domain.name
- `game`/`general` 카테고리 → `domain`/`general`
- 위원회 필터: 하드코딩 → Sheets 데이터에서 동적 생성

### 9-3: `docs/index.html`
- 타이틀, 헤더 브랜딩 변경
- "게임산업" 관련 텍스트 제거/범용화

### 9-4: `docs/trigger.js`
- `gamwatch_*` localStorage 키 → `parlawatch_*`
- GH_REPO 참조 변경

### 9-5: `docs/styles.css`
- 브랜딩 색상은 유지하되, 게임 관련 아이콘/이미지 제거

### 9-6: `docs/report.js`
- 리포트 제목/헤더 브랜딩 변경

## Step 10: GitHub Actions 범용화

`.github/workflows/pipeline.yml`:
- `gamwatch` 참조 → `parlawatch`
- cron 스케줄 주석 명확화 (사용자가 변경해야 함을 안내)
- workflow_dispatch 입력 파라미터는 동일 유지

## Step 11: sheets_client.py 업데이트

- `company_mention_detail` 컬럼명 → `entity_mention_detail`
- HEADERS dict에서 `is_company_mentioned` → `is_entity_mentioned`, `company_mention_detail` → `entity_mention_detail`

## Step 12: cli.py 업데이트

- 브랜딩 변경
- `company_names` → `entity_names` 파라미터 변경

## Step 13: github-folio 통합

`github-folio/src/repos.js`에 ParlaWatch 항목 추가:

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

## Step 14: 문서 정비

- `README.md`: ParlaWatch 소개, 기능, 스크린샷 위치, 셋업 안내 (한국어)
- `config.example.yaml`: 게임산업 예시 설정 (참고용)
- 기존 `GamWatch_사용설명서.md` → `ParlaWatch_사용설명서.md`로 업데이트
- `architecture.html` 브랜딩 업데이트

---

## 수정 파일 총 정리

### 신규 생성
- `pipeline/setup/__init__.py`
- `pipeline/setup/sheets_creator.py`
- `pipeline/setup/validator.py`
- `config.example.yaml`
- `README.md` (새로 작성)

### 핵심 수정 (로직 변경)
- `config.yaml` — 빈 템플릿화
- `pipeline/config.py` — 하드코딩 키워드 제거
- `pipeline/llm/prompts.py` — 도메인 변수 템플릿화
- `pipeline/text_processor.py` — 카테고리/키워드 범용화
- `pipeline/main.py` — config 연동 변경
- `pipeline/sheets_client.py` — 컬럼명 변경
- `pipeline/cli.py` — 파라미터명 변경
- `CLAUDE.md` — 셋업 위저드 가이드

### 브랜딩/UI 수정
- `docs/config.js`
- `docs/app.js`
- `docs/index.html`
- `docs/trigger.js`
- `docs/report.js`
- `docs/styles.css`
- `.github/workflows/pipeline.yml`
- `architecture.html`

### 외부 프로젝트
- `github-folio/src/repos.js` — ParlaWatch 항목 추가

---

## Verification

### 1. 코드 검증
- `config.yaml`이 빈 상태에서 에러 없이 로드되는지 확인
- `python -m pipeline.cli --help`가 정상 실행되는지 확인
- 게임 관련 하드코딩이 남아있지 않은지 grep으로 확인:
  ```bash
  grep -ri "게임" pipeline/ docs/ --include="*.py" --include="*.js" --include="*.html"
  grep -ri "gamwatch" . --include="*.py" --include="*.js" --include="*.yaml" --include="*.html" --include="*.md"
  ```

### 2. 셋업 모듈 검증
- `sheets_creator.py`: 테스트 서비스 계정으로 시트 생성 → 6탭 + 헤더 확인
- `validator.py`: 각 API 검증 함수 개별 테스트

### 3. 대시보드 검증
- `docs/index.html`을 로컬에서 열어 브랜딩 확인
- "게임", "GamWatch" 텍스트가 없는지 확인
- 카테고리 필터가 "domain"/"general"로 동작하는지 확인

### 4. github-folio 검증
- `npm run dev`로 로컬 실행 → ParlaWatch 카드가 Legal AI 카테고리에 표시되는지 확인
