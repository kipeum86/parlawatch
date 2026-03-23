/**
 * GamWatch 파이프라인 트리거 + 상태 모니터링 + 설정 + 자막 추출.
 */

let _pollTimer = null;
let _pipelineStartTime = null;

// 자막 자동추출에 사용할 Invidious 인스턴스 목록
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.fdn.fr',
  'https://iv.datura.network',
  'https://invidious.protokolla.fi',
];

// ──────────────────────────────────────────────
// 전체 파이프라인 실행
// ──────────────────────────────────────────────

function triggerPipeline() {
  if (!_checkGitHubConfig()) return;
  document.getElementById('confirm-modal').style.display = 'flex';
}

function cancelPipeline() {
  closeModalAnimated('confirm-modal');
}

async function confirmPipeline() {
  closeModalAnimated('confirm-modal');

  const btn = document.getElementById('btn-trigger');
  btn.disabled = true;
  btn.textContent = '실행 요청 중...';

  try {
    const success = await _dispatchWorkflow({});
    if (success) {
      _startStatusPolling();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '전체 파이프라인 실행';
  }
}

// ──────────────────────────────────────────────
// 수동 영상 분석 모달
// ──────────────────────────────────────────────

function openManualModal() {
  document.getElementById('manual-modal').style.display = 'flex';
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('manual-date').value = today;
  // 이전 상태 초기화
  _setSubtitleStatus('');
  document.getElementById('manual-subtitle').value = '';
  document.getElementById('manual-char-count').textContent = '';
  document.getElementById('btn-manual-submit').disabled = false;
  document.getElementById('btn-manual-submit').textContent = '분석 요청';
  // 자막 수동입력은 접힌 상태로 시작
  document.getElementById('transcript-guide').open = false;

  // 자막 글자 수 표시 이벤트
  const textarea = document.getElementById('manual-subtitle');
  textarea.oninput = () => {
    const len = textarea.value.trim().length;
    document.getElementById('manual-char-count').textContent = len > 0
      ? `${len.toLocaleString()}자 입력됨`
      : '';
  };
}

function closeManualModal() {
  closeModalAnimated('manual-modal');
}

async function submitManualVideo() {
  if (!_checkGitHubConfig()) return;

  const url = document.getElementById('manual-url').value.trim();
  const committee = document.getElementById('manual-committee').value.trim();
  const date = document.getElementById('manual-date').value;
  const eventType = document.getElementById('manual-event-type').value.trim() || '국정감사';
  const subtitleText = document.getElementById('manual-subtitle').value.trim();

  if (!url) {
    showNotification('유튜브 URL을 입력해 주세요.', 'error');
    return;
  }

  if (!url.includes('youtube.com/') && !url.includes('youtu.be/')) {
    showNotification('올바른 유튜브 URL을 입력해 주세요.', 'error');
    return;
  }

  const videoId = _extractVideoId(url);
  if (!videoId) {
    showNotification('유튜브 URL에서 영상 ID를 추출할 수 없습니다.', 'error');
    return;
  }

  if (subtitleText && subtitleText.length < 100) {
    showNotification('자막이 너무 짧습니다. 전체 스크립트를 복사해 주세요.', 'error');
    return;
  }

  const btn = document.getElementById('btn-manual-submit');
  btn.disabled = true;
  btn.textContent = '분석 요청 중...';

  // 자막이 있으면 압축, 없으면 빈 문자열
  let subtitleData = '';
  if (subtitleText) {
    _setSubtitleStatus(`자막 ${subtitleText.length.toLocaleString()}자 — 압축 후 전송 중...`);
    try {
      subtitleData = await _compressText(subtitleText);
    } catch (e) {
      console.error('Compression failed:', e);
      if (subtitleText.length <= 60000) {
        subtitleData = subtitleText;
      } else {
        showNotification('자막이 너무 깁니다. 텍스트를 줄여서 다시 시도해 주세요.', 'error');
        btn.disabled = false;
        btn.textContent = '분석 요청';
        return;
      }
    }

    if (subtitleData.length > 65000) {
      showNotification('압축 후에도 데이터가 너무 큽니다. 더 짧은 영상으로 시도해 주세요.', 'error');
      btn.disabled = false;
      btn.textContent = '분석 요청';
      return;
    }
  } else {
    _setSubtitleStatus('서버에서 자막을 자동 추출합니다...');
  }

  const codeMap = {
    '정무위원회': 'jungmu',
    '과학기술정보방송통신위원회': 'gwabang',
    '문화체육관광위원회': 'munche',
    '산업통상자원중소벤처기업위원회': 'sanja',
    '법제사법위원회': 'beopsa',
    '보건복지위원회': 'bokji',
  };

  const inputs = {
    video_url: url,
    committee: committee,
    committee_code: codeMap[committee] || 'etc',
    event_date: date,
    event_type: eventType,
    subtitle_data: subtitleData,
  };

  const success = await _dispatchWorkflow(inputs);
  if (success) {
    closeManualModal();
    document.getElementById('manual-url').value = '';
    document.getElementById('manual-committee').value = '';
    document.getElementById('manual-subtitle').value = '';
    _startStatusPolling();
  } else {
    btn.disabled = false;
    btn.textContent = '분석 요청';
  }
}

// ──────────────────────────────────────────────
// 자막 추출 (Invidious API)
// ──────────────────────────────────────────────

function _extractVideoId(url) {
  const patterns = [
    /(?:v=|\/v\/|\/live\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function _fetchSubtitle(videoId) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      console.log(`Trying subtitle from: ${instance}`);

      // 1. 자막 목록 조회
      const listRes = await fetch(`${instance}/api/v1/captions/${videoId}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!listRes.ok) continue;

      const data = await listRes.json();
      const captions = data.captions || [];
      if (!captions.length) continue;

      // 한국어 자막 찾기
      const koCaption = captions.find(c =>
        c.language_code === 'ko' || c.languageCode === 'ko' ||
        (c.label && c.label.includes('Korean'))
      );
      if (!koCaption) continue;

      // 2. 자막 내용 다운로드
      const captionUrl = koCaption.url.startsWith('http')
        ? koCaption.url
        : `${instance}${koCaption.url}`;

      const captionRes = await fetch(captionUrl, {
        signal: AbortSignal.timeout(15000),
      });
      if (!captionRes.ok) continue;

      const vttText = await captionRes.text();
      const parsed = _parseVtt(vttText);
      if (parsed && parsed.length > 100) {
        console.log(`Subtitle fetched from ${instance}: ${parsed.length} chars`);
        return parsed;
      }
    } catch (e) {
      console.warn(`Invidious ${instance} failed:`, e.message);
      continue;
    }
  }
  return null;
}

function _parseVtt(vttText) {
  const lines = vttText.split('\n');
  const textLines = [];
  let prevLine = '';

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('WEBVTT')) continue;
    if (line.startsWith('Kind:') || line.startsWith('Language:')) continue;
    if (line.startsWith('NOTE')) continue;
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->/.test(line)) continue;
    if (/^\d+$/.test(line)) continue;

    // HTML/VTT 태그 제거
    let cleaned = line.replace(/<[^>]+>/g, '').trim();
    if (!cleaned) continue;

    // 중복 제거
    if (cleaned === prevLine) continue;

    textLines.push(cleaned);
    prevLine = cleaned;
  }

  return textLines.join('\n');
}

// ──────────────────────────────────────────────
// 텍스트 압축 (gzip + base64)
// ──────────────────────────────────────────────

async function _compressText(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const reader = cs.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const compressed = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }

  // base64 인코딩
  let binary = '';
  for (let i = 0; i < compressed.length; i++) {
    binary += String.fromCharCode(compressed[i]);
  }
  return btoa(binary);
}

function _setSubtitleStatus(msg, type) {
  const el = document.getElementById('manual-subtitle-status');
  if (el) {
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
    el.className = 'subtitle-status' + (type === 'error' ? ' subtitle-status-error' : '');
  }
}

async function autoFetchSubtitle() {
  const url = document.getElementById('manual-url').value.trim();
  if (!url) {
    showNotification('유튜브 URL을 먼저 입력해 주세요.', 'error');
    return;
  }

  const videoId = _extractVideoId(url);
  if (!videoId) {
    showNotification('올바른 유튜브 URL을 입력해 주세요.', 'error');
    return;
  }

  const btn = document.getElementById('btn-auto-subtitle');
  btn.disabled = true;
  btn.textContent = '추출 중...';
  _setSubtitleStatus('Invidious API에서 자막을 가져오는 중...');

  try {
    const text = await _fetchSubtitle(videoId);
    if (text) {
      const textarea = document.getElementById('manual-subtitle');
      textarea.value = text;
      textarea.dispatchEvent(new Event('input'));
      _setSubtitleStatus(`자막 자동 추출 완료 (${text.length.toLocaleString()}자)`);
      showNotification('자막 자동 추출에 성공했습니다!', 'success');
    } else {
      _setSubtitleStatus('자동 추출 실패 — 아래 안내를 따라 수동으로 복사해 주세요.', 'error');
      document.getElementById('transcript-guide').open = true;
    }
  } catch (e) {
    console.error('Auto subtitle fetch error:', e);
    _setSubtitleStatus('자동 추출 실패 — 아래 안내를 따라 수동으로 복사해 주세요.', 'error');
    document.getElementById('transcript-guide').open = true;
  } finally {
    btn.disabled = false;
    btn.textContent = '자막 자동 추출';
  }
}

// ──────────────────────────────────────────────
// 파이프라인 상태 모니터링
// ──────────────────────────────────────────────

function _startStatusPolling() {
  _pipelineStartTime = Date.now();
  _showStatus('running', '파이프라인 시작 요청 중...', '');
  setTimeout(() => _pollStatus(), 10000);
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(() => _pollStatus(), 15000);
}

async function _pollStatus() {
  try {
    const apiUrl = `https://api.github.com/repos/${CONFIG.GH_OWNER}/${CONFIG.GH_REPO}/actions/workflows/${CONFIG.GH_WORKFLOW_ID}/runs?per_page=1&branch=master`;
    const res = await fetch(apiUrl, {
      headers: {
        'Authorization': `token ${CONFIG.GH_PAT}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) return;

    const data = await res.json();
    const run = data.workflow_runs && data.workflow_runs[0];
    if (!run) return;

    const elapsed = _formatElapsed(Date.now() - _pipelineStartTime);
    const runUrl = run.html_url;

    if (run.status === 'queued') {
      _showStatus('running', '파이프라인 대기 중...', elapsed, runUrl);
    } else if (run.status === 'in_progress') {
      _showStatus('running', '파이프라인 실행 중...', elapsed, runUrl);
    } else if (run.status === 'completed') {
      _stopPolling();
      if (run.conclusion === 'success') {
        _showStatus('success', '파이프라인 완료! 페이지를 새로고침하면 결과를 확인할 수 있습니다.', elapsed, runUrl);
        setTimeout(() => {
          if (confirm('파이프라인이 완료되었습니다. 페이지를 새로고침할까요?')) {
            location.reload();
          }
        }, 2000);
      } else {
        _showStatus('failed', `파이프라인 실패 (${run.conclusion}). Actions 로그를 확인해 주세요.`, elapsed, runUrl);
      }
    }
  } catch (e) {
    console.error('Status poll error:', e);
  }
}

function _stopPolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

function _showStatus(state, text, elapsed, runUrl) {
  const bar = document.getElementById('pipeline-status');
  bar.style.display = 'block';
  bar.className = `pipeline-status ${state}`;

  const iconMap = { running: '\u25F7', success: '\u2714', failed: '\u2718' };
  document.getElementById('pipeline-status-icon').textContent = iconMap[state] || '';
  document.getElementById('pipeline-status-text').textContent = text;
  document.getElementById('pipeline-status-time').textContent = elapsed ? `(${elapsed})` : '';

  const link = document.getElementById('pipeline-status-link');
  if (runUrl) {
    link.href = runUrl;
    link.style.display = 'inline';
  } else {
    link.style.display = 'none';
  }
}

function _formatElapsed(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  return `${min}분 ${remainSec}초`;
}

// 페이지 로드 시 진행 중인 파이프라인이 있으면 표시
async function _checkActiveRun() {
  if (!CONFIG.GH_PAT) return;
  try {
    const apiUrl = `https://api.github.com/repos/${CONFIG.GH_OWNER}/${CONFIG.GH_REPO}/actions/workflows/${CONFIG.GH_WORKFLOW_ID}/runs?per_page=1&branch=master&status=in_progress`;
    const res = await fetch(apiUrl, {
      headers: {
        'Authorization': `token ${CONFIG.GH_PAT}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.workflow_runs && data.workflow_runs.length > 0) {
      _pipelineStartTime = new Date(data.workflow_runs[0].created_at).getTime();
      _showStatus('running', '파이프라인 실행 중...', _formatElapsed(Date.now() - _pipelineStartTime), data.workflow_runs[0].html_url);
      if (!_pollTimer) {
        _pollTimer = setInterval(() => _pollStatus(), 15000);
      }
    }
  } catch (e) { /* silent */ }
}

document.addEventListener('DOMContentLoaded', () => setTimeout(_checkActiveRun, 2000));

// ──────────────────────────────────────────────
// 공통: workflow_dispatch API 호출
// ──────────────────────────────────────────────

function _checkGitHubConfig() {
  if (!CONFIG.GH_PAT) {
    showNotification('GitHub PAT이 설정되지 않았습니다. ⚙ 설정 버튼에서 입력해 주세요.', 'error');
    openSettingsModal();
    return false;
  }
  return true;
}

async function _dispatchWorkflow(inputs) {
  const apiUrl = `https://api.github.com/repos/${CONFIG.GH_OWNER}/${CONFIG.GH_REPO}/actions/workflows/${CONFIG.GH_WORKFLOW_ID}/dispatches`;

  try {
    const body = { ref: 'master' };
    if (inputs && Object.keys(inputs).length > 0) {
      body.inputs = inputs;
    }

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `token ${CONFIG.GH_PAT}`,
        'Accept': 'application/vnd.github.v3+json',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 204) {
      return true;
    } else {
      const errText = await res.text();
      console.error('Dispatch failed:', res.status, errText);
      showNotification('실행 요청에 실패했습니다. 잠시 후 다시 시도해주세요.', 'error');
      return false;
    }
  } catch (e) {
    console.error('Dispatch error:', e);
    showNotification('실행 요청에 실패했습니다. 네트워크를 확인해 주세요.', 'error');
    return false;
  }
}

// ──────────────────────────────────────────────
// 설정 모달
// ──────────────────────────────────────────────

function openSettingsModal() {
  document.getElementById('settings-modal').style.display = 'flex';
  document.getElementById('settings-pat').value = CONFIG.GH_PAT || '';
}

function closeSettingsModal() {
  closeModalAnimated('settings-modal');
}

function saveSettings() {
  const pat = document.getElementById('settings-pat').value.trim();
  if (!pat) {
    showNotification('PAT을 입력해 주세요.', 'error');
    return;
  }
  CONFIG.GH_PAT = pat;
  closeSettingsModal();
  showNotification('설정이 저장되었습니다.', 'success');
}
