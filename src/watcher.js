import { Supervisor, inputArgs } from './proc.js';
import { SIZE } from './detector.js';

const FRAME = SIZE * SIZE * 3;
const PAD = 0x72; // gray used to fill the square frame
const STEP = 4; // motion is measured on a 104x104 grid

export const SENSITIVITY = {
  alta: { motion: 0.002, score: 0.35, hits: 1 },
  media: { motion: 0.004, score: 0.5, hits: 2 },
  baixa: { motion: 0.01, score: 0.62, hits: 2 },
};

/**
 * Watches one camera (low-quality stream, 2 frames per second). When something moves, asks the
 * detector whether there is a person; calls onPerson(frame, info) at most once per cooldown.
 */
export class PersonWatcher {
  constructor(ctx, cam, detector, onPerson) {
    this.cam = cam;
    this.detector = detector;
    this.onPerson = onPerson;
    this.ctx = ctx;
    this.bg = null;
    this.contentRows = SIZE;
    this.busy = false;
    this.hits = [];
    this.lastEvent = 0;
    this.lastFrameAt = 0;
    this.sup = new Supervisor(`alertas ${cam.id}`, () => ctx.ffmpeg(), () => [
      ...inputArgs(cam, cam.sub),
      '-an',
      '-vf', `fps=2,scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease,pad=${SIZE}:${SIZE}:0:0:color=0x727272,format=rgb24`,
      '-f', 'rawvideo', 'pipe:1',
    ]);
    this.sup.stdout = true;
    this.sup.onStdout = (chunk) => this._data(chunk);
    this.buf = Buffer.alloc(0);
  }

  start() {
    this.sup.start();
  }

  stop() {
    this.sup.stop();
  }

  status() {
    const ok = this.sup.running && Date.now() - this.lastFrameAt < 15_000;
    return { watching: ok, error: ok ? '' : this.sup.lastError };
  }

  _data(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= FRAME) {
      const frame = Buffer.from(this.buf.subarray(0, FRAME));
      this.buf = this.buf.subarray(FRAME);
      this._frame(frame);
    }
  }

  _frame(rgb) {
    this.lastFrameAt = Date.now();
    const g = SIZE / STEP;
    if (!this.bg) {
      // Rows at the bottom that are only padding are not part of the image.
      let rows = SIZE;
      while (rows > 1) {
        const off = (rows - 1) * SIZE * 3;
        let pad = true;
        for (let x = 0; x < SIZE * 3; x += 9) if (rgb[off + x] !== PAD) { pad = false; break; }
        if (!pad) break;
        rows--;
      }
      this.contentRows = rows;
    }
    const gh = Math.ceil(this.contentRows / STEP);
    const gray = new Float32Array(g * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < g; x++) {
        const i = (y * STEP * SIZE + x * STEP) * 3;
        gray[y * g + x] = (rgb[i] * 77 + rgb[i + 1] * 150 + rgb[i + 2] * 29) >> 8;
      }
    }
    if (!this.bg) {
      this.bg = gray;
      return;
    }
    let changed = 0;
    for (let i = 0; i < gray.length; i++) if (Math.abs(gray[i] - this.bg[i]) > 22) changed++;
    const frac = changed / gray.length;
    // Lights turning on/off or night vision switching changes everything: start over.
    if (frac > 0.6) {
      this.bg = gray;
      return;
    }
    for (let i = 0; i < gray.length; i++) this.bg[i] = this.bg[i] * 0.9 + gray[i] * 0.1;

    const sens = SENSITIVITY[this.ctx.settings().alerts.sensitivity] || SENSITIVITY.media;
    if (frac < sens.motion || this.busy) return;
    this.busy = true;
    this.detector
      .detect(rgb, sens.score)
      .then((people) => {
        const now = Date.now();
        if (!people.length) return;
        this.hits = this.hits.filter((t) => now - t < 5000);
        this.hits.push(now);
        const cooldown = (Number(this.ctx.settings().alerts.cooldownSec) || 60) * 1000;
        if (this.hits.length >= sens.hits && now - this.lastEvent > cooldown) {
          this.lastEvent = now;
          this.hits = [];
          this.onPerson(rgb, { people, contentRows: this.contentRows, score: people[0].score });
        }
      })
      .catch((e) => {
        this.sup.lastError = e.message;
      })
      .finally(() => {
        this.busy = false;
      });
  }
}
