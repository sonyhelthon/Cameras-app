import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ROOT } from './config.js';

// Small person detector (YOLOX-nano, COCO classes, 3.6 MB). Runs on the computer's processor.
export const SIZE = 416;
const MODEL_URL = 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx';
const PERSON = 0;

/** Loads the model (downloading it once) and finds people in 416x416 RGB frames. */
export class PersonDetector {
  constructor() {
    this.file = path.join(ROOT, 'bin', 'yolox_nano.onnx');
    this.session = null;
    this.loading = null;
    this.status = 'parado';
    this.error = '';
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.session) return this.session;
    this.loading ||= (async () => {
      this.status = 'carregando';
      try {
        if (!fs.existsSync(this.file)) {
          fs.mkdirSync(path.dirname(this.file), { recursive: true });
          console.log('Baixando o modelo de detecção de pessoas (3,6 MB)…');
          const res = await fetch(MODEL_URL, { redirect: 'follow' });
          if (!res.ok) throw new Error(`download do modelo falhou (HTTP ${res.status})`);
          const tmp = `${this.file}.part`;
          await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
          fs.renameSync(tmp, this.file);
        }
        const ort = (await import('onnxruntime-node')).default;
        this.ort = ort;
        this.session = await ort.InferenceSession.create(this.file, { intraOpNumThreads: 2 });
        this.status = 'ok';
        return this.session;
      } catch (e) {
        this.status = 'erro';
        this.error = `Detecção de pessoas indisponível: ${e.message}`;
        this.loading = null;
        throw new Error(this.error);
      }
    })();
    return this.loading;
  }

  /**
   * rgb: Buffer with SIZE*SIZE*3 bytes (letterboxed frame). Returns people found:
   * [{ score, x, y, w, h }] in 0..1 of the 416 frame. One detection at a time (keeps CPU low).
   */
  detect(rgb, minScore = 0.5) {
    const run = this.queue.then(() => this._detect(rgb, minScore));
    this.queue = run.catch(() => {});
    return run;
  }

  async _detect(rgb, minScore) {
    const session = await this.load();
    const n = SIZE * SIZE;
    const data = new Float32Array(3 * n);
    // The model expects BGR, 0..255, channels first.
    for (let i = 0; i < n; i++) {
      data[i] = rgb[i * 3 + 2];
      data[n + i] = rgb[i * 3 + 1];
      data[2 * n + i] = rgb[i * 3];
    }
    const out = await session.run({ [session.inputNames[0]]: new this.ort.Tensor('float32', data, [1, 3, SIZE, SIZE]) });
    const o = out[session.outputNames[0]].data;
    const D = 85;
    const boxes = [];
    let k = 0;
    for (const s of [8, 16, 32]) {
      const g = SIZE / s;
      for (let gy = 0; gy < g; gy++) {
        for (let gx = 0; gx < g; gx++, k++) {
          const b = k * D;
          const score = o[b + 4] * o[b + 5 + PERSON];
          if (score < minScore) continue;
          const w = Math.exp(o[b + 2]) * s;
          const h = Math.exp(o[b + 3]) * s;
          const cx = (o[b] + gx) * s;
          const cy = (o[b + 1] + gy) * s;
          boxes.push({ score, x: (cx - w / 2) / SIZE, y: (cy - h / 2) / SIZE, w: w / SIZE, h: h / SIZE });
        }
      }
    }
    return nms(boxes, 0.45);
  }
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

function nms(boxes, thr) {
  boxes.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const b of boxes) if (keep.every((k) => iou(k, b) < thr)) keep.push(b);
  return keep;
}
