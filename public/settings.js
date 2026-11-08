/* global api, reloadCameras */
'use strict';

(() => {
  const $ = (s) => document.querySelector(s);
  let brands = [];
  let adminCams = [];
  let editing = null; // camera being edited (null = new)

  const say = (el, msg, ok) => {
    el.textContent = msg || '';
    el.className = `small ${ok === true ? 'ok' : ok === false ? 'error' : ''}`;
  };
  const gb = (n) => (n == null ? '?' : n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : `${(n / 1e9).toFixed(0)} GB`);

  // ---------- Camera list ----------
  async function loadAdmin() {
    const [cams, status] = await Promise.all([api('/api/admin/cameras'), api('/api/cameras')]);
    adminCams = cams;
    const st = new Map(status.map((c) => [c.id, c]));
    const list = $('#cam-admin-list');
    list.innerHTML = '';
    if (!cams.length) {
      list.innerHTML = '<li class="empty">Nenhuma câmera ainda. Toque em “+ Adicionar câmera”.</li>';
      return;
    }
    for (const c of cams) {
      const s = st.get(c.id) || {};
      const li = document.createElement('li');
      li.innerHTML = '<span class="dot"></span><div class="grow"><strong></strong><div class="small muted"></div></div><button class="btn small-btn">Editar</button>';
      li.querySelector('.dot').classList.toggle('rec', !!s.recording);
      li.querySelector('strong').textContent = c.name;
      const brand = brands.find((b) => b.id === c.brand);
      li.querySelector('.muted').textContent =
        `${c.host || (c.main || '').replace(/\/\/[^@]*@/, '//')} · ${brand ? brand.label.split(' /')[0] : ''}` +
        (s.recording ? ' · gravando' : s.error ? ` · ${s.error.slice(0, 80)}` : '');
      li.querySelector('button').addEventListener('click', () => openEditor(c));
      list.appendChild(li);
    }
  }

  // ---------- Editor ----------
  const form = $('#cam-form');
  const field = (n) => form.elements[n];

  function fillBrands() {
    const sel = $('#brand');
    sel.innerHTML = '';
    for (const b of brands) sel.add(new Option(b.label, b.id));
  }

  function applyBrand(setDefaults) {
    const b = brands.find((x) => x.id === field('brand').value) || brands[0];
    $('#brand-hint').textContent = b.hint || '';
    $('#brand-setup').textContent = b.setup || '';
    $('#fields-std').hidden = !!b.custom;
    $('#fields-custom').hidden = !b.custom;
    if (setDefaults) {
      field('user').value = b.user || '';
      field('ptz').checked = !!b.ptz;
    }
  }

  function openEditor(cam = null, prefill = {}) {
    editing = cam;
    form.reset();
    $('#cam-editor-title').textContent = cam ? `Editar ${cam.name}` : 'Adicionar câmera';
    $('#cam-delete').hidden = !cam;
    $('#discover-box').hidden = !!cam;
    $('#new-cam-help').hidden = !!cam;
    $('#new-cam-help').open = false;
    $('#discover-list').innerHTML = '';
    say($('#discover-msg'), '');
    $('#test-result').hidden = true;
    const c = cam || { brand: 'yoosee', ...prefill };
    field('brand').value = c.brand || 'yoosee';
    applyBrand(!cam);
    for (const k of ['name', 'host', 'main', 'sub', 'rtspPort', 'onvifPort']) if (c[k] != null) field(k).value = c[k];
    if (cam) {
      field('user').value = cam.user ?? '';
      field('ptz').checked = !!cam.ptz;
      field('transport').value = cam.transport || 'auto';
    }
    $('#cam-password').placeholder = cam?.hasPassword ? '(sem mudança)' : '';
    $('#cam-editor').showModal();
  }

  function formData() {
    const d = {};
    for (const k of ['name', 'brand', 'host', 'user', 'password', 'main', 'sub', 'rtspPort', 'onvifPort', 'transport']) d[k] = field(k).value.trim();
    d.ptz = field('ptz').checked;
    if (editing) d.id = editing.id;
    return d;
  }

  field('brand').addEventListener('change', () => applyBrand(true));
  $('#cam-add').addEventListener('click', () => openEditor());
  $('#cam-cancel').addEventListener('click', () => $('#cam-editor').close());

  $('#discover').addEventListener('click', async () => {
    const btn = $('#discover');
    btn.disabled = true;
    say($('#discover-msg'), 'Procurando… (até 20 segundos)');
    const list = $('#discover-list');
    list.innerHTML = '';
    try {
      const found = await api('/api/admin/discover');
      say($('#discover-msg'), found.length ? 'Toque numa câmera para usar o IP dela:' : 'Nenhuma câmera encontrada. Se ela é nova, veja “Câmera nova” acima; ou digite o IP abaixo.');
      if (!found.length) $('#new-cam-help').open = true;
      for (const f of found) {
        const li = document.createElement('li');
        li.innerHTML = '<div class="grow"><strong></strong><div class="small muted"></div></div>';
        li.querySelector('strong').textContent = f.host;
        const b = brands.find((x) => x.id === f.brand);
        li.querySelector('.muted').textContent = f.added
          ? `já adicionada como “${f.added}”`
          : [f.rtsp ? 'vídeo RTSP' : null, f.onvifPort ? `ONVIF ${f.onvifPort}` : null, f.brand !== 'generic' ? `parece ${b?.label.split(' /')[0]}` : null].filter(Boolean).join(' · ');
        if (f.added) li.classList.add('disabled');
        else li.addEventListener('click', () => {
          field('host').value = f.host;
          if (f.brand !== 'generic') {
            field('brand').value = f.brand;
            applyBrand(true);
          }
          for (const x of list.children) x.classList.remove('selected');
          li.classList.add('selected');
          field('password').focus();
        });
        list.appendChild(li);
      }
    } catch (e) {
      say($('#discover-msg'), e.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  $('#cam-test').addEventListener('click', async () => {
    const box = $('#test-result');
    box.hidden = false;
    box.className = 'test-result';
    box.textContent = 'Testando conexão… (até 30 segundos)';
    $('#cam-test').disabled = true;
    try {
      const r = await api('/api/admin/test', { method: 'POST', body: JSON.stringify(formData()) });
      if (r.ok) {
        box.className = 'test-result ok';
        box.innerHTML = '<p>✅ Funcionou! Imagem da câmera:</p><img alt="Imagem da câmera">';
        box.querySelector('img').src = r.image;
        box.insertAdjacentHTML('beforeend', '<p class="small muted">Agora dê um nome para ela abaixo (ex.: Garagem) e toque em Salvar.</p>');
        $('#name-field').scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (!editing) setTimeout(() => field('name').focus({ preventScroll: true }), 400);
        if (field('transport').value === 'auto' && r.transport) field('transport').value = r.transport;
      } else {
        box.className = 'test-result bad';
        box.textContent = `❌ ${r.error}`;
      }
    } catch (e) {
      box.className = 'test-result bad';
      box.textContent = `❌ ${e.message}`;
    } finally {
      $('#cam-test').disabled = false;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData();
    try {
      if (editing) await api(`/api/admin/cameras/${editing.id}`, { method: 'PUT', body: JSON.stringify(d) });
      else await api('/api/admin/cameras', { method: 'POST', body: JSON.stringify(d) });
      $('#cam-editor').close();
      await loadAdmin();
      reloadCameras();
    } catch (err) {
      const box = $('#test-result');
      box.hidden = false;
      box.className = 'test-result bad';
      box.textContent = err.message;
    }
  });

  $('#cam-delete').addEventListener('click', async () => {
    if (!editing || !confirm(`Remover a câmera “${editing.name}”? As gravações já feitas continuam guardadas.`)) return;
    await api(`/api/admin/cameras/${editing.id}`, { method: 'DELETE' });
    $('#cam-editor').close();
    await loadAdmin();
    reloadCameras();
  });

  // ---------- Settings ----------
  async function loadSettings() {
    const { settings: s, drive, tools, toolErrors, addresses } = await api('/api/settings');
    $('#site-input').value = s.site.name;
    $('#site-remote').value = s.site.remoteUrl || '';
    $('#site-addr').textContent = (addresses || []).join('  ou  ') || location.host;
    $('#drive-folder').value = s.drive.folder;
    $('#drive-days').value = s.drive.retentionDays;
    $('#drive-enabled').checked = s.drive.enabled;
    $('#rec-enabled').checked = s.recording.enabled;
    $('#rec-stream').value = s.recording.stream;
    $('#rec-audio').checked = s.recording.audio;
    $('#local-hours').value = s.local.retentionHours;

    const warn = [];
    if (tools.ffmpeg === 'baixando') warn.push('Baixando o ffmpeg (programa de vídeo)… isso acontece só uma vez.');
    if (toolErrors.ffmpeg) warn.push(toolErrors.ffmpeg);
    if (tools.rclone === 'baixando') warn.push('Baixando o rclone (programa do Drive)…');
    $('#tools-warning').hidden = !warn.length;
    $('#tools-warning').textContent = warn.join(' ');

    if (drive.error) say($('#drive-msg'), `Último envio falhou: ${drive.error}`, false);
    else if (drive.lastUpload) say($('#drive-msg'), `Último envio: ${new Date(drive.lastUpload).toLocaleString('pt-BR')}`, true);
    loadDriveInfo();
  }

  async function loadDriveInfo() {
    const badge = $('#drive-badge');
    badge.textContent = 'verificando…';
    badge.className = 'badge';
    try {
      const a = await api('/api/drive/about');
      badge.textContent = a.connected ? 'conectado' : 'não conectado';
      badge.className = `badge ${a.connected ? 'ok' : 'bad'}`;
      $('#drive-connect').textContent = a.connected ? 'Trocar conta Google' : 'Conectar conta Google';
      $('#drive-space').textContent = a.connected && a.total ? `Espaço: ${gb(a.used)} usados de ${gb(a.total)} (${gb(a.free)} livres)` : '';
    } catch (e) {
      badge.textContent = 'erro';
      badge.className = 'badge bad';
      $('#drive-space').textContent = e.message;
    }
  }

  async function saveSettings(body, msgEl) {
    try {
      const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      $('#drive-folder').value = r.settings.drive.folder;
      say(msgEl, 'Salvo ✓', true);
      if (typeof refreshStatus === 'function') refreshStatus();
    } catch (e) {
      say(msgEl, e.message, false);
    }
  }

  $('#site-save').addEventListener('click', () =>
    saveSettings({ site: { name: $('#site-input').value, remoteUrl: $('#site-remote').value } }, $('#site-msg')).then(() => (document.querySelector('#site-name').textContent = $('#site-input').value.trim())),
  );
  $('#drive-save').addEventListener('click', () =>
    saveSettings({ drive: { folder: $('#drive-folder').value, retentionDays: Number($('#drive-days').value), enabled: $('#drive-enabled').checked } }, $('#drive-msg')),
  );
  $('#drive-upload').addEventListener('click', async () => {
    try {
      await api('/api/drive/upload-now', { method: 'POST' });
      say($('#drive-msg'), 'Enviando… (os arquivos que acabaram de gravar vão no próximo envio)', true);
    } catch (e) {
      say($('#drive-msg'), e.message, false);
    }
  });
  $('#drive-connect').addEventListener('click', async () => {
    const btn = $('#drive-connect');
    btn.disabled = true;
    say($('#drive-connect-msg'), 'Abrindo o login do Google no navegador do computador servidor… Entre na conta e clique em “Permitir”. (pode levar alguns minutos na primeira vez)');
    try {
      await api('/api/drive/connect', { method: 'POST' });
      say($('#drive-connect-msg'), 'Conta Google conectada ✓', true);
      loadDriveInfo();
    } catch (e) {
      say($('#drive-connect-msg'), e.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  $('#rec-save').addEventListener('click', () =>
    saveSettings(
      {
        recording: { enabled: $('#rec-enabled').checked, stream: $('#rec-stream').value, audio: $('#rec-audio').checked },
        local: { retentionHours: Number($('#local-hours').value) },
      },
      $('#rec-msg'),
    ).then(reloadCameras),
  );

  $('#pw-save').addEventListener('click', async () => {
    try {
      await api('/api/password', { method: 'POST', body: JSON.stringify({ current: $('#pw-current').value, password: $('#pw-new').value }) });
      $('#pw-current').value = '';
      $('#pw-new').value = '';
      say($('#pw-msg'), 'Senha trocada ✓', true);
    } catch (e) {
      say($('#pw-msg'), e.message, false);
    }
  });
  $('#logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.href = '/login.html';
  });

  // ---------- People ----------
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return 'agora';
    if (m < 60) return `há ${m} min`;
    if (m < 48 * 60) return `há ${Math.round(m / 60)} h`;
    return `há ${Math.round(m / 1440)} dias`;
  };
  async function loadPeople() {
    const { users, invites } = await api('/api/users');
    const list = $('#people-list');
    list.innerHTML = '';
    const me = document.createElement('li');
    me.innerHTML = '<span>👑</span><div class="grow"><strong>Você (senha de administrador)</strong><div class="small muted">Administrador</div></div>';
    list.appendChild(me);
    for (const u of users) {
      const li = document.createElement('li');
      li.innerHTML = '<span>👤</span><div class="grow"><strong></strong><div class="small muted"></div></div><button class="btn small-btn danger">Remover</button>';
      li.querySelector('strong').textContent = u.name;
      li.querySelector('.muted').textContent = `${u.roleLabel} · visto ${ago(u.lastSeen)}`;
      li.querySelector('button').addEventListener('click', async () => {
        if (!confirm(`Remover o acesso de “${u.name}”? O app no celular dessa pessoa deixa de funcionar na hora.`)) return;
        await api(`/api/users/${u.id}`, { method: 'DELETE' });
        loadPeople();
      });
      list.appendChild(li);
    }
    for (const i of invites) {
      const li = document.createElement('li');
      li.innerHTML = '<span>✉️</span><div class="grow"><strong></strong><div class="small muted"></div></div><button class="btn small-btn">Cancelar</button>';
      li.querySelector('strong').textContent = i.name;
      li.querySelector('.muted').textContent = `Convite ainda não usado · vale até ${new Date(i.expires).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
      li.querySelector('button').addEventListener('click', async () => {
        await api(`/api/users/${i.id}`, { method: 'DELETE' });
        loadPeople();
      });
      list.appendChild(li);
    }
  }

  const inviteForm = $('#invite-form');
  $('#invite-new').addEventListener('click', () => {
    inviteForm.reset();
    $('#invite-step1').hidden = false;
    $('#invite-step2').hidden = true;
    $('#invite-go').hidden = false;
    say($('#invite-msg'), '');
    $('#invite-dialog').showModal();
    inviteForm.elements.name.focus();
  });
  $('#invite-close').addEventListener('click', () => $('#invite-dialog').close());
  $('#invite-dialog').addEventListener('close', () => loadPeople());
  inviteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/invites', {
        method: 'POST',
        body: JSON.stringify({ name: inviteForm.elements.name.value, role: inviteForm.elements.role.value }),
      });
      $('#invite-img').src = r.qr;
      $('#invite-info').textContent =
        `Convite para ${r.name} (${r.role === 'admin' ? 'Administrador' : 'Só ver'}). Vale uma vez, até ${new Date(r.expires).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` +
        (r.urls.some((u) => u.startsWith('https')) ? '' : ' Funciona no Wi-Fi deste local (o acesso de fora ainda não está configurado).');
      $('#invite-step1').hidden = true;
      $('#invite-step2').hidden = false;
      $('#invite-go').hidden = true;
    } catch (err) {
      say($('#invite-msg'), err.message, false);
    }
  });

  // Called by app.js when the "Ajustes" tab opens.
  window.openSettings = async () => {
    if (!brands.length) {
      brands = await api('/api/brands');
      fillBrands();
    }
    await Promise.all([loadAdmin(), loadSettings(), loadPeople()]);
  };
  window.openCameraEditor = () => window.openSettings().then(() => openEditor());
})();
