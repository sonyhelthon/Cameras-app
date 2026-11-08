import { spawn } from 'node:child_process';
import { redact } from './config.js';

/**
 * Keeps an ffmpeg (or other) process running, restarting it with backoff when it exits.
 */
export class Supervisor {
  constructor(name, bin, argsFn) {
    this.name = name;
    this.bin = bin;
    this.argsFn = argsFn;
    this.child = null;
    this.stopped = true;
    this.backoff = 2000;
    this.lastError = '';
    this.startedAt = 0;
    this.timer = null;
  }

  start() {
    this.stopped = false;
    this._spawn();
  }

  _spawn() {
    if (this.stopped) return;
    const args = this.argsFn();
    this.startedAt = Date.now();
    const child = spawn(this.bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    this.child = child;
    let tail = '';
    child.stderr.on('data', (d) => {
      tail = (tail + d.toString()).slice(-2000);
    });
    child.on('error', (err) => {
      this.lastError = `Não foi possível iniciar "${this.bin}": ${err.message}`;
    });
    child.on('close', (code) => {
      if (this.child === child) this.child = null;
      const lines = redact(tail).trim().split('\n').filter(Boolean);
      if (!this.stopped) {
        if (lines.length) this.lastError = lines.slice(-3).join(' | ');
        // A run that lasted a while resets the backoff.
        if (Date.now() - this.startedAt > 60_000) this.backoff = 2000;
        console.warn(`[${this.name}] saiu (código ${code}); reiniciando em ${this.backoff / 1000}s. ${this.lastError}`);
        this.timer = setTimeout(() => this._spawn(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 60_000);
      }
    });
  }

  restart() {
    if (this.child) this.child.kill('SIGKILL');
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.child) this.child.kill('SIGKILL');
    this.child = null;
  }

  get running() {
    return !!this.child;
  }
}

/** ffmpeg input arguments for a camera URL. */
export function inputArgs(cam, url) {
  const args = ['-hide_banner', '-loglevel', 'error', ...cam.inputArgs];
  if (url.startsWith('rtsp://')) args.push('-rtsp_transport', 'tcp', '-timeout', '10000000');
  args.push('-i', url);
  return args;
}

/** Map video + optional audio; copy video, AAC audio. */
export function avArgs(withAudio) {
  return withAudio
    ? ['-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-ar', '16000']
    : ['-map', '0:v:0', '-c:v', 'copy', '-an'];
}
