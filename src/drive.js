import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FILE_RE, listLocal } from './recorder.js';

function run(bin, args, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    let timer;
    if (timeoutMs) timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    child.on('error', (e) => reject(new Error(`Não foi possível iniciar "${bin}": ${e.message}`)));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').slice(-2).join(' | ') || `código ${code}`));
    });
  });
}

/** Folder inside the Drive, without leading/trailing slashes or "..". */
export function cleanFolder(f) {
  return String(f || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
}

/**
 * Sends finished recordings to the Google Drive via rclone, cleans up the computer's copy
 * once it is in the Drive, and deletes Drive recordings older than the retention period.
 */
export class Drive {
  constructor(ctx) {
    this.ctx = ctx;
    this.recDir = path.join(ctx.dataDir, 'recordings');
    this.lastSuccessStart = 0;
    this.lastError = '';
    this.uploading = false;
    this.connecting = false;
    this.lastRemoteCleanup = 0;
    this.listCache = new Map();
    this.connected = null; // unknown until checked
  }

  get s() {
    return this.ctx.settings().drive;
  }

  rclone() {
    return this.ctx.tools.bin('rclone');
  }

  remotePath(...parts) {
    return [`${this.s.remoteName}:${cleanFolder(this.s.folder)}`, ...parts].join('/');
  }

  /** Called when the folder or account changes. */
  reset() {
    this.listCache.clear();
    this.lastError = '';
    this.connected = null;
  }

  start() {
    const tick = () => this.cycle().catch((e) => console.error('[drive]', e.message));
    setTimeout(tick, 30_000);
    this.timer = setInterval(tick, 60_000);
  }

  stop() {
    clearInterval(this.timer);
  }

  async checkConnected() {
    try {
      await this.ctx.tools.ensure('rclone');
      const out = await run(this.rclone(), ['listremotes'], 20_000);
      this.connected = out.split(/\r?\n/).includes(`${this.s.remoteName}:`);
    } catch (e) {
      this.connected = false;
      this.lastError = e.message;
    }
    return this.connected;
  }

  /**
   * Links the Google account: rclone opens the browser ON THE SERVER COMPUTER for the login.
   */
  async connect() {
    if (this.connecting) throw Object.assign(new Error('Já existe uma conexão em andamento. Termine o login no navegador do computador.'), { status: 409 });
    this.connecting = true;
    try {
      await this.ctx.tools.ensure('rclone');
      const name = this.s.remoteName;
      if (await this.checkConnected()) await run(this.rclone(), ['config', 'delete', name], 20_000);
      await run(this.rclone(), ['config', 'create', name, 'drive', 'scope=drive'], 10 * 60_000);
      await run(this.rclone(), ['lsd', `${name}:`, '--max-depth', '1'], 60_000);
      this.reset();
      this.connected = true;
    } finally {
      this.connecting = false;
    }
  }

  async about() {
    const out = await run(this.rclone(), ['about', `${this.s.remoteName}:`, '--json'], 30_000);
    const j = JSON.parse(out);
    return { total: j.total ?? null, used: j.used ?? null, free: j.free ?? null };
  }

  async cycle() {
    const minutes = Math.max(1, Number(this.s.uploadEveryMinutes) || 5);
    const due = !this.lastUploadTry || Date.now() - this.lastUploadTry >= minutes * 60_000 - 5000;
    if (this.s.enabled && !this.uploading && due) await this.upload();
    this.cleanLocal();
  }

  async upload() {
    this.lastUploadTry = Date.now();
    this.uploading = true;
    const started = Date.now();
    try {
      await this.ctx.tools.ensure('rclone');
      const args = ['copy', this.recDir, this.remotePath(), '--min-age', '2m', '--include', '*.mp4', '--transfers', '2'];
      if (this.s.bwlimit) args.push('--bwlimit', String(this.s.bwlimit));
      await run(this.rclone(), args);
      this.lastSuccessStart = started;
      this.lastError = '';
      this.listCache.clear();
    } catch (e) {
      this.lastError = e.message;
      console.error('[drive] envio falhou:', e.message);
    } finally {
      this.uploading = false;
    }
    if (Date.now() - this.lastRemoteCleanup > 24 * 3600_000 && !this.lastError) {
      this.lastRemoteCleanup = Date.now();
      try {
        await run(this.rclone(), ['delete', this.remotePath(), '--min-age', `${Number(this.s.retentionDays) || 45}d`, '--include', '*.mp4']);
      } catch (e) {
        console.error('[drive] limpeza falhou:', e.message);
      }
    }
  }

  /** Deletes the computer's files older than the local retention (only if already in the Drive). */
  cleanLocal() {
    const limit = Date.now() - this.ctx.settings().local.retentionHours * 3600_000;
    // A file was included in the last successful copy if it was ≥2 min old when it started.
    const uploadedBefore = this.s.enabled ? this.lastSuccessStart - 2 * 60_000 : Infinity;
    if (!fs.existsSync(this.recDir)) return;
    for (const camId of fs.readdirSync(this.recDir)) {
      for (const f of listLocal(this.ctx.dataDir, camId)) {
        if (f.mtimeMs < limit && f.mtimeMs < uploadedBefore) fs.rmSync(path.join(this.recDir, camId, f.name), { force: true });
      }
    }
  }

  async list(camId) {
    if (!this.s.enabled) return [];
    const hit = this.listCache.get(camId);
    if (hit && Date.now() - hit.at < 60_000) return hit.files;
    let files = [];
    try {
      const out = await run(this.rclone(), ['lsjson', this.remotePath(camId), '--files-only'], 20_000);
      files = JSON.parse(out)
        .filter((f) => FILE_RE.test(f.Name))
        .map((f) => ({ name: f.Name, size: f.Size }));
    } catch (e) {
      // A camera folder that does not exist yet is not an error.
      if (!/not found|doesn't exist/i.test(e.message)) throw new Error(/código null|código 1$/.test(e.message) ? 'o Drive demorou para responder' : e.message);
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
      this.rclone(),
      ['cat', this.remotePath(camId, name), '--offset', String(start), '--count', String(end - start + 1)],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    child.stdout.pipe(res);
    res.on('close', () => child.kill());
    child.on('error', () => res.destroy());
  }

  status() {
    return {
      enabled: !!this.s.enabled,
      connected: this.connected,
      connecting: this.connecting,
      lastUpload: this.lastSuccessStart || null,
      uploading: this.uploading,
      error: this.lastError,
    };
  }
}
