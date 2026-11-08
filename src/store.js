import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = {
  site: { name: 'Casa', remoteUrl: '' },
  recording: { enabled: true, stream: 'main', segmentMinutes: 10, audio: true },
  local: { retentionHours: 48 },
  alerts: { enabled: true, sensitivity: 'media', cooldownSec: 60, from: '', to: '' },
  drive: { enabled: false, remoteName: 'gdrive', folder: 'Cameras', retentionDays: 45, uploadEveryMinutes: 5, bwlimit: '' },
};

function merge(defaults, value) {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(value || {})) {
    out[k] = defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k]) ? merge(defaults[k], v) : v;
  }
  return out;
}

/** Everything the app manages by itself (cameras, settings, password), saved in data/app.json. */
export class Store {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'app.json');
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch { /* first run */ }
    this.data = {
      passwordHash: data.passwordHash || null,
      settings: merge(DEFAULT_SETTINGS, data.settings),
      cameras: Array.isArray(data.cameras) ? data.cameras : [],
      users: Array.isArray(data.users) ? data.users : [],
      invites: Array.isArray(data.invites) ? data.invites : [],
      imported: !!data.imported,
    };
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    this.data.settings = merge(this.data.settings, patch);
    this.save();
  }

  newCameraId(name) {
    const base =
      String(name || 'camera')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 24) || 'camera';
    const ids = new Set(this.data.cameras.map((c) => c.id));
    let id = base;
    for (let i = 2; ids.has(id); i++) id = `${base}-${i}`;
    return id;
  }
}
