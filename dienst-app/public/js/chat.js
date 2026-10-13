/* chat.js – Gruppenchat (immer oben) und Einzelchats mit allen anderen */
(function () {
  'use strict';
  const App = window.App;
  const { S, el, icon } = App;

  const isMobile = () => window.matchMedia('(max-width: 799px)').matches;

  const view = (App.views.chat = {
    root: null,
    search: '',
    roleFilter: null,
    open: false, // mobil: Unterhaltung offen?

    mount(root) {
      this.root = root;
      root.replaceChildren();
      this.open = !isMobile() || !!App.chatTarget;
      if (App.chatTarget) { S.activeChat = App.chatTarget; App.chatTarget = null; }
      else if (!isMobile() && !S.activeChat) S.activeChat = 'group';

      this.searchInput = el('input', { class: 'input', type: 'search', placeholder: 'Person suchen …', value: this.search,
        oninput: (e) => { this.search = e.target.value; this.renderPeople(); } });
      this.groupBox = el('div', { class: 'chat-group' });
      this.chipsBox = el('div', { class: 'chips filter' });
      this.peopleBox = el('div', { class: 'chat-people' });

      this.aside = el('aside', { class: 'chat-list' },
        el('div', { class: 'chat-list-top' }, this.groupBox, this.searchInput, this.chipsBox),
        this.peopleBox);

      this.titleBox = el('div', { class: 'grow' });
      this.msgBox = el('div', { class: 'msgs' });
      this.input = el('textarea', { class: 'input', rows: 1, maxlength: 4000, placeholder: 'Nachricht schreiben …' });
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
      });
      this.input.addEventListener('input', () => {
        this.input.style.height = 'auto';
        this.input.style.height = Math.min(this.input.scrollHeight, 140) + 'px';
      });
      this.pane = el('section', { class: 'chat-pane' },
        el('header', { class: 'chat-head' },
          el('button', { class: 'icon-btn only-mobile', type: 'button', 'aria-label': 'Zurück', onclick: () => { this.open = false; this.syncOpen(); this.renderList(); } }, icon('back')),
          this.titleBox),
        this.msgBox,
        el('div', { class: 'composer' }, this.input,
          el('button', { class: 'btn primary', type: 'button', 'aria-label': 'Senden', onclick: () => this.send() }, icon('send', 18))));

      this.wrap = el('div', { class: 'chat' }, this.aside, this.pane);
      root.append(this.wrap);
      this.syncOpen();
      this.renderList();
      this.renderConversation(true);
    },

    syncOpen() { this.wrap.classList.toggle('open', this.open); },

    // Wird bei neuen Nachrichten etc. aufgerufen
    update() {
      if (!this.root || !this.root.isConnected) return;
      this.renderList();
      if (this.open) this.renderConversation(false);
    },

    /* ---------- Liste ---------- */
    summary() {
      const map = new Map();
      for (const m of S.chat) map.set(App.chatKey(m), m); // letzte Nachricht je Chat
      return map;
    },

    renderList() {
      const unread = App.chatUnread();
      const last = this.summary();
      this.groupBox.replaceChildren(this.row('group', 'Gruppenchat', 'Alle im Team', last.get('group'), unread.group, true));

      // Rollenfilter („frag mal die Springer“)
      const chips = [el('button', { class: 'chip-btn' + (!this.roleFilter ? ' on' : ''), type: 'button', onclick: () => { this.roleFilter = null; this.renderList(); } }, 'Alle')];
      S.roles.forEach((r) => {
        const on = this.roleFilter === r.id;
        chips.push(el('button', {
          class: 'chip-btn' + (on ? ' on' : ''), type: 'button',
          style: on ? { background: r.color, color: App.contrast(r.color), borderColor: r.color } : { borderColor: r.color },
          onclick: () => { this.roleFilter = on ? null : r.id; this.renderList(); },
        }, r.name));
      });
      this.chipsBox.replaceChildren(...chips);
      this.renderPeople(unread, last);
    },

    renderPeople(unread, last) {
      unread = unread || App.chatUnread();
      last = last || this.summary();
      const st = App.edState();
      const q = this.search.trim().toLowerCase();
      let people = S.profiles.filter((p) => p.id !== S.me.id);
      if (q) people = people.filter((p) => App.name(p).toLowerCase().includes(q));
      if (this.roleFilter) {
        const role = App.roleById(this.roleFilter);
        people = people.filter((p) => App.displayRoles(p.id, st).some((r) => r.id === this.roleFilter));
        if (role && role.name === 'Einsatzdienst') people.sort((a, b) => App.name(a).localeCompare(App.name(b), 'de'));
      }
      people.sort((a, b) => {
        const la = last.get(a.id), lb = last.get(b.id);
        if (la && lb) return lb.created_at.localeCompare(la.created_at);
        if (la) return -1;
        if (lb) return 1;
        return App.name(a).localeCompare(App.name(b), 'de');
      });
      if (!people.length) {
        this.peopleBox.replaceChildren(el('p', { class: 'muted small pad' }, 'Niemand gefunden.'));
        return;
      }
      this.peopleBox.replaceChildren(...people.map((p) => this.row(p.id, App.name(p), null, last.get(p.id), unread[p.id], false, p, st)));
    },

    row(key, title, sub, lastMsg, unreadCount, isGroup, person, st) {
      const active = S.activeChat === key && (this.open || !isMobile());
      const preview = lastMsg ? (lastMsg.sender_id === S.me.id ? 'Du: ' : (isGroup ? App.name(App.profileById(lastMsg.sender_id)) + ': ' : '')) + lastMsg.body : (sub || 'Noch keine Nachrichten');
      const avatar = isGroup
        ? el('div', { class: 'avatar group' }, icon('users', 18))
        : el('div', { class: 'avatar', style: { background: this.avatarColor(person, st), color: '#fff' } }, App.name(person).slice(0, 1).toUpperCase());
      return el('button', { class: 'chat-row' + (active ? ' active' : ''), type: 'button', onclick: () => this.select(key) },
        avatar,
        el('div', { class: 'grow' },
          el('div', { class: 'between' },
            el('strong', {}, title, person ? App.dots(person.id, st) : null),
            lastMsg ? el('span', { class: 'small muted' }, App.fmtTime(new Date(lastMsg.created_at))) : null),
          el('div', { class: 'preview' + (unreadCount ? ' unread' : '') }, preview)),
        unreadCount ? el('span', { class: 'badge-count' }, String(unreadCount)) : null);
    },

    avatarColor(person, st) {
      const roles = person ? App.displayRoles(person.id, st) : [];
      const ed = roles.find((r) => r.name === 'Einsatzdienst');
      return (ed || roles[0] || { color: '#64748b' }).color;
    },

    select(key) {
      S.activeChat = key;
      this.open = true;
      this.syncOpen();
      this.renderList();
      this.renderConversation(true);
      setTimeout(() => this.input && this.input.focus(), 50);
    },

    /* ---------- Unterhaltung ---------- */
    renderConversation(forceBottom) {
      const key = S.activeChat;
      if (!key) {
        this.titleBox.replaceChildren(el('strong', {}, 'Chat'));
        this.msgBox.replaceChildren(el('p', { class: 'muted pad' }, 'Wähle links eine Unterhaltung.'));
        return;
      }
      const isGroup = key === 'group';
      const person = isGroup ? null : App.profileById(key);
      if (!isGroup && !person) { S.activeChat = 'group'; return this.renderConversation(true); }
      const st = App.edState();

      this.titleBox.replaceChildren(
        el('strong', {}, isGroup ? 'Gruppenchat' : App.name(person)),
        isGroup ? el('div', { class: 'small muted' }, 'Alle im Team') :
          el('div', { class: 'chips' }, App.displayRoles(person.id, st).map((r) => App.chip(r))));

      const msgs = S.chat.filter((m) => App.chatKey(m) === key);
      const nearBottom = this.msgBox.scrollHeight - this.msgBox.scrollTop - this.msgBox.clientHeight < 120;
      const frag = [];
      let lastDay = '';
      let lastSender = null;
      msgs.forEach((m) => {
        const d = new Date(m.created_at);
        const dayStr = App.ymd(d);
        if (dayStr !== lastDay) {
          lastDay = dayStr;
          lastSender = null;
          const label = App.isSameDay(d, new Date()) ? 'Heute' : App.isSameDay(d, App.addDays(new Date(), -1)) ? 'Gestern' : App.fmtLong(d);
          frag.push(el('div', { class: 'day-sep' }, el('span', {}, label)));
        }
        const mine = m.sender_id === S.me.id;
        const sender = App.profileById(m.sender_id);
        frag.push(el('div', { class: 'bubble-row' + (mine ? ' mine' : '') },
          el('div', { class: 'bubble' },
            isGroup && !mine && lastSender !== m.sender_id ? el('div', { class: 'who' }, App.name(sender), App.dots(m.sender_id, st)) : null,
            el('div', { class: 'txt' }, m.body),
            el('div', { class: 'time' }, App.fmtTime(d)))));
        lastSender = m.sender_id;
      });
      if (!msgs.length) frag.push(el('p', { class: 'muted pad center' }, isGroup ? 'Schreib die erste Nachricht an alle.' : `Noch keine Nachrichten mit ${App.name(person)}.`));
      this.msgBox.replaceChildren(...frag);
      if (forceBottom || nearBottom) this.msgBox.scrollTop = this.msgBox.scrollHeight;
      this.markRead(key, msgs);
    },

    markRead(key, msgs) {
      if (!this.open || S.tab !== 'chat') return;
      const store = App.lastReadStore();
      const latest = msgs.length ? msgs[msgs.length - 1].created_at : new Date().toISOString();
      if ((store[key] || '') >= latest) return;
      store[key] = latest;
      try { localStorage.setItem('lr:' + S.me.id, JSON.stringify(store)); } catch (e) { /* voll */ }
      App.updateBadges();
      this.renderList();
    },

    send() {
      const body = this.input.value.trim();
      const key = S.activeChat;
      if (!body || !key) return;
      this.input.value = '';
      this.input.style.height = 'auto';
      App.guard(async () => {
        const { data, error } = await App.sb.from('chat_messages')
          .insert({ recipient_id: key === 'group' ? null : key, body }).select().single();
        if (error) { this.input.value = body; throw error; }
        App.addChatMessage(data);
        this.update();
        this.msgBox.scrollTop = this.msgBox.scrollHeight;
      });
    },
  });

  // Nachricht in den Zustand aufnehmen (doppelte vermeiden)
  App.addChatMessage = (m) => {
    if (S.chat.some((x) => x.id === m.id)) return false;
    S.chat.push(m);
    S.chat.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return true;
  };

  // Chat mit einer bestimmten Person öffnen (z. B. vom Einsatzdienst-Kasten)
  App.openChat = (profileId) => {
    App.chatTarget = profileId;
    App.go('chat');
  };
})();
