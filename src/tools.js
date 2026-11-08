import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ROOT } from './config.js';

const WIN = process.platform === 'win32';
// Official downloads (Windows 64-bit).
const SOURCES = {
  ffmpeg: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  rclone: 'https://downloads.rclone.org/rclone-current-windows-amd64.zip',
};

/**
 * Finds ffmpeg and rclone, and on Windows downloads them into the app's "bin" folder when
 * missing (no separate install script needed).
 */
export class Tools {
  constructor(base) {
    this.base = base;
    this.binDir = path.join(ROOT, 'bin');
    this.paths = {};
    this.status = { ffmpeg: 'verificando', rclone: 'verificando' };
    this.errors = {};
    this.pending = {};
  }

  _candidates(name) {
    const conf = this.base.bin[name];
    const isPath = /[\\/]/.test(conf);
    const exe = WIN ? `${name}.exe` : name;
    const list = [];
    if (isPath) list.push(conf);
    list.push(path.join(this.binDir, exe));
    if (WIN) list.push(`C:/cameras/bin/${exe}`);
    if (!isPath) list.push(conf);
    return list;
  }

  _works(bin, name) {
    const r = spawnSync(bin, [name === 'rclone' ? 'version' : '-version'], { timeout: 20_000, windowsHide: true });
    return !r.error && r.status === 0;
  }

  find(name) {
    for (const c of this._candidates(name)) {
      if (this._works(c, name)) {
        this.paths[name] = c;
        this.status[name] = 'ok';
        return c;
      }
    }
    this.status[name] = 'faltando';
    return null;
  }

  bin(name) {
    return this.paths[name] || this.base.bin[name];
  }

  /** Returns the program path, downloading it first if needed (Windows). */
  ensure(name) {
    if (this.paths[name] || this.find(name)) return Promise.resolve(this.paths[name]);
    if (!WIN) {
      this.errors[name] = `Instale o ${name} (ex.: sudo apt install ${name})`;
      return Promise.reject(new Error(this.errors[name]));
    }
    this.pending[name] ||= this._download(name).finally(() => delete this.pending[name]);
    return this.pending[name];
  }

  async _download(name) {
    this.status[name] = 'baixando';
    delete this.errors[name];
    const work = path.join(this.binDir, `_${name}-download`);
    const zip = `${work}.zip`;
    try {
      fs.rmSync(work, { recursive: true, force: true });
      fs.mkdirSync(work, { recursive: true });
      console.log(`Baixando ${name} de ${SOURCES[name]} ...`);
      const res = await fetch(SOURCES[name], { redirect: 'follow' });
      if (!res.ok) throw new Error(`download falhou (HTTP ${res.status})`);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zip));
      // Windows 10/11 include tar.exe, which also extracts .zip files.
      await new Promise((resolve, reject) => {
        const p = spawn('tar', ['-xf', zip, '-C', work], { windowsHide: true });
        p.on('error', reject);
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`não foi possível extrair (código ${code})`))));
      });
      const exe = findFile(work, `${name}.exe`);
      if (!exe) throw new Error(`${name}.exe não encontrado no arquivo baixado`);
      fs.copyFileSync(exe, path.join(this.binDir, `${name}.exe`));
      console.log(`${name} instalado em ${this.binDir}`);
    } catch (e) {
      this.status[name] = 'erro';
      this.errors[name] = `Não foi possível baixar o ${name}: ${e.message}`;
      throw new Error(this.errors[name]);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
      fs.rmSync(zip, { force: true });
    }
    if (!this.find(name)) {
      this.status[name] = 'erro';
      this.errors[name] = `O ${name} foi baixado mas não abriu (antivírus?)`;
      throw new Error(this.errors[name]);
    }
    return this.paths[name];
  }
}

function findFile(dir, fileName) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, fileName);
      if (r) return r;
    } else if (e.name.toLowerCase() === fileName) return p;
  }
  return null;
}
