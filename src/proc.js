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
    this.lastArgs = args;
    this.startedAt = Date.now();
    const bin = typeof this.bin === 'function' ? this.bin() : this.bin;
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    this.child = child;
    let tail = '';
    child.stderr.on('data', (d) => {
      tail = (tail + d.toString()).slice(-2000);
    });
    child.on('error', (err) => {
      this.lastError = `Não foi possível iniciar "${bin}": ${err.message}`;
    });
    child.on('close', (code) => {
      if (this.child === child) this.child = null;
      const lines = redact(tail).trim().split('\n').filter(Boolean);
      if (!this.stopped) {
        if (lines.length) this.lastError = lines.slice(-3).join(' | ');
        // A run that lasted a while resets the backoff.
        if (Date.now() - this.startedAt > 60_000) this.backoff = 2000;
        else this.onShortExit?.(this.lastArgs);
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

/**
 * RTSP transport for a camera. "auto" alternates between TCP and UDP after each failed
 * attempt (starts with UDP: Yoosee cameras such as the JT-8177 work over UDP) and keeps whichever one works.
 */
export function transportFor(cam) {
  if (cam.transport === 'tcp' || cam.transport === 'udp') return cam.transport;
  return (cam._transport ||= 'udp');
}
export function flipTransport(cam, failedArgs = []) {
  if (cam.transport === 'tcp' || cam.transport === 'udp') return;
  const i = failedArgs.indexOf('-rtsp_transport');
  // Only switch if the failed attempt used the current transport (recorder and live share it).
  if (i < 0 || failedArgs[i + 1] !== transportFor(cam)) return;
  cam._transport = transportFor(cam) === 'tcp' ? 'udp' : 'tcp';
  console.warn(`[${cam.id}] tentando conectar por ${cam._transport.toUpperCase()}`);
}

/** ffmpeg input arguments for a camera URL. */
export function inputArgs(cam, url) {
  const args = ['-hide_banner', '-loglevel', 'error', ...cam.inputArgs];
  // No "-timeout": it made Yoosee connections fail. Hangs are handled by the watchdogs.
  if (url.startsWith('rtsp://')) args.push('-rtsp_transport', transportFor(cam));
  args.push('-i', url);
  return args;
}

/**
 * Live view: re-encode to H.264, because these cameras send H.265 (HEVC), which most
 * browsers cannot play. Keyframe every second for low latency.
 */
export function liveArgs() {
  return [
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '26',
    '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*1)',
    '-c:a', 'aac', '-b:a', '64k', '-ar', '16000',
  ];
}

/** Map video + optional audio; copy video, AAC audio. */
export function avArgs(withAudio) {
  return withAudio
    ? ['-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-ar', '16000']
    : ['-map', '0:v:0', '-c:v', 'copy', '-an'];
}
