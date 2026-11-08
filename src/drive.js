import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FILE_RE, listLocal } from './recorder.js';

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    child.on('error', (e) => reject(new Error(`Não foi possível iniciar "${bin}": ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').slice(-2).join(' | ') || `código ${code}`))));
  });
}

/**
 * Sends finished recordings to the Google Drive via rclone, cleans up the notebook copy
 * once it is in the Drive, and deletes Drive recordings older than the retention period.
 */
export class Drive {
  constructor(cfg) {
    this.cfg = cfg;
    this.d = cfg.drive;
    this.recDir = path.join(cfg.dataDir, 'recordings');
    this.lastSuccessStart = 0;
    this.lastError = '';
    this.uploading = false;
    this.lastRemoteCleanup = 0;
    this.listCache = new Map();
  }

  remotePath(...parts) {
    return [this.d.remote.replace(/\/+$/, ''), ...parts].join('/');
  }

  start() {
    const tick = () => this.cycle().catch((e) => console.error('[drive]', e.message));
    setTimeout(tick, 30_000);
    this.timer = setInterval(tick, Math.max(1, this.d.uploadEveryMinutes) * 60_000);
  }

  stop() {
    clearInterval(this.timer);
  }

  async cycle() {
    if (this.d.enabled && !this.uploading) {
      this.uploading = true;
      const started = Date.now();
      try {
        const args = ['copy', this.recDir, this.remotePath(), '--min-age', '2m', '--include', '*.mp4', '--transfers', '2'];
        if (this.d.bwlimit) args.push('--bwlimit', this.d.bwlimit);
        await run(this.cfg.bin.rclone, args);
        this.lastSuccessStart = started;
        this.lastError = '';
        this.listCache.clear();
      } catch (e) {
        this.lastError = e.message;
        console.error('[drive] envio falhou:', e.message);
      } finally {
        this.uploading = false;
      }
      if (Date.now() - this.lastRemoteCleanup > 24 * 3600_000) {
        this.lastRemoteCleanup = Date.now();
        try {
          await run(this.cfg.bin.rclone, ['delete', this.remotePath(), '--min-age', `${this.d.retentionDays}d`, '--include', '*.mp4']);
        } catch (e) {
          console.error('[drive] limpeza falhou:', e.message);
        }
      }
    }
    this.cleanLocal();
  }

  /** Deletes notebook files older than the local retention (only if already in the Drive). */
  cleanLocal() {
    const limit = Date.now() - this.cfg.local.retentionHours * 3600_000;
    // A file was included in the last successful copy if it was ≥2 min old when it started.
    const uploadedBefore = this.d.enabled ? this.lastSuccessStart - 2 * 60_000 : Infinity;
    for (const cam of this.cfg.cameras) {
      for (const f of listLocal(this.cfg.dataDir, cam.id)) {
        if (f.mtimeMs < limit && f.mtimeMs < uploadedBefore) {
          fs.rmSync(path.join(this.recDir, cam.id, f.name), { force: true });
        }
      }
    }
  }

  async list(camId) {
    if (!this.d.enabled) return [];
    const hit = this.listCache.get(camId);
    if (hit && Date.now() - hit.at < 60_000) return hit.files;
    let files = [];
    try {
      const out = await run(this.cfg.bin.rclone, ['lsjson', this.remotePath(camId), '--files-only']);
      files = JSON.parse(out)
        .filter((f) => FILE_RE.test(f.Name))
        .map((f) => ({ name: f.Name, size: f.Size }));
    } catch (e) {
      // A camera folder that does not exist yet is not an error.
      if (!/not found|doesn't exist/i.test(e.message)) throw e;
    }
    this.listCache.set(camId, { at: Date.now(), files });
    return files;
  }

  /** Streams a Drive file to the HTTP response, honoring Range so the video can seek. */
  async stream(camId, name, req, res) {
    const file = (await this.list(camId)).find((f) => f.name === name);
    if (!file) return res.status(404).end();
    let start = 0;
    let end = file.size - 1;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      if (m[1]) start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), end);
      if (!m[1] && m[2]) start = file.size - Number(m[2]);
      if (start > end || start >= file.size) {
        return res.status(416).set('Content-Range', `bytes */${file.size}`).end();
      }
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${file.size}`);
    }
    res.set({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) });
    const child = spawn(
      this.cfg.bin.rclone,
      ['cat', this.remotePath(camId, name), '--offset', String(start), '--count', String(end - start + 1)],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    child.stdout.pipe(res);
    res.on('close', () => child.kill());
    child.on('error', () => res.destroy());
  }

  status() {
    return {
      enabled: !!this.d.enabled,
      lastUpload: this.lastSuccessStart || null,
      uploading: this.uploading,
      error: this.lastError,
    };
  }
}
