/* global Hls */
'use strict';

const $ = (s) => document.querySelector(s);
let cameras = [];
const players = new Map(); // video element -> { hls }

async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) {
    location.href = '/login.html';
    throw new Error('login');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
  return data;
}

// ---------- Video helpers ----------
function playHls(video, src, msgEl) {
  stopVideo(video);
  if (msgEl) msgEl.textContent = 'Conectando…';
  const onPlaying = () => msgEl && (msgEl.textContent = '');
  video.addEventListener('playing', onPlaying, { once: true });

  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({ liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 5, manifestLoadingTimeOut: 25000, manifestLoadingMaxRetry: 6 });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (msgEl) msgEl.textContent = 'Câmera indisponível. Tentando de novo…';
      setTimeout(() => players.get(video)?.hls === hls && playHls(video, src, msgEl), 5000);
    });
    hls.loadSource(src);
    hls.attachMedia(video);
    players.set(video, { hls });
  } else {
    video.src = src; // iPhone / Safari
    players.set(video, { hls: null });
  }
  video.play().catch(() => {});
}

function stopVideo(video) {
  const p = players.get(video);
  if (p?.hls) p.hls.destroy();
  players.delete(video);
  video.removeAttribute('src');
  video.load();
}

// ---------- Live grid ----------
function renderGrid() {
  const grid = $('#grid');
  grid.innerHTML = '';
  if (!cameras.length) {
    grid.innerHTML = '<div class="empty-state"><p>Nenhuma câmera ainda.</p><button class="btn primary">+ Adicionar câmera</button></div>';
    grid.querySelector('button').addEventListener('click', () => {
      showTab('settings');
      window.openCameraEditor();
    });
    return;
  }
  for (const cam of cameras) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.cam = cam.id;
    tile.innerHTML = `
      <video muted autoplay playsinline></video>
      <div class="overlay-msg"></div>
      <div class="label"><span class="dot" title=""></span><span class="name"></span></div>`;
    tile.querySelector('.name').textContent = cam.name;
    tile.addEventListener('click', () => openViewer(cam));
    grid.appendChild(tile);
  }
  updateBadges();
  startGrid();
}

function startGrid() {
  for (const tile of document.querySelectorAll('.tile')) {
    playHls(tile.querySelector('video'), `/live/${tile.dataset.cam}/sd/index.m3u8`, tile.querySelector('.overlay-msg'));
  }
}
function stopGrid() {
  for (const v of document.querySelectorAll('.tile video')) stopVideo(v);
}

function updateBadges() {
  for (const cam of cameras) {
    const dot = document.querySelector(`.tile[data-cam="${cam.id}"] .dot`);
    if (!dot) continue;
    dot.classList.toggle('rec', cam.recording);
    const msg = document.querySelector(`.tile[data-cam="${cam.id}"] .overlay-msg`);
    if (msg && msg.textContent && !cam.recording && cam.error) msg.textContent = `${cam.error} (Ajustes → Editar → Testar)`;
    dot.title = cam.recording ? 'Gravando' : cam.error ? `Não está gravando: ${cam.error}` : 'Não está gravando';
  }
}

async function refreshStatus() {
  try {
    cameras = await api('/api/cameras');
    updateBadges();
    const st = await api('/api/status');
    if (st.site) {
      $('#site-name').textContent = st.site;
      document.title = `${st.site} · Câmeras`;
    }
    const el = $('#drive-status');
    if (st.tools.ffmpeg === 'baixando') {
      el.textContent = 'Preparando vídeo…';
      el.className = 'pill';
    } else if (!st.drive.enabled) {
      el.textContent = 'Drive desligado';
      el.className = 'pill';
    } else if (st.drive.error) {
      el.textContent = 'Drive: erro no envio';
      el.title = st.drive.error;
      el.className = 'pill bad';
    } else {
      el.textContent = st.drive.lastUpload ? `Drive ✓ ${new Date(st.drive.lastUpload).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Drive: aguardando';
      el.title = '';
      el.className = 'pill';
    }
  } catch { /* offline */ }
}

// ---------- Fullscreen viewer + PTZ ----------
let viewerCam = null;
let viewerHd = false;

function openViewer(cam) {
  viewerCam = cam;
  viewerHd = false;
  stopGrid();
  $('#viewer-title').textContent = cam.name;
  $('#ptz').hidden = !cam.ptz;
  $('#viewer').showModal();
  resetZoom();
  loadViewer();
  // Phone: full screen and sideways, like a video player.
  const d = $('#viewer');
  if (matchMedia('(pointer: coarse)').matches && d.requestFullscreen) {
    d.requestFullscreen()
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }
}
function loadViewer() {
  $('#viewer-hd').classList.toggle('on', viewerHd);
  const v = $('#viewer-video');
  v.muted = true;
  $('#viewer-sound').textContent = '🔇 Som';
  playHls(v, `/live/${viewerCam.id}/${viewerHd ? 'hd' : 'sd'}/index.m3u8`, $('#viewer-msg'));
}
$('#viewer-hd').addEventListener('click', () => { viewerHd = !viewerHd; loadViewer(); });
$('#viewer-close').addEventListener('click', () => $('#viewer').close());
$('#viewer').addEventListener('close', () => {
  try { screen.orientation?.unlock?.(); } catch { /* not supported */ }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  stopVideo($('#viewer-video'));
  viewerCam = null;
  if (currentTab === 'live') startGrid();
});
$('#viewer-sound').addEventListener('click', () => {
  const v = $('#viewer-video');
  v.muted = !v.muted;
  $('#viewer-sound').textContent = v.muted ? '🔇 Som' : '🔊 Som';
});

// ---------- Zoom (pinch / double tap / mouse wheel) ----------
const zoom = { s: 1, x: 0, y: 0 };
const pointers = new Map();
let pinchStart = null;
let lastTap = 0;
function applyZoom() {
  const v = $('#viewer-video');
  const body = $('.viewer-body');
  // Keep the image inside the screen when zoomed.
  const maxX = (body.clientWidth * (zoom.s - 1)) / 2;
  const maxY = (body.clientHeight * (zoom.s - 1)) / 2;
  zoom.x = Math.max(-maxX, Math.min(maxX, zoom.x));
  zoom.y = Math.max(-maxY, Math.min(maxY, zoom.y));
  v.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
}
function resetZoom() {
  Object.assign(zoom, { s: 1, x: 0, y: 0 });
  applyZoom();
}
const zbody = $('.viewer-body');
zbody.addEventListener('pointerdown', (e) => {
  zbody.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), s: zoom.s };
  }
  if (pointers.size === 1) {
    const now = Date.now();
    if (now - lastTap < 300) {
      if (zoom.s > 1) resetZoom();
      else {
        zoom.s = 2.5;
        applyZoom();
      }
    }
    lastTap = now;
  }
});
zbody.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    zoom.s = Math.max(1, Math.min(6, (pinchStart.s * Math.hypot(a.x - b.x, a.y - b.y)) / pinchStart.d));
    if (zoom.s === 1) Object.assign(zoom, { x: 0, y: 0 });
    applyZoom();
  } else if (pointers.size === 1 && zoom.s > 1) {
    zoom.x += e.clientX - prev.x;
    zoom.y += e.clientY - prev.y;
    applyZoom();
  }
});
for (const ev of ['pointerup', 'pointercancel']) {
  zbody.addEventListener(ev, (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
  });
}
zbody.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom.s = Math.max(1, Math.min(6, zoom.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
  if (zoom.s === 1) Object.assign(zoom, { x: 0, y: 0 });
  applyZoom();
}, { passive: false });

// Photo of what is on screen
$('#viewer-photo').addEventListener('click', () => {
  const v = $('#viewer-video');
  if (!v.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  const a = document.createElement('a');
  const t = new Date();
  a.download = `${viewerCam.name}_${t.toLocaleDateString('pt-BR').replace(/\//g, '-')}_${t.toTimeString().slice(0, 8).replace(/:/g, '-')}.jpg`;
  a.href = c.toDataURL('image/jpeg', 0.92);
  a.click();
});

for (const btn of document.querySelectorAll('#ptz button')) {
  let held = null;
  const send = () => viewerCam && api(`/api/ptz/${viewerCam.id}`, { method: 'POST', body: JSON.stringify({ dir: btn.dataset.dir, ms: 500 }) })
    .catch((e) => { $('#viewer-msg').textContent = e.message; setTimeout(() => ($('#viewer-msg').textContent = ''), 3000); });
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    send();
    held = setInterval(send, 550);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, () => clearInterval(held));
}

// ---------- Recordings ----------
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadRecordings() {
  const cam = $('#rec-cam').value;
  const day = $('#rec-day').value;
  const list = $('#rec-list');
  const info = $('#rec-info');
  list.innerHTML = '';
  info.textContent = 'Carregando…';
  try {
    const { items, driveError } = await api(`/api/recordings/${cam}`);
    const dayItems = items.filter((i) => i.name.startsWith(day));
    info.textContent = `${dayItems.length} gravação(ões) neste dia.` + (driveError ? ` Erro ao ler o Drive: ${driveError}` : '');
    for (const it of dayItems) {
      const li = document.createElement('li');
      const time = it.name.slice(11, 16).replace('-', ':');
      const mb = it.size >= 1048576 ? `${Math.round(it.size / 1048576)} MB` : `${Math.max(1, Math.round(it.size / 1024))} KB`;
      const url = `/rec/${it.source}/${cam}/${it.name}`;
      li.innerHTML = `<span class="time"></span><span class="muted"></span><span class="src"></span><a title="Baixar">⬇</a>`;
      li.querySelector('.time').textContent = time;
      li.querySelector('.muted').textContent = mb;
      li.querySelector('.src').textContent = it.source === 'drive' ? 'Drive' : 'Notebook';
      const a = li.querySelector('a');
      a.href = `${url}?download=1`;
      a.addEventListener('click', (e) => e.stopPropagation());
      li.addEventListener('click', () => {
        for (const x of list.children) x.classList.remove('playing');
        li.classList.add('playing');
        const p = $('#rec-player');
        p.hidden = false;
        p.src = url;
        p.play().catch(() => {});
        p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      list.appendChild(li);
    }
  } catch (e) {
    info.textContent = e.message;
  }
}

// ---------- Tabs ----------
let currentTab = 'live';
function showTab(tab) {
  currentTab = tab;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  $('#tab-live').hidden = tab !== 'live';
  $('#tab-recs').hidden = tab !== 'recs';
  $('#tab-settings').hidden = tab !== 'settings';
  if (tab === 'live') startGrid();
  else stopGrid();
  if (tab === 'recs') loadRecordings();
  if (tab === 'settings') window.openSettings().catch((e) => alert(e.message));
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
$('#rec-cam').addEventListener('change', loadRecordings);
$('#rec-day').addEventListener('change', loadRecordings);

// Stop streams when the app goes to background (saves the phone's data plan and battery).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopGrid();
    if (viewerCam) stopVideo($('#viewer-video'));
  } else if (viewerCam) loadViewer();
  else if (currentTab === 'live') startGrid();
});

// Reloads the camera list after cameras are added/changed in Ajustes.
async function reloadCameras() {
  stopGrid();
  cameras = await api('/api/cameras');
  const sel = $('#rec-cam');
  const current = sel.value;
  sel.innerHTML = '';
  for (const c of cameras) sel.add(new Option(c.name, c.id));
  if (current) sel.value = current;
  renderGrid();
  if (currentTab !== 'live') stopGrid();
}

// Opened from the Android app: show the "⇄" button to go back to the list of places.
try {
  if (new URLSearchParams(location.search).get('app') === '1') sessionStorage.setItem('inApp', '1');
  if (sessionStorage.getItem('inApp')) document.querySelector('#locais').hidden = false;
} catch { /* storage blocked */ }

// ---------- Init ----------
(async () => {
  $('#rec-day').value = today();
  await reloadCameras();
  refreshStatus();
  setInterval(refreshStatus, 30_000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
