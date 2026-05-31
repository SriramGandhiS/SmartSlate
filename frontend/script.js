/* SmartSlate — Frontend Logic */
'use strict';

// ── API Base ──────────────────────────────────────────────────────────────────
const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
  ? 'http://127.0.0.1:8080'
  : window.location.origin;

// ── Clock ─────────────────────────────────────────────────────────────────────
setInterval(() => {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}, 1000);

// ── Scroll Reveal (IntersectionObserver) ──────────────────────────────────────
function initScrollAnimations() {
  const targets = document.querySelectorAll('.reveal, .reveal-left, .reveal-scale');
  if (!targets.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target); // once visible, always visible
      }
    });
  }, {
    threshold: 0,                      // trigger the moment ANY pixel is visible
    rootMargin: '0px 0px 60px 0px'    // pre-trigger 60px before element enters
  });

  targets.forEach(el => {
    // If already in viewport on load, make visible immediately
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      el.classList.add('visible');
    } else {
      observer.observe(el);
    }
  });
}


// ── Data Fetch & Render ───────────────────────────────────────────────────────
async function fetchData() {
  const page = document.body.dataset.page;

  try {
    const [reportRes, studentsRes, realRes] = await Promise.all([
      fetch(`${API_BASE}/report`),
      fetch(`${API_BASE}/students`),
      fetch(`${API_BASE}/api/realtime/dashboard`)
    ]);

    if (!reportRes.ok || !studentsRes.ok || !realRes.ok) return;

    const allRecords  = await reportRes.json();
    const allStudents = await studentsRes.json();

    const today       = new Date().toLocaleDateString('en-CA');
    const todayRecs   = allRecords.filter(r => r[1] === today);
    const presentNames = [...new Set(todayRecs.map(r => r[0]))];

    if (page === 'index') {
      const verifiedEl = document.getElementById('total-verified');
      const ratioEl    = document.getElementById('present-ratio');
      const pIdx       = document.getElementById('stat-present-index');
      const tIdx       = document.getElementById('stat-total-index');
      const logCount   = document.getElementById('log-count');

      if (verifiedEl) verifiedEl.textContent = presentNames.length || '0';
      if (pIdx)       pIdx.textContent       = presentNames.length || '0';
      if (tIdx)       tIdx.textContent       = allStudents.length  || '0';
      if (logCount)   logCount.textContent   = `${todayRecs.length} entr${todayRecs.length === 1 ? 'y' : 'ies'}`;
      if (ratioEl) {
        const pct = allStudents.length > 0
          ? Math.round((presentNames.length / allStudents.length) * 100) + '%'
          : '0%';
        ratioEl.textContent = pct;
      }
      renderMonitor(todayRecs);


    } else if (page === 'dashboard') {
      const statPresent = document.getElementById('stat-present');
      const statTotal   = document.getElementById('stat-total');
      const statAbsent  = document.getElementById('stat-absent');
      if (statPresent) statPresent.textContent = presentNames.length;
      if (statTotal)   statTotal.textContent   = allStudents.length;
      if (statAbsent)  statAbsent.textContent  = Math.max(0, allStudents.length - presentNames.length);
      renderTable(allRecords);
      loadMonthOptions();
    }

  } catch (err) {
    console.warn('[SmartSlate] Fetch error:', err.message);
  }
}

// ── Monitor Log (index page) ──────────────────────────────────────────────────
function renderMonitor(records) {
  const list = document.getElementById('list-present');
  if (!list) return;

  if (!records.length) {
    list.innerHTML = '<div class="log-empty">No verifications yet today.</div>';
    return;
  }

  // Deduplicate and show latest per person
  const seen = new Set();
  const unique = records.filter(r => {
    if (seen.has(r[0])) return false;
    seen.add(r[0]);
    return true;
  });

  list.innerHTML = unique.map(r => `
    <div class="log-row">
      <span class="log-name">${escHtml(r[0])}</span>
      <span class="log-time">${escHtml(r[2])}</span>
    </div>
  `).join('');
}

// ── Dashboard Table ───────────────────────────────────────────────────────────
function renderTable(records) {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;

  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:3rem;">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = records.map(r => {
    const periodCells = [1,2,3,4,5,6,7,8].map(p => {
      // Each period starts at hour 8+p (P1=09:00, P2=10:00, …)
      const hourStr = String(8 + p).padStart(2, '0');
      const isP = r[2] && r[2].startsWith(hourStr);
      return `<td style="text-align:center">${isP
        ? '<span class="period-present"></span>'
        : '<span style="color:var(--border)">—</span>'
      }</td>`;
    }).join('');

    return `<tr>
      <td onclick="viewStudent('${escAttr(r[0])}')">${escHtml(r[0])}</td>
      <td>${escHtml(r[1])}</td>
      <td>${escHtml(r[2])}</td>
      ${periodCells}
    </tr>`;
  }).join('');
}

// ── Month Filter ──────────────────────────────────────────────────────────────
async function loadMonthOptions() {
  const select = document.getElementById('month-select');
  if (!select || select.dataset.loaded) return;
  try {
    const res    = await fetch(`${API_BASE}/report/months`);
    const months = await res.json();
    if (months.length) {
      select.innerHTML = '<option value="">All months</option>' +
        months.map(m => `<option value="${m}">${m}</option>`).join('');
    }
    select.dataset.loaded = '1';
  } catch { /* silent */ }
}

async function loadSelectedMonth() {
  const select = document.getElementById('month-select');
  const ym = select?.value;
  if (!ym) { fetchData(); return; }

  try {
    const res     = await fetch(`${API_BASE}/report/month/${ym}`);
    const records = await res.json();
    renderTable(records);
  } catch { /* silent */ }
}

function searchFromDashboard() {
  const name = document.getElementById('search-name')?.value.trim();
  if (name) viewStudent(name);
}

// ── AI Report PDF ─────────────────────────────────────────────────────────────
async function generateAIReport() {
  const btn = document.getElementById('export-btn');
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = 'Generating...';
  btn.disabled = true;
  try {
    const res  = await fetch(`${API_BASE}/ai/generate_report`, { method: 'POST' });
    const data = await res.json();
    if (data.pdf_url) window.open(`${API_BASE}${data.pdf_url}`, '_blank');
    else alert(data.message || 'Report generation failed.');
  } catch { alert('Could not reach server.'); }
  finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

// ── Registration (with face-already-exists handling) ──────────────────────────
async function registerStudent() {
  const nameInput    = document.getElementById('reg-name');
  const detailsInput = document.getElementById('reg-details');
  const msgEl        = document.getElementById('reg-message');
  const btn          = document.getElementById('reg-btn');
  if (!nameInput || !msgEl || !btn) return;

  const name    = nameInput.value.trim();
  const details = detailsInput?.value.trim() || '';

  if (!name) {
    setMsg(msgEl, 'err', 'Please enter a name before capturing.');
    return;
  }

  btn.textContent = 'Capturing...';
  btn.disabled    = true;
  setMsg(msgEl, 'info', 'Acquiring frame from camera...');

  try {
    // Grab current frame from live camera
    const frameRes = await fetch(`${API_BASE}/capture_frame`);
    if (!frameRes.ok) throw new Error('Camera not ready. Make sure the feed is visible.');

    const blob   = await frameRes.blob();
    const b64    = await blobToBase64(blob);

    setMsg(msgEl, 'info', 'Analyzing face...');

    const regRes = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, image: b64, details })
    });

    const data = await regRes.json();

    if (!regRes.ok) {
      // Face already registered or other error — show clearly
      const isDuplicate = data.message && data.message.toLowerCase().includes('already registered');
      setMsg(msgEl, 'err', data.message || 'Registration failed. Try again.');
      if (isDuplicate) {
        // Highlight the message more clearly
        msgEl.innerHTML = `
          <strong style="font-size:0.82rem; display:block; margin-bottom:0.3rem;">Face Already Registered</strong>
          ${escHtml(data.message)}
        `;
      }
    } else {
      setMsg(msgEl, 'ok', `${name} registered successfully. Face model updated.`);
      nameInput.value = '';
      if (detailsInput) detailsInput.value = '';
    }

  } catch (err) {
    setMsg(msgEl, 'err', err.message || 'Unexpected error. Check the server.');
  } finally {
    btn.textContent = 'Initialize Capture';
    btn.disabled    = false;
  }
}

function setMsg(el, type, text) {
  el.className = `msg-box msg-${type}`;
  el.textContent = text;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}

// ── AI Chat ───────────────────────────────────────────────────────────────────
function openChat() {
  document.getElementById('chat-overlay')?.classList.add('open');
}
function closeChat() {
  document.getElementById('chat-overlay')?.classList.remove('open');
}

// legacy toggleChat support
function toggleChat() {
  const o = document.getElementById('chat-overlay');
  o?.classList.toggle('open');
}

async function sendChat() {
  const input  = document.getElementById('chat-input');
  const body   = document.getElementById('chat-messages');
  const query  = input?.value.trim();
  if (!query || !body) return;
  input.value = '';

  // User bubble
  body.innerHTML += `<div class="chat-msg-user">${escHtml(query)}</div>`;

  // Loading indicator
  const lid = 'load-' + Date.now();
  body.innerHTML += `<div id="${lid}" class="chat-msg-ai" style="color:var(--muted); font-size:0.75rem; font-family:'JetBrains Mono',monospace;">Thinking...</div>`;
  body.scrollTop = body.scrollHeight;

  try {
    const res  = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    const loadEl = document.getElementById(lid);
    if (loadEl) {
      loadEl.className = 'chat-msg-ai';
      loadEl.innerHTML = data.response || data.message || 'No response.';
    }
  } catch {
    const loadEl = document.getElementById(lid);
    if (loadEl) loadEl.textContent = 'Connection failed.';
  }
  body.scrollTop = body.scrollHeight;
}

// ── Student Profile ───────────────────────────────────────────────────────────
function viewStudent(name) {
  window.location.href = `profile.html?name=${encodeURIComponent(name)}`;
}

async function renderProfile() {
  const params = new URLSearchParams(window.location.search);
  const name   = params.get('name');
  const container = document.getElementById('profile-container');
  if (!name || !container) return;

  try {
    const res  = await fetch(`${API_BASE}/student/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error('Not found');
    const d = await res.json();

    container.innerHTML = `
      <div class="page-hero reveal" style="max-width:1400px;margin:0 auto;">
        <div class="page-eyebrow">Identity Profile</div>
        <h1 class="page-title">${escHtml(d.name)}</h1>
        <p style="margin-top:1rem; color:var(--muted); font-size:0.9rem;">${escHtml(d.details || '')}</p>
      </div>

      <div class="section" style="padding-top:0; padding-bottom:0;">
        <div class="profile-grid stagger">
          <div class="stat-cell reveal">
            <span class="stat-label">Attendance</span>
            <div class="stat-value">${d.percentage}%</div>
          </div>
          <div class="stat-cell reveal">
            <span class="stat-label">Present Days</span>
            <div class="stat-value">${d.present}</div>
          </div>
          <div class="stat-cell reveal">
            <span class="stat-label">Total Sessions</span>
            <div class="stat-value muted">${d.total}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-label reveal">Access History</div>
        <div class="table-wrap reveal" style="transition-delay:0.1s;">
          ${d.records.length ? `
            <table>
              <thead>
                <tr><th>Date</th><th>Time</th><th>Status</th></tr>
              </thead>
              <tbody>
                ${d.records.map(r => `
                  <tr>
                    <td style="color:var(--fg)">${escHtml(r.date)}</td>
                    <td>${escHtml(r.time)}</td>
                    <td><span style="color:#4ade80; font-size:0.65rem; letter-spacing:0.15em;">LOGGED</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div style="padding:3rem; text-align:center; color:var(--muted); font-size:0.8rem;">No records found.</div>'}
        </div>
        <div style="margin-top:2rem;" class="reveal">
          <a href="dashboard.html" class="btn">Back to Hub</a>
        </div>
      </div>
    `;

    // Trigger scroll animations for newly injected content
    initScrollAnimations();

  } catch {
    if (container) {
      container.innerHTML = `
        <div class="page-hero" style="min-height:calc(100vh - 72px); display:flex; flex-direction:column; justify-content:center;">
          <div class="page-eyebrow">Error</div>
          <h1 class="page-title">Identity<br>Not Found</h1>
          <div style="margin-top:3rem;"><a href="dashboard.html" class="btn btn-solid">Back to Hub</a></div>
        </div>`;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escAttr(str) { return escHtml(str); }

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Initialize scroll reveal immediately
  initScrollAnimations();

  const page = document.body.dataset.page;

  if (page === 'profile') {
    renderProfile();
  } else {
    fetchData();
    // Poll every 5 seconds for live updates
    setInterval(fetchData, 5000);
  }
});
