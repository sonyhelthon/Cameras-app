/* global firebase, jsQR */
'use strict';

// SHCAM app: login → my places (from the account) → open the place's computer.
const $ = (s) => document.querySelector(s);
const cfg = window.FIREBASE_CONFIG;
const native = !!window.Capacitor?.isNativePlatform?.();
const Plugins = window.Capacitor?.Plugins || {};
const ROLE = { admin: 'Administrador', viewer: 'Só ver' };
let user = null;
let profile = { name: '' };
let mySites = [];
let unsubSites = null;

// ---------- small helpers ----------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}
for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => show(b.dataset.go));
function say(el, text, ok) {
  el.textContent = text || '';
  el.className = `msg ${ok === true ? 'ok' : ok === false ? 'bad' : ''}`;
}
let toastTimer;
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 3500);
}
let cancelled = false;
function overlay(msg, btn = 'Voltar') {
  $('#overlay').hidden = !msg;
  $('#overlay-msg').textContent = msg || '';
  $('#overlay-btn').textContent = btn;
}
$('#overlay-btn').addEventListener('click', () => { cancelled = true; overlay(null); });

function sheet(title, build) {
  $('#sheet-title').textContent = title;
  const body = $('#sheet-body');
  body.innerHTML = '';
  build(body);
  $('#sheet').hidden = false;
}
const closeSheet = () => { $('#sheet').hidden = true; };
$('#sheet-cancel').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
function sheetButton(body, text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls || ''}`;
  b.textContent = text;
  b.addEventListener('click', onClick);
  body.appendChild(b);
  return b;
}

const authErrors = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'Não existe conta com esse e-mail.',
  'auth/email-already-in-use': 'Já existe uma conta com esse e-mail. Toque em Voltar e entre.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/too-many-requests': 'Muitas tentativas. Espere alguns minutos.',
  'auth/network-request-failed': 'Sem internet. Confira a conexão.',
};
const authMsg = (e) => authErrors[e?.code] || e?.message || 'Não foi possível entrar.';

// ---------- Firebase ----------
let auth = null;
let db = null;
if (cfg) {
  firebase.initializeApp(cfg);
  auth = firebase.auth();
  db = firebase.firestore();
  // Tests: ?emu=1 uses the local Firebase simulator.
  if (new URLSearchParams(location.search).has('emu') || localStorage.getItem('emu')) {
    localStorage.setItem('emu', '1');
    auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    db.useEmulator('127.0.0.1', 8085);
  }
}

// ---------- Login screen ----------
if (!cfg) {
  $('#config-missing').hidden = false;
  $('#no-account').hidden = false;
  for (const el of document.querySelectorAll('#s-login button:not(.link), #s-login input')) el.disabled = true;
}
const FA = Plugins.FirebaseAuthentication;
// Google login needs the native plugin in the Android app (Google blocks it inside app web views).
$('#google').hidden = native ? !(window.GOOGLE_ENABLED && FA) : false;

$('#f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  say($('#login-msg'), 'Entrando…');
  try {
    await auth.signInWithEmailAndPassword(f.email.value.trim(), f.password.value);
    say($('#login-msg'), '');
  } catch (err) {
    say($('#login-msg'), authMsg(err), false);
  }
});
$('#google').addEventListener('click', async () => {
  say($('#login-msg'), 'Abrindo o Google…');
  try {
    if (native) {
      const r = await FA.signInWithGoogle();
      await auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(r.credential?.idToken));
    } else {
      await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    }
    say($('#login-msg'), '');
  } catch (err) {
    say($('#login-msg'), authMsg(err), false);
  }
});
$('#go-signup').addEventListener('click', () => show('s-signup'));
$('#forgot').addEventListener('click', async () => {
  const email = $('#f-login').email.value.trim();
  if (!email) return say($('#login-msg'), 'Digite seu e-mail acima e toque em "Esqueci minha senha" de novo.', false);
  try {
    await auth.sendPasswordResetEmail(email);
    say($('#login-msg'), 'Enviamos um e-mail para você criar uma nova senha.', true);
  } catch (err) {
    say($('#login-msg'), authMsg(err), false);
  }
});
$('#f-signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  say($('#signup-msg'), 'Criando sua conta…');
  try {
    const cred = await auth.createUserWithEmailAndPassword(f.email.value.trim(), f.password.value);
    await cred.user.updateProfile({ displayName: f.name.value.trim() });
    profile.name = f.name.value.trim();
    await saveProfile(cred.user);
    say($('#signup-msg'), '');
    enterHome();
  } catch (err) {
    say($('#signup-msg'), authMsg(err), false);
  }
});
$('#no-account').addEventListener('click', () => enterHome());

async function saveProfile(u) {
  const name = profile.name || u.displayName || (u.email || '').split('@')[0];
  const data = { name, email: u.email || '', updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  // Phones that receive this person's alerts (one entry per phone).
  if (pushToken) data.pushTokens = { [pushToken.slice(-40).replace(/[^A-Za-z0-9_-]/g, '_')]: pushToken };
  await db.doc(`users/${u.uid}`).set(data, { merge: true });
  profile.name = name;
}

// ---------- Home ----------
function enterHome() {
  show('s-home');
  $('#hello').textContent = user ? `Olá, ${profile.name || user.displayName || ''}`.trim() : '';
  $('#account-btn').hidden = !user;
  if (user && !unsubSites) {
    unsubSites = db.collection('sites').where(`members.${user.uid}`, 'in', ['admin', 'viewer']).onSnapshot((snap) => {
      mySites = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
      renderSites();
    }, () => toast('Não consegui carregar seus locais. Confira a internet.'));
  }
  renderSites();
  renderLegacy();
  const pending = localStorage.getItem('convite');
  if (pending && user) openInvite(pending);
}

function serverUrls(site) {
  const s = site.server || {};
  return [...(s.lan || []), s.remote].filter(Boolean);
}

function renderSites() {
  const box = $('#sites');
  box.innerHTML = '';
  if (user && !mySites.length) {
    box.innerHTML = '<p class="muted center-text">Você ainda não tem locais. Toque em <strong>+ Adicionar</strong> para instalar câmeras ou entrar com um convite.</p>';
  }
  for (const site of mySites) {
    const role = site.members[user.uid];
    const el = document.createElement('div');
    el.className = 'site';
    el.innerHTML = '<span class="dot"></span><div class="grow"><strong></strong><div class="small muted"></div></div><button class="icon-btn" aria-label="Opções">⋮</button>';
    el.querySelector('strong').textContent = site.name;
    const urls = serverUrls(site);
    el.querySelector('.muted').textContent = `${ROLE[role]}${urls.length ? '' : ' · computador ainda não ligado'}`;
    el.querySelector('.grow').addEventListener('click', () => openSite(site));
    el.querySelector('.icon-btn').addEventListener('click', () => siteMenu(site));
    box.appendChild(el);
    if (urls.length) reachable(urls).then((u) => el.querySelector('.dot').classList.add(u ? 'on' : 'off'));
  }
  // With nothing yet, the choices are shown right away; otherwise they are behind "+ Adicionar".
  $('#choices').hidden = !!(mySites.length || legacy.length);
}

$('#more').addEventListener('click', () => {
  const c = $('#choices');
  c.hidden = !c.hidden;
  if (!c.hidden) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('#c-other').addEventListener('click', () => { $('#other').hidden = !$('#other').hidden; });

$('#account-btn').addEventListener('click', () => {
  sheet(profile.name || user.email, (body) => {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = user.email;
    body.appendChild(p);
    sheetButton(body, 'Sair da conta', 'danger', async () => {
      closeSheet();
      unsubSites?.();
      unsubSites = null;
      await auth.signOut();
      await FA?.signOut?.().catch(() => {});
    });
  });
});

// ---------- Open a place ----------
async function openSite(site, tab = '') {
  const urls = serverUrls(site);
  if (!urls.length) {
    if (site.members[user.uid] === 'admin') return pairScreen(site);
    return overlay(`O computador de “${site.name}” ainda não foi ligado. Peça para quem instalou as câmeras terminar a instalação.`);
  }
  cancelled = false;
  overlay(`Abrindo ${site.name}…`);
  const url = await reachable(urls);
  if (cancelled) return;
  if (!url) {
    return overlay(site.server?.remote
      ? `Não consegui falar com ${site.name}. Confira a internet do celular, ou se o computador de lá está ligado.`
      : `Não consegui falar com ${site.name}. Conecte o celular no Wi-Fi de lá, e confira se o computador está ligado.`);
  }
  const token = await user.getIdToken();
  location.href = `${url}/api/auth/firebase?t=${encodeURIComponent(token)}&site=${site.id}${tab ? `&tab=${tab}` : ''}${pushToken ? `&push=${encodeURIComponent(pushToken)}` : ''}`;
}

function siteMenu(site) {
  const admin = site.members[user.uid] === 'admin';
  sheet(site.name, (body) => {
    sheetButton(body, 'Abrir câmeras', 'primary big', () => { closeSheet(); openSite(site); });
    if (admin) {
      sheetButton(body, '📤 Compartilhar (WhatsApp)', 'big', () => shareSite(site));
      sheetButton(body, '👥 Pessoas com acesso', '', () => people(site));
      sheetButton(body, '🔧 Instalar câmera aqui', '', () => { closeSheet(); openSite(site, 'settings'); });
      sheetButton(body, serverUrls(site).length ? '🖥️ Trocar o computador' : '🖥️ Ligar o computador', '', () => { closeSheet(); pairScreen(site); });
      sheetButton(body, 'Renomear', '', async () => {
        const name = prompt('Novo nome do local:', site.name);
        if (name?.trim()) await db.doc(`sites/${site.id}`).update({ name: name.trim().slice(0, 30) });
        closeSheet();
      });
    }
    if (site.owner !== user.uid) {
      sheetButton(body, 'Sair deste local', 'danger', async () => {
        if (!confirm(`Sair de “${site.name}”? Você deixa de ver as câmeras de lá.`)) return;
        await db.doc(`sites/${site.id}`).update({
          [`members.${user.uid}`]: firebase.firestore.FieldValue.delete(),
          [`memberInfo.${user.uid}`]: firebase.firestore.FieldValue.delete(),
        });
        closeSheet();
      });
    } else {
      sheetButton(body, 'Excluir local', 'danger', async () => {
        if (!confirm(`Excluir “${site.name}”? Ninguém mais verá as câmeras de lá pelo app. As gravações no Drive não são apagadas.`)) return;
        await db.doc(`sites/${site.id}`).delete();
        closeSheet();
      });
    }
  });
}

// ---------- Share by WhatsApp ----------
function inviteCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => abc[b % abc.length]).join('');
}
function shareSite(site) {
  sheet(`Compartilhar ${site.name}`, (body) => {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'Você envia um link pelo WhatsApp. A pessoa toca nele, entra com a conta dela e passa a ver as câmeras. O link vale para 1 pessoa, por 48 horas.';
    body.appendChild(p);
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="viewer">Só ver (ao vivo, gravações, alertas)</option><option value="admin">Administrador (pode mudar tudo)</option>';
    body.appendChild(sel);
    sheetButton(body, 'Enviar convite', 'primary big', async (ev) => {
      ev.target.disabled = true;
      try {
        const code = inviteCode();
        await db.doc(`invites/${code}`).set({
          siteId: site.id, siteName: site.name, role: sel.value,
          by: user.uid, byName: profile.name || user.displayName || user.email,
          usedBy: null, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + 48 * 3600_000),
        });
        const link = `https://${cfg.projectId}.web.app/c/${code}`;
        const text = `${profile.name || 'Eu'} te convidou para ver as câmeras de "${site.name}" no SHCAM. Toque para entrar: ${link}`;
        closeSheet();
        if (Plugins.Share) await Plugins.Share.share({ title: 'Convite SHCAM', text, dialogTitle: 'Enviar convite' }).catch(() => {});
        else {
          await navigator.clipboard?.writeText(text).catch(() => {});
          toast('Link copiado. Cole no WhatsApp da pessoa.');
        }
      } catch (err) {
        ev.target.disabled = false;
        toast(`Não consegui criar o convite: ${err.message}`);
      }
    });
  });
}

function people(site) {
  sheet(`Pessoas em ${site.name}`, (body) => {
    for (const [uid, role] of Object.entries(site.members)) {
      const info = site.memberInfo?.[uid] || {};
      const row = document.createElement('div');
      row.className = 'person';
      row.innerHTML = '<span>👤</span><div class="grow"><strong></strong><div class="small muted"></div></div>';
      row.querySelector('strong').textContent = `${info.name || 'Sem nome'}${uid === user.uid ? ' (você)' : ''}`;
      row.querySelector('.muted').textContent = `${info.email || ''} · ${uid === site.owner ? 'Dono' : ROLE[role]}`;
      if (uid !== site.owner && uid !== user.uid) {
        const b = document.createElement('button');
        b.className = 'btn danger';
        b.textContent = 'Remover';
        b.addEventListener('click', async () => {
          if (!confirm(`Remover ${info.name || 'esta pessoa'}? Ela deixa de ver as câmeras na hora.`)) return;
          await db.doc(`sites/${site.id}`).update({
            [`members.${uid}`]: firebase.firestore.FieldValue.delete(),
            [`memberInfo.${uid}`]: firebase.firestore.FieldValue.delete(),
          });
          row.remove();
        });
        row.appendChild(b);
      }
      body.appendChild(row);
    }
  });
}

// ---------- Install cameras: new place + link the computer ----------
let pairing = null;
$('#c-install').addEventListener('click', () => {
  if (!user) return toast('Entre na sua conta para instalar câmeras.');
  $('#ns-step1').hidden = false;
  $('#ns-step2').hidden = true;
  $('#ns-name').value = '';
  say($('#ns-msg'), '');
  show('s-newsite');
});
$('#ns-create').addEventListener('click', async () => {
  const name = $('#ns-name').value.trim().slice(0, 30);
  if (!name) return say($('#ns-msg'), 'Dê um nome para o local.', false);
  try {
    const ref = await db.collection('sites').add({
      name, owner: user.uid,
      members: { [user.uid]: 'admin' },
      memberInfo: { [user.uid]: { name: profile.name || user.displayName || '', email: user.email } },
      devices: {}, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    pairScreen({ id: ref.id, name });
  } catch (err) {
    say($('#ns-msg'), `Não consegui criar o local: ${err.message}`, false);
  }
});
function pairScreen(site) {
  pairing = site;
  show('s-newsite');
  $('#ns-step1').hidden = true;
  $('#ns-step2').hidden = false;
  $('#ns-code').value = '';
  say($('#ns-msg'), `Local: ${site.name}`);
}
$('#ns-later').addEventListener('click', () => show('s-home'));
$('#ns-pair').addEventListener('click', async () => {
  const code = $('#ns-code').value.replace(/\D/g, '');
  if (code.length !== 6) return say($('#ns-msg'), 'O código tem 6 números.', false);
  try {
    const p = await db.doc(`pairings/${code}`).get();
    if (!p.exists) return say($('#ns-msg'), 'Código não encontrado. Confira os números na tela do computador.', false);
    if (p.data().siteId) return say($('#ns-msg'), 'Esse código já foi usado. Feche e abra o programa no computador para gerar outro.', false);
    const deviceUid = p.data().deviceUid;
    const site = (await db.doc(`sites/${pairing.id}`).get()).data();
    const batch = db.batch();
    batch.update(db.doc(`sites/${pairing.id}`), { [`devices.${deviceUid}`]: true });
    batch.set(db.doc(`devices/${deviceUid}`), { siteId: pairing.id, members: Object.keys(site.members) });
    batch.update(db.doc(`pairings/${code}`), { siteId: pairing.id, siteName: pairing.name, by: user.uid });
    await batch.commit();
    toast(`Computador ligado a ${pairing.name}! ✓`);
    show('s-home');
  } catch (err) {
    say($('#ns-msg'), `Não consegui ligar: ${err.message}`, false);
  }
});

// ---------- Invite link ----------
const codeFrom = (text) => {
  const m = /\/c\/([A-Za-z0-9]{6,20})/.exec(text) || /convite\/([A-Za-z0-9]{6,20})/.exec(text) || /^\s*([A-Za-z0-9]{6,20})\s*$/.exec(text);
  return m ? m[1].toUpperCase() : null;
};
$('#c-invite').addEventListener('click', () => {
  $('#inv-paste').hidden = false;
  $('#inv-show').hidden = true;
  $('#inv-input').value = '';
  say($('#inv-msg'), '');
  show('s-invite');
});
$('#inv-check').addEventListener('click', () => {
  const code = codeFrom($('#inv-input').value);
  if (!code) return say($('#inv-msg'), 'Não reconheci o link. Cole a mensagem inteira do WhatsApp.', false);
  openInvite(code);
});
let currentInvite = null;
async function openInvite(code) {
  localStorage.setItem('convite', code);
  if (!user) {
    show('s-login');
    say($('#login-msg'), 'Entre ou crie sua conta para aceitar o convite.');
    return;
  }
  show('s-invite');
  $('#inv-paste').hidden = true;
  $('#inv-show').hidden = true;
  say($('#inv-msg'), 'Abrindo convite…');
  try {
    const snap = await db.doc(`invites/${code}`).get();
    const inv = snap.data();
    if (!snap.exists) throw new Error('Convite não encontrado.');
    if (inv.usedBy && inv.usedBy !== user.uid) throw new Error('Este convite já foi usado por outra pessoa. Peça um novo.');
    if (inv.expiresAt.toMillis() < Date.now()) throw new Error('Este convite venceu. Peça um novo.');
    currentInvite = { code, ...inv };
    $('#inv-by').textContent = inv.byName || 'Alguém';
    $('#inv-site').textContent = inv.siteName;
    $('#inv-role').textContent = `Acesso: ${ROLE[inv.role]}`;
    $('#inv-show').hidden = false;
    say($('#inv-msg'), '');
  } catch (err) {
    localStorage.removeItem('convite');
    say($('#inv-msg'), err.message, false);
    $('#inv-paste').hidden = false;
  }
}
$('#inv-accept').addEventListener('click', async () => {
  const inv = currentInvite;
  try {
    const batch = db.batch();
    batch.update(db.doc(`invites/${inv.code}`), { usedBy: user.uid, usedAt: firebase.firestore.FieldValue.serverTimestamp() });
    batch.update(db.doc(`sites/${inv.siteId}`), {
      [`members.${user.uid}`]: inv.role,
      [`memberInfo.${user.uid}`]: { name: profile.name || user.displayName || '', email: user.email },
      lastInvite: inv.code,
    });
    await batch.commit();
    localStorage.removeItem('convite');
    toast(`Pronto! Agora você vê as câmeras de ${inv.siteName}.`);
    show('s-home');
  } catch (err) {
    say($('#inv-msg'), mySites.some((s) => s.id === inv.siteId) ? 'Você já tem acesso a este local.' : `Não consegui aceitar: ${err.message}`, false);
  }
});

// Links that open the app: minhascameras://convite/CODE (from the WhatsApp link page).
function handleUrl(url) {
  const code = url && codeFrom(url);
  if (code) openInvite(code);
}
Plugins.App?.addListener?.('appUrlOpen', (e) => handleUrl(e.url));

// =====================================================================
// Old mode: places saved on this phone (QR of the computer / typed address)
// =====================================================================
const KEY = 'locais';
let legacy = (() => {
  let l = [];
  try { l = JSON.parse(localStorage.getItem(KEY)) || []; } catch { /* empty */ }
  for (const s of l) if (!s.urls) s.urls = [s.lan, s.remote].filter(Boolean);
  return l;
})();
const saveLegacy = () => localStorage.setItem(KEY, JSON.stringify(legacy));
let editing = null;

function normalize(a) {
  a = String(a || '').trim().replace(/\/+$/, '');
  if (!a) return '';
  if (!/^https?:\/\//i.test(a)) a = (/\.ts\.net$/i.test(a.split('/')[0]) ? 'https://' : 'http://') + a;
  try {
    const u = new URL(a);
    if (!u.port && u.protocol === 'http:') u.port = '8080';
    return u.origin;
  } catch { return ''; }
}
async function hello(url, ms = 3500) {
  if (!url) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${url}/api/hello`, { signal: ctl.signal, cache: 'no-store' });
    const j = await r.json();
    return j.app === 'minhas-cameras' ? j : null;
  } catch { return null; } finally { clearTimeout(t); }
}
async function reachable(urls) {
  const res = await Promise.all(urls.map((u) => hello(u, u.startsWith('https') ? 6000 : 3500).then((ok) => (ok ? u : null))));
  return res.find(Boolean) || null;
}

function renderLegacy() {
  const box = $('#legacy');
  box.innerHTML = '';
  $('#legacy-box').hidden = !legacy.length;
  for (const s of legacy) {
    const el = document.createElement('div');
    el.className = 'site';
    el.innerHTML = '<span class="dot"></span><div class="grow"><strong></strong><div class="small muted"></div></div><button class="icon-btn" aria-label="Editar">⋮</button>';
    el.querySelector('strong').textContent = s.name;
    el.querySelector('.muted').textContent = s.key ? 'Convite por QR' : s.urls.join(' · ').replace(/https?:\/\//g, '');
    el.querySelector('.grow').addEventListener('click', () => openLegacy(s));
    el.querySelector('.icon-btn').addEventListener('click', () => edit(s));
    box.appendChild(el);
    reachable(s.urls).then((u) => el.querySelector('.dot').classList.add(u ? 'on' : 'off'));
  }
}
async function openLegacy(s, tab = '') {
  cancelled = false;
  overlay(`Abrindo ${s.name}…`);
  const url = await reachable(s.urls);
  if (cancelled) return;
  if (!url) return overlay(`Não consegui falar com ${s.name}. Conecte o celular no Wi-Fi de lá, e confira se o computador está ligado.`);
  const extra = `${pushToken ? `&push=${encodeURIComponent(pushToken)}` : ''}${tab ? `&tab=${tab}` : ''}`;
  location.href = s.key ? `${url}/api/auth/device?k=${encodeURIComponent(s.key)}${extra}` : `${url}/?app=1${tab ? `&tab=${tab}` : ''}`;
}

// QR code of a computer (old invites)
let stream = null;
let scanning = false;
async function startScan() {
  $('#scanner').hidden = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch {
    stopScan();
    return overlay('Não consegui usar a câmera do celular. Permita o acesso à câmera para o app SHCAM e tente de novo.');
  }
  const v = $('#cam');
  v.srcObject = stream;
  await v.play().catch(() => {});
  scanning = true;
  const detector = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (!scanning) return;
    let text = null;
    if (v.videoWidth) {
      try {
        if (detector) text = (await detector.detect(v))[0]?.rawValue || null;
        else {
          const w = 640, h = Math.round((v.videoHeight / v.videoWidth) * 640);
          canvas.width = w; canvas.height = h;
          ctx.drawImage(v, 0, 0, w, h);
          text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data || null;
        }
      } catch { /* try again */ }
    }
    if (text) {
      if (text.startsWith('MC1:')) { stopScan(); handleQrInvite(text); return; }
      if (codeFrom(text)) { stopScan(); openInvite(codeFrom(text)); return; }
      $('#scan-msg').textContent = 'Esse QR code não é do SHCAM.';
    }
    setTimeout(tick, 200);
  };
  tick();
}
function stopScan() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $('#scanner').hidden = true;
}
$('#scan').addEventListener('click', startScan);
$('#scan-cancel').addEventListener('click', stopScan);
function deviceName() {
  const m = /Android [\d.]+; ([^;)]+)/.exec(navigator.userAgent);
  return m ? m[1].replace(/ Build.*/, '').trim() : 'Celular';
}
async function handleQrInvite(text) {
  let inv;
  try {
    const bin = atob(text.slice(4).replace(/-/g, '+').replace(/_/g, '/'));
    inv = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch { inv = null; }
  if (!inv?.c || !Array.isArray(inv.u)) return overlay('QR code inválido. Peça um novo convite.');
  inv.n ||= 'Câmeras';
  cancelled = false;
  overlay(`Conectando em ${inv.n}…`);
  const url = await reachable(inv.u);
  if (cancelled) return;
  if (!url) return overlay(`Não consegui falar com ${inv.n}. Conecte o celular no Wi-Fi de ${inv.n} e escaneie de novo.`);
  try {
    const r = await fetch(`${url}/api/invite/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: inv.c, device: deviceName(), push: pushToken }),
    });
    const j = await r.json();
    if (!r.ok) return overlay(j.error || 'Convite não aceito.');
    const name = j.site || inv.n;
    let site = legacy.find((s) => s.name === name);
    if (site) Object.assign(site, { urls: inv.u, key: j.key });
    else legacy.push((site = { id: Date.now().toString(36), name, urls: inv.u, key: j.key }));
    saveLegacy();
    renderLegacy();
    overlay(null);
    openLegacy(site);
  } catch {
    overlay('Não consegui concluir o convite. Tente de novo.');
  }
}

// Typed address
function edit(s) {
  editing = s;
  const f = $('#form');
  f.reset();
  $('#form-title').textContent = s ? `Editar ${s.name}` : 'Endereço do computador';
  $('#del').hidden = !s;
  say($('#form-msg'), '');
  if (s) {
    f.name.value = s.name;
    f.lan.value = (s.urls.find((u) => u.startsWith('http:')) || '').replace(/^http:\/\//, '').replace(/:8080$/, '');
    f.remote.value = s.urls.find((u) => u.startsWith('https:')) || '';
  }
  show('s-manual');
}
$('#add-manual').addEventListener('click', () => edit(null));
$('#del').addEventListener('click', () => {
  if (!editing || !confirm(`Remover “${editing.name}” deste celular?`)) return;
  legacy = legacy.filter((x) => x !== editing);
  saveLegacy();
  enterHome();
});
$('#test').addEventListener('click', async () => {
  const f = $('#form');
  say($('#form-msg'), 'Testando…');
  const lan = normalize(f.lan.value), remote = normalize(f.remote.value);
  const [a, b] = await Promise.all([hello(lan), hello(remote, 6000)]);
  const parts = [];
  if (lan) parts.push(a ? `Em casa: OK (${a.name})` : 'Em casa: sem resposta (é o endereço do computador, não da câmera?)');
  if (remote) parts.push(b ? `De fora: OK (${b.name})` : 'De fora: sem resposta');
  say($('#form-msg'), parts.join(' · ') || 'Informe pelo menos um endereço.', !!(a || b));
  if ((a || b) && !f.name.value) f.name.value = (a || b).name;
});
$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const urls = [normalize(f.lan.value), normalize(f.remote.value)].filter(Boolean);
  if (!urls.length) return say($('#form-msg'), 'Informe pelo menos um endereço.', false);
  const data = { name: f.name.value.trim(), urls };
  if (editing) Object.assign(editing, data); else legacy.push({ id: Date.now().toString(36), ...data });
  saveLegacy();
  enterHome();
});

// ---------- Push notifications ----------
let pushToken = localStorage.getItem('pushToken') || '';
const Push = window.PUSH_ENABLED && native ? Plugins.PushNotifications : null;
async function setupPush() {
  if (!Push) return;
  try {
    await Push.createChannel({ id: 'alertas', name: 'Alertas de pessoas', importance: 5, visibility: 1, sound: 'default', vibration: true });
    Push.addListener('registration', (t) => {
      pushToken = t.value;
      localStorage.setItem('pushToken', pushToken);
      if (user) saveProfile(user).catch(() => {});
    });
    Push.addListener('pushNotificationActionPerformed', (a) => {
      const d = a.notification?.data || {};
      const site = mySites.find((s) => s.id === d.siteId) || legacy.find((s) => s.name === d.site);
      if (!site) return;
      if (site.members) openSite(site, 'alerts');
      else openLegacy(site, 'alerts');
    });
    let perm = await Push.checkPermissions();
    if (perm.receive !== 'granted') perm = await Push.requestPermissions();
    if (perm.receive === 'granted') await Push.register();
  } catch { /* no notifications on this phone */ }
}

// ---------- Start ----------
setupPush();
if (auth) {
  auth.onAuthStateChanged(async (u) => {
    user = u;
    if (!u) {
      unsubSites?.();
      unsubSites = null;
      mySites = [];
      show('s-login');
      return;
    }
    profile.name = u.displayName || '';
    try {
      const p = await db.doc(`users/${u.uid}`).get();
      if (p.exists && p.data().name) profile.name = p.data().name;
      await saveProfile(u);
    } catch { /* offline: continue */ }
    enterHome();
  });
} else {
  show('s-login');
}
Plugins.App?.getLaunchUrl?.().then((r) => handleUrl(r?.url)).catch(() => {});
