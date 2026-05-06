const API_BASE = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost" 
  ? "http://127.0.0.1:8080" 
  : window.location.origin;

// Global State
let currentProfileData = null;

// Clock
setInterval(() => {
  const clock = document.getElementById('clock');
  if (clock) clock.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}, 1000);

// Unified Data Fetcher
async function fetchData() {
  const page = document.body.dataset.page;
  
  try {
    const [reportRes, studentsRes, realRes] = await Promise.all([
      fetch(`${API_BASE}/report`),
      fetch(`${API_BASE}/students`),
      fetch(`${API_BASE}/api/realtime/dashboard`)
    ]);
    
    if (!reportRes.ok || !studentsRes.ok || !realRes.ok) return;
    
    const allRecords = await reportRes.json();
    const allStudents = await studentsRes.json();
    const realData = await realRes.json();
    
    // Update Cooldown
    const cooldownEl = document.getElementById('cooldown-status');
    if (cooldownEl) {
      if (realData.next_scan_in > 0) {
        const mins = Math.floor(realData.next_scan_in / 60);
        const secs = realData.next_scan_in % 60;
        cooldownEl.innerHTML = `NEXT SCAN FOR <span style="color:var(--accent-lime)">${realData.last_user}</span> IN <span style="color:white">${mins}m ${secs}s</span>`;
      } else {
        cooldownEl.innerHTML = `NEXT SCAN: <span style="color:var(--accent-lime)">READY</span>`;
      }
    }

    const today = new Date().toLocaleDateString('en-CA');
    const todayRecords = allRecords.filter(r => r[1] === today);
    const presentNames = [...new Set(todayRecords.map(r => r[0]))];
    
    if (page === 'index') {
      renderMonitor(todayRecords);
    } else if (page === 'dashboard') {
      renderDashboard(allRecords, allStudents, presentNames);
    }
  } catch (err) {
    console.error("Link Failure:", err);
  }
}

// Page Specific Renderers
function renderMonitor(todayRecords) {
  const list = document.getElementById('list-present');
  if (!list) return;
  
  if (todayRecords.length === 0) {
    list.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-gray);">AWAITING SCAN...</div>';
    return;
  }
  
  list.innerHTML = todayRecords.map(r => `
    <div class="bb-list-item">
      <div class="bb-item-info">
        <span class="bb-item-name">${r[0]}</span>
        <span class="bb-item-meta">Verified at ${r[2]}</span>
      </div>
      <div class="bb-badge bb-badge-lime">VERIFIED</div>
    </div>
  `).join('');
}

function renderDashboard(allRecords, allStudents, presentNames) {
  const statPresent = document.getElementById('stat-present');
  const statTotal = document.getElementById('stat-total');
  const statAbsent = document.getElementById('stat-absent');
  const tableBody = document.getElementById('table-body');
  
  if (statPresent) statPresent.textContent = presentNames.length;
  if (statTotal) statTotal.textContent = allStudents.length;
  if (statAbsent) statAbsent.textContent = allStudents.length - presentNames.length;
  
  if (tableBody) {
    tableBody.innerHTML = allRecords.map(r => `
      <tr>
        <td style="font-weight: 800; color: var(--accent-lime); cursor:pointer;" onclick="viewStudent('${r[0]}')">${r[0]}</td>
        <td>${r[1]}</td>
        <td>${r[2]}</td>
        ${[1,2,3,4,5,6,7,8].map(p => {
          const hour = p + 7;
          const isPresent = r[2].startsWith(hour < 10 ? '0'+hour : ''+hour);
          return `<td style="text-align:center">${isPresent ? '✅' : '-'}</td>`;
        }).join('')}
      </tr>
    `).join('');
  }
}

// AI Chat
function toggleChat() {
  document.getElementById('chat-overlay').classList.toggle('active');
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const query = input.value.trim();
  if (!query) return;

  const msgBox = document.getElementById('chat-messages');
  msgBox.innerHTML += `<div style="align-self: flex-end; background: var(--accent-lime); color: #000; padding: 12px 20px; border-radius: 12px; font-weight: 700;">${query}</div>`;
  input.value = "";
  
  const loadingId = 'loading-' + Date.now();
  msgBox.innerHTML += `<div id="${loadingId}" style="align-self: flex-start; background: rgba(255,255,255,0.05); padding: 12px 20px; border-radius: 12px; color: var(--accent-lime);">Analyzing...</div>`;
  msgBox.scrollTop = msgBox.scrollHeight;

  try {
    const res = await fetch(`${API_BASE}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    document.getElementById(loadingId).remove();
    msgBox.innerHTML += `<div style="align-self: flex-start; background: rgba(255,255,255,0.05); padding: 12px 20px; border-radius: 12px; border: 1px solid var(--border-color);">${data.response}</div>`;
    msgBox.scrollTop = msgBox.scrollHeight;
  } catch (err) {
    document.getElementById(loadingId).innerText = "Link Failure.";
  }
}

// Student Profile
async function viewStudent(name) {
  window.location.href = `profile.html?name=${encodeURIComponent(name)}`;
}

async function renderProfile() {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('name');
  if (!name) return;

  const container = document.getElementById('profile-container');
  try {
    const res = await fetch(`${API_BASE}/student/${encodeURIComponent(name)}`);
    const data = await res.json();
    
    container.innerHTML = `
      <div class="bb-card" style="padding: 40px;">
        <h1 style="font-size: 48px; color: var(--accent-lime); margin-bottom: 8px;">${data.name}</h1>
        <p style="color: var(--text-gray); margin-bottom: 32px;">${data.details}</p>
        
        <div class="bb-stats-grid" style="margin-bottom: 40px;">
          <div class="bb-stat-item">
            <div class="bb-stat-label">Percentage</div>
            <div class="bb-stat-value lime">${data.percentage}%</div>
          </div>
          <div class="bb-stat-item">
            <div class="bb-stat-label">Present</div>
            <div class="bb-stat-value">${data.present}</div>
          </div>
          <div class="bb-stat-item">
            <div class="bb-stat-label">Total Classes</div>
            <div class="bb-stat-value">${data.total}</div>
          </div>
        </div>

        <div class="bb-card">
          <div class="bb-panel-header"><div class="bb-panel-title">TIMESTAMPS</div></div>
          <div style="max-height: 400px; overflow-y: auto;">
            ${data.records.map(r => `
              <div class="bb-list-item">
                <div class="bb-item-info"><span class="bb-item-name">${r.date}</span></div>
                <span class="bb-item-meta">${r.time}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = "Error loading profile.";
  }
}

// Register
async function registerStudent() {
  const name = document.getElementById('reg-name').value;
  const details = document.getElementById('reg-details').value;
  const msg = document.getElementById('reg-message');
  
  if (!name) return msg.innerText = "NAME REQUIRED";
  
  msg.innerText = "INITIALIZING BURST CAPTURE...";
  
  for (let i = 1; i <= 5; i++) {
    msg.innerText = `CAPTURING ANGLE ${i}/5...`;
    
    // Fetch frame directly from backend to avoid camera locks
    const frameRes = await fetch(`${API_BASE}/capture_frame`);
    const blob = await frameRes.blob();
    const image = await new Promise(r => {
      const reader = new FileReader();
      reader.onloadend = () => r(reader.result);
      reader.readAsDataURL(blob);
    });
    
    await fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, image, details })
    });
    await new Promise(r => setTimeout(r, 600));
  }
  
  msg.innerText = "REGISTRATION COMPLETE.";
}

// Boot
window.addEventListener('load', () => {
  const page = document.body.dataset.page;
  
  if (page === 'register') {
    // No getUserMedia needed, we use /video_feed
  } else if (page === 'profile') {
    renderProfile();
  } else {
    fetchData();
    setInterval(fetchData, 5000);
  }
});

function searchFromDashboard() {
  const name = document.getElementById('search-name').value;
  if (name) viewStudent(name);
}

async function loadSelectedMonth() {
  // Not fully implemented in this version, but can be added back if needed
  fetchData();
}

async function generateAIReport() {
  await fetch(`${API_BASE}/ai/generate_report`, { method: "POST" });
  alert("AI Intelligence Report Generated. Check /reports/latest");
}
