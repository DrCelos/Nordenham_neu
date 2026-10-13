/* core.js – Grundlagen: Supabase, Zustand, Datenladen, Rollenlogik, UI-Bausteine */
(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const App = (window.App = { S: {}, views: {}, cfg });
  const S = App.S;

  Object.assign(S, {
    session: null,
    me: null,
    roles: [],
    profiles: [],
    profileRoles: [],
    shifts: new Map(), // key: profileId|YYYY-MM-DD
    notes: [],
    edItems: [],
    chat: [],
    material: [],
    tab: 'home',
    activeChat: 'group',
  });

  /* ---------- Supabase ---------- */
  App.configured = !!(
    cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !/DEIN-PROJEKT|EINFUEGEN/i.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY) &&
    window.supabase
  );
  if (App.configured) {
    // Die Passkey-Schnittstelle von Supabase ist (noch) experimentell und muss aktiviert werden.
    // Die Doku nennt zwei Schreibweisen, daher werden beide mitgegeben (unbekannte Optionen werden ignoriert).
    App.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, experimental: { passkey: true } },
      experimental: { passkey: true },
    });
    App.passkeySupported = !!(App.sb.auth && typeof App.sb.auth.signInWithPasskey === 'function' &&
      window.PublicKeyCredential);
  }

  /* ---------- Kleine Helfer ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  App.pad = pad;
  App.ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  App.parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  App.addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  App.startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  App.WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  App.WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  App.MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  App.fmtTime = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  App.fmtDM = (d) => pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.';
  App.fmtLong = (d) => `${App.WD_LONG[d.getDay()]}, ${d.getDate()}. ${App.MONTHS[d.getMonth()]}`;
  App.isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  App.relTime = (iso) => {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'gerade eben';
    if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
    if (diff < 86400 && App.isSameDay(d, new Date())) return `vor ${Math.floor(diff / 3600)} Std.`;
    if (App.isSameDay(d, App.addDays(new Date(), -1))) return 'gestern ' + App.fmtTime(d);
    return App.fmtDM(d) + ' ' + App.fmtTime(d);
  };

  App.contrast = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111827' : '#ffffff';
  };

  /* ---------- DOM-Builder (kein innerHTML mit Nutzerdaten) ---------- */
  const PROP_KEYS = ['value', 'checked', 'disabled', 'selected', 'htmlFor', 'textContent'];
  App.el = function (tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) {
            if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv;
          }
        }
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (PROP_KEYS.includes(k)) e[k] = v;
        else if (v === true) e.setAttribute(k, '');
        else e.setAttribute(k, v);
      }
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else if (c instanceof Node) e.appendChild(c);
      else e.appendChild(document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return e;
  };
  const el = App.el;

  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.5.7 4 2.5 4 6"/>',
    logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    wand: '<path d="M4 20L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.7 1.3L21 13l-1.3.7L19 15l-.7-1.3L17 13l1.3-.7z"/>',
  };
  App.icon = (name, size = 20) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';
    return s;
  };

  /* ---------- Toast & Modal ---------- */
  App.toast = (msg, kind = 'info', ms = 3500) => {
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = el('div', { class: 'toast ' + kind }, msg);
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  };

  App.errMsg = (e) => {
    const m = (e && (e.message || e.error_description || e.error)) || String(e);
    if (/row-level security|permission denied/i.test(m)) return 'Dazu fehlt dir die Berechtigung.';
    if (/Invalid login credentials/i.test(m)) return 'E-Mail oder Passwort stimmt nicht.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Keine Verbindung zum Server.';
    return m;
  };
  App.guard = async (fn) => {
    try { return await fn(); }
    catch (e) { console.error(e); App.toast(App.errMsg(e), 'err', 5000); }
  };

  App.modal = function ({ title, body, actions, wide, persistent, onClose }) {
    const prevFocus = document.activeElement;
    const overlay = el('div', { class: 'overlay' });
    const sheet = el('div', { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (onClose) onClose();
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* egal */ }
    };
    const onKey = (e) => { if (e.key === 'Escape' && !persistent) close(); };
    document.addEventListener('keydown', onKey);
    if (title !== undefined) {
      sheet.append(el('div', { class: 'sheet-head' },
        el('h3', {}, title),
        persistent ? null : el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', onclick: close }, App.icon('x'))));
    }
    const bodyBox = el('div', { class: 'sheet-body' }, body);
    sheet.append(bodyBox);
    if (actions && actions.length) sheet.append(el('div', { class: 'sheet-actions' }, actions));
    overlay.append(sheet);
    if (!persistent) overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    const first = sheet.querySelector('input,textarea,select');
    if (first) setTimeout(() => first.focus(), 30);
    return { close, sheet, body: bodyBox };
  };

  App.confirm = (text, { ok = 'Ja', danger = false, title = 'Bist du sicher?' } = {}) =>
    new Promise((resolve) => {
      let m;
      let answered = false;
      const done = (v) => { answered = true; m.close(); resolve(v); };
      m = App.modal({
        title,
        body: el('p', {}, text),
        actions: [
          el('button', { class: 'btn ghost', type: 'button', onclick: () => done(false) }, 'Abbrechen'),
          el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: () => done(true) }, ok),
        ],
        onClose: () => { if (!answered) resolve(false); },
      });
    });

  App.prompt = (text, { title = 'Eingabe', type = 'text', ok = 'Speichern', placeholder = '' } = {}) =>
    new Promise((resolve) => {
      let m;
      let answered = false;
      const input = el('input', { type, class: 'input', placeholder, autocomplete: 'off' });
      const done = (v) => { answered = true; m.close(); resolve(v); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
      m = App.modal({
        title,
        body: el('div', { class: 'stack' }, el('p', {}, text), input),
        actions: [
          el('button', { class: 'btn ghost', type: 'button', onclick: () => done(null) }, 'Abbrechen'),
          el('button', { class: 'btn primary', type: 'button', onclick: () => done(input.value) }, ok),
        ],
        onClose: () => { if (!answered) resolve(null); },
      });
    });

  /* ---------- Rollen & Personen ---------- */
  App.roleByName = (n) => S.roles.find((r) => r.name === n);
  App.roleById = (id) => S.roles.find((r) => r.id === id);
  App.profileById = (id) => S.profiles.find((p) => p.id === id);
  App.name = (p) => {
    if (!p) return 'Unbekannt';
    return p.display_name || (p.email ? p.email.split('@')[0] : 'Neu');
  };
  App.realRoles = (pid) =>
    S.profileRoles.filter((x) => x.profile_id === pid).map((x) => App.roleById(x.role_id)).filter(Boolean)
      .sort((a, b) => a.sort - b.sort);
  App.hasRole = (pid, name) => App.realRoles(pid).some((r) => r.name === name);
  App.isAdmin = () => !!S.me && App.hasRole(S.me.id, 'Admin');
  App.isLager = () => !!S.me && App.hasRole(S.me.id, 'Lager');

  // Einsatzdienst: fest zugeordnet ODER laut Dienstplan gerade im Dienst
  // ODER (wenn gerade niemand eingetragen ist) der Nächste im Plan.
  App.edState = function (now = new Date()) {
    const t = now.getTime();
    const edRole = App.roleByName('Einsatzdienst');
    const fixed = new Set(edRole ? S.profileRoles.filter((x) => x.role_id === edRole.id).map((x) => x.profile_id) : []);
    const active = new Set();
    let nextStart = null;
    let nextIds = new Set();
    for (const s of S.shifts.values()) {
      if (s.status !== 'dienst' || !s.is_ed || !s.start_at) continue;
      const st = new Date(s.start_at).getTime();
      const en = new Date(s.end_at).getTime();
      if (st <= t && en > t) active.add(s.profile_id);
      else if (st > t) {
        if (nextStart === null || st < nextStart) { nextStart = st; nextIds = new Set([s.profile_id]); }
        else if (st === nextStart) nextIds.add(s.profile_id);
      }
    }
    const next = active.size ? new Set() : nextIds;
    const ids = new Set([...fixed, ...active, ...next]);
    return { fixed, active, next, nextStart: active.size ? null : nextStart, ids };
  };
  App.isEd = (pid, st) => (st || App.edState()).ids.has(pid);

  // Rollen für die Anzeige: echte Rollen + (dynamisch) Einsatzdienst
  App.displayRoles = (pid, st) => {
    const list = App.realRoles(pid);
    const edRole = App.roleByName('Einsatzdienst');
    if (edRole && (st || App.edState()).ids.has(pid) && !list.includes(edRole)) list.push(edRole);
    return list.sort((a, b) => a.sort - b.sort);
  };

  App.chip = (role, extra) =>
    el('span', { class: 'chip' + (extra ? ' ' + extra : ''), style: { background: role.color, color: App.contrast(role.color) } }, role.name);

  App.dots = (pid, st) =>
    el('span', { class: 'dots' }, App.displayRoles(pid, st).map((r) => el('i', { style: { background: r.color }, title: r.name })));

  /* ---------- Schichtarten ---------- */
  App.SHIFT = {
    S8:    { short: '8h',  label: '8 Stunden',    s: '08:00', e: '16:30', next: false, ed: true, color: '#2563eb' },
    S10:   { short: '10h', label: '10 Stunden',   s: '07:00', e: '17:45', next: false, ed: true, color: '#1d4ed8' },
    NACHT: { short: 'N',   label: 'Nachtschicht', s: '20:15', e: '07:00', next: true,  ed: true, color: '#4338ca' },
    EDT:   { short: 'EDT', label: 'EDT',          s: '08:00', e: '20:00', next: false, ed: true,  color: '#d97706' },
    EDN:   { short: 'EDN', label: 'EDN',          s: '20:00', e: '08:00', next: true,  ed: true,  color: '#7c3aed' },
    ED24:  { short: 'ED24', label: 'ED24',        s: '08:00', e: '08:00', next: true,  ed: true,  color: '#be185d' },
    ZEIT:  { short: 'Zeit', label: 'Freie Zeit',  custom: true, ed: true, color: '#0d9488' },
  };

  App.shiftOptionsFor = (pid) => {
    const names = App.realRoles(pid).map((r) => r.name);
    const groups = [];
    if (names.includes('Springer')) groups.push({ title: 'Springer', codes: ['S8', 'S10', 'NACHT'] });
    if (names.includes('FSJ') || names.includes('Ehrenamt')) groups.push({ title: 'Einsatzdienst', codes: ['EDT', 'EDN', 'ED24'] });
    if (names.includes('Ehrenamt')) groups.push({ title: 'Eigene Zeit', codes: ['ZEIT'] });
    if (!groups.length) groups.push({ title: 'Eigene Zeit', codes: ['ZEIT'] });
    return groups;
  };

  App.shiftTimes = (dayStr, code, custom) => {
    const d = App.parseYmd(dayStr);
    let s, e, add;
    if (code === 'ZEIT') { s = custom.s; e = custom.e; add = e <= s ? 1 : 0; }
    else { const def = App.SHIFT[code]; s = def.s; e = def.e; add = def.next ? 1 : 0; }
    const [sh, sm] = s.split(':').map(Number);
    const [eh, em] = e.split(':').map(Number);
    return {
      start_at: new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm).toISOString(),
      end_at: new Date(d.getFullYear(), d.getMonth(), d.getDate() + add, eh, em).toISOString(),
    };
  };

  App.shiftShort = (sh) => {
    if (!sh) return '';
    if (sh.status === 'frei') return 'frei';
    if (sh.code === 'ZEIT' && sh.start_at) {
      const a = new Date(sh.start_at), b = new Date(sh.end_at);
      const f = (d) => (d.getMinutes() ? `${d.getHours()}:${pad(d.getMinutes())}` : String(d.getHours()));
      return `${f(a)}–${f(b)}`;
    }
    return (App.SHIFT[sh.code] || {}).short || sh.code || 'Dienst';
  };
  App.shiftRange = (sh) => {
    if (!sh || sh.status !== 'dienst' || !sh.start_at) return '';
    const a = new Date(sh.start_at), b = new Date(sh.end_at);
    return `${App.fmtTime(a)}–${App.fmtTime(b)}` + (App.isSameDay(a, b) ? '' : ' (+1)');
  };
  App.shiftColor = (sh) => ((App.SHIFT[sh.code] || {}).color) || '#475569';

  const shiftKey = (pid, day) => pid + '|' + day;
  App.shiftOf = (pid, day) => S.shifts.get(shiftKey(pid, day));

  App.saveShift = async (pid, dayStr, { status, code, custom, isEd }) => {
    let payload;
    if (status === 'frei') {
      payload = { profile_id: pid, day: dayStr, status: 'frei', code: null, start_at: null, end_at: null, is_ed: false };
    } else {
      const t = App.shiftTimes(dayStr, code, custom);
      const ed = true; // alles, was unter „Dienst“ gewählt wird, ist Einsatzdienst
      payload = { profile_id: pid, day: dayStr, status: 'dienst', code, start_at: t.start_at, end_at: t.end_at, is_ed: ed };
    }
    payload.updated_at = new Date().toISOString();
    const { data, error } = await App.sb.from('shifts').upsert(payload, { onConflict: 'profile_id,day' }).select().single();
    if (error) throw error;
    S.shifts.set(shiftKey(pid, dayStr), data);
    return data;
  };

  App.deleteShift = async (pid, dayStr) => {
    const { error } = await App.sb.from('shifts').delete().eq('profile_id', pid).eq('day', dayStr);
    if (error) throw error;
    S.shifts.delete(shiftKey(pid, dayStr));
  };

  /* ---------- Daten laden ---------- */
  async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }

  App.load = {
    async roles() {
      const { data, error } = await App.sb.from('roles').select('*').order('sort');
      if (error) throw error;
      S.roles = data;
    },
    async profiles() {
      const { data, error } = await App.sb.from('profiles').select('id,email,display_name,material_seen_at,created_at');
      if (error) throw error;
      S.profiles = data.sort((a, b) => App.name(a).localeCompare(App.name(b), 'de'));
      if (S.session) S.me = S.profiles.find((p) => p.id === S.session.user.id) || null;
    },
    async profileRoles() {
      const { data, error } = await App.sb.from('profile_roles').select('*');
      if (error) throw error;
      S.profileRoles = data;
    },
    async notes() {
      const { data, error } = await App.sb.from('notes').select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      S.notes = data;
    },
    async edItems() {
      const { data, error } = await App.sb.from('ed_items').select('*').order('created_at', { ascending: true }).limit(300);
      if (error) throw error;
      S.edItems = data;
    },
    async material() {
      const { data, error } = await App.sb.from('material_items').select('*').order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      S.material = data;
    },
    async chat() {
      const rows = await fetchAll((a, b) =>
        App.sb.from('chat_messages').select('*').order('created_at', { ascending: false }).range(a, Math.min(b, 1999)));
      S.chat = rows.reverse();
    },
    // Nur neue Chat-Nachrichten holen (für den regelmäßigen Abgleich)
    async chatSince() {
      if (!S.chat.length) return App.load.chat();
      const last = S.chat[S.chat.length - 1].created_at;
      const { data, error } = await App.sb.from('chat_messages').select('*').gt('created_at', last).order('created_at').limit(500);
      if (error) throw error;
      data.forEach((m) => App.addChatMessage && App.addChatMessage(m));
    },
    async shifts(fromYmd, toYmd) {
      const rows = await fetchAll((a, b) =>
        App.sb.from('shifts').select('*').gte('day', fromYmd).lte('day', toYmd).order('day').range(a, b));
      for (const [k, v] of S.shifts) if (v.day >= fromYmd && v.day <= toYmd) S.shifts.delete(k);
      rows.forEach((r) => S.shifts.set(shiftKey(r.profile_id, r.day), r));
    },
    // Fenster für die Einsatzdienst-Logik und den Zeitstrahl
    async edWindow() {
      const t = new Date();
      await App.load.shifts(App.ymd(App.addDays(t, -2)), App.ymd(App.addDays(t, 60)));
    },
  };

  /* ---------- Verwaltungsfunktion (Netlify) ---------- */
  App.adminCall = async (payload) => {
    const { data } = await App.sb.auth.getSession();
    const token = data && data.session ? data.session.access_token : '';
    let res;
    try {
      res = await fetch('/.netlify/functions/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new Error('Die Verwaltungsfunktion ist nicht erreichbar (läuft die Seite auf Netlify?).');
    }
    let json = {};
    try { json = await res.json(); } catch (e) { /* leer */ }
    if (!res.ok) {
      if (res.status === 404) throw new Error('Die Netlify-Function "admin" wurde nicht gefunden. Wurde der Ordner netlify/functions mit deployt?');
      throw new Error(json.error || 'Fehler ' + res.status);
    }
    return json;
  };

  /* ---------- Hinweise & Badges ---------- */
  App.lastReadStore = () => {
    try { return JSON.parse(localStorage.getItem('lr:' + S.me.id) || '{}'); } catch (e) { return {}; }
  };
  App.chatKey = (m) => (m.recipient_id == null ? 'group' : (m.sender_id === S.me.id ? m.recipient_id : m.sender_id));
  App.chatUnread = () => {
    if (!S.me) return {};
    const lr = App.lastReadStore();
    let init = localStorage.getItem('lrinit:' + S.me.id);
    if (!init) { init = new Date().toISOString(); localStorage.setItem('lrinit:' + S.me.id, init); }
    const out = {};
    for (const m of S.chat) {
      if (m.sender_id === S.me.id) continue;
      const k = App.chatKey(m);
      // Alte Gruppennachrichten gelten beim ersten Start nicht als „neu“, direkte Nachrichten an mich schon
      const since = lr[k] || (k === 'group' ? init : '1970-01-01');
      if (m.created_at > since) out[k] = (out[k] || 0) + 1;
    }
    return out;
  };
  App.materialNewCount = () => {
    if (!S.me || !App.isLager()) return 0;
    const seen = S.me.material_seen_at || '1970-01-01';
    return S.material.filter((m) => m.created_by !== S.me.id && m.created_at > seen).length;
  };

  App.updateBadges = () => {
    const chatDot = document.querySelector('[data-tab="chat"] .dot');
    const matDot = document.querySelector('[data-tab="material"] .dot');
    if (chatDot) chatDot.classList.toggle('on', Object.keys(App.chatUnread()).length > 0);
    if (matDot) matDot.classList.toggle('on', App.materialNewCount() > 0 && S.tab !== 'material');
  };
})();
