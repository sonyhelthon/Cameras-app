import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig } from './config.js';
import { Recorder, listLocal, FILE_RE } from './recorder.js';
import { LiveManager } from './live.js';
import { Drive } from './drive.js';
import { Ptz } from './ptz.js';
import { createAuth } from './auth.js';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const cfg = loadConfig();
const camById = new Map(cfg.cameras.map((c) => [c.id, c]));
const recorders = new Map();
if (cfg.recording.enabled) for (const cam of cfg.cameras) recorders.set(cam.id, new Recorder(cfg, cam));
const live = new LiveManager(cfg);
const drive = new Drive(cfg);
const ptz = new Ptz(cfg.cameras);
const auth = createAuth(cfg);

const app = express();
app.set('trust proxy', false);
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => auth.middleware(req, res, next));

app.post('/api/login', (req, res) => auth.login(req, res));
app.post('/api/logout', (req, res) => auth.logout(req, res));

const camOr404 = (req, res) => {
  const cam = camById.get(req.params.cam);
  if (!cam) res.status(404).json({ error: 'Câmera não encontrada' });
  return cam;
};
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.message });
  });

app.get('/api/cameras', (req, res) => {
  res.json(
    cfg.cameras.map((c) => ({
      id: c.id,
      name: c.name,
      ptz: !!c.ptz,
      ...(recorders.get(c.id)?.status() || { recording: false, lastFile: null, error: '' }),
    })),
  );
});

app.get('/api/status', (req, res) => {
  res.json({ drive: drive.status(), recordingEnabled: cfg.recording.enabled, auth: auth.enabled });
});

app.post('/api/ptz/:cam', wrap(async (req, res) => {
  if (!camOr404(req, res)) return;
  await ptz.move(req.params.cam, req.body?.dir, Number(req.body?.ms) || 600);
  res.json({ ok: true });
}));

// Live (HLS)
const Q_RE = /^(sd|hd)$/;
app.get('/live/:cam/:q/index.m3u8', wrap(async (req, res) => {
  const cam = camOr404(req, res);
  if (!cam || !Q_RE.test(req.params.q)) return res.status(404).end();
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

// Recordings
app.get('/api/recordings/:cam', wrap(async (req, res) => {
  const cam = camOr404(req, res);
  if (!cam) return;
  const local = listLocal(cfg.dataDir, cam.id).filter((f) => Date.now() - f.mtimeMs > 20_000);
  const names = new Set(local.map((f) => f.name));
  let remote = [];
  let driveError = '';
  try {
    remote = (await drive.list(cam.id)).filter((f) => !names.has(f.name));
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
  const cam = camOr404(req, res);
  if (!cam || !FILE_RE.test(req.params.file)) return res.status(404).end();
  if (req.query.download) res.attachment(`${cam.id}_${req.params.file}`);
  if (req.params.source === 'local') {
    return res.sendFile(path.join(cfg.dataDir, 'recordings', cam.id, req.params.file), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
  if (req.params.source === 'drive') return drive.stream(cam.id, req.params.file, req, res);
  res.status(404).end();
}));

app.get('/vendor/hls.min.js', (req, res) => res.sendFile(require.resolve('hls.js/dist/hls.min.js')));
app.use(express.static(path.join(ROOT, 'public')));

const server = app.listen(cfg.server.port, () => {
  console.log(`Câmeras: ${cfg.cameras.map((c) => c.name).join(', ') || '(nenhuma)'}`);
  console.log(`Gravação: ${cfg.recording.enabled ? 'ligada' : 'desligada'} | Google Drive: ${cfg.drive.enabled ? cfg.drive.remote : 'desligado'}`);
  if (!auth.enabled) console.warn('ATENÇÃO: sem senha (server.password vazio).');
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  console.log(`Abra no navegador: http://localhost:${cfg.server.port}`);
  for (const i of ips) console.log(`   ou na rede:      http://${i.address}:${cfg.server.port}`);
});

for (const r of recorders.values()) r.start();
drive.start();

function shutdown() {
  console.log('Encerrando...');
  for (const r of recorders.values()) r.stop();
  live.stopAll();
  drive.stop();
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
