import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COOKIE = 'cam_session';
const MAX_AGE_DAYS = 90;
const PUBLIC = new Set([
  '/login.html', '/api/login', '/api/auth/state', '/api/setup', '/api/hello',
  '/api/invite/redeem', '/api/auth/device',
  '/style.css', '/icon.svg', '/manifest.webmanifest', '/sw.js',
]);
// Only the administrator can change things; "Só ver" users can watch, use the arrows and recordings.
const ADMIN_ONLY = [
  /^\/api\/admin\//, /^\/api\/settings/, /^\/api\/drive\//, /^\/api\/password/, /^\/api\/users/, /^\/api\/invites/, /^\/api\/push/,
];
export const ROLES = { admin: 'Administrador', viewer: 'Só ver' };
const INVITE_HOURS = 24;

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

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

/**
 * Login and permissions.
 * - The administrator enters with the password (created on the first access).
 * - Other people join by scanning an invite QR code: their phone gets its own key, which the
 *   administrator can remove at any time. No IP or password to type.
 */
export function createAuth(dataDir, store) {
  const secretFile = path.join(dataDir, '.secret');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
  const secret = fs.readFileSync(secretFile, 'utf8').trim();
  store.data.users ||= [];
  store.data.invites ||= [];

  const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('hex');
  const readCookie = (req) => {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
    return m && decodeURIComponent(m[1]);
  };
  const setSession = (res, uid) => {
    const body = `${Date.now()}.${uid}`;
    res.cookie(COOKIE, `${body}.${sign(body)}`, { httpOnly: true, sameSite: 'lax', maxAge: MAX_AGE_DAYS * 86400_000 });
  };
  const ADMIN = { id: 'admin', name: 'Administrador', role: 'admin' };
  const userById = (uid) => (uid === 'admin' ? ADMIN : store.data.users.find((u) => u.id === uid));
  /** The person behind a request, or null. Removed people lose access at once. */
  const sessionUser = (req) => {
    const parts = String(readCookie(req) || '').split('.');
    if (parts.length !== 3) return null;
    const [ts, uid, sig] = parts;
    const expected = sign(`${ts}.${uid}`);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    if (Date.now() - Number(ts) > MAX_AGE_DAYS * 86400_000) return null;
    return userById(uid) || null;
  };
  const needsSetup = () => !store.data.passwordHash;
  const failures = new Map();
  const tooMany = (req, res) => {
    const f = failures.get(req.ip) || { n: 0, until: 0 };
    if (Date.now() < f.until) {
      res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
      return true;
    }
    return false;
  };
  const fail = (req) => {
    const f = failures.get(req.ip) || { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= 5) Object.assign(f, { n: 0, until: Date.now() + 60_000 });
    failures.set(req.ip, f);
  };
  const cleanInvites = () => {
    const before = store.data.invites.length;
    store.data.invites = store.data.invites.filter((i) => i.expires > Date.now());
    if (store.data.invites.length !== before) store.save();
  };

  return {
    state(req, res) {
      res.json({ needsSetup: needsSetup() });
    },

    me(req, res) {
      const u = req.user;
      res.json({ id: u.id, name: u.name, role: u.role });
    },

    setup(req, res) {
      if (!needsSetup()) return res.status(403).json({ error: 'A senha já foi criada.' });
      const pw = String(req.body?.password || '');
      if (pw.length < 6) return res.status(400).json({ error: 'Use pelo menos 6 caracteres.' });
      store.data.passwordHash = hashPassword(pw);
      store.save();
      setSession(res, 'admin');
      res.json({ ok: true });
    },

    login(req, res) {
      if (needsSetup()) return res.status(409).json({ error: 'Crie a senha primeiro.' });
      if (tooMany(req, res)) return;
      if (!checkPassword(req.body?.password || '', store.data.passwordHash)) {
        fail(req);
        return res.status(401).json({ error: 'Senha incorreta' });
      }
      failures.delete(req.ip);
      setSession(res, 'admin');
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

    // ---------- Invites ----------
    /** Creates a one-time invite; returns the secret code (only shown once, inside the QR). */
    createInvite({ name, role }) {
      cleanInvites();
      const code = randomToken(18);
      const invite = {
        id: randomToken(6),
        name: String(name || '').trim().slice(0, 40) || 'Convidado',
        role: ROLES[role] ? role : 'viewer',
        codeHash: sha(code),
        created: Date.now(),
        expires: Date.now() + INVITE_HOURS * 3600_000,
      };
      store.data.invites.push(invite);
      store.save();
      return { invite, code };
    },

    /** Phone app: exchanges the invite code for this phone's own key. */
    redeem(req, res) {
      if (tooMany(req, res)) return;
      cleanInvites();
      const code = String(req.body?.code || '');
      const inv = store.data.invites.find((i) => i.codeHash === sha(code));
      if (!inv) {
        fail(req);
        return res.status(404).json({ error: 'Convite inválido ou vencido. Peça um novo QR code.' });
      }
      const key = randomToken(32);
      const user = {
        id: randomToken(8),
        name: inv.name,
        role: inv.role,
        device: String(req.body?.device || '').slice(0, 60),
        pushToken: String(req.body?.push || '').slice(0, 400) || undefined,
        keyHash: sha(key),
        created: Date.now(),
        lastSeen: Date.now(),
      };
      store.data.invites = store.data.invites.filter((i) => i !== inv); // one use only
      store.data.users.push(user);
      store.save();
      res.json({ ok: true, key, name: user.name, site: store.settings.site.name });
    },

    /** Phone app: opens the app with the phone's key (sets the session cookie). */
    device(req, res) {
      const key = String(req.query.k || '');
      const user = key && store.data.users.find((u) => u.keyHash === sha(key));
      if (!user) return res.redirect('/login.html?app=1&removido=1');
      user.lastSeen = Date.now();
      // The phone app sends its notification address every time it opens.
      const push = String(req.query.push || '').slice(0, 400);
      if (push) user.pushToken = push;
      store.save();
      setSession(res, user.id);
      const tab = /^[a-z]+$/.test(String(req.query.tab || '')) ? `&tab=${req.query.tab}` : '';
      const add = req.query.add === 'camera' ? '&add=camera' : '';
      res.redirect(`/?app=1${tab}${add}`);
    },

    listPeople() {
      cleanInvites();
      return {
        users: store.data.users.map(({ keyHash, pushToken, ...u }) => ({ ...u, push: !!pushToken, roleLabel: ROLES[u.role] })),
        invites: store.data.invites.map(({ codeHash, ...i }) => ({ ...i, roleLabel: ROLES[i.role] })),
      };
    },

    removeUser(id) {
      const before = store.data.users.length + store.data.invites.length;
      store.data.users = store.data.users.filter((u) => u.id !== id);
      store.data.invites = store.data.invites.filter((i) => i.id !== id);
      store.save();
      return store.data.users.length + store.data.invites.length !== before;
    },

    middleware(req, res, next) {
      // CORS only for the two calls the phone app makes before opening the server.
      if (req.path === '/api/hello' || req.path === '/api/invite/redeem') {
        res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST' });
        if (req.method === 'OPTIONS') return res.status(204).end();
      }
      if (PUBLIC.has(req.path)) return next();
      const user = needsSetup() ? null : sessionUser(req);
      if (user) {
        req.user = user;
        if (user.role !== 'admin' && ADMIN_ONLY.some((re) => re.test(req.path))) {
          return res.status(403).json({ error: 'Só o administrador pode fazer isso.' });
        }
        return next();
      }
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Faça login' });
      if (req.path === '/' || req.path.endsWith('.html')) {
        const q = req.originalUrl.indexOf('?');
        return res.redirect(`/login.html${q >= 0 ? req.originalUrl.slice(q) : ''}`);
      }
      res.status(401).end();
    },
  };
}
