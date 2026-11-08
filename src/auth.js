import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COOKIE = 'cam_session';
const MAX_AGE_DAYS = 90;
const PUBLIC = new Set(['/login.html', '/api/login', '/style.css', '/icon.svg', '/manifest.webmanifest', '/sw.js']);

export function createAuth(cfg) {
  const password = String(cfg.server.password || '');
  const secretFile = path.join(cfg.dataDir, '.secret');
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

  const failures = new Map();

  return {
    enabled: !!password,

    login(req, res) {
      const ip = req.ip;
      const f = failures.get(ip) || { n: 0, until: 0 };
      if (Date.now() < f.until) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
      const given = Buffer.from(String(req.body?.password || ''));
      const want = Buffer.from(password);
      const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
      if (!ok) {
        f.n += 1;
        if (f.n >= 5) Object.assign(f, { n: 0, until: Date.now() + 60_000 });
        failures.set(ip, f);
        return res.status(401).json({ error: 'Senha incorreta' });
      }
      failures.delete(ip);
      const ts = Date.now();
      res.cookie(COOKIE, `${ts}.${sign(ts)}`, { httpOnly: true, sameSite: 'lax', maxAge: MAX_AGE_DAYS * 86400_000 });
      res.json({ ok: true });
    },

    logout(req, res) {
      res.clearCookie(COOKIE);
      res.json({ ok: true });
    },

    middleware(req, res, next) {
      if (!password || PUBLIC.has(req.path) || valid(readCookie(req))) return next();
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Faça login' });
      if (req.path === '/' || req.path.endsWith('.html')) return res.redirect('/login.html');
      res.status(401).end();
    },
  };
}
