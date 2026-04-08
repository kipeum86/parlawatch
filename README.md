# ParlaWatch — 범용 국회 모니터링 도구

**한국어** · [English](README.en.md)

AI 기반 국회 모니터링 자동화 도구입니다. 어떤 산업/분야든 키워드와 도메인만 설정하면 국회 영상을 자동으로 분석합니다.

```
유튜브 국회방송 → 자막 추출 → Claude AI 분석 → Google Sheets → 대시보드
```

## 주요 기능

- **도메인 무관 모니터링** — 의료, 금융, 교육, 어떤 산업이든 `config.yaml` 설정만으로 사용
- **AI 2-pass 분석** — Claude AI가 자막을 구조화(Pass 1) + 누락 검증(Pass 2)
- **Claude Code 셋업 위저드** — Claude Code에서 프로젝트를 열면 대화형으로 셋업 안내
- **실시간 대시보드** — GitHub Pages에서 분석 결과를 필터/검색
- **자동 실행** — GitHub Actions가 매일 새벽 자동으로 파이프라인 실행

### 문서

| 문서 | 설명 |
|------|------|
| **[대시보드 데모](https://kipeum86.github.io/parlawatch/)** | 의료/제약 산업 예시 데이터로 구성된 대시보드 데모 |
| **[시스템 아키텍처](https://kipeum86.github.io/parlawatch/architecture.html)** | 10개 섹션 — 파이프라인, 자막 추출, AI 분석, 데이터 구조, 설정 체계 |

---

## 사전 준비물

시작하기 전에 아래 4가지를 준비하세요.

### 1. Google Cloud 프로젝트 + 서비스 계정

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 새 프로젝트 생성 (예: `parlawatch`)
3. **API 활성화** — 좌측 메뉴 → API 및 서비스 → 라이브러리에서:
   - `Google Sheets API` 검색 → **사용** 클릭
   - `YouTube Data API v3` 검색 → **사용** 클릭
   - `Google Drive API` 검색 → **사용** 클릭
4. **서비스 계정 생성** — API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → 서비스 계정
   - 이름: `parlawatch` (아무거나)
   - 역할: 편집자 (Editor)
5. **JSON 키 다운로드** — 생성된 서비스 계정 클릭 → 키 탭 → 키 추가 → JSON
   - 다운로드된 파일을 프로젝트 루트에 `sa.json`으로 저장

### 2. Google Sheets API 키 (대시보드용)

대시보드가 Google Sheets 데이터를 읽으려면 별도의 API 키가 필요합니다.

1. Google Cloud Console → API 및 서비스 → 사용자 인증 정보
2. **사용자 인증 정보 만들기** → **API 키**
3. 생성된 API 키 복사 (나중에 `docs/config.js`에 입력)
4. (권장) API 키 제한: Google Sheets API만 허용

### 3. Anthropic API 키

1. [console.anthropic.com](https://console.anthropic.com/) 접속
2. API Keys → Create Key
3. 키 복사 (`sk-ant-...` 형태)

### 4. (선택) Naver Search API

관련 뉴스 기사를 자동 검색하려면 필요합니다. 없어도 파이프라인은 동작합니다.

1. [developers.naver.com](https://developers.naver.com/) 접속
2. 애플리케이션 등록 → 검색 API 선택
3. Client ID + Client Secret 확보

---

## 설치 및 셋업

### Step 1: 프로젝트 클론

```bash
git clone https://github.com/kipeum86/parlawatch.git
cd parlawatch
```

### Step 2: Python 환경 설정

```bash
python3 -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Step 3: 환경 변수 설정

프로젝트 루트에 `.env` 파일 생성:

```bash
GOOGLE_APPLICATION_CREDENTIALS=sa.json
ANTHROPIC_API_KEY=sk-ant-여기에키입력
SPREADSHEET_ID=           # Step 5에서 채움
NAVER_CLIENT_ID=          # 선택
NAVER_CLIENT_SECRET=      # 선택
```

### Step 4: API 키 검증

```bash
source .venv/bin/activate
export $(cat .env | xargs)
python3 -c "
from pipeline.setup.validator import validate_all
results = validate_all(
    anthropic_key='$ANTHROPIC_API_KEY',
    sa_file='sa.json',
)
for api, result in results.items():
    status = '✓' if result['status'] == 'ok' else '✗'
    print(f'  {status} {api}: {result[\"message\"]}')
"
```

모든 API가 `✓`로 표시되어야 합니다. 실패 시 키를 다시 확인하세요.

### Step 5: Google Sheets 자동 생성

```bash
python3 -c "
from pipeline.setup.sheets_creator import create_spreadsheet
sid = create_spreadsheet(
    service_account_file='sa.json',
    title='ParlaWatch - 모니터링',
    share_email='내이메일@gmail.com',   # 본인 Gmail 주소
)
print(f'Spreadsheet ID: {sid}')
print('이 ID를 config.yaml과 .env에 입력하세요.')
"
```

출력된 Spreadsheet ID를:
1. `.env` 파일의 `SPREADSHEET_ID=` 뒤에 입력
2. `config.yaml`의 `sheets.spreadsheet_id:` 뒤에 입력

생성된 시트는 본인 Gmail로 공유되므로 [Google Sheets](https://docs.google.com/spreadsheets/)에서 바로 확인 가능합니다.

### Step 6: 도메인 설정

`config.yaml`을 열고 모니터링할 분야를 설정합니다.

```yaml
# 예시: 의료/제약 산업 모니터링
domain:
  name: "의료/제약"
  description: "의료, 제약, 바이오 산업 관련 국회 모니터링. 의약품 허가, 건강보험, 병원 정책, 제약사 규제 등을 추적합니다."

entity_names:
  - "삼성바이오로직스"
  - "셀트리온"
  - "한미약품"

keywords:
  include:
    - "의료"
    - "제약"
    - "바이오"
    - "건강보험"
    - "의약품"
  exclude:
    - "의료 사고"    # 오탐 방지 (필요 시)

committees:
  - code: "bokji"
    name: "보건복지위원회"
    search_terms: ["복지위", "보건복지위원회"]

audit_period:
  start: "2026-10-01"
  end: "2026-10-31"
```

> **참고:** `config.example.yaml`에 게임산업 예시가 있으니 참고하세요.

### Step 7: 테스트 실행

```bash
source .venv/bin/activate
export $(cat .env | xargs)

# 국회방송 영상 하나로 테스트 (Sheets 기록 없이)
python -m pipeline.cli "https://www.youtube.com/watch?v=영상ID" --committee "보건복지위원회" --dry-run
```

`분석 완료: N개 안건`이 출력되면 성공입니다.

Sheets에도 기록하려면 `--dry-run`을 빼고 실행하세요.

---

## 대시보드 설정 (GitHub Pages)

분석 결과를 웹 대시보드에서 보려면 GitHub Pages를 설정합니다.

### Step 1: 본인 GitHub에 레포 생성

```bash
# 기존 origin 제거 후 본인 레포로 설정
git remote remove origin
gh repo create 내레포이름 --public --source . --push
```

또는 GitHub에서 수동으로 레포를 만들고:
```bash
git remote add origin https://github.com/내아이디/내레포이름.git
git push -u origin main
```

### Step 2: GitHub Pages 활성화

1. GitHub 레포 → **Settings** 탭
2. 좌측 메뉴 → **Pages**
3. Source: **Deploy from a branch**
4. Branch: `main`, Folder: `/docs` 선택
5. **Save** 클릭

약 1-2분 후 `https://내아이디.github.io/내레포이름/` 으로 대시보드 접속 가능.

### Step 3: 대시보드 설정값 입력

`docs/config.js`를 열고 빈 값을 채웁니다:

```javascript
const CONFIG = {
  SPREADSHEET_ID: '여기에_Spreadsheet_ID',        // Step 5에서 생성한 ID
  SHEETS_API_KEY: '여기에_Sheets_API_키',          // 사전 준비물 2번에서 만든 API 키

  GH_OWNER: '내GitHub아이디',                      // 예: 'kipeum86'
  GH_REPO: '내레포이름',                           // 예: 'parlawatch'
  GH_WORKFLOW_ID: 'pipeline.yml',
  // ...
};
```

변경 후 commit + push:
```bash
git add docs/config.js
git commit -m "config: add dashboard settings"
git push
```

### Step 4: 대시보드 접속 확인

`https://내아이디.github.io/내레포이름/` 접속 → 비밀번호 입력 → 대시보드 확인.

아직 데이터가 없으면 빈 화면이 정상입니다. 파이프라인을 실행하면 데이터가 채워집니다.

---

## GitHub Actions 자동 실행 설정

매일 새벽 자동으로 파이프라인을 실행하려면:

### Step 1: Repository Secrets 등록

GitHub 레포 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret 이름 | 값 |
|------------|-----|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `sa.json` 파일 **내용 전체** (JSON 텍스트) |
| `SPREADSHEET_ID` | Google Sheets ID |
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `NAVER_CLIENT_ID` | (선택) Naver Client ID |
| `NAVER_CLIENT_SECRET` | (선택) Naver Client Secret |

### Step 2: 수동 테스트

1. GitHub 레포 → **Actions** 탭
2. 좌측 **ParlaWatch Pipeline** 클릭
3. **Run workflow** → 유튜브 URL 입력 → **Run workflow** 클릭
4. 실행 완료 후 Google Sheets에서 데이터 확인

### Step 3: 자동 실행 확인

`.github/workflows/pipeline.yml`에 설정된 cron (`0 17 * * *` = 매일 새벽 2시 KST)이 `config.yaml`의 `audit_period` 기간 내에만 자동 실행됩니다.

> **주의:** 대시보드에서 "전체 파이프라인 실행" 버튼을 사용하려면, 대시보드 ⚙ 설정에서 GitHub PAT(Personal Access Token)을 입력해야 합니다. PAT은 GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → `repo`, `workflow` 권한으로 생성합니다.

---

## 일상 사용법

### 자동 모니터링
설정이 끝나면 별도 조작 없이 매일 자동 실행됩니다. 대시보드에서 결과를 확인하세요.

### 수동 영상 분석
```bash
# 터미널에서 직접 실행
python -m pipeline.cli "유튜브URL" --committee "상임위명" --date 2026-10-23

# 대시보드에서 실행
대시보드 → "영상 분석 요청" 버튼 → URL 입력
```

### 대시보드 로컬 미리보기
```bash
cd docs && python -m http.server 8000
# http://localhost:8000 에서 확인
```

---

## 기술 스택

| 구성 요소 | 기술 |
|-----------|------|
| LLM | Claude (Anthropic API) |
| 자막 추출 | youtube-transcript-api → NotebookLM → yt-dlp (fallback) |
| 데이터 저장 | Google Sheets API (6개 탭) |
| 뉴스 검색 | Naver Search API (선택) |
| 자동 실행 | GitHub Actions (cron + workflow_dispatch) |
| 대시보드 | Vanilla JS + GitHub Pages |

## 프로젝트 구조

```
pipeline/              — Python 파이프라인
  config.py            — 설정 로드 + 검증
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
tests/                 — pytest 테스트
config.yaml            — 도메인/키워드 설정 (빈 템플릿)
config.example.yaml    — 게임산업 예시 설정
```

## 라이선스

MIT
