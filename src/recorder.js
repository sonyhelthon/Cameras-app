import fs from 'node:fs';
import path from 'node:path';
import { Supervisor, inputArgs, avArgs } from './proc.js';

export const FILE_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/;

/** Continuous recording: one ffmpeg per camera writing N-minute MP4 files. */
export class Recorder {
  constructor(cfg, cam) {
    this.cfg = cfg;
    this.cam = cam;
    this.dir = path.join(cfg.dataDir, 'recordings', cam.id);
    fs.mkdirSync(this.dir, { recursive: true });
    const url = cfg.recording.stream === 'sub' ? cam.sub : cam.main;
    this.sup = new Supervisor(`gravação ${cam.id}`, cfg.bin.ffmpeg, () => [
      ...inputArgs(cam, url),
      ...avArgs(cfg.recording.audio),
      '-f', 'segment',
      '-segment_time', String(cfg.recording.segmentMinutes * 60),
      '-segment_atclocktime', '1',
      '-reset_timestamps', '1',
      '-strftime', '1',
      '-segment_format', 'mp4',
      // moov at the start so files play while downloading from the Drive
      '-segment_format_options', 'movflags=+faststart',
      path.join(this.dir, '%Y-%m-%d_%H-%M-%S.mp4'),
    ]);
  }

  start() {
    this.sup.start();
    // Watchdog: ffmpeg sometimes hangs without exiting when the camera drops off Wi-Fi.
    this.watchdog = setInterval(() => {
      if (!this.sup.running || Date.now() - this.sup.startedAt < 90_000) return;
      const last = this.latestFile();
      if (!last || Date.now() - last.mtimeMs > 90_000) {
        console.warn(`[gravação ${this.cam.id}] sem dados há 90s, reiniciando`);
        this.sup.lastError ||= 'Sem dados da câmera';
        this.sup.restart();
      }
    }, 30_000);
  }

  stop() {
    clearInterval(this.watchdog);
    this.sup.stop();
  }

  latestFile() {
    let best = null;
    for (const name of fs.readdirSync(this.dir)) {
      if (!FILE_RE.test(name)) continue;
      const st = fs.statSync(path.join(this.dir, name));
      if (!best || st.mtimeMs > best.mtimeMs) best = { name, mtimeMs: st.mtimeMs, size: st.size };
    }
    return best;
  }

  status() {
    const last = this.latestFile();
    const ok = this.sup.running && last && Date.now() - last.mtimeMs < 60_000;
    return { recording: !!ok, lastFile: last?.name || null, error: ok ? '' : this.sup.lastError };
  }
}

export function listLocal(dataDir, camId) {
  const dir = path.join(dataDir, 'recordings', camId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => FILE_RE.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, mtimeMs: st.mtimeMs };
    });
}
