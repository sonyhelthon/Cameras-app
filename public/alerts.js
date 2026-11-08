/* global api, me, playRecordingAt */
'use strict';

// "🔔 Alertas" tab: photos of people detected by the cameras.
(() => {
  const $ = (s) => document.querySelector(s);
  const SEEN = 'alertas-vistos';
  let items = [];
  let current = null;
  let filled = false;

  const seenTs = () => Number(localStorage.getItem(SEEN) || 0);
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (ts) => {
    const d = new Date(ts);
    const today = new Date();
    const y = new Date(Date.now() - 86400_000);
    if (d.toDateString() === today.toDateString()) return 'Hoje';
    if (d.toDateString() === y.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  };

  function render(append = false) {
    const list = $('#alert-list');
    if (!append) list.innerHTML = '';
    const seen = seenTs();
    let lastDay = list.dataset.lastDay || '';
    if (!append) lastDay = '';
    for (const ev of append ? items.slice(-append) : items) {
      const day = fmtDay(ev.ts);
      if (day !== lastDay) {
        const h = document.createElement('p');
        h.className = 'alert-day';
        h.textContent = day;
        list.appendChild(h);
        lastDay = day;
      }
      const card = document.createElement('button');
      card.className = `alert-card${ev.ts > seen ? ' new' : ''}`;
      card.innerHTML = '<img loading="lazy" alt=""><div class="meta"><strong></strong><span class="muted"></span></div>';
      card.querySelector('img').src = `/events/img/${ev.id}.jpg`;
      card.querySelector('strong').textContent = ev.camName;
      card.querySelector('.muted').textContent = fmtTime(ev.ts);
      card.addEventListener('click', () => openAlert(ev));
      list.appendChild(card);
    }
    list.dataset.lastDay = lastDay;
    $('#alert-info').textContent = items.length ? '' : 'Nenhum alerta ainda. Quando uma câmera vir uma pessoa, a foto aparece aqui.';
  }

  async function load() {
    const cam = $('#alert-cam').value;
    items = await api(`/api/events?limit=60${cam ? `&cam=${cam}` : ''}`);
    render();
    $('#alert-more').hidden = items.length < 60;
  }

  $('#alert-more').addEventListener('click', async () => {
    const cam = $('#alert-cam').value;
    const more = await api(`/api/events?limit=60&before=${items[items.length - 1].ts}${cam ? `&cam=${cam}` : ''}`);
    items.push(...more);
    render(more.length);
    $('#alert-more').hidden = more.length < 60;
  });
  $('#alert-cam').addEventListener('change', load);

  function openAlert(ev) {
    current = ev;
    $('#alert-title').textContent = `Pessoa em ${ev.camName}`;
    $('#alert-img').src = `/events/img/${ev.id}.jpg`;
    $('#alert-when').textContent = new Date(ev.ts).toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#alert-del').hidden = me.role !== 'admin';
    $('#alert-dialog').showModal();
  }
  $('#alert-close').addEventListener('click', () => $('#alert-dialog').close());
  $('#alert-rec').addEventListener('click', () => {
    $('#alert-dialog').close();
    playRecordingAt(current.cam, current.ts);
  });
  $('#alert-del').addEventListener('click', async () => {
    if (!confirm('Apagar este alerta?')) return;
    await api(`/api/events/${current.id}`, { method: 'DELETE' });
    $('#alert-dialog').close();
    load();
  });

  // Red number on the tab: alerts not seen yet on this device.
  async function badge() {
    try {
      const latest = await api('/api/events?limit=50');
      const n = latest.filter((e) => e.ts > seenTs()).length;
      const b = $('#alert-badge');
      b.hidden = !n;
      b.textContent = n > 49 ? '50+' : String(n);
    } catch { /* offline */ }
  }

  window.openAlerts = async (cams) => {
    if (!filled && cams) {
      for (const c of cams) $('#alert-cam').add(new Option(c.name, c.id));
      filled = true;
    }
    await load();
    // Opening the tab marks everything as seen (the highlight stays until next time).
    if (items[0]) localStorage.setItem(SEEN, String(Math.max(seenTs(), items[0].ts)));
    $('#alert-badge').hidden = true;
  };
  window.refreshAlertBadge = badge;
  badge();
  setInterval(badge, 30_000);
})();
