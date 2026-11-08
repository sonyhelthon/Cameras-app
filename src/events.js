import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { SIZE } from './detector.js';

const KEEP_DAYS = 30;
export const EVENT_ID_RE = /^[a-z0-9]{8,20}$/;

/** "Pessoa detectada" alerts: list in data/events.json, photos in data/events/<id>.jpg. */
export class Events {
  constructor(ctx) {
    this.ctx = ctx;
    this.dir = path.join(ctx.dataDir, 'events');
    this.file = path.join(ctx.dataDir, 'events.json');
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      this.items = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.items = [];
    }
    this.cleanup();
    setInterval(() => this.cleanup(), 6 * 3600_000).unref();
  }

  save() {
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.items));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  imagePath(id) {
    return path.join(this.dir, `${id}.jpg`);
  }

  /** Saves the photo of the moment (with a box around each person) and records the alert. */
  async add(cam, rgb, { people, contentRows, score }) {
    const id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const scale = 2; // 416 -> 832 px wide
    const boxes = people
      .map((p) => {
        const x = Math.max(0, Math.round(p.x * SIZE * scale));
        const y = Math.max(0, Math.round(p.y * SIZE * scale));
        const w = Math.round(p.w * SIZE * scale);
        const h = Math.min(Math.round(p.h * SIZE * scale), contentRows * scale - y);
        return `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=red@0.9:t=4`;
      })
      .join(',');
    const vf = [`crop=${SIZE}:${contentRows}:0:0`, `scale=${SIZE * scale}:-2`, boxes].filter(Boolean).join(',');
    await new Promise((resolve, reject) => {
      const p = spawn(this.ctx.ffmpeg(), [
        '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${SIZE}x${SIZE}`, '-i', 'pipe:0',
        '-vf', vf, '-frames:v', '1', '-q:v', '4', '-y', this.imagePath(id),
      ], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg ${code}`))));
      p.stdin.end(rgb);
    });
    const ev = { id, cam: cam.id, camName: cam.name, ts: Date.now(), people: people.length, score: Math.round(score * 100) / 100 };
    this.items.push(ev);
    this.save();
    return ev;
  }

  list({ cam, before, limit = 60 } = {}) {
    let l = this.items;
    if (cam) l = l.filter((e) => e.cam === cam);
    if (before) l = l.filter((e) => e.ts < before);
    return l.slice(-limit).reverse();
  }

  remove(id) {
    this.items = this.items.filter((e) => e.id !== id);
    fs.rmSync(this.imagePath(id), { force: true });
    this.save();
  }

  cleanup() {
    const limit = Date.now() - KEEP_DAYS * 86400_000;
    const old = this.items.filter((e) => e.ts < limit);
    for (const e of old) fs.rmSync(this.imagePath(e.id), { force: true });
    if (old.length) {
      this.items = this.items.filter((e) => e.ts >= limit);
      this.save();
    }
  }
}
