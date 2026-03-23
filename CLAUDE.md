# ParlaWatch — 범용 국회 모니터링 도구

## 개요

국회 모니터링을 자동화하는 도구입니다. 어떤 산업/분야든 키워드와 도메인만 설정하면 국회 영상을 자동 분석합니다.

**핵심 흐름:** 유튜브 국회방송 → 자막 추출 → Claude AI 분석 → Google Sheets 저장 → 대시보드

## 기술 스택

- **LLM**: Claude (Anthropic API) — 2-pass 분석 (구조화 + 검증)
- **자막 추출**: youtube-transcript-api → NotebookLM → yt-dlp (fallback)
- **데이터 저장**: Google Sheets API (6개 탭)
- **자동 실행**: GitHub Actions (cron + workflow_dispatch)
- **대시보드**: Vanilla JS + GitHub Pages

## 프로젝트 구조

```
pipeline/              — Python 백엔드
  config.py            — 설정 로드 + 상수
  main.py              — 파이프라인 오케스트레이터
  cli.py               — 수동 분석 CLI
  text_processor.py    — 키워드 필터 + LLM 2-pass 분석
  sheets_client.py     — Google Sheets API 래퍼
  subtitle_extractor.py — 자막 추출 (3가지 소스)
  video_detector.py    — YouTube 영상 감지
  news_searcher.py     — Naver 뉴스 검색
  llm/                 — LLM 클라이언트 + 프롬프트
  setup/               — 셋업 도우미 (검증, Sheets 생성)
docs/                  — GitHub Pages 대시보드
.github/workflows/     — GitHub Actions
config.yaml            — 도메인, 키워드, 기관 설정
config.example.yaml    — 게임산업 예시 설정
```

## 테스트

```bash
pytest tests/ -v
```

## 셋업 가이드

사용자가 "셋업해줘", "/setup", 또는 처음 프로젝트를 열었을 때 아래 Phase를 순서대로 안내하세요.

### Phase 1: 사전 준비물 확인

아래 항목을 하나씩 확인합니다:

1. **Google Cloud 프로젝트**
   - Google Cloud Console에서 프로젝트 생성
   - Google Sheets API 활성화
   - YouTube Data API v3 활성화
   - 서비스 계정 생성 → JSON 키 다운로드 → 프로젝트 루트에 `sa.json`으로 저장

2. **Anthropic API 키**
   - console.anthropic.com에서 API 키 발급

3. **(선택) Naver Search API**
   - developers.naver.com에서 검색 API 등록
   - Client ID + Client Secret 확보

각 항목 준비 완료 여부를 사용자에게 확인하세요.

### Phase 2: API 키 검증

1. `.env` 파일 생성:
```bash
GOOGLE_APPLICATION_CREDENTIALS=sa.json
ANTHROPIC_API_KEY=sk-ant-...
NAVER_CLIENT_ID=...        # 선택
NAVER_CLIENT_SECRET=...    # 선택
```

2. 검증 실행:
```python
from pipeline.setup.validator import validate_all
results = validate_all(
    anthropic_key="...",
    sa_file="sa.json",
)
print(results)
```

실패한 API가 있으면 구체적 해결 방법을 안내하세요.

### Phase 3: Google Sheets 자동 생성

```python
from pipeline.setup.sheets_creator import create_spreadsheet
spreadsheet_id = create_spreadsheet(
    service_account_file="sa.json",
    title="ParlaWatch - [도메인명] 모니터링",
    share_email="사용자이메일@gmail.com",
)
print(f"Spreadsheet ID: {spreadsheet_id}")
```

생성된 `spreadsheet_id`를 `config.yaml`의 `sheets.spreadsheet_id`에 기입하세요.

실패 시 대안: Google Sheets에서 수동으로 스프레드시트를 만들고, 6개 탭(_processed_videos, _manual_queue, _keywords, agendas, statements, news_articles)을 직접 생성한 후 spreadsheet_id를 config.yaml에 입력.

### Phase 4: 도메인 설정

사용자에게 다음을 질문하세요:

1. **모니터링할 산업/분야는?** (예: 의료/제약, 금융, 교육)
2. **관심 상임위원회는?** (전체 상임위 목록을 보여주고 선택하게)
   - 기획재정위, 교육위, 과학기술정보방송통신위, 외교통일위, 국방위, 행정안전위, 문화체육관광위, 농림축산식품해양수산위, 산업통상자원중소벤처기업위, 보건복지위, 환경노동위, 국토교통위, 정보위, 여성가족위, 법제사법위, 정무위
3. **포함할 키워드는?** (AI가 도메인에 맞게 추천하고 사용자가 수정)
4. **제외할 키워드는?** (오탐 방지용, AI 추천)
5. **주요 모니터링 대상 기업/기관은?**
6. **모니터링 기간은?** (예: 2026-10-01 ~ 2026-10-31)

답변을 바탕으로 `config.yaml`을 자동 업데이트하세요.

### Phase 5: GitHub 설정

GitHub Actions를 사용하려면:

1. GitHub에 ParlaWatch 레포 생성
2. Repository Settings → Secrets and variables → Actions에서 추가:
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: sa.json 내용 전체
   - `SPREADSHEET_ID`: 위에서 생성한 ID
   - `ANTHROPIC_API_KEY`: Anthropic API 키
   - `NAVER_CLIENT_ID`: (선택)
   - `NAVER_CLIENT_SECRET`: (선택)
3. `docs/config.js`에 SPREADSHEET_ID, SHEETS_API_KEY, GH_OWNER, GH_REPO 기입

### Phase 6: 테스트 실행

```bash
# 환경 변수 로드
export $(cat .env | xargs)

# 테스트 영상으로 파이프라인 테스트
python -m pipeline.cli "유튜브URL" --committee "상임위명" --dry-run
```

결과를 확인하고, 문제가 있으면 에러 로그를 분석해서 해결 방법을 안내하세요.

## 일반 작업

### 영상 수동 분석
```bash
python -m pipeline.cli "유튜브URL" --committee 문체위 --date 2026-10-23
```

### 전체 파이프라인 실행
```bash
python -m pipeline.main
```

### 대시보드 로컬 확인
```bash
cd docs && python -m http.server 8000
```
`http://localhost:8000` 에서 확인
