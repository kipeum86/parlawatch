/**
 * ParlaWatch 대시보드 — 데이터 fetch, 렌더링, 필터, 검색.
 */

// ── 다크모드 ──
function initTheme() {
  const saved = localStorage.getItem('parlawatch_theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  updateThemeIcon();
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('parlawatch_theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('parlawatch_theme', 'dark');
  }
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.innerHTML = isDark ? '&#9788;' : '&#9790;';
  btn.title = isDark ? '라이트모드 전환' : '다크모드 전환';
}

initTheme();

// 전역 데이터 저장소
let allAgendas = [];
let allStatements = [];
let allNewsArticles = [];
let allProcessedVideos = [];
let allUserKeywords = [];
let dataModel = []; // 안건 기준 join된 최종 모델
let allExpanded = false;
const LOAD_MORE_SIZE = 10;
let _currentFiltered = [];
let _currentSearch = '';
let _visibleGroups = 0;
let _viewMode = localStorage.getItem('parlawatch_view') || 'card';


// ──────────────────────────────────────────────
// 유틸: Sheets 날짜 시리얼 넘버 → YYYY-MM-DD 변환
// ──────────────────────────────────────────────

function _fixDate(val) {
  if (!val) return val;
  // 이미 YYYY-MM-DD 형식이면 그대로
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  // 숫자(Excel 시리얼 넘버)이면 변환
  const num = Number(val);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const d = new Date((num - 25569) * 86400000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return val;
}

// ──────────────────────────────────────────────
// 초기화
// ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

async function init() {
  _showSkeletonLoading();
  try {
    await loadAllData();
    buildDataModel();
    populateFilters();
    applyFilters();
    renderInfoChips();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('last-updated').textContent =
      `마지막 로드: ${new Date().toLocaleString('ko-KR')}`;
  } catch (e) {
    document.getElementById('loading').innerHTML =
      '<p>데이터를 불러올 수 없습니다. 설정을 확인해 주세요.</p>';
    console.error('Init error:', e);
  }
}

function _showSkeletonLoading() {
  const container = document.getElementById('loading');
  let html = '';
  for (let i = 0; i < 4; i++) {
    html += `
      <div class="skeleton-card">
        <div class="skeleton-line skeleton-line-badge"></div>
        <div class="skeleton-line skeleton-line-short"></div>
        <div class="skeleton-line skeleton-line-long"></div>
        <div class="skeleton-line skeleton-line-medium"></div>
      </div>`;
  }
  container.innerHTML = html;
}

// ──────────────────────────────────────────────
// 데이터 로드
// ──────────────────────────────────────────────

async function loadAllData() {
  // 데모 모드: SPREADSHEET_ID가 비어있으면 mock data 사용
  if (!CONFIG.SPREADSHEET_ID) {
    _loadDemoData();
    return;
  }

  const [agendas, statements, news] = await Promise.all([
    fetchSheetData(CONFIG.TABS.AGENDAS),
    fetchSheetData(CONFIG.TABS.STATEMENTS),
    fetchSheetData(CONFIG.TABS.NEWS_ARTICLES),
  ]);
  allAgendas = agendas;
  allStatements = statements;
  allNewsArticles = news;

  // 정보 칩 데이터 (실패해도 메인 로드에 영향 없음)
  const [videosResult, keywordsResult] = await Promise.allSettled([
    fetchSheetData(CONFIG.TABS.PROCESSED_VIDEOS),
    fetchSheetData(CONFIG.TABS.KEYWORDS),
  ]);
  allProcessedVideos = videosResult.status === 'fulfilled' ? videosResult.value : [];
  allUserKeywords = keywordsResult.status === 'fulfilled' ? keywordsResult.value : [];
}

function _loadDemoData() {
  allAgendas = [
    { agenda_id: '20261023_bokji_001', video_id: 'demo_v1', committee: '보건복지위원회', date: '2026-10-23', category: 'domain', title: '의약품 허가·심사 절차 개선 방안', summary: '식약처의 의약품 허가 심사 기간이 주요국 대비 2배 이상 소요되는 문제를 지적하며, 바이오시밀러 패스트트랙 도입과 심사 인력 확충 방안을 논의하였다. 셀트리온의 자가면역질환 치료제 심사 지연 사례가 집중 거론되었다.', is_company_mentioned: 'TRUE', company_mention_detail: '셀트리온 — 자가면역질환 바이오시밀러 품목 허가가 14개월째 지연 중이며, 동일 제품이 FDA에서는 10개월 만에 승인된 사례가 지적됨', sort_order: '1', event_type: '국정감사' },
    { agenda_id: '20261023_bokji_002', video_id: 'demo_v1', committee: '보건복지위원회', date: '2026-10-23', category: 'domain', title: '건강보험 보장성 강화 및 재정 안정화', summary: '건강보험 보장률이 65%대에 정체된 상황에서 비급여 항목의 급여화 로드맵과 건강보험 재정 건전성 확보 방안을 동시에 논의하였다. 특히 고가 항암제 급여 확대와 재정 영향 분석이 주요 쟁점이었다.', is_company_mentioned: 'FALSE', company_mention_detail: '', sort_order: '2', event_type: '국정감사' },
    { agenda_id: '20261023_bokji_003', video_id: 'demo_v1', committee: '보건복지위원회', date: '2026-10-23', category: 'domain', title: '디지털 헬스케어 산업 육성 정책', summary: 'AI 기반 의료기기 인허가 현황과 디지털 치료제 제도화 방안을 점검하였다. 삼성바이오로직스의 AI 신약개발 플랫폼 투자 계획이 언급되었으며, 개인정보 보호와 의료 데이터 활용 간 균형 문제가 논의되었다.', is_company_mentioned: 'TRUE', company_mention_detail: '삼성바이오로직스 — AI 기반 신약개발 플랫폼에 3,000억원 투자 계획 발표, 정부 R&D 지원 연계 방안 논의', sort_order: '3', event_type: '국정감사' },
    { agenda_id: '20261023_bokji_004', video_id: 'demo_v1', committee: '보건복지위원회', date: '2026-10-23', category: 'general', title: '저출산 대응 양육 지원 확대 방안', summary: '육아휴직 급여 인상, 아동수당 확대, 공공 보육시설 확충 등 저출산 대응 정책의 실효성을 점검하였다. 합계출산율 0.7명대의 위기 상황에서 보다 과감한 재정 투입 필요성이 강조되었다.', is_company_mentioned: 'FALSE', company_mention_detail: '', sort_order: '4', event_type: '국정감사' },
    { agenda_id: '20261021_bokji_001', video_id: 'demo_v2', committee: '보건복지위원회', date: '2026-10-21', category: 'domain', title: '바이오의약품 산업 지원 및 규제 합리화', summary: '국내 바이오의약품 산업의 글로벌 경쟁력 강화를 위한 규제 혁신 방안을 논의하였다. 한미약품의 기술수출 성과와 국내 바이오 CDMO 역량 확대 필요성이 거론되었다.', is_company_mentioned: 'TRUE', company_mention_detail: '한미약품 — 비만 치료제 기술수출 계약(8조원) 체결 성과 언급, 국내 임상 인프라 확대 필요성 논의', sort_order: '1', event_type: '국정감사' },
    { agenda_id: '20261021_bokji_002', video_id: 'demo_v2', committee: '보건복지위원회', date: '2026-10-21', category: 'domain', title: '의료 인력 수급 불균형 해소 대책', summary: '지방 의료기관의 의사 부족 문제와 전공의 수련환경 개선 방안을 논의하였다. 필수의료 분야 보상 체계 개편과 의대 정원 조정의 필요성이 주요 쟁점이었다.', is_company_mentioned: 'FALSE', company_mention_detail: '', sort_order: '2', event_type: '국정감사' },
    { agenda_id: '20261021_bokji_003', video_id: 'demo_v2', committee: '보건복지위원회', date: '2026-10-21', category: 'general', title: '국가 감염병 대응 체계 개선 방안', summary: '코로나19 이후 질병관리청의 감염병 대응 역량 강화 현황을 점검하고, 신종 감염병 조기 경보 시스템과 백신 자급률 향상 방안을 논의하였다.', is_company_mentioned: 'FALSE', company_mention_detail: '', sort_order: '3', event_type: '국정감사' },
    { agenda_id: '20261025_gihoek_001', video_id: 'demo_v3', committee: '기획재정위원회', date: '2026-10-25', category: 'domain', title: '2027년도 보건복지부 예산안 심사', summary: '보건복지부 소관 예산 107조원에 대한 심사를 진행하였다. 건강보험 국고지원금 확대, 바이오헬스 R&D 예산 증액, 필수의료 지원 특별회계 신설 등이 핵심 쟁점이었다.', is_company_mentioned: 'FALSE', company_mention_detail: '', sort_order: '1', event_type: '예산심사' },
  ];

  allStatements = [
    { statement_id: '20261023_bokji_001_s001', agenda_id: '20261023_bokji_001', speaker_name: '김민석', speaker_party: '더불어민주당', speaker_role: 'questioner', content: '식약처장, 셀트리온의 자가면역질환 바이오시밀러 품목허가가 14개월째 지연되고 있습니다. 동일 제품이 미국 FDA에서는 10개월 만에 승인됐는데, 우리 식약처는 왜 이렇게 느린 겁니까?', sort_order: '1' },
    { statement_id: '20261023_bokji_001_s002', agenda_id: '20261023_bokji_001', speaker_name: '오유경', speaker_party: '', speaker_role: 'respondent', content: '바이오시밀러 심사 과정에서 추가 임상 자료 요청이 있었습니다. 다만 심사 기간 단축을 위해 패스트트랙 제도 도입을 검토 중이며, 심사 인력도 내년까지 30% 확충할 계획입니다.', sort_order: '2' },
    { statement_id: '20261023_bokji_001_s003', agenda_id: '20261023_bokji_001', speaker_name: '강기윤', speaker_party: '국민의힘', speaker_role: 'questioner', content: '바이오시밀러 패스트트랙이 도입되면 구체적으로 심사 기간이 얼마나 단축될 것으로 예상하십니까? 미국, 유럽과 비교 가능한 수준까지 줄일 수 있습니까?', sort_order: '3' },
    { statement_id: '20261023_bokji_002_s001', agenda_id: '20261023_bokji_002', speaker_name: '최혜영', speaker_party: '더불어민주당', speaker_role: 'questioner', content: '건강보험 보장률이 65%에서 거의 10년째 정체입니다. 문재인케어 이후 비급여의 급여화가 사실상 중단된 것 아닙니까? 고가 항암제 급여 확대 계획은 어떻게 됩니까?', sort_order: '1' },
    { statement_id: '20261023_bokji_002_s002', agenda_id: '20261023_bokji_002', speaker_name: '조규홍', speaker_party: '', speaker_role: 'respondent', content: '비급여 급여화는 재정 영향을 면밀히 분석하면서 단계적으로 추진하고 있습니다. 고가 항암제의 경우 위험분담계약 활용을 확대하여 환자 접근성과 재정 안정성을 동시에 확보하겠습니다.', sort_order: '2' },
    { statement_id: '20261023_bokji_003_s001', agenda_id: '20261023_bokji_003', speaker_name: '이용호', speaker_party: '국민의힘', speaker_role: 'questioner', content: 'AI 의료기기 허가 건수가 300건을 넘었는데 실제 현장에서 활용되는 건 극소수입니다. 삼성바이오로직스가 AI 신약개발에 3,000억을 투자한다고 했는데, 정부 차원의 R&D 지원 연계 방안이 있습니까?', sort_order: '1' },
    { statement_id: '20261023_bokji_003_s002', agenda_id: '20261023_bokji_003', speaker_name: '조규홍', speaker_party: '', speaker_role: 'respondent', content: 'AI 의료기기의 수가 체계 마련을 위해 건보공단과 협의 중입니다. 대기업의 AI 신약개발 투자에 대해서는 국가신약개발사업과 연계한 매칭 지원을 검토하겠습니다.', sort_order: '2' },
    { statement_id: '20261023_bokji_004_s001', agenda_id: '20261023_bokji_004', speaker_name: '남인순', speaker_party: '더불어민주당', speaker_role: 'questioner', content: '합계출산율 0.72명입니다. 역대 최저치를 갱신하고 있는데, 현재의 양육 지원 정책으로는 한계가 명확하지 않습니까? 보다 파격적인 대책이 필요합니다.', sort_order: '1' },
    { statement_id: '20261023_bokji_004_s002', agenda_id: '20261023_bokji_004', speaker_name: '조규홍', speaker_party: '', speaker_role: 'respondent', content: '내년부터 육아휴직 급여를 월 250만원으로 인상하고, 아이돌봄서비스 이용 대상을 중위소득 200%까지 확대할 계획입니다. 공공 영유아 보육시설도 500개소 추가 확충하겠습니다.', sort_order: '2' },
    { statement_id: '20261021_bokji_001_s001', agenda_id: '20261021_bokji_001', speaker_name: '전혜숙', speaker_party: '더불어민주당', speaker_role: 'questioner', content: '한미약품이 비만 치료제 기술수출로 8조원 규모 계약을 체결했습니다. 국내 바이오 산업의 성과가 나오고 있는데, CDMO 분야에서 글로벌 경쟁력이 부족하다는 지적이 있습니다. 정부 지원 방안은?', sort_order: '1' },
    { statement_id: '20261021_bokji_001_s002', agenda_id: '20261021_bokji_001', speaker_name: '조규홍', speaker_party: '', speaker_role: 'respondent', content: 'CDMO 분야 경쟁력 강화를 위해 바이오의약품 전용 산업단지 조성을 추진 중입니다. 또한 GMP 시설 현대화 지원과 전문 인력 양성 프로그램을 확대하겠습니다.', sort_order: '2' },
    { statement_id: '20261021_bokji_002_s001', agenda_id: '20261021_bokji_002', speaker_name: '서영석', speaker_party: '더불어민주당', speaker_role: 'questioner', content: '지방의 중소병원에서 전문의를 구하지 못해 진료과를 폐쇄하는 사례가 속출하고 있습니다. 필수의료 분야 의사에 대한 실질적 보상 체계 개편 계획을 말씀해 주십시오.', sort_order: '1' },
    { statement_id: '20261021_bokji_002_s002', agenda_id: '20261021_bokji_002', speaker_name: '조규홍', speaker_party: '', speaker_role: 'respondent', content: '필수의료 분야 수가를 평균 30% 인상하는 방안을 내년 건강보험 수가 협상에 반영할 예정입니다. 또한 지방 근무 의사에 대한 인센티브 제도를 강화하겠습니다.', sort_order: '2' },
    { statement_id: '20261021_bokji_003_s001', agenda_id: '20261021_bokji_003', speaker_name: '김원이', speaker_party: '더불어민주당', speaker_role: 'questioner', content: '질병관리청의 감염병 대응 인력이 코로나 이후 오히려 줄었습니다. 신종 감염병 조기 경보 시스템은 어떤 수준까지 구축되어 있습니까?', sort_order: '1' },
    { statement_id: '20261021_bokji_003_s002', agenda_id: '20261021_bokji_003', speaker_name: '지영미', speaker_party: '', speaker_role: 'respondent', content: 'AI 기반 감염병 감시 시스템을 내년 상반기까지 고도화할 계획입니다. 또한 권역별 감염병 전문병원 지정을 확대하고, 백신 원부자재 국산화율을 60%까지 높이겠습니다.', sort_order: '2' },
    { statement_id: '20261025_gihoek_001_s001', agenda_id: '20261025_gihoek_001', speaker_name: '류성걸', speaker_party: '국민의힘', speaker_role: 'questioner', content: '보건복지부 예산 107조원 중 건강보험 국고지원이 12조인데, 법정 부담률 20%에 미치지 못합니다. 바이오헬스 R&D 예산도 작년 대비 삭감되었는데 이유가 무엇입니까?', sort_order: '1' },
    { statement_id: '20261025_gihoek_001_s002', agenda_id: '20261025_gihoek_001', speaker_name: '조규홍', speaker_party: '', speaker_role: 'respondent', content: '건강보험 국고지원금은 보험료 수입 연동 방식으로 점진적 확대를 추진하고 있습니다. 바이오헬스 R&D의 경우 민간 투자 확대분을 감안한 것이나, 필수 분야 예산은 복원을 요청드리겠습니다.', sort_order: '2' },
  ];

  allNewsArticles = [
    { article_id: '20261023_bokji_001_n001', agenda_id: '20261023_bokji_001', title: '식약처, 바이오시밀러 패스트트랙 도입 검토…심사 기간 6개월 단축 목표', url: '#', publisher: '한겨레' },
    { article_id: '20261023_bokji_001_n002', agenda_id: '20261023_bokji_001', title: '셀트리온 "자가면역 바이오시밀러, FDA보다 4개월 늦어…규제 개선 절실"', url: '#', publisher: '매일경제' },
    { article_id: '20261023_bokji_002_n001', agenda_id: '20261023_bokji_002', title: '건강보험 보장률 65% 정체…"고가 항암제 급여 확대 시급"', url: '#', publisher: 'KBS뉴스' },
    { article_id: '20261023_bokji_003_n001', agenda_id: '20261023_bokji_003', title: '삼성바이오, AI 신약개발 플랫폼에 3천억 투자…정부 매칭 지원 논의', url: '#', publisher: '조선비즈' },
    { article_id: '20261021_bokji_001_n001', agenda_id: '20261021_bokji_001', title: '한미약품 비만치료제 기술수출 8조원…K-바이오 위상 높아져', url: '#', publisher: 'MBC뉴스' },
    { article_id: '20261021_bokji_001_n002', agenda_id: '20261021_bokji_001', title: '바이오 CDMO 시장 선점 경쟁…정부 "전용 산업단지 조성 추진"', url: '#', publisher: '연합뉴스' },
    { article_id: '20261021_bokji_002_n001', agenda_id: '20261021_bokji_002', title: '지방 중소병원 진료과 폐쇄 속출…"필수의료 수가 30% 인상 추진"', url: '#', publisher: 'SBS뉴스' },
    { article_id: '20261025_gihoek_001_n001', agenda_id: '20261025_gihoek_001', title: '복지부 예산 107조 심사…건보 국고지원·바이오 R&D가 쟁점', url: '#', publisher: '한국경제' },
  ];

  allProcessedVideos = [
    { video_id: 'demo_v1', committee: '보건복지위원회', date: '2026-10-23', title: '제22대 국회 보건복지위원회 국정감사 (2일차)', video_url: '#', source: 'auto', subtitle_source: 'stenographer', processed_at: '2026-10-23 14:30:00', status: 'success', error_message: '' },
    { video_id: 'demo_v2', committee: '보건복지위원회', date: '2026-10-21', title: '제22대 국회 보건복지위원회 국정감사 (1일차)', video_url: '#', source: 'auto', subtitle_source: 'auto_generated', processed_at: '2026-10-21 15:12:00', status: 'success', error_message: '' },
    { video_id: 'demo_v3', committee: '기획재정위원회', date: '2026-10-25', title: '제22대 국회 기획재정위원회 예산결산소위 (복지부)', video_url: '#', source: 'manual', subtitle_source: 'stenographer', processed_at: '2026-10-25 16:45:00', status: 'success', error_message: '' },
  ];

  allUserKeywords = [
    { keyword: '의약품', type: 'include', note: '의약품 허가/심사' },
    { keyword: '바이오', type: 'include', note: '바이오의약품/바이오시밀러' },
    { keyword: '건강보험', type: 'include', note: '건보 재정/보장성' },
    { keyword: '제약', type: 'include', note: '' },
    { keyword: '의료기기', type: 'include', note: 'AI 의료기기 포함' },
    { keyword: '디지털 헬스케어', type: 'include', note: '' },
    { keyword: '신약', type: 'include', note: '신약개발/기술수출' },
    { keyword: '필수의료', type: 'include', note: '의료인력 수급' },
    { keyword: 'CDMO', type: 'include', note: '위탁개발생산' },
    { keyword: '의료 사고', type: 'exclude', note: '오탐 방지' },
    { keyword: '의료 소송', type: 'exclude', note: '오탐 방지' },
  ];
}

async function fetchSheetData(tabName) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${tabName}?key=${CONFIG.SHEETS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets API 오류: ${res.status}`);
  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

// ──────────────────────────────────────────────
// 데이터 모델 구성 (안건 기준 join)
// ──────────────────────────────────────────────

function buildDataModel() {
  const stmtMap = {};
  allStatements.forEach(s => {
    const aid = s.agenda_id;
    if (!stmtMap[aid]) stmtMap[aid] = [];
    stmtMap[aid].push(s);
  });

  const newsMap = {};
  allNewsArticles.forEach(n => {
    const aid = n.agenda_id;
    if (!newsMap[aid]) newsMap[aid] = [];
    newsMap[aid].push(n);
  });

  dataModel = allAgendas.map(a => ({
    ...a,
    date: _fixDate(a.date),
    statements: (stmtMap[a.agenda_id] || []).sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0)),
    newsArticles: newsMap[a.agenda_id] || [],
    isCompanyMentioned: a.is_company_mentioned === 'TRUE',
  }));

  // sort_order 기준 정렬
  dataModel.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date); // 최신 먼저
    if (a.committee !== b.committee) return a.committee.localeCompare(b.committee);
    return (parseInt(a.sort_order) || 0) - (parseInt(b.sort_order) || 0);
  });
}

// ──────────────────────────────────────────────
// 필터
// ──────────────────────────────────────────────

function populateFilters() {
  const dates = [...new Set(dataModel.map(a => a.date))].sort().reverse();
  const committees = [...new Set(dataModel.map(a => a.committee))].sort();

  const dateSelect = document.getElementById('filter-date');
  dates.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    dateSelect.appendChild(opt);
  });

  const commSelect = document.getElementById('filter-committee');
  committees.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    commSelect.appendChild(opt);
  });

  // 보고서 모달 필터도 동일하게 설정
  const reportDate = document.getElementById('report-date');
  if (reportDate) {
    dates.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      reportDate.appendChild(opt);
    });
  }

  const reportComm = document.getElementById('report-committee');
  if (reportComm) {
    committees.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      reportComm.appendChild(opt);
    });
  }
}

function applyFilters() {
  const date = document.getElementById('filter-date').value;
  const committee = document.getElementById('filter-committee').value;
  const category = document.getElementById('filter-category').value;
  const search = document.getElementById('filter-search').value.trim().toLowerCase();

  let filtered = dataModel;

  if (date) filtered = filtered.filter(a => a.date === date);
  if (committee) filtered = filtered.filter(a => a.committee === committee);
  if (category) filtered = filtered.filter(a => a.category === category);

  if (search) {
    filtered = filtered.filter(a => {
      const texts = [
        a.title, a.summary, a.company_mention_detail,
        ...a.statements.map(s => `${s.speaker_name} ${s.content}`),
      ].join(' ').toLowerCase();
      return texts.includes(search);
    });
  }

  // 도메인 토글 버튼 동기화
  const domainToggle = document.getElementById('btn-domain-toggle');
  if (domainToggle) domainToggle.classList.toggle('active', category === 'domain');

  updateStats(filtered);
  renderAgendas(filtered, search);
}

// ──────────────────────────────────────────────
// 렌더링
// ──────────────────────────────────────────────

function renderAgendas(agendas, searchTerm) {
  // 필터 변경 시 초기화
  _currentFiltered = agendas;
  _currentSearch = searchTerm;
  _visibleGroups = 0;

  const container = document.getElementById('agenda-list');
  const emptyState = document.getElementById('empty-state');

  if (agendas.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    _hideLoadMore();
    return;
  }

  emptyState.style.display = 'none';
  container.innerHTML = '';
  container.className = _viewMode === 'list' ? 'agenda-list view-list' : 'agenda-list';

  // 처음 10개 그룹 렌더링
  _loadMoreGroups();

  // 툴바 표시 + 상태 리셋
  document.getElementById('agenda-toolbar').style.display = agendas.length ? 'flex' : 'none';
  _updateViewToggle();
  allExpanded = false;
  document.getElementById('btn-toggle-all').textContent = '모두 펼치기';
}

function _getGroupedKeys() {
  const groups = {};
  _currentFiltered.forEach(a => {
    const key = `${a.date}__${a.committee}`;
    if (!groups[key]) groups[key] = { date: a.date, committee: a.committee, agendas: [] };
    groups[key].agendas.push(a);
  });
  return { groups, sortedKeys: Object.keys(groups).sort().reverse() };
}

function _loadMoreGroups() {
  const container = document.getElementById('agenda-list');
  const { groups, sortedKeys } = _getGroupedKeys();
  const totalGroups = sortedKeys.length;
  const end = Math.min(_visibleGroups + LOAD_MORE_SIZE, totalGroups);

  for (let i = _visibleGroups; i < end; i++) {
    const key = sortedKeys[i];
    const g = groups[key];
    const isFirst = i === 0 && _visibleGroups === 0;
    const collapsedClass = isFirst ? '' : 'collapsed';
    const chevron = isFirst ? '&#9660;' : '&#9654;';

    const div = document.createElement('div');
    div.innerHTML = `
      <div class="date-group ${collapsedClass}">
        <div class="date-group-header" onclick="toggleDateGroup(this)">
          <span class="date-group-chevron">${chevron}</span>
          ${g.date} <span class="committee-label">${g.committee}</span>
          <span class="date-group-count">(${g.agendas.length}건)</span>
        </div>
        <div class="date-group-body">
          ${g.agendas.map(a => _viewMode === 'list' ? renderAgendaListItem(a, _currentSearch) : renderAgendaCard(a, _currentSearch)).join('')}
        </div>
      </div>
    `;
    container.appendChild(div.firstElementChild);
  }

  _visibleGroups = end;

  // 더보기 버튼 업데이트
  const remaining = totalGroups - _visibleGroups;
  if (remaining > 0) {
    _showLoadMore(remaining);
  } else {
    _hideLoadMore();
  }
}

function _showLoadMore(remaining) {
  const btn = document.getElementById('btn-load-more');
  if (btn) {
    btn.textContent = `더보기 (${remaining}개 그룹 남음)`;
    btn.style.display = 'block';
  }
}

function _hideLoadMore() {
  const btn = document.getElementById('btn-load-more');
  if (btn) btn.style.display = 'none';
}

function loadMore() {
  _loadMoreGroups();
}

function renderAgendaCard(agenda, searchTerm) {
  const isDomain = agenda.category === 'domain';
  const isMentioned = agenda.isCompanyMentioned;

  const classes = [
    'agenda-card',
    isDomain ? 'domain' : '',
    isMentioned ? 'company-mentioned' : '',
  ].filter(Boolean).join(' ');

  const title = highlightText(agenda.title, searchTerm);
  const summary = highlightText(agenda.summary, searchTerm);

  return `
    <div class="${classes}" onclick="toggleDetail(this)">
      <div class="agenda-header">
        <span class="agenda-badge ${agenda.category}">${isDomain ? '관심 분야' : '일반'}</span>
        ${agenda.event_type && agenda.event_type !== '국정감사' ? `<span class="agenda-badge event-type">${agenda.event_type}</span>` : ''}
        <span class="agenda-title">${title}</span>
      </div>
      <div class="agenda-summary">${summary}</div>
      <div class="agenda-meta">${agenda.committee} · ${agenda.date}</div>
      <div class="agenda-detail">
        ${isMentioned ? `<div class="company-highlight">${highlightText(agenda.company_mention_detail, searchTerm)}</div>` : ''}
        ${renderStatements(agenda.statements, searchTerm)}
        ${renderNews(agenda.newsArticles)}
      </div>
    </div>
  `;
}

function renderAgendaListItem(agenda, searchTerm) {
  const isDomain = agenda.category === 'domain';
  const isMentioned = agenda.isCompanyMentioned;

  const classes = [
    'agenda-list-item',
    isDomain ? 'domain' : '',
    isMentioned ? 'company-mentioned' : '',
  ].filter(Boolean).join(' ');

  const title = highlightText(agenda.title, searchTerm);

  return `
    <div class="${classes}" onclick="toggleDetail(this)">
      <span class="agenda-badge ${agenda.category}">${isDomain ? '관심 분야' : '일반'}</span>
      ${isMentioned ? '<span class="agenda-list-star">★</span>' : ''}
      <span class="agenda-title">${title}</span>
      <span class="agenda-meta">${agenda.committee} · ${agenda.date}</span>
      <div class="agenda-detail">
        ${agenda.summary ? `<div class="agenda-summary">${highlightText(agenda.summary, searchTerm)}</div>` : ''}
        ${isMentioned ? `<div class="company-highlight">${highlightText(agenda.company_mention_detail, searchTerm)}</div>` : ''}
        ${renderStatements(agenda.statements, searchTerm)}
        ${renderNews(agenda.newsArticles)}
      </div>
    </div>
  `;
}

function setViewMode(mode) {
  _viewMode = mode;
  localStorage.setItem('parlawatch_view', mode);
  applyFilters();
}

function _updateViewToggle() {
  const cardBtn = document.getElementById('btn-view-card');
  const listBtn = document.getElementById('btn-view-list');
  if (cardBtn) cardBtn.classList.toggle('active', _viewMode === 'card');
  if (listBtn) listBtn.classList.toggle('active', _viewMode === 'list');
}

function renderStatements(statements, searchTerm) {
  if (!statements.length) return '';
  return statements.map(s => {
    const roleLabel = s.speaker_role === 'questioner' ? '질의' : '답변';
    const party = s.speaker_party ? `(${s.speaker_party})` : '';
    return `
      <div class="statement">
        <span class="statement-speaker">${party}${highlightText(s.speaker_name, searchTerm)}</span>
        <span class="statement-role ${s.speaker_role}">${roleLabel}</span>
        <div class="statement-content">${highlightText(s.content, searchTerm)}</div>
      </div>
    `;
  }).join('');
}

function renderNews(articles) {
  if (!articles.length) return '';
  return `
    <div class="news-section">
      <div class="news-section-title">관련 기사</div>
      ${articles.map(n => `
        <div class="news-item">
          <a href="${escapeHtml(n.url)}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a>
          <span class="news-publisher">${escapeHtml(n.publisher)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ──────────────────────────────────────────────
// UI 헬퍼
// ──────────────────────────────────────────────

function toggleDetail(card) {
  const detail = card.querySelector('.agenda-detail');
  if (detail) detail.classList.toggle('open');
}

function highlightText(text, searchTerm) {
  if (!text || !searchTerm) return escapeHtml(text || '');
  const escaped = escapeHtml(text);
  const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toggleDateGroup(headerEl) {
  const group = headerEl.closest('.date-group');
  group.classList.toggle('collapsed');
  const chevron = headerEl.querySelector('.date-group-chevron');
  chevron.innerHTML = group.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
}

function toggleAllDetails() {
  allExpanded = !allExpanded;
  document.querySelectorAll('.agenda-detail').forEach(d => {
    d.classList.toggle('open', allExpanded);
  });
  document.querySelectorAll('.date-group').forEach(g => {
    g.classList.toggle('collapsed', !allExpanded);
    const chevron = g.querySelector('.date-group-chevron');
    if (chevron) chevron.innerHTML = allExpanded ? '&#9660;' : '&#9654;';
  });
  document.getElementById('btn-toggle-all').textContent = allExpanded ? '모두 접기' : '모두 펼치기';
}

function updateStats(filtered) {
  const bar = document.getElementById('stats-bar');
  bar.style.display = filtered.length ? 'flex' : 'none';
  document.getElementById('stats-total').textContent = `전체 ${filtered.length}건`;
  const domainCount = filtered.filter(a => a.category === 'domain').length;
  document.getElementById('stats-domain').textContent = `관심 분야 ${domainCount}건`;
  const companyCount = filtered.filter(a => a.isCompanyMentioned).length;
  document.getElementById('stats-company').textContent = `기관 언급 ${companyCount}건`;
}

async function refreshData() {
  const btn = document.getElementById('btn-refresh');
  btn.disabled = true;
  showNotification('새로고침 중...', 'info');
  try {
    await loadAllData();
    buildDataModel();
    resetFilterOptions();
    populateFilters();
    applyFilters();
    renderInfoChips();
    document.getElementById('last-updated').textContent =
      `마지막 로드: ${new Date().toLocaleString('ko-KR')}`;
    showNotification('새로고침 완료', 'success');
  } catch (e) {
    showNotification('새로고침 실패', 'error');
    console.error('Refresh error:', e);
  } finally {
    btn.disabled = false;
  }
}

function resetFilterOptions() {
  ['filter-date', 'filter-committee', 'report-date'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
  });
  const reportComm = document.getElementById('report-committee');
  if (reportComm) {
    while (reportComm.options.length > 1) reportComm.remove(1);
  }
}

function toggleDomainFilter() {
  const select = document.getElementById('filter-category');
  select.value = select.value === 'domain' ? '' : 'domain';
  applyFilters();
}

function resetFilters() {
  document.getElementById('filter-date').value = '';
  document.getElementById('filter-committee').value = '';
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-search').value = '';
  const domainToggle = document.getElementById('btn-domain-toggle');
  if (domainToggle) domainToggle.classList.remove('active');
  applyFilters();
}

// ── 맨 위로 버튼 ──

window.addEventListener('scroll', function() {
  const btn = document.getElementById('btn-scroll-top');
  if (window.scrollY > 300) {
    btn.classList.add('visible');
  } else {
    btn.classList.remove('visible');
  }
});

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ──────────────────────────────────────────────
// 정보 칩 + 팝오버
// ──────────────────────────────────────────────

function renderInfoChips() {
  const container = document.getElementById('info-chips');
  if (!container) return;

  const videoCount = allProcessedVideos.length;
  const includeKw = allUserKeywords.filter(k => (k.type || 'include') === 'include');
  const excludeKw = allUserKeywords.filter(k => k.type === 'exclude');

  document.getElementById('chip-videos-label').textContent = `영상 ${videoCount}건 처리`;
  document.getElementById('chip-keywords-label').textContent = `키워드 ${includeKw.length}+${excludeKw.length}개`;

  container.style.display = 'flex';
}

function openInfoModal(type) {
  if (type === 'videos') renderVideosModal();
  else renderKeywordsModal();
  document.getElementById(`modal-${type}`).style.display = 'flex';
}

function closeInfoModal(type) {
  closeModalAnimated(`modal-${type}`);
}

function renderVideosModal() {
  const body = document.getElementById('modal-videos-body');
  if (!allProcessedVideos.length) {
    body.innerHTML = '<p style="color:var(--color-text-secondary);font-size:13px;">처리된 영상이 없습니다.</p>';
    return;
  }

  const sorted = [...allProcessedVideos].sort((a, b) =>
    (b.date || '').localeCompare(a.date || '')
  );

  const rows = sorted.map(v => {
    const statusClass = v.status || 'success';
    const statusLabel = v.status === 'success' ? '성공'
      : v.status === 'no_subtitle' ? '자막없음'
      : v.status === 'error' ? '오류' : (v.status || '');
    const sourceLabel = v.source === 'auto' ? '자동' : '수동';
    const title = v.title || '제목없음';
    const titleHtml = v.video_url
      ? `<a href="${escapeHtml(v.video_url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`
      : escapeHtml(title);

    return `<tr>
      <td>${escapeHtml(_fixDate(v.date) || '')}</td>
      <td>${escapeHtml(v.committee || '')}</td>
      <td>${titleHtml}</td>
      <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      <td>${sourceLabel}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <table class="info-table">
      <thead><tr>
        <th>날짜</th><th>상임위</th><th>제목</th><th>상태</th><th>소스</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderKeywordsModal() {
  const body = document.getElementById('modal-keywords-body');
  const includeKw = allUserKeywords.filter(k => (k.type || 'include') === 'include');
  const excludeKw = allUserKeywords.filter(k => k.type === 'exclude');

  function renderTags(keywords, isExclude) {
    const cls = isExclude ? ' exclude' : '';
    return keywords.map(k =>
      `<span class="keyword-tag${cls}" title="${escapeHtml(k.note || '')}">${escapeHtml(k.keyword)}</span>`
    ).join('');
  }

  body.innerHTML = `
    <div class="keyword-section">
      <div class="keyword-section-title">포함 키워드 (${includeKw.length}개)</div>
      <div class="keyword-tags">
        ${renderTags(includeKw, false)}
      </div>
    </div>
    <div class="keyword-section">
      <div class="keyword-section-title">제외 키워드 (${excludeKw.length}개)</div>
      <div class="keyword-tags">
        ${renderTags(excludeKw, true)}
      </div>
    </div>`;
}

// ── 모달 닫기 애니메이션 공통 ──
function closeModalAnimated(modalId, callback) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.add('closing');
  modal.addEventListener('animationend', function handler() {
    modal.removeEventListener('animationend', handler);
    modal.style.display = 'none';
    modal.classList.remove('closing');
    if (callback) callback();
  });
}

let _notifTimer = null;
function showNotification(message, type) {
  type = type || 'info';
  const el = document.getElementById('notification');
  if (_notifTimer) clearTimeout(_notifTimer);
  el.classList.remove('hiding');
  el.textContent = message;
  el.className = `notification ${type}`;
  el.style.display = 'block';
  _notifTimer = setTimeout(() => {
    el.classList.add('hiding');
    el.addEventListener('animationend', function handler() {
      el.removeEventListener('animationend', handler);
      el.style.display = 'none';
      el.classList.remove('hiding');
    });
  }, 4500);
}
