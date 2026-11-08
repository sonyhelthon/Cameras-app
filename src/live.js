import fs from 'node:fs';
import path from 'node:path';
import { Supervisor, inputArgs, avArgs, flipTransport } from './proc.js';

const IDLE_MS = 40_000;

/**
 * Live view as HLS, started on demand when someone is watching and stopped when idle.
 * A single ffmpeg per camera/quality serves all viewers (these cameras accept few connections).
 */
export class LiveManager {
  constructor(cfg) {
    this.cfg = cfg;
    this.sessions = new Map();
    this.root = path.join(cfg.dataDir, 'live');
    fs.rmSync(this.root, { recursive: true, force: true });
    fs.mkdirSync(this.root, { recursive: true });
    this.reaper = setInterval(() => this._reap(), 10_000);
  }

  _key(cam, q) {
    return `${cam.id}-${q}`;
  }

  dirFor(cam, q) {
    return path.join(this.root, this._key(cam, q));
  }

  touch(cam, q) {
    const key = this._key(cam, q);
    let s = this.sessions.get(key);
    if (!s) {
      const dir = this.dirFor(cam, q);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const url = q === 'hd' ? cam.main : cam.sub;
      const sup = new Supervisor(`ao vivo ${key}`, this.cfg.bin.ffmpeg, () => [
        ...inputArgs(cam, url),
        ...avArgs(true),
        '-f', 'hls',
        '-hls_time', '1',
        '-hls_list_size', '6',
        '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
        '-hls_segment_filename', path.join(dir, 's%d.ts'),
        path.join(dir, 'index.m3u8'),
      ]);
      sup.onShortExit = (args) => flipTransport(cam, args);
      sup.start();
      s = { sup, dir, last: Date.now() };
      this.sessions.set(key, s);
    }
    s.last = Date.now();
    return s;
  }

  /** Waits until the playlist exists (camera connected). */
  async waitPlaylist(cam, q, timeoutMs = 20_000) {
    const s = this.touch(cam, q);
    const file = path.join(s.dir, 'index.m3u8');
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (fs.existsSync(file)) return file;
      await new Promise((r) => setTimeout(r, 300));
      s.last = Date.now();
    }
    const err = new Error(s.sup.lastError || 'A câmera não respondeu');
    err.status = 504;
    throw err;
  }

  _reap() {
    for (const [key, s] of this.sessions) {
      if (Date.now() - s.last > IDLE_MS) {
        s.sup.stop();
        fs.rmSync(s.dir, { recursive: true, force: true });
        this.sessions.delete(key);
      }
    }
  }

  stopAll() {
    clearInterval(this.reaper);
    for (const s of this.sessions.values()) s.sup.stop();
    this.sessions.clear();
  }
}
