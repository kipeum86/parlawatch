# ParlaWatch — General-Purpose National Assembly Monitoring Tool

[한국어](README.md) · **English**

An AI-powered automation tool for monitoring the Korean National Assembly. Configure your domain and keywords, and it automatically analyzes Assembly video proceedings for any industry or field.

```
YouTube (NATV) → Transcript extraction → Claude AI analysis → Google Sheets → Dashboard
```

## Features

- **Domain-agnostic monitoring** — Healthcare, finance, education, any industry — configure via `config.yaml` alone
- **AI 2-pass analysis** — Claude AI structures transcripts (Pass 1) and verifies missed items (Pass 2)
- **Claude Code setup wizard** — Open the project in Claude Code and get an interactive setup walkthrough
- **Live dashboard** — Filter and search analysis results on GitHub Pages
- **Automated execution** — GitHub Actions runs the pipeline automatically every night

### Documentation

| Document | Description |
|------|------|
| **[Dashboard demo](https://kipeum86.github.io/parlawatch/)** | Dashboard demo populated with sample data from the healthcare/pharma industry |
| **[System architecture](https://kipeum86.github.io/parlawatch/architecture.html)** | 10 sections — pipeline, transcript extraction, AI analysis, data model, configuration |

---

## Prerequisites

Prepare the four items below before you start.

### 1. Google Cloud project + service account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g., `parlawatch`)
3. **Enable APIs** — Left menu → APIs & Services → Library:
   - Search for `Google Sheets API` → click **Enable**
   - Search for `YouTube Data API v3` → click **Enable**
   - Search for `Google Drive API` → click **Enable**
4. **Create a service account** — APIs & Services → Credentials → Create credentials → Service account
   - Name: `parlawatch` (anything is fine)
   - Role: Editor
5. **Download a JSON key** — Click the created service account → Keys tab → Add key → JSON
   - Save the downloaded file as `sa.json` at the project root

### 2. Google Sheets API key (for the dashboard)

The dashboard needs a separate API key to read Google Sheets data.

1. Google Cloud Console → APIs & Services → Credentials
2. **Create credentials** → **API key**
3. Copy the generated API key (you'll paste it into `docs/config.js` later)
4. (Recommended) Restrict the API key to allow only the Google Sheets API

### 3. Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. API Keys → Create Key
3. Copy the key (format: `sk-ant-...`)

### 4. (Optional) Naver Search API

Required only if you want automatic related-news searches. The pipeline works without it.

1. Go to [developers.naver.com](https://developers.naver.com/)
2. Register an application → choose the Search API
3. Obtain Client ID + Client Secret

---

## Installation & setup

### Step 1: Clone the project

```bash
git clone https://github.com/kipeum86/parlawatch.git
cd parlawatch
```

### Step 2: Set up the Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Step 3: Configure environment variables

Create a `.env` file at the project root:

```bash
GOOGLE_APPLICATION_CREDENTIALS=sa.json
ANTHROPIC_API_KEY=sk-ant-your-key-here
SPREADSHEET_ID=           # fill in during Step 5
NAVER_CLIENT_ID=          # optional
NAVER_CLIENT_SECRET=      # optional
```

### Step 4: Validate API keys

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

Every API should show `✓`. If any fails, recheck the corresponding key.

### Step 5: Auto-create the Google Sheet

```bash
python3 -c "
from pipeline.setup.sheets_creator import create_spreadsheet
sid = create_spreadsheet(
    service_account_file='sa.json',
    title='ParlaWatch - Monitoring',
    share_email='your-email@gmail.com',   # your Gmail address
)
print(f'Spreadsheet ID: {sid}')
print('Paste this ID into config.yaml and .env.')
"
```

Take the printed Spreadsheet ID and:
1. Paste it after `SPREADSHEET_ID=` in `.env`
2. Paste it after `sheets.spreadsheet_id:` in `config.yaml`

The created sheet is shared with your Gmail, so you can open it directly at [Google Sheets](https://docs.google.com/spreadsheets/).

### Step 6: Configure your domain

Open `config.yaml` and configure the field you want to monitor.

```yaml
# Example: monitoring the healthcare/pharma industry
domain:
  name: "Healthcare/Pharma"
  description: "National Assembly monitoring for healthcare, pharma, and bio industries. Tracks drug approvals, health insurance, hospital policy, pharma regulation, etc."

entity_names:
  - "Samsung Biologics"
  - "Celltrion"
  - "Hanmi Pharmaceutical"

keywords:
  include:
    - "의료"       # healthcare
    - "제약"       # pharma
    - "바이오"     # bio
    - "건강보험"   # health insurance
    - "의약품"     # drug
  exclude:
    - "의료 사고"  # prevent false positives (as needed)

committees:
  - code: "bokji"
    name: "보건복지위원회"   # Health & Welfare Committee
    search_terms: ["복지위", "보건복지위원회"]

audit_period:
  start: "2026-10-01"
  end: "2026-10-31"
```

> **Note:** See `config.example.yaml` for a game-industry example.

### Step 7: Test run

```bash
source .venv/bin/activate
export $(cat .env | xargs)

# Test with a single NATV video (no Sheets write)
python -m pipeline.cli "https://www.youtube.com/watch?v=VIDEO_ID" --committee "보건복지위원회" --dry-run
```

Success looks like `분석 완료: N개 안건` (Analysis complete: N agenda items).

Drop `--dry-run` to also record the results to Sheets.

---

## Dashboard setup (GitHub Pages)

To view analysis results in the web dashboard, set up GitHub Pages.

### Step 1: Create your own GitHub repo

```bash
# Remove the existing origin and point to your repo
git remote remove origin
gh repo create your-repo-name --public --source . --push
```

Or create the repo manually on GitHub, then:
```bash
git remote add origin https://github.com/your-id/your-repo-name.git
git push -u origin main
```

### Step 2: Enable GitHub Pages

1. GitHub repo → **Settings** tab
2. Left menu → **Pages**
3. Source: **Deploy from a branch**
4. Branch: `main`, Folder: `/docs`
5. Click **Save**

After ~1-2 minutes the dashboard is reachable at `https://your-id.github.io/your-repo-name/`.

### Step 3: Fill in dashboard settings

Open `docs/config.js` and fill in the blanks:

```javascript
const CONFIG = {
  SPREADSHEET_ID: 'your_spreadsheet_id',        // the ID from Step 5
  SHEETS_API_KEY: 'your_sheets_api_key',        // the API key from Prerequisite #2

  GH_OWNER: 'your_github_id',                   // e.g., 'kipeum86'
  GH_REPO: 'your_repo_name',                    // e.g., 'parlawatch'
  GH_WORKFLOW_ID: 'pipeline.yml',
  // ...
};
```

Commit and push:
```bash
git add docs/config.js
git commit -m "config: add dashboard settings"
git push
```

### Step 4: Verify the dashboard

Open `https://your-id.github.io/your-repo-name/` → enter the password → confirm the dashboard loads.

An empty screen is normal if there's no data yet — it fills up once the pipeline runs.

---

## GitHub Actions automation

To run the pipeline automatically every night:

### Step 1: Register repository secrets

GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret name | Value |
|------------|-----|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Full contents** of `sa.json` (the JSON text) |
| `SPREADSHEET_ID` | Google Sheets ID |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `NAVER_CLIENT_ID` | (optional) Naver Client ID |
| `NAVER_CLIENT_SECRET` | (optional) Naver Client Secret |

### Step 2: Manual test

1. GitHub repo → **Actions** tab
2. Click **ParlaWatch Pipeline** in the left sidebar
3. **Run workflow** → enter a YouTube URL → click **Run workflow**
4. When it finishes, verify the data in Google Sheets

### Step 3: Confirm the schedule

The cron in `.github/workflows/pipeline.yml` (`0 17 * * *` = 2 AM KST daily) runs automatically, but only within the `audit_period` defined in `config.yaml`.

> **Note:** To use the "Run full pipeline" button from the dashboard, enter a GitHub PAT (Personal Access Token) in the dashboard's ⚙ Settings. Create the PAT at GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) with `repo` and `workflow` scopes.

---

## Daily usage

### Automatic monitoring
Once set up, it runs on its own every night. Check the dashboard for results.

### Manual video analysis
```bash
# Run directly from the terminal
python -m pipeline.cli "YOUTUBE_URL" --committee "COMMITTEE_NAME" --date 2026-10-23

# Run from the dashboard
Dashboard → "Request video analysis" button → enter the URL
```

### Local dashboard preview
```bash
cd docs && python -m http.server 8000
# Visit http://localhost:8000
```

---

## Tech stack

| Component | Technology |
|-----------|------|
| LLM | Claude (Anthropic API) |
| Transcript extraction | youtube-transcript-api → NotebookLM → yt-dlp (fallback) |
| Data storage | Google Sheets API (6 tabs) |
| News search | Naver Search API (optional) |
| Automation | GitHub Actions (cron + workflow_dispatch) |
| Dashboard | Vanilla JS + GitHub Pages |

## Project layout

```
pipeline/              — Python pipeline
  config.py            — config loading + validation
  main.py              — pipeline orchestrator
  cli.py               — manual analysis CLI
  text_processor.py    — keyword filter + LLM 2-pass analysis
  sheets_client.py     — Google Sheets API wrapper
  subtitle_extractor.py — transcript extraction (3 sources)
  video_detector.py    — YouTube video detection
  news_searcher.py     — Naver news search
  llm/                 — LLM client + prompts
  setup/               — setup helpers (validation, Sheets creation)
docs/                  — GitHub Pages dashboard
tests/                 — pytest tests
config.yaml            — domain/keyword settings (empty template)
config.example.yaml    — game-industry example
```

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
