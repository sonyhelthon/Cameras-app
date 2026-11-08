import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import express from 'express';
import { loadBase, importLegacy, ROOT } from './config.js';
import { Store } from './store.js';
import { BRANDS, resolveCamera, guessBrand } from './presets.js';
import { Tools } from './tools.js';
import { Recorder, listLocal, FILE_RE } from './recorder.js';
import { LiveManager } from './live.js';
import { Drive, cleanFolder } from './drive.js';
import { Ptz } from './ptz.js';
import { createAuth, hashPassword } from './auth.js';
import { discover } from './discover.js';
import { testCamera, friendlyError } from './probe.js';

const require = createRequire(import.meta.url);

const base = loadBase();
const store = new Store(base.dataDir);
importLegacy(store, base.legacy, hashPassword);
const tools = new Tools(base);

const ctx = {
  dataDir: base.dataDir,
  tools,
  settings: () => store.settings,
  ffmpeg: () => tools.bin('ffmpeg'),
};

// ---------- Cameras (runtime) ----------
let camById = new Map(); // id -> resolved camera
const camKeys = new Map(); // id -> JSON of saved camera, to detect changes
const recorders = new Map();
const live = new LiveManager(ctx);
const drive = new Drive(ctx);
const ptz = new Ptz((id) => camById.get(id));
let ffmpegReady = false;

function stopCamera(id) {
  recorders.get(id)?.stop();
  recorders.delete(id);
  live.stopCam(id);
  ptz.forget(id);
}

/** Starts/stops/restarts recorders so they match the saved cameras and settings. */
function applyCameras({ restartAll = false } = {}) {
  const saved = new Map(store.data.cameras.map((c) => [c.id, c]));
  for (const id of new Set([...camById.keys(), ...recorders.keys()])) {
    const key = saved.has(id) ? JSON.stringify(saved.get(id)) : null;
    if (restartAll || key !== camKeys.get(id)) {
      stopCamera(id);
      camById.delete(id);
      camKeys.delete(id);
    }
  }
  for (const [id, c] of saved) {
    if (!camById.has(id)) {
      camById.set(id, resolveCamera(c));
      camKeys.set(id, JSON.stringify(c));
    }
  }
  // Keep the order of the saved list.
  camById = new Map([...saved.keys()].map((id) => [id, camById.get(id)]));
  if (ffmpegReady && store.settings.recording.enabled) {
    for (const cam of camById.values()) {
      if (!recorders.has(cam.id)) {
        const r = new Recorder(ctx, cam);
        r.start();
        recorders.set(cam.id, r);
      }
    }
  }
}

// ---------- HTTP ----------
const auth = createAuth(base.dataDir, store);
const app = express();
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => auth.middleware(req, res, next));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.message });
  });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

app.get('/api/auth/state', (req, res) => auth.state(req, res));
app.post('/api/setup', (req, res) => auth.setup(req, res));
app.post('/api/login', (req, res) => auth.login(req, res));
app.post('/api/logout', (req, res) => auth.logout(req, res));
app.post('/api/password', (req, res) => auth.changePassword(req, res));

// Cameras for viewing
app.get('/api/cameras', (req, res) => {
  res.json(
    [...camById.values()].map((c) => {
      const st = recorders.get(c.id)?.status() || { recording: false, lastFile: null, error: '' };
      return { id: c.id, name: c.name, ptz: !!c.ptz, ...st, error: st.error ? friendlyError(st.error) : '' };
    }),
  );
});

app.get('/api/status', (req, res) => {
  res.json({
    drive: drive.status(),
    recordingEnabled: store.settings.recording.enabled,
    tools: tools.status,
    toolErrors: tools.errors,
  });
});

// ---------- Camera management ----------
app.get('/api/brands', (req, res) => {
  res.json(Object.entries(BRANDS).map(([id, b]) => ({ id, label: b.label, hint: b.hint, setup: b.setup, custom: !!b.custom, ptz: b.ptz, user: b.user })));
});

app.get('/api/admin/cameras', (req, res) => {
  res.json(store.data.cameras.map(({ password, ...c }) => ({ ...c, hasPassword: !!password })));
});

const CAM_FIELDS = ['name', 'brand', 'host', 'user', 'password', 'ptz', 'main', 'sub', 'rtspPort', 'onvifPort', 'transport'];
function cameraFromBody(body, existing = {}) {
  const c = { ...existing };
  for (const k of CAM_FIELDS) if (body[k] !== undefined) c[k] = body[k];
  // An empty password in the form means "keep the current one".
  if (!body.password && existing.password) c.password = existing.password;
  c.name = String(c.name || '').trim().slice(0, 40);
  c.brand = BRANDS[c.brand] ? c.brand : 'generic';
  c.host = String(c.host || '').trim();
  c.ptz = !!c.ptz;
  for (const k of ['rtspPort', 'onvifPort']) {
    if (c[k] === '' || c[k] == null) delete c[k];
    else c[k] = Number(c[k]);
  }
  if (!['auto', 'udp', 'tcp'].includes(c.transport)) c.transport = 'auto';
  if (!BRANDS[c.brand].custom) {
    delete c.main;
    delete c.sub;
  } else {
    c.main = String(c.main || '').trim();
    c.sub = String(c.sub || '').trim() || undefined;
  }
  return c;
}
function validateCamera(c) {
  if (BRANDS[c.brand].custom) {
    if (!/^(rtsp|rtsps|http|https):\/\//i.test(c.main)) throw bad('Informe o endereço RTSP completo (começa com rtsp://).');
  } else if (!/^[a-z0-9.-]+$/i.test(c.host)) throw bad('Informe o IP da câmera (ex.: 192.168.0.50).');
  for (const k of ['rtspPort', 'onvifPort']) if (c[k] !== undefined && !(c[k] > 0 && c[k] < 65536)) throw bad('Porta inválida.');
}

app.post('/api/admin/cameras', (req, res) => {
  const c = cameraFromBody(req.body || {});
  validateCamera(c);
  // No name yet (the person names it after seeing the image): "Câmera 1", "Câmera 2"…
  if (!c.name) {
    const names = new Set(store.data.cameras.map((x) => x.name));
    let n = store.data.cameras.length + 1;
    while (names.has(`Câmera ${n}`)) n++;
    c.name = `Câmera ${n}`;
  }
  c.id = store.newCameraId(c.name);
  store.data.cameras.push(c);
  store.save();
  applyCameras();
  res.json({ ok: true, id: c.id });
});

app.put('/api/admin/cameras/:id', (req, res) => {
  const i = store.data.cameras.findIndex((c) => c.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Câmera não encontrada' });
  const c = cameraFromBody(req.body || {}, store.data.cameras[i]);
  c.name ||= store.data.cameras[i].name;
  validateCamera(c);
  store.data.cameras[i] = c;
  store.save();
  applyCameras();
  res.json({ ok: true });
});

app.delete('/api/admin/cameras/:id', (req, res) => {
  const before = store.data.cameras.length;
  store.data.cameras = store.data.cameras.filter((c) => c.id !== req.params.id);
  if (store.data.cameras.length === before) return res.status(404).json({ error: 'Câmera não encontrada' });
  store.save();
  applyCameras();
  res.json({ ok: true });
});

app.post('/api/admin/cameras/order', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const byId = new Map(store.data.cameras.map((c) => [c.id, c]));
  store.data.cameras = [...ids.filter((id) => byId.has(id)).map((id) => byId.get(id)), ...store.data.cameras.filter((c) => !ids.includes(c.id))];
  store.save();
  applyCameras();
  res.json({ ok: true });
});

app.post('/api/admin/test', wrap(async (req, res) => {
  const body = req.body || {};
  const existing = store.data.cameras.find((c) => c.id === body.id) || {};
  const c = cameraFromBody(body, existing);
  validateCamera(c);
  await tools.ensure('ffmpeg');
  const cam = resolveCamera({ ...c, id: 'teste' });
  // Avoid competing with the running recorder for the same camera (cheap cameras allow few connections).
  if (existing.id) stopCamera(existing.id);
  try {
    const r = await testCamera(tools.bin('ffmpeg'), cam);
    res.json(r);
  } finally {
    if (existing.id) {
      camById.delete(existing.id);
      camKeys.delete(existing.id);
      applyCameras();
    }
  }
}));

let discovering = null;
app.get('/api/admin/discover', wrap(async (req, res) => {
  discovering ||= discover().finally(() => (discovering = null));
  const found = await discovering;
  const known = new Map(store.data.cameras.filter((c) => c.host).map((c) => [c.host, c.name]));
  res.json(found.map((f) => ({ ...f, brand: guessBrand(f), added: known.get(f.host) || null })));
}));

// ---------- Settings ----------
app.get('/api/settings', (req, res) => {
  res.json({ settings: store.settings, drive: drive.status(), tools: tools.status, toolErrors: tools.errors, platform: process.platform });
});

app.put('/api/settings', (req, res) => {
  const b = req.body || {};
  const s = store.settings;
  const patch = {};
  if (b.recording) {
    patch.recording = {};
    if (b.recording.enabled !== undefined) patch.recording.enabled = !!b.recording.enabled;
    if (['main', 'sub'].includes(b.recording.stream)) patch.recording.stream = b.recording.stream;
    if (b.recording.audio !== undefined) patch.recording.audio = !!b.recording.audio;
  }
  if (b.local?.retentionHours !== undefined) {
    const h = Number(b.local.retentionHours);
    if (!(h >= 1 && h <= 24 * 60)) throw bad('Horas no computador: entre 1 e 1440.');
    patch.local = { retentionHours: h };
  }
  if (b.drive) {
    patch.drive = {};
    if (b.drive.enabled !== undefined) patch.drive.enabled = !!b.drive.enabled;
    if (b.drive.folder !== undefined) {
      const f = cleanFolder(b.drive.folder);
      if (!f) throw bad('Informe a pasta do Drive (ex.: Cameras/Casa).');
      patch.drive.folder = f;
    }
    if (b.drive.retentionDays !== undefined) {
      const d = Number(b.drive.retentionDays);
      if (!(d >= 1 && d <= 3650)) throw bad('Dias no Drive: entre 1 e 3650.');
      patch.drive.retentionDays = d;
    }
    if (b.drive.bwlimit !== undefined) {
      if (b.drive.bwlimit && !/^\d+(\.\d+)?[KMG]?$/i.test(b.drive.bwlimit)) throw bad('Limite de upload inválido (ex.: 2M).');
      patch.drive.bwlimit = String(b.drive.bwlimit || '');
    }
  }
  const recBefore = JSON.stringify(s.recording);
  const folderBefore = s.drive.folder;
  store.updateSettings(patch);
  if (JSON.stringify(store.settings.recording) !== recBefore) applyCameras({ restartAll: true });
  if (store.settings.drive.folder !== folderBefore) drive.reset();
  res.json({ ok: true, settings: store.settings });
});

app.post('/api/drive/connect', wrap(async (req, res) => {
  await drive.connect();
  res.json({ ok: true });
}));
app.get('/api/drive/about', wrap(async (req, res) => {
  if (!(await drive.checkConnected())) return res.json({ connected: false });
  res.json({ connected: true, ...(await drive.about()) });
}));
app.post('/api/drive/upload-now', (req, res) => {
  if (!store.settings.drive.enabled) return res.status(400).json({ error: 'Ative o envio para o Drive primeiro.' });
  drive.upload().catch(() => {});
  res.json({ ok: true });
});

app.post('/api/ptz/:cam', wrap(async (req, res) => {
  await ptz.move(req.params.cam, req.body?.dir, Number(req.body?.ms) || 600);
  res.json({ ok: true });
}));

// ---------- Live (HLS) ----------
const Q_RE = /^(sd|hd)$/;
app.get('/live/:cam/:q/index.m3u8', wrap(async (req, res) => {
  const cam = camById.get(req.params.cam);
  if (!cam || !Q_RE.test(req.params.q)) return res.status(404).end();
  if (!ffmpegReady) return res.status(503).json({ error: 'Preparando o ffmpeg…' });
  const file = await live.waitPlaylist(cam, req.params.q);
  res.set('Cache-Control', 'no-store').type('application/vnd.apple.mpegurl').sendFile(file);
}));
app.get('/live/:cam/:q/:seg', (req, res) => {
  const cam = camById.get(req.params.cam);
  if (!cam || !Q_RE.test(req.params.q) || !/^s\d+\.ts$/.test(req.params.seg)) return res.status(404).end();
  const s = live.touch(cam, req.params.q);
  res.set('Cache-Control', 'no-store').type('video/mp2t').sendFile(path.join(s.dir, req.params.seg), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// ---------- Recordings ----------
const ID_RE = /^[a-z0-9_-]+$/i;
app.get('/api/recordings/:cam', wrap(async (req, res) => {
  const id = req.params.cam;
  if (!ID_RE.test(id)) return res.status(404).end();
  const local = listLocal(base.dataDir, id).filter((f) => Date.now() - f.mtimeMs > 20_000);
  const names = new Set(local.map((f) => f.name));
  let remote = [];
  let driveError = '';
  try {
    remote = (await drive.list(id)).filter((f) => !names.has(f.name));
  } catch (e) {
    driveError = e.message;
  }
  const items = [
    ...local.map((f) => ({ name: f.name, size: f.size, source: 'local' })),
    ...remote.map((f) => ({ name: f.name, size: f.size, source: 'drive' })),
  ].sort((a, b) => b.name.localeCompare(a.name));
  res.json({ items, driveError });
}));

app.get('/rec/:source/:cam/:file', wrap(async (req, res) => {
  const { cam, file, source } = req.params;
  if (!ID_RE.test(cam) || !FILE_RE.test(file)) return res.status(404).end();
  if (req.query.download) res.attachment(`${cam}_${file}`);
  if (source === 'local') {
    return res.sendFile(path.join(base.dataDir, 'recordings', cam, file), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
  if (source === 'drive') return drive.stream(cam, file, req, res);
  res.status(404).end();
}));

app.get('/vendor/hls.min.js', (req, res) => res.sendFile(require.resolve('hls.js/dist/hls.min.js')));
app.use(express.static(path.join(ROOT, 'public')));
// Errors from handlers answer as JSON, which the app shows to the person.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Erro' });
});

// ---------- Start ----------
const server = app.listen(base.port, () => {
  console.log(`Câmeras: ${[...camById.values()].map((c) => c.name).join(', ') || '(nenhuma ainda: adicione pelo app)'}`);
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && /^(192\.168|10)\./.test(i.address));
  console.log(`\nAbra no navegador deste computador: http://localhost:${base.port}`);
  for (const i of ips) console.log(`No celular (mesmo Wi-Fi):           http://${i.address}:${base.port}`);
  console.log('');
});

applyCameras();
tools
  .ensure('ffmpeg')
  .then((p) => {
    console.log(`ffmpeg: OK (${p})`);
    ffmpegReady = true;
    applyCameras();
  })
  .catch((e) => console.error(`\n*** ${e.message} ***\n`));
drive.start();
if (store.settings.drive.enabled) drive.checkConnected();

function shutdown() {
  console.log('Encerrando...');
  for (const id of recorders.keys()) stopCamera(id);
  live.stopAll();
  drive.stop();
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
