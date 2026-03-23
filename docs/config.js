/**
 * GamWatch 대시보드 설정.
 * GH_PAT은 보안상 코드에 포함하지 않고, 브라우저 localStorage에서 관리합니다.
 * 첫 접속 시 설정 모달에서 입력하면 됩니다.
 */
const CONFIG = {
  // Google Sheets
  SPREADSHEET_ID: '1IG3GWc4kChVmjYxsPw_NX3gUlKj_ehOFgOMh3RqJPRY',
  SHEETS_API_KEY: 'AIzaSyANCUUWh4ckh52L37haIOPLjC007yihCyw',

  // GitHub Actions 트리거
  GH_OWNER: 'kipeum86',
  GH_REPO: 'gamwatch-national-audit-monitoring',
  GH_WORKFLOW_ID: 'pipeline.yml',

  // GH_PAT은 localStorage에서 로드
  get GH_PAT() {
    return localStorage.getItem('gamwatch_gh_pat') || '';
  },
  set GH_PAT(val) {
    localStorage.setItem('gamwatch_gh_pat', val);
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
