import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COOKIE = 'cam_session';
const MAX_AGE_DAYS = 90;
const PUBLIC = new Set([
  '/login.html', '/api/login', '/api/auth/state', '/api/setup', '/api/hello',
  '/style.css', '/icon.svg', '/manifest.webmanifest', '/sw.js',
]);

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(String(pw), salt, 32).toString('hex')}`;
}

function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(pw), salt, 32);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/**
 * Password login. On the first access the app asks to create the password (no config file).
 */
export function createAuth(dataDir, store) {
  const secretFile = path.join(dataDir, '.secret');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
  const secret = fs.readFileSync(secretFile, 'utf8').trim();

  const sign = (ts) => crypto.createHmac('sha256', secret).update(String(ts)).digest('hex');
  const valid = (token) => {
    const [ts, sig] = String(token || '').split('.');
    if (!ts || !sig || Date.now() - Number(ts) > MAX_AGE_DAYS * 86400_000) return false;
    const expected = sign(ts);
    return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  };
  const readCookie = (req) => {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
    return m && decodeURIComponent(m[1]);
  };
  const setSession = (res) => {
    const ts = Date.now();
    res.cookie(COOKIE, `${ts}.${sign(ts)}`, { httpOnly: true, sameSite: 'lax', maxAge: MAX_AGE_DAYS * 86400_000 });
  };
  const needsSetup = () => !store.data.passwordHash;
  const failures = new Map();

  return {
    state(req, res) {
      res.json({ needsSetup: needsSetup() });
    },

    setup(req, res) {
      if (!needsSetup()) return res.status(403).json({ error: 'A senha já foi criada.' });
      const pw = String(req.body?.password || '');
      if (pw.length < 6) return res.status(400).json({ error: 'Use pelo menos 6 caracteres.' });
      store.data.passwordHash = hashPassword(pw);
      store.save();
      setSession(res);
      res.json({ ok: true });
    },

    login(req, res) {
      if (needsSetup()) return res.status(409).json({ error: 'Crie a senha primeiro.' });
      const ip = req.ip;
      const f = failures.get(ip) || { n: 0, until: 0 };
      if (Date.now() < f.until) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
      if (!checkPassword(req.body?.password || '', store.data.passwordHash)) {
        f.n += 1;
        if (f.n >= 5) Object.assign(f, { n: 0, until: Date.now() + 60_000 });
        failures.set(ip, f);
        return res.status(401).json({ error: 'Senha incorreta' });
      }
      failures.delete(ip);
      setSession(res);
      res.json({ ok: true });
    },

    changePassword(req, res) {
      if (!checkPassword(req.body?.current || '', store.data.passwordHash)) return res.status(401).json({ error: 'Senha atual incorreta' });
      const pw = String(req.body?.password || '');
      if (pw.length < 6) return res.status(400).json({ error: 'Use pelo menos 6 caracteres.' });
      store.data.passwordHash = hashPassword(pw);
      store.save();
      res.json({ ok: true });
    },

    logout(req, res) {
      res.clearCookie(COOKIE);
      res.json({ ok: true });
    },

    middleware(req, res, next) {
      if (PUBLIC.has(req.path) || (!needsSetup() && valid(readCookie(req)))) return next();
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Faça login' });
      if (req.path === '/' || req.path.endsWith('.html')) {
        const q = req.originalUrl.indexOf('?');
        return res.redirect(`/login.html${q >= 0 ? req.originalUrl.slice(q) : ''}`);
      }
      res.status(401).end();
    },
  };
}
