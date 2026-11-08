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
    dot.title = cam.recording ? 'Gravando' : cam.error ? `Não está gravando: ${cam.error}` : 'Não está gravando';
  }
}

async function refreshStatus() {
  try {
    cameras = await api('/api/cameras');
    updateBadges();
    const st = await api('/api/status');
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
  loadViewer();
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
  stopVideo($('#viewer-video'));
  viewerCam = null;
  if (currentTab === 'live') startGrid();
});
$('#viewer-sound').addEventListener('click', () => {
  const v = $('#viewer-video');
  v.muted = !v.muted;
  $('#viewer-sound').textContent = v.muted ? '🔇 Som' : '🔊 Som';
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

// ---------- Init ----------
(async () => {
  $('#rec-day').value = today();
  await reloadCameras();
  refreshStatus();
  setInterval(refreshStatus, 30_000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
