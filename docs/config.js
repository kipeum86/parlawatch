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

  get GH_PAT() {
    return localStorage.getItem('parlawatch_gh_pat') || '';
  },
  set GH_PAT(val) {
    localStorage.setItem('parlawatch_gh_pat', val);
  },

  TABS: {
    AGENDAS: 'agendas',
    STATEMENTS: 'statements',
    NEWS_ARTICLES: 'news_articles',
    PROCESSED_VIDEOS: '_processed_videos',
    KEYWORDS: '_keywords',
  },
};
