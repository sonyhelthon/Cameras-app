import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const ID_RE = /^[a-z0-9_-]+$/i;

export function loadConfig(file = process.env.CONFIG || 'config.yaml') {
  if (!fs.existsSync(file)) {
    console.error(`Arquivo de configuração "${file}" não encontrado. Copie config.example.yaml para config.yaml e ajuste.`);
    process.exit(1);
  }
  const raw = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
  const baseDir = path.dirname(path.resolve(file));

  const cfg = {
    server: { port: 8080, password: '', ...raw.server },
    bin: { ffmpeg: 'ffmpeg', rclone: 'rclone', ...raw.bin },
    dataDir: path.resolve(baseDir, raw.dataDir || './data'),
    recording: { enabled: true, segmentMinutes: 10, stream: 'main', audio: true, ...raw.recording },
    local: { retentionHours: 48, ...raw.local },
    drive: { enabled: false, remote: 'gdrive:Cameras', uploadEveryMinutes: 5, retentionDays: 45, bwlimit: '', ...raw.drive },
  };

  const defaults = { user: 'admin', rtspPort: 554, mainPath: '/onvif1', subPath: '/onvif2', onvifPort: 5000, ptz: true, ...raw.defaults };
  const seen = new Set();
  cfg.cameras = (raw.cameras || []).map((c) => {
    const cam = { ...defaults, ...c };
    if (!cam.id || !ID_RE.test(cam.id)) throw new Error(`Câmera com id inválido: "${cam.id}" (use letras, números, - ou _)`);
    if (seen.has(cam.id)) throw new Error(`Id de câmera repetido: ${cam.id}`);
    seen.add(cam.id);
    cam.name ||= cam.id;
    const auth = cam.password ? `${encodeURIComponent(cam.user)}:${encodeURIComponent(cam.password)}@` : '';
    cam.main ||= `rtsp://${auth}${cam.host}:${cam.rtspPort}${cam.mainPath}`;
    cam.sub ||= cam.host ? `rtsp://${auth}${cam.host}:${cam.rtspPort}${cam.subPath}` : cam.main;
    cam.inputArgs ||= [];
    if (!cam.host) cam.ptz = false;
    return cam;
  });

  for (const d of ['recordings', 'live']) fs.mkdirSync(path.join(cfg.dataDir, d), { recursive: true });
  return cfg;
}

/** Hides camera passwords in URLs for logging. */
export function redact(s) {
  return String(s).replace(/(rtsp:\/\/[^:/@]+:)[^@]*@/g, '$1***@');
}
