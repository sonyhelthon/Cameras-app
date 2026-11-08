import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Base settings of the server. Everything else (cameras, Drive, password) is set up in the app.
 * config.yaml is optional: port, data folder and program paths. An old config.yaml with cameras
 * is imported once (see importLegacy).
 */
export function loadBase(file = process.env.CONFIG || 'config.yaml') {
  let raw = {};
  let baseDir = process.cwd();
  if (fs.existsSync(file)) {
    raw = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
    baseDir = path.dirname(path.resolve(file));
  }
  const base = {
    port: Number(process.env.PORT) || raw.server?.port || 8080,
    bin: { ffmpeg: 'ffmpeg', rclone: 'rclone', ...raw.bin },
    dataDir: path.resolve(baseDir, raw.dataDir || './data'),
    legacy: raw,
  };
  for (const d of ['recordings', 'live']) fs.mkdirSync(path.join(base.dataDir, d), { recursive: true });
  return base;
}

/** Brings cameras/password/settings from an old config.yaml into the app (only once). */
export function importLegacy(store, legacy, hashPassword) {
  if (store.data.imported) return;
  store.data.imported = true;
  if (legacy.server?.password && !store.data.passwordHash) store.data.passwordHash = hashPassword(String(legacy.server.password));
  const d = legacy.defaults || {};
  for (const c of legacy.cameras || []) {
    if (!c?.id) continue;
    store.data.cameras.push({
      id: store.newCameraId(c.id),
      name: c.name || c.id,
      brand: c.main ? 'generic' : 'yoosee',
      host: c.host,
      user: c.user ?? d.user,
      password: c.password,
      ptz: c.ptz ?? d.ptz,
      ...(c.main ? { main: c.main, sub: c.sub } : {}),
      ...(c.inputArgs ? { inputArgs: c.inputArgs } : {}),
    });
  }
  const s = {};
  if (legacy.recording) s.recording = legacy.recording;
  if (legacy.local) s.local = legacy.local;
  if (legacy.drive) {
    const [remoteName, ...folder] = String(legacy.drive.remote || 'gdrive:Cameras').split(':');
    s.drive = { ...legacy.drive, remoteName, folder: folder.join(':') || 'Cameras' };
    delete s.drive.remote;
  }
  store.updateSettings(s);
}

/** Hides camera passwords in URLs for logging. */
export function redact(s) {
  return String(s).replace(/(rtsp:\/\/[^:/@]*:)[^@]*@/g, '$1***@');
}
