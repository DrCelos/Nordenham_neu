/* material.js – Material melden (alle) und Materialliste mit Abhaken (Lager) */
(function () {
  'use strict';
  const App = window.App;
  const { S, el, icon } = App;

  const REASONS = {
    verbraucht: { label: 'Verbraucht (Einsatz)', cls: 'use' },
    abgelaufen: { label: 'Abgelaufen', cls: 'exp' },
  };

  const view = (App.views.material = {
    root: null,
    showForm: false,
    filter: 'open', // open | done | all
    prevSeen: null,

    canSeeList() { return App.isLager() || App.isAdmin(); },

    mount(root) {
      this.root = root;
      // Lager/Admin sehen zuerst die Liste, alle anderen direkt das Formular
      this.showForm = !this.canSeeList();
      // Stand merken, damit „NEU“-Markierungen auch nach dem Quittieren sichtbar bleiben
      this.prevSeen = S.me.material_seen_at || '1970-01-01';
      this.draw();
      this.markSeen();
    },

    update() {
      if (!this.root || !this.root.isConnected) return;
      if (this.canSeeList() && !this.showForm) this.renderList();
      this.markSeen();
    },

    draw() {
      this.root.replaceChildren();
      if (this.showForm) this.root.append(this.formCard());
      else this.root.append(this.listCard());
      if (!this.showForm) this.renderList();
    },

    /* ---------- Eintragsformular (für alle gleich) ---------- */
    formCard() {
      const name = el('input', { class: 'input', placeholder: 'Was wurde gebraucht? z. B. Handschuhe M', maxlength: 200, list: 'mat-names' });
      const names = [...new Set(S.material.map((m) => m.name))].slice(0, 50);
      const datalist = el('datalist', { id: 'mat-names' }, names.map((n) => el('option', { value: n })));
      const qty = el('input', { class: 'input', type: 'number', min: 1, max: 9999, value: 1, inputmode: 'numeric' });
      const note = el('input', { class: 'input', placeholder: 'Notiz (optional)', maxlength: 300 });
      let reason = 'verbraucht';

      const reasonBox = el('div', { class: 'seg big' });
      const drawReasons = () => reasonBox.replaceChildren(...Object.entries(REASONS).map(([k, r]) =>
        el('button', { type: 'button', class: reason === k ? 'on ' + r.cls : '', onclick: () => { reason = k; drawReasons(); } }, r.label)));
      drawReasons();

      const save = () => {
        const n = name.value.trim();
        const q = parseInt(qty.value, 10);
        if (!n) return App.toast('Bitte angeben, welches Material.', 'err');
        if (!q || q < 1) return App.toast('Bitte eine Anzahl angeben.', 'err');
        App.guard(async () => {
          const { error } = await App.sb.from('material_items').insert({ name: n, quantity: q, reason, note: note.value.trim() || null });
          if (error) throw error;
          App.toast('Eintrag gespeichert. Das Lager ist informiert.', 'ok');
          if (this.canSeeList()) {
            // Nach dem Speichern erscheint wieder die Liste
            this.showForm = false;
            await App.load.material();
            this.draw();
            this.markSeen();
          } else {
            name.value = ''; qty.value = 1; note.value = ''; reason = 'verbraucht'; drawReasons();
            name.focus();
          }
        });
      };

      return el('section', { class: 'card' },
        el('h3', {}, 'Material melden'),
        el('p', { class: 'small muted' }, 'Trag ein, was verbraucht wurde oder abgelaufen ist – das Lager sieht es sofort und füllt nach.'),
        el('div', { class: 'stack' },
          el('label', { class: 'field' }, 'Material', name, datalist),
          el('label', { class: 'field' }, 'Anzahl', qty),
          el('div', { class: 'field' }, 'Grund', reasonBox),
          el('label', { class: 'field' }, 'Notiz', note),
          el('div', { class: 'row end' },
            this.canSeeList() ? el('button', { class: 'btn ghost', type: 'button', onclick: () => { this.showForm = false; this.draw(); } }, 'Abbrechen') : null,
            el('button', { class: 'btn primary', type: 'button', onclick: save }, 'Speichern'))));
    },

    /* ---------- Liste (Lager) ---------- */
    listCard() {
      this.listBox = el('div', { class: 'mat-list' });
      this.summary = el('span', { class: 'small muted' });
      this.filterBox = el('div', { class: 'seg' });
      return el('section', { class: 'card' },
        el('div', { class: 'between wrap' },
          el('div', {}, el('h3', {}, 'Material'), this.summary),
          el('button', { class: 'btn primary', type: 'button', onclick: () => { this.showForm = true; this.draw(); } }, icon('plus', 18), 'Eintrag')),
        this.filterBox,
        this.listBox);
    },

    renderList() {
      if (!this.listBox || !this.listBox.isConnected) return;
      const all = S.material;
      const open = all.filter((m) => !m.done);
      this.summary.textContent = `${open.length} offen · ${all.length - open.length} erledigt`;

      this.filterBox.replaceChildren(...[['open', 'Offen'], ['done', 'Erledigt'], ['all', 'Alle']].map(([k, label]) =>
        el('button', { type: 'button', class: this.filter === k ? 'on' : '', onclick: () => { this.filter = k; this.renderList(); } }, label)));

      let items = all;
      if (this.filter === 'open') items = open;
      if (this.filter === 'done') items = all.filter((m) => m.done);
      // Offene zuerst, innerhalb nach Datum (neu oben)
      items = items.slice().sort((a, b) => Number(a.done) - Number(b.done) || b.created_at.localeCompare(a.created_at));

      if (!items.length) {
        this.listBox.replaceChildren(el('p', { class: 'muted pad center' }, this.filter === 'open' ? 'Alles erledigt – nichts nachzufüllen. 🎉' : 'Keine Einträge.'));
        return;
      }
      this.listBox.replaceChildren(...items.map((m) => this.row(m)));
    },

    row(m) {
      const r = REASONS[m.reason] || { label: m.reason, cls: '' };
      const by = App.profileById(m.created_by);
      const isNew = App.isLager() && m.created_by !== (S.me && S.me.id) && m.created_at > this.prevSeen && !m.done;
      return el('div', { class: 'mat-row' + (m.done ? ' done' : '') },
        el('input', { type: 'checkbox', class: 'check', checked: m.done, 'aria-label': 'Erledigt', onchange: (e) => this.toggle(m, e.target.checked) }),
        el('div', { class: 'grow' },
          el('div', { class: 'mat-title' },
            el('strong', {}, m.name), el('span', { class: 'qty' }, '× ' + m.quantity),
            el('span', { class: 'reason ' + r.cls }, r.label),
            isNew ? el('span', { class: 'new' }, 'NEU') : null),
          m.note ? el('div', { class: 'small' }, m.note) : null,
          el('div', { class: 'small muted' }, `${by ? App.name(by) : 'Unbekannt'} · ${App.relTime(m.created_at)}` + (m.done && m.done_at ? ` · erledigt ${App.relTime(m.done_at)}` : ''))),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Löschen', onclick: () => this.remove(m) }, icon('trash', 18)));
    },

    toggle(m, done) {
      App.guard(async () => {
        const { error } = await App.sb.from('material_items').update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', m.id);
        if (error) throw error;
        await App.load.material();
        this.renderList();
      });
    },

    async remove(m) {
      if (!(await App.confirm(`„${m.name}“ aus der Liste löschen?`, { ok: 'Löschen', danger: true }))) return;
      App.guard(async () => {
        const { error } = await App.sb.from('material_items').delete().eq('id', m.id);
        if (error) throw error;
        await App.load.material();
        this.renderList();
      });
    },

    // Benachrichtigungspunkt quittieren, sobald das Lager die Liste sieht
    markSeen() {
      if (S.tab !== 'material' || !App.isLager() || this.showForm) return;
      const latest = S.material.reduce((mx, m) => (m.created_at > mx ? m.created_at : mx), '');
      const current = S.me.material_seen_at || '';
      if (!latest || latest <= current) { App.updateBadges(); return; }
      S.me.material_seen_at = latest; // sofort lokal, damit der Punkt verschwindet
      App.updateBadges();
      App.sb.from('profiles').update({ material_seen_at: latest }).eq('id', S.me.id).then(() => {});
    },
  });
})();
