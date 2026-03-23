/**
 * GamWatch 대시보드 — 데이터 fetch, 렌더링, 필터, 검색.
 */

// ── 다크모드 ──
function initTheme() {
  const saved = localStorage.getItem('gamwatch_theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  updateThemeIcon();
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('gamwatch_theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('gamwatch_theme', 'dark');
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
let _viewMode = localStorage.getItem('gamwatch_view') || 'card';

// 기본 키워드 (pipeline/config.py 미러링)
const DEFAULT_INCLUDE_KEYWORDS = [
  "게임", "게임산업", "게임업계", "온라인게임", "모바일게임", "PC게임",
  "콘솔게임", "비디오게임", "게임사",
  "확률형 아이템", "가챠", "셧다운제", "게임 이용등급", "게임물등급위원회",
  "게임물관리위원회", "게임 과몰입", "게임 중독", "게임 사행성",
  "게임 규제", "게임 셧다운", "게임법", "게임 자율규제",
  "e스포츠", "이스포츠", "esports", "프로게이머",
  "게임 콘텐츠", "게임 수출", "게임 시장",
  "게임 개발", "게임 엔진",
];
const DEFAULT_EXCLUDE_KEYWORDS = [
  "게임 체인저", "게임체인저",
  "머니 게임", "머니게임",
  "치킨 게임", "치킨게임",
  "제로섬 게임", "제로섬게임",
  "블레임 게임", "블레임게임",
  "네임 게임", "네임게임",
];

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

  // 게임 토글 버튼 동기화
  const gameToggle = document.getElementById('btn-game-toggle');
  if (gameToggle) gameToggle.classList.toggle('active', category === 'game');

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
  const isGame = agenda.category === 'game';
  const isMentioned = agenda.isCompanyMentioned;

  const classes = [
    'agenda-card',
    isGame ? 'game' : '',
    isMentioned ? 'company-mentioned' : '',
  ].filter(Boolean).join(' ');

  const title = highlightText(agenda.title, searchTerm);
  const summary = highlightText(agenda.summary, searchTerm);

  return `
    <div class="${classes}" onclick="toggleDetail(this)">
      <div class="agenda-header">
        <span class="agenda-badge ${agenda.category}">${isGame ? '게임' : '일반'}</span>
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
  const isGame = agenda.category === 'game';
  const isMentioned = agenda.isCompanyMentioned;

  const classes = [
    'agenda-list-item',
    isGame ? 'game' : '',
    isMentioned ? 'company-mentioned' : '',
  ].filter(Boolean).join(' ');

  const title = highlightText(agenda.title, searchTerm);

  return `
    <div class="${classes}" onclick="toggleDetail(this)">
      <span class="agenda-badge ${agenda.category}">${isGame ? '게임' : '일반'}</span>
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
  localStorage.setItem('gamwatch_view', mode);
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
  const gameCount = filtered.filter(a => a.category === 'game').length;
  document.getElementById('stats-game').textContent = `게임 관련 ${gameCount}건`;
  const companyCount = filtered.filter(a => a.isCompanyMentioned).length;
  document.getElementById('stats-company').textContent = `게임사 언급 ${companyCount}건`;
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

function toggleGameFilter() {
  const select = document.getElementById('filter-category');
  select.value = select.value === 'game' ? '' : 'game';
  applyFilters();
}

function resetFilters() {
  document.getElementById('filter-date').value = '';
  document.getElementById('filter-committee').value = '';
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-search').value = '';
  const gameToggle = document.getElementById('btn-game-toggle');
  if (gameToggle) gameToggle.classList.remove('active');
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
  const userInclude = allUserKeywords.filter(k => (k.type || 'include') === 'include');
  const userExclude = allUserKeywords.filter(k => k.type === 'exclude');
  const totalInclude = DEFAULT_INCLUDE_KEYWORDS.length + userInclude.length;
  const totalExclude = DEFAULT_EXCLUDE_KEYWORDS.length + userExclude.length;

  document.getElementById('chip-videos-label').textContent = `영상 ${videoCount}건 처리`;
  document.getElementById('chip-keywords-label').textContent = `키워드 ${totalInclude}+${totalExclude}개`;

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
  const userInclude = allUserKeywords.filter(k => (k.type || 'include') === 'include');
  const userExclude = allUserKeywords.filter(k => k.type === 'exclude');

  function renderTags(defaults, userAdded, isExclude) {
    const cls = isExclude ? ' exclude' : '';
    const defaultTags = defaults.map(kw =>
      `<span class="keyword-tag${cls}">${escapeHtml(kw)}</span>`
    ).join('');
    const userTags = userAdded.map(k =>
      `<span class="keyword-tag user-added${cls}" title="${escapeHtml(k.note || '사용자 추가')}">${escapeHtml(k.keyword)}</span>`
    ).join('');
    return defaultTags + userTags;
  }

  body.innerHTML = `
    <div class="keyword-section">
      <div class="keyword-section-title">포함 키워드 (기본 ${DEFAULT_INCLUDE_KEYWORDS.length}개${userInclude.length ? ' + 추가 ' + userInclude.length + '개' : ''})</div>
      <div class="keyword-tags">
        ${renderTags(DEFAULT_INCLUDE_KEYWORDS, userInclude, false)}
      </div>
    </div>
    <div class="keyword-section">
      <div class="keyword-section-title">제외 키워드 (기본 ${DEFAULT_EXCLUDE_KEYWORDS.length}개${userExclude.length ? ' + 추가 ' + userExclude.length + '개' : ''})</div>
      <div class="keyword-tags">
        ${renderTags(DEFAULT_EXCLUDE_KEYWORDS, userExclude, true)}
      </div>
    </div>
    ${userInclude.length || userExclude.length ? '<p style="font-size:11px;color:var(--color-text-secondary);margin-top:8px;">점선 테두리 = 사용자 추가 키워드</p>' : ''}`;
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
