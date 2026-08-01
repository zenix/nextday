'use strict';

// Escapes text before it's interpolated into an innerHTML template. Applied
// to every value in this file that ultimately comes from outside this
// server's own static assets — calendar feeds, Wilma, the holidays API,
// and server error messages — so a hostile event title or homework string
// can't execute script in the dashboard origin.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

let currentDate = readDateFromHash() || getTomorrow();
let refreshInterval = null;
let config = {
  calendars: [],
  widgetOrder: ['weather', 'kids', 'calendar'],
  accentColor: '#38BDF8',
  wilma: { baseUrl: '', username: '', passwordSet: false },
};
let meta = { students: [] };
let csrfToken = null;
// Calendar URLs the user has typed this session but not yet saved. Only
// entries here (non-empty) are sent to PUT /api/secrets — an empty field
// always means "leave the stored URL alone", since the server never sends
// a secret URL back to us to prefill.
let pendingCalendarUrls = {};

function readDateFromHash() {
  const h = location.hash.slice(1);
  const datePart = h.split('?')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
}

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function getToday() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function navigate(offset) {
  const d = new Date(currentDate + 'T12:00:00');
  d.setDate(d.getDate() + offset);
  currentDate = d.toISOString().slice(0, 10);
  location.hash = currentDate;
}

window.addEventListener('hashchange', () => {
  currentDate = readDateFromHash() || getTomorrow();
  loadDay();
});

window.onerror = function (msg) {
  showError(`UI Error: ${esc(msg)}`);
  return false;
};

// Wraps fetch(): attaches the CSRF header to state-changing requests and
// sends a logged-out user back to the login page on a 401 instead of
// letting every caller handle that separately.
async function apiFetch(url, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  const method = (opts.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    opts.headers['X-CSRF-Token'] = csrfToken;
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.hash);
    throw new Error('Not authenticated');
  }
  return res;
}

async function fetchSession() {
  try {
    const res = await apiFetch('/api/session');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    csrfToken = data.csrfToken;
  } catch (e) {
    console.error('Failed to fetch session', e);
  }
}

async function fetchConfig() {
  try {
    const res = await apiFetch('/api/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const newConfig = await res.json();
    config = { ...config, ...newConfig };
    applyAccent(config.accentColor);
  } catch (e) {
    console.error('Failed to fetch config', e);
  }
}

async function fetchMeta() {
  try {
    const res = await apiFetch('/api/meta');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    meta = await res.json();
  } catch (e) {
    console.error('Failed to fetch meta', e);
  }
}

function genId() {
  // Not a secret, just a stable local key linking a public calendar entry
  // to its (secret, server-side-only) URL — doesn't need crypto.randomUUID,
  // which some browsers refuse on a plain-http LAN origin.
  return 'cal-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function renderCalendarList() {
  const list = document.getElementById('calendarList');
  list.innerHTML = (config.calendars || []).map((c, i) => `
    <div style="display:flex; gap:8px; align-items:center;" data-cal-row="${esc(c.id)}">
      <input type="text" placeholder="Name" value="${esc(c.name || '')}"
             data-idx="${i}" data-field="name" style="flex:0 0 30%;">
      <input type="text" placeholder="${c.urlSet ? 'URL set — leave blank to keep' : 'Paste iCal URL to add'}"
             value="${esc(pendingCalendarUrls[c.id] || '')}"
             data-idx="${i}" data-field="url" style="flex:1;">
      <button type="button" class="order-btn" data-remove-idx="${i}">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('input[data-field="name"]').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = Number(e.target.dataset.idx);
      config.calendars[idx].name = e.target.value;
    });
  });
  list.querySelectorAll('input[data-field="url"]').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = Number(e.target.dataset.idx);
      pendingCalendarUrls[config.calendars[idx].id] = e.target.value;
    });
  });
}

function addCalendar() {
  if (!Array.isArray(config.calendars)) config.calendars = [];
  config.calendars.push({ id: genId(), name: '', urlSet: false });
  renderCalendarList();
}

function removeCalendar(idx) {
  const [removed] = config.calendars.splice(idx, 1);
  if (removed) delete pendingCalendarUrls[removed.id];
  renderCalendarList();
}

function toggleSettings(show) {
  const modal = document.getElementById('settingsModal');
  modal.style.display = show ? 'flex' : 'none';
  if (show) {
    populateSettings();
  }
}

async function populateSettings() {
  await fetchConfig();
  pendingCalendarUrls = {};
  if (!Array.isArray(config.calendars)) config.calendars = [];
  renderCalendarList();

  document.getElementById('wilmaBaseUrl').value = config.wilma?.baseUrl || '';
  document.getElementById('wilmaUser').value = config.wilma?.username || '';
  document.getElementById('wilmaPass').value = '';
  document.getElementById('wilmaPassStatus').textContent = config.wilma?.passwordSet ? '(set)' : '(not set)';

  renderWidgetOrder();

  document.querySelectorAll('.theme-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.color === config.accentColor);
  });
}

function renderWidgetOrder() {
  const list = document.getElementById('widgetList');
  list.innerHTML = config.widgetOrder.map((id, index) => `
    <div class="widget-order-item">
      <span>${esc(id.charAt(0).toUpperCase() + id.slice(1))}</span>
      <div class="order-btns">
        <button class="order-btn" data-move-idx="${index}" data-move-dir="-1" ${index === 0 ? 'disabled style="opacity:0.3"' : ''}>↑</button>
        <button class="order-btn" data-move-idx="${index}" data-move-dir="1" ${index === config.widgetOrder.length - 1 ? 'disabled style="opacity:0.3"' : ''}>↓</button>
      </div>
    </div>
  `).join('');
}

function moveWidget(index, direction) {
  const newOrder = [...config.widgetOrder];
  const targetIndex = index + direction;
  [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];
  config.widgetOrder = newOrder;
  renderWidgetOrder();
}

function setAccent(color) {
  config.accentColor = color;
  applyAccent(color);
  document.querySelectorAll('.theme-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.color === color);
  });
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
}

async function saveSettings() {
  const publicConfig = {
    calendars: (config.calendars || []).map(c => ({ id: c.id, name: c.name || '' })),
    widgetOrder: config.widgetOrder,
    accentColor: config.accentColor,
  };

  try {
    const configRes = await apiFetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(publicConfig),
    });
    if (!configRes.ok) {
      const data = await configRes.json().catch(() => ({}));
      alert(`Failed to save settings: ${data.error || configRes.status}`);
      return;
    }

    const wilmaBaseUrl = document.getElementById('wilmaBaseUrl').value;
    const wilmaUser = document.getElementById('wilmaUser').value;
    const wilmaPass = document.getElementById('wilmaPass').value;
    const secretsPatch = {};
    if (wilmaBaseUrl || wilmaUser || wilmaPass) {
      secretsPatch.wilma = {};
      if (wilmaBaseUrl) secretsPatch.wilma.baseUrl = wilmaBaseUrl;
      if (wilmaUser) secretsPatch.wilma.username = wilmaUser;
      if (wilmaPass) secretsPatch.wilma.password = wilmaPass;
    }
    const urlEntries = Object.entries(pendingCalendarUrls).filter(([, url]) => url);
    if (urlEntries.length > 0) {
      secretsPatch.calendarUrls = Object.fromEntries(urlEntries);
    }

    if (Object.keys(secretsPatch).length > 0) {
      const secretsRes = await apiFetch('/api/secrets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(secretsPatch),
      });
      if (!secretsRes.ok) {
        const data = await secretsRes.json().catch(() => ({}));
        alert(`Settings saved, but credentials failed to save: ${data.error || secretsRes.status}`);
        return;
      }
    }

    pendingCalendarUrls = {};
    toggleSettings(false);
    loadDay();
  } catch (e) {
    if (e.message !== 'Not authenticated') alert('Failed to save settings');
  }
}

async function logout() {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch (e) {
    // apiFetch already redirects on 401; ignore other errors and leave anyway
  }
  location.href = '/login.html';
}

function weatherIcon(wmoCode) {
  if (wmoCode === 0) return '☀️';
  if (wmoCode <= 2) return '🌤';
  if (wmoCode === 3) return '☁️';
  if (wmoCode <= 48) return '🌫';
  if (wmoCode <= 67) return '🌧';
  if (wmoCode <= 77) return '❄️';
  if (wmoCode <= 82) return '🌦';
  if (wmoCode <= 86) return '🌨';
  return '⛈';
}

function formatDateTitle(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const today = getToday();
  const tomorrow = getTomorrow();

  let prefix = '';
  if (dateStr === today) prefix = 'TODAY • ';
  else if (dateStr === tomorrow) prefix = 'TOMORROW • ';

  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(d);
  const dayMonth = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' }).format(d).replace(/\//g, '.');

  return (prefix + weekday + ' ' + dayMonth).toUpperCase();
}

function renderWeather(weather) {
  if (!weather || weather.error) {
    return `<div class="card"><div class="error-inline">☁️ Weather unavailable: ${esc(weather?.message || 'Unknown error')}</div></div>`;
  }

  const hourlyHtml = weather.hourly ? `
    <div class="weather-hourly">
      ${weather.hourly.map(h => `
        <div class="hourly-point">
          <span class="hourly-time">${esc(h.time)}</span>
          <span class="hourly-icon">${weatherIcon(h.wmoCode)}</span>
          <span class="hourly-temp">${Math.round(h.temp)}°</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
    <div class="card weather-card">
      <div class="weather">
        <div class="weather-main">
          <div class="weather-icon">${weatherIcon(weather.wmoCode)}</div>
          <div class="weather-temps">
            <span class="temp-high">${Number(weather.tempMax)}°</span>
            <span class="temp-low">${Number(weather.tempMin)}°</span>
            <span style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Pirkkala</span>
          </div>
        </div>
        <div class="weather-details">
          <div class="w-detail">💧 ${Number(weather.precipitationMm)}mm</div>
          <div class="w-detail">💨 ${Number(weather.windKph)} km/h</div>
        </div>
      </div>
      ${hourlyHtml}
    </div>
  `;
}

function renderCalendar(calendar) {
  if (!calendar || calendar.error) {
    return `<div class="card"><h2>YOUR DAY</h2><div class="error-inline">📅 Calendar unavailable: ${esc(calendar?.message || 'Unknown error')}</div></div>`;
  }

  let eventsHtml = '';
  if (calendar.length === 0) {
    eventsHtml = '<div class="empty-state">No events scheduled.</div>';
  } else {
    eventsHtml = `<ul>${calendar.map(ev => `
      <li>
        <div class="event">
          <div class="event-time">${esc(ev.time)}</div>
          <div class="event-details">
            <div class="event-title">${esc(ev.title)}</div>
            ${ev.durationMinutes ? `<div class="event-duration">${Number(ev.durationMinutes)} min</div>` : ''}
          </div>
        </div>
      </li>
    `).join('')}</ul>`;
  }

  return `
    <div class="card">
      <h2>YOUR DAY</h2>
      ${eventsHtml}
    </div>
  `;
}

function renderKids(kids) {
  if (!kids || kids.error) {
    return `<div class="card"><h2>WILMA</h2><div class="error-inline">🎒 Wilma unavailable: ${esc(kids?.message || 'Unknown error')}</div></div>`;
  }

  if (kids.length === 0) {
    return '';
  }

  const kidsHtml = kids.map(kid => {
    const scheduleHtml = kid.schedule.length ? kid.schedule.map(s => `<span class="subject-tag">${esc(s.time)} ${esc(s.subject)}</span>`).join(' ') : '<span class="empty-state">None</span>';
    const hwHtml = kid.homework.length ? kid.homework.map(h => `<div class="data-item"><span><b>${esc(h.subject)}</b> — ${esc(h.description)}</span><span style="color:var(--text-muted);font-size:0.85rem;white-space:nowrap;">${esc(h.dueDate)}</span></div>`).join('') : '<span class="empty-state">None pending</span>';
    const examsHtml = kid.exams.length ? kid.exams.map(e => `<div class="data-item"><span><b>${esc(e.subject)}</b> on ${esc(e.date)}</span></div>`).join('') : '<span class="empty-state">No upcoming exams</span>';

    return `
      <div class="kid-block">
        <div class="kid-name">${esc(kid.name.toUpperCase())}</div>
        <div class="data-row">
          <div class="data-label">Schedule</div>
          <div class="data-content" style="display:flex; flex-wrap:wrap; gap:6px;">${scheduleHtml}</div>
        </div>
        <div class="data-row">
          <div class="data-label">Homework</div>
          <div class="data-content">${hwHtml}</div>
        </div>
        <div class="data-row">
          <div class="data-label">Exams</div>
          <div class="data-content">${examsHtml}</div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="card">
      <h2>WILMA</h2>
      ${kidsHtml}
    </div>
  `;
}

function render(data) {
  document.getElementById('dateTitle').innerText = formatDateTitle(data.date);

  const badge = document.getElementById('holidayBadge');
  if (data.holiday) {
    badge.innerHTML = `<span class="holiday-pill">${esc(data.holiday.localName)}</span>`;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }

  const content = document.getElementById('content');

  let html = '';
  config.widgetOrder.forEach(id => {
    if (id === 'weather') html += renderWeather(data.weather);
    if (id === 'calendar') html += renderCalendar(data.calendar);
    if (id === 'kids') html += renderKids(data.kids);
  });

  content.innerHTML = html;

  content.style.animation = 'none';
  content.offsetHeight;
  content.style.animation = 'fadeIn 0.3s ease-out';
}

function showLoading() {
  document.getElementById('content').innerHTML = `
    <div class="card loading">
      <div class="spinner"></div>
      <div>Fetching the day...</div>
    </div>
  `;
}

function showError(msg) {
  document.getElementById('content').innerHTML = `
    <div class="card error-full">
      <div style="font-size: 2rem; margin-bottom: 10px;">⚠️</div>
      <div>${esc(msg)}</div>
      <button class="btn-retry" data-retry>Retry</button>
    </div>
  `;
}

async function loadDay() {
  showLoading();
  document.getElementById('dateTitle').innerText = formatDateTitle(currentDate);

  const params = new URLSearchParams();
  params.set('date', currentDate);
  try {
    const res = await apiFetch(`/api/day?${params.toString()}`);
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    render(data);
  } catch (e) {
    if (e.message !== 'Not authenticated') {
      showError('Failed to load data. Please check your connection or server logs.');
    }
  }

  setupAutoRefresh();
}

function setupAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);

  const today = getToday();
  const tomorrow = getTomorrow();

  if (currentDate === today || currentDate === tomorrow) {
    refreshInterval = setInterval(loadDay, 30 * 60 * 1000);
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.error('ServiceWorker registration failed: ', err);
    });
  });
}

// Event delegation for everything that used to be an inline onclick= — a
// strict script-src 'self' CSP blocks inline handlers, so all wiring lives
// here instead of in the HTML.
function wireUpEvents() {
  document.getElementById('prevBtn').addEventListener('click', () => navigate(-1));
  document.getElementById('nextBtn').addEventListener('click', () => navigate(1));
  document.getElementById('openSettingsBtn').addEventListener('click', () => toggleSettings(true));
  document.getElementById('closeSettingsBtn').addEventListener('click', () => toggleSettings(false));
  document.getElementById('addCalendarBtn').addEventListener('click', addCalendar);
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  document.getElementById('logoutBtn').addEventListener('click', logout);

  document.getElementById('themePicker').addEventListener('click', (e) => {
    const dot = e.target.closest('.theme-dot');
    if (dot) setAccent(dot.dataset.color);
  });

  document.getElementById('calendarList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-idx]');
    if (btn) removeCalendar(Number(btn.dataset.removeIdx));
  });

  document.getElementById('widgetList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-move-idx]');
    if (btn && !btn.disabled) moveWidget(Number(btn.dataset.moveIdx), Number(btn.dataset.moveDir));
  });

  document.getElementById('content').addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) loadDay();
  });
}

async function init() {
  wireUpEvents();
  await fetchSession();
  await Promise.allSettled([
    fetchConfig(),
    fetchMeta(),
  ]);

  location.hash = currentDate;
  loadDay();
}

init();
