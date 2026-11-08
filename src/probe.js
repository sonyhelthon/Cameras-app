import { spawn } from 'node:child_process';
import { redact } from './config.js';

/** Turns ffmpeg errors into something a person can act on. */
export function friendlyError(msg) {
  const m = String(msg);
  if (/401|Unauthorized/i.test(m)) return 'Usuário ou senha incorretos.';
  // Yoosee cameras answer 400 when the password is wrong or empty.
  if (/400|Bad Request/i.test(m)) return 'A câmera recusou o acesso: quase sempre é a senha errada ou vazia. Confira a senha do dispositivo.';
  if (/404|Not Found/i.test(m)) return 'A câmera respondeu, mas o endereço do vídeo não existe. Tente outra marca na lista.';
  if (/Sem dados/i.test(m)) return 'A câmera parou de enviar imagem. Confira se ela está ligada e com Wi-Fi.';
  if (/refused/i.test(m)) return 'A câmera recusou a conexão nesta porta. Confira o IP e se ela tem RTSP.';
  if (/timed out|timeout|Tempo esgotado|No route|unreachable|Network is/i.test(m)) return 'A câmera não respondeu. Confira o IP e se ela está ligada no mesmo Wi-Fi.';
  if (/Invalid data/i.test(m)) return 'A câmera respondeu algo inesperado. Tente outra marca na lista.';
  return redact(m.trim().split('\n').slice(-2).join(' ')) || 'Não foi possível conectar.';
}

function grab(ffmpeg, cam, url, transport, timeoutMs) {
  return new Promise((resolve) => {
    const args = ['-hide_banner', '-loglevel', 'error', ...cam.inputArgs];
    if (url.startsWith('rtsp://')) args.push('-rtsp_transport', transport);
    args.push('-i', url, '-frames:v', '1', '-an', '-vf', 'scale=640:-2', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1');
    const p = spawn(ffmpeg, args, { windowsHide: true });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    const timer = setTimeout(() => {
      err ||= 'timed out';
      p.kill('SIGKILL');
    }, timeoutMs);
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });
    p.on('close', () => {
      clearTimeout(timer);
      const jpg = Buffer.concat(chunks);
      if (jpg.length > 1000) resolve({ ok: true, transport, image: `data:image/jpeg;base64,${jpg.toString('base64')}` });
      else resolve({ ok: false, error: err || 'sem imagem' });
    });
  });
}

/** Tests a camera: grabs one frame (tries UDP, then TCP). */
export async function testCamera(ffmpeg, cam) {
  if (!cam.main) return { ok: false, error: 'Informe o IP ou o endereço RTSP.' };
  const order = cam.transport === 'tcp' ? ['tcp'] : cam.transport === 'udp' ? ['udp'] : ['udp', 'tcp'];
  let last;
  for (const t of order) {
    last = await grab(ffmpeg, cam, cam.main, t, 15_000);
    if (last.ok) return last;
  }
  return { ok: false, error: friendlyError(last.error) };
}
