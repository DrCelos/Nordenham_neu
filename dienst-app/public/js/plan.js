/* plan.js – Dienstplan (Monat & Woche), Schicht-Editor und Planungsassistent */
(function () {
  'use strict';
  const App = window.App;
  const { S, el, icon } = App;

  const mondayOf = (d) => {
    const x = App.startOfDay(d);
    const wd = (x.getDay() + 6) % 7; // Montag = 0
    return App.addDays(x, -wd);
  };
  const isoWeek = (d) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  };
  const canEdit = (pid) => !!S.me && (pid === S.me.id || App.isAdmin());

  const view = (App.views.plan = {
    root: null,
    mode: 'month', // 'month' | 'week'
    anchor: new Date(),
    roleFilter: null,

    mount(root) {
      this.root = root;
      root.replaceChildren();

      this.title = el('div', { class: 'plan-title' });
      this.modeBtns = el('div', { class: 'seg' });
      this.chipsBox = el('div', { class: 'chips filter' });
      this.wrap = el('div', { class: 'plan-wrap' });

      root.append(
        el('div', { class: 'card plan-bar' },
          el('div', { class: 'between wrap' },
            el('div', { class: 'row tight' },
              el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zurück', onclick: () => this.shift(-1) }, icon('back')),
              this.title,
              el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Weiter', onclick: () => this.shift(1) }, icon('next')),
              el('button', { class: 'btn small ghost', type: 'button', onclick: () => { this.anchor = new Date(); this.refresh(true); } }, 'Heute')),
            el('div', { class: 'row tight' },
              this.modeBtns,
              el('button', { class: 'btn primary', type: 'button', onclick: () => this.openAssistant() }, icon('wand', 18), 'Planungsassistent'))),
          this.chipsBox),
        el('div', { class: 'card flush' }, this.wrap)
      );
      this.refresh(true);
    },

    range() {
      if (this.mode === 'week') {
        const a = mondayOf(this.anchor);
        return { from: a, to: App.addDays(a, 6) };
      }
      const a = new Date(this.anchor.getFullYear(), this.anchor.getMonth(), 1);
      return { from: a, to: new Date(a.getFullYear(), a.getMonth() + 1, 0) };
    },

    shift(dir) {
      if (this.mode === 'week') this.anchor = App.addDays(this.anchor, 7 * dir);
      else this.anchor = new Date(this.anchor.getFullYear(), this.anchor.getMonth() + dir, 1);
      this.refresh(true);
    },

    async refresh(scrollToToday) {
      this.renderChrome();
      this.render(scrollToToday);
      const { from, to } = this.range();
      try {
        await App.load.shifts(App.ymd(App.addDays(from, -1)), App.ymd(App.addDays(to, 1)));
        this.render(scrollToToday);
      } catch (e) { App.toast(App.errMsg(e), 'err'); }
    },

    update() {
      if (this.root && this.root.isConnected) this.render(false);
    },

    // Sichtbaren Zeitraum neu laden (für den regelmäßigen Abgleich)
    async reload() {
      const { from, to } = this.range();
      await App.load.shifts(App.ymd(App.addDays(from, -1)), App.ymd(App.addDays(to, 1)));
    },

    renderChrome() {
      const { from, to } = this.range();
      this.title.textContent = this.mode === 'week'
        ? `KW ${isoWeek(from)} · ${App.fmtDM(from)}–${App.fmtDM(to)}${to.getFullYear()}`
        : `${App.MONTHS[from.getMonth()]} ${from.getFullYear()}`;

      this.modeBtns.replaceChildren(
        ...[['month', 'Monat'], ['week', 'Woche']].map(([m, label]) =>
          el('button', { type: 'button', class: this.mode === m ? 'on' : '', onclick: () => { this.mode = m; this.refresh(true); } }, label)));

      const chips = [el('button', { class: 'chip-btn' + (!this.roleFilter ? ' on' : ''), type: 'button', onclick: () => { this.roleFilter = null; this.render(false); this.renderChrome(); } }, 'Alle')];
      S.roles.forEach((r) => {
        const on = this.roleFilter === r.id;
        chips.push(el('button', {
          class: 'chip-btn' + (on ? ' on' : ''), type: 'button',
          style: on ? { background: r.color, color: App.contrast(r.color), borderColor: r.color } : { borderColor: r.color },
          onclick: () => { this.roleFilter = on ? null : r.id; this.render(false); this.renderChrome(); },
        }, r.name));
      });
      this.chipsBox.replaceChildren(...chips);
    },

    render(scrollToToday) {
      if (!this.wrap) return;
      const keepL = this.wrap.scrollLeft, keepT = this.wrap.scrollTop;
      const { from, to } = this.range();
      const days = [];
      for (let d = from; d <= to; d = App.addDays(d, 1)) days.push(d);
      const today = new Date();
      const st = App.edState();

      let people = S.profiles.slice();
      if (this.roleFilter) people = people.filter((p) => App.displayRoles(p.id, st).some((r) => r.id === this.roleFilter));
      // eigene Zeile zuerst, dann alphabetisch
      people.sort((a, b) => (b.id === S.me.id) - (a.id === S.me.id) || App.name(a).localeCompare(App.name(b), 'de'));

      const week = this.mode === 'week';
      const head = el('tr', {},
        el('th', { class: 'corner' }, 'Name'),
        days.map((d) => {
          const isToday = App.isSameDay(d, today);
          return el('th', { class: 'day' + (isToday ? ' today' : '') + ([0, 6].includes(d.getDay()) ? ' we' : ''), 'data-today': isToday ? '1' : null },
            el('span', { class: 'wd' }, App.WD[d.getDay()]),
            el('span', { class: 'dn' }, week ? App.fmtDM(d) : String(d.getDate())));
        }));

      const body = people.map((p) => {
        const editable = canEdit(p.id);
        return el('tr', { class: p.id === S.me.id ? 'me' : '' },
          el('th', { class: 'name' }, el('span', { class: 'nm' }, App.name(p)), App.dots(p.id, st)),
          days.map((d) => {
            const ds = App.ymd(d);
            const sh = App.shiftOf(p.id, ds);
            const isToday = App.isSameDay(d, today);
            const cls = 'cell' + (isToday ? ' today' : '') + ([0, 6].includes(d.getDay()) ? ' we' : '') + (editable ? ' edit' : '');
            return el('td', { class: cls, onclick: editable ? () => this.openEditor(p, ds) : null }, this.cellContent(sh, week));
          }));
      });

      this.wrap.replaceChildren(
        el('table', { class: 'plan ' + (week ? 'week' : 'month') },
          el('thead', {}, head),
          el('tbody', {}, body.length ? body : el('tr', {}, el('td', { colspan: days.length + 1, class: 'pad muted' }, 'Keine Personen für diesen Filter.')))));

      if (scrollToToday) {
        const th = this.wrap.querySelector('th[data-today]');
        if (th && !week) this.wrap.scrollLeft = Math.max(0, th.offsetLeft - 130);
        else this.wrap.scrollLeft = 0;
        this.wrap.scrollTop = 0;
      } else {
        this.wrap.scrollLeft = keepL;
        this.wrap.scrollTop = keepT;
      }
    },

    cellContent(sh, week) {
      if (!sh) return null;
      if (sh.status === 'frei') return el('span', { class: 'free' }, week ? 'frei' : '·');
      const label = App.shiftShort(sh);
      return el('span', { class: 'shift' + (sh.is_ed ? ' ed' : ''), style: { background: App.shiftColor(sh) }, title: `${label} ${App.shiftRange(sh)}` },
        el('b', {}, label),
        week ? el('small', {}, App.shiftRange(sh)) : null);
    },

    /* ---------- Einzelnen Tag bearbeiten ---------- */
    openEditor(person, dayStr) {
      const date = App.parseYmd(dayStr);
      const existing = App.shiftOf(person.id, dayStr);
      const groups = App.shiftOptionsFor(person.id);
      const state = {
        status: existing ? existing.status : null,
        code: existing && existing.status === 'dienst' ? existing.code : null,
        s: '09:00', e: '13:00', isEd: false,
      };
      if (existing && existing.code === 'ZEIT' && existing.start_at) {
        state.s = App.fmtTime(new Date(existing.start_at));
        state.e = App.fmtTime(new Date(existing.end_at));
        
      }

      const content = el('div', { class: 'stack' });
      let m;
      const draw = () => {
        const parts = [];
        parts.push(el('div', { class: 'seg big' },
          el('button', { type: 'button', class: state.status === 'frei' ? 'on free' : '', onclick: () => { state.status = 'frei'; draw(); } }, 'Frei'),
          el('button', { type: 'button', class: state.status === 'dienst' ? 'on' : '', onclick: () => { state.status = 'dienst'; draw(); } }, 'Dienst')));
        if (state.status === 'dienst') {
          groups.forEach((g) => {
            parts.push(el('div', { class: 'small muted' }, g.title));
            parts.push(el('div', { class: 'opt-grid' }, g.codes.map((c) => this.optButton(c, state, draw))));
          });
          if (state.code === 'ZEIT') parts.push(this.customTimeBox(state));
        }
        content.replaceChildren(...parts);
      };
      draw();

      const save = () => {
        if (!state.status) return App.toast('Bitte Frei oder Dienst wählen.', 'err');
        if (state.status === 'dienst' && !state.code) return App.toast('Bitte eine Schicht wählen.', 'err');
        if (state.code === 'ZEIT' && (!state.s || !state.e || state.s === state.e)) return App.toast('Bitte Beginn und Ende angeben.', 'err');
        App.guard(async () => {
          await App.saveShift(person.id, dayStr, { status: state.status, code: state.code, custom: { s: state.s, e: state.e }, isEd: state.isEd });
          m.close();
          this.afterChange();
        });
      };
      const remove = () => App.guard(async () => {
        await App.deleteShift(person.id, dayStr);
        m.close();
        this.afterChange();
      });

      m = App.modal({
        title: `${App.name(person)} · ${App.WD[date.getDay()]}, ${App.fmtDM(date)}${date.getFullYear()}`,
        body: content,
        actions: [
          existing ? el('button', { class: 'btn ghost danger-text', type: 'button', onclick: remove }, 'Eintrag löschen') : null,
          el('span', { class: 'grow' }),
          el('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'Abbrechen'),
          el('button', { class: 'btn primary', type: 'button', onclick: save }, 'Speichern'),
        ],
      });
    },

    optButton(code, state, draw) {
      const def = App.SHIFT[code];
      const sub = def.custom ? 'Zeit selbst wählen' : `${def.s}–${def.e}${def.next ? ' (+1)' : ''}`;
      const on = state.code === code;
      return el('button', {
        type: 'button', class: 'opt' + (on ? ' on' : ''),
        style: on ? { background: def.color, color: '#fff', borderColor: def.color } : { borderColor: def.color },
        onclick: () => { state.code = code; draw(); },
      }, el('b', {}, def.label), el('small', {}, sub));
    },

    customTimeBox(state) {
      return el('div', { class: 'custom-time' },
        el('label', {}, 'Von ', el('input', { type: 'time', class: 'input', value: state.s, onchange: (e) => { state.s = e.target.value; } })),
        el('label', {}, 'Bis ', el('input', { type: 'time', class: 'input', value: state.e, onchange: (e) => { state.e = e.target.value; } })),
        el('p', { class: 'small muted' }, 'Liegt „Bis“ vor „Von“, endet die Schicht am Folgetag.'));
    },

    afterChange() {
      this.update();
      if (App.views.home && S.tab === 'home') App.views.home.update();
    },

    /* ---------- Planungsassistent ---------- */
    // Ablauf: 1) Monat wählen  2) alle Tage von 1. bis zum letzten Tag nacheinander durchgehen
    // 3) erst am letzten Tag erscheint „Abschließen“.
    openAssistant() {
      const base = this.mode === 'week' ? mondayOf(this.anchor) : this.anchor;
      let year = base.getFullYear();
      let month = base.getMonth();
      let personId = S.me.id;
      let idx = 0;
      let step = 'month'; // 'month' | 'choose' | 'shift'
      const state = { code: null, s: '09:00', e: '13:00', isEd: true };
      let m;

      const nDays = () => new Date(year, month + 1, 0).getDate();
      const dayStr = (i) => App.ymd(new Date(year, month, i + 1));
      const box = el('div', { class: 'stack assistant' });

      const loadMonth = async () => {
        try { await App.load.shifts(App.ymd(new Date(year, month, 1)), App.ymd(new Date(year, month + 1, 0))); }
        catch (e) { App.toast(App.errMsg(e), 'err'); }
      };
      const changeMonth = (d) => {
        const x = new Date(year, month + d, 1);
        year = x.getFullYear(); month = x.getMonth();
        draw();
        loadMonth().then(() => { if (step === 'month') draw(); });
      };

      const personSelect = () => (App.isAdmin()
        ? el('label', { class: 'field' }, 'Planung für',
          el('select', { class: 'input', onchange: (e) => { personId = e.target.value; draw(); } },
            S.profiles.map((p) => el('option', { value: p.id, selected: p.id === personId }, App.name(p) + (p.id === S.me.id ? ' (ich)' : '')))))
        : null);

      const start = async () => {
        await loadMonth();
        idx = 0; // immer vom 1. des Monats an
        step = 'choose';
        state.code = null;
        draw();
      };

      const go = (i) => {
        idx = Math.min(Math.max(0, i), nDays() - 1);
        step = 'choose';
        state.code = null;
        draw();
      };

      const finish = () => {
        this.mode = 'month';
        this.anchor = new Date(year, month, 1);
        m.close(); // onClose aktualisiert die Ansicht
        App.toast(`Planung für ${App.MONTHS[month]} ${year} abgeschlossen.`, 'ok');
        this.refresh(true);
      };

      const saveAndNext = (payload) => App.guard(async () => {
        await App.saveShift(personId, dayStr(idx), payload);
        this.afterChange();
        if (idx < nDays() - 1) go(idx + 1);
        else { step = 'choose'; state.code = null; draw(); } // letzter Tag: bleiben, dann „Abschließen“
      });

      const drawMonth = () => {
        const parts = [personSelect()];
        let filled = 0;
        for (let i = 0; i < nDays(); i++) if (App.shiftOf(personId, dayStr(i))) filled++;
        parts.push(el('h2', { class: 'center' }, 'Welcher Monat?'));
        parts.push(el('div', { class: 'month-pick' },
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Vorheriger Monat', onclick: () => changeMonth(-1) }, icon('back')),
          el('strong', {}, `${App.MONTHS[month]} ${year}`),
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Nächster Monat', onclick: () => changeMonth(1) }, icon('next'))));
        parts.push(el('p', { class: 'center small muted' },
          `Danach gehe ich alle ${nDays()} Tage von 1. bis ${nDays()}. ${App.MONTHS[month]} nacheinander mit dir durch.`,
          filled ? ` Schon eingetragen: ${filled} von ${nDays()} Tagen (sie werden beim Durchgehen angezeigt und lassen sich ändern).` : ''));
        parts.push(el('button', { type: 'button', class: 'btn primary block', onclick: start }, 'Los geht’s'));
        box.replaceChildren(...parts.filter(Boolean));
      };

      const drawDay = () => {
        const date = new Date(year, month, idx + 1);
        const ds = dayStr(idx);
        const cur = App.shiftOf(personId, ds);
        const person = App.profileById(personId);
        const last = idx === nDays() - 1;
        const parts = [];
        if (step === 'choose') state.isEd = true; // alles unter „Dienst“ zählt als Einsatzdienst

        if (App.isAdmin()) {
          parts.push(el('label', { class: 'field' }, 'Planung für',
            el('select', { class: 'input', onchange: (e) => { personId = e.target.value; go(idx); } },
              S.profiles.map((p) => el('option', { value: p.id, selected: p.id === personId }, App.name(p) + (p.id === S.me.id ? ' (ich)' : ''))))));
        }

        parts.push(el('div', { class: 'progress' }, el('i', { style: { width: ((idx + 1) / nDays()) * 100 + '%' } })));
        parts.push(el('div', { class: 'small muted center' }, `${App.MONTHS[month]} ${year} · Tag ${idx + 1} von ${nDays()}`));
        parts.push(el('h2', { class: 'center big-date' + (App.isSameDay(date, new Date()) ? ' today' : '') }, App.fmtLong(date)));
        if (cur) parts.push(el('div', { class: 'center small' }, 'Eingetragen: ',
          cur.status === 'frei' ? el('b', {}, 'frei') : el('b', {}, App.shiftShort(cur) + ' ' + App.shiftRange(cur))));
        if (last) parts.push(el('div', { class: 'center small muted' }, 'Das ist der letzte Tag des Monats.'));

        if (step === 'choose') {
          parts.push(el('div', { class: 'assist-btns' },
            el('button', { type: 'button', class: 'big-btn free', onclick: () => saveAndNext({ status: 'frei' }) }, el('b', {}, 'Frei'), el('small', {}, last ? 'speichern' : 'weiter zum nächsten Tag')),
            el('button', { type: 'button', class: 'big-btn duty', onclick: () => { step = 'shift'; draw(); } }, el('b', {}, 'Dienst'), el('small', {}, 'Schicht wählen'))));
        } else {
          App.shiftOptionsFor(person.id).forEach((g) => {
            parts.push(el('div', { class: 'small muted' }, g.title));
            parts.push(el('div', { class: 'opt-grid' }, g.codes.map((c) => {
              const def = App.SHIFT[c];
              if (def.custom) return this.optButton(c, state, draw);
              return el('button', { type: 'button', class: 'opt', style: { borderColor: def.color },
                onclick: () => saveAndNext({ status: 'dienst', code: c }) },
              el('b', {}, def.label), el('small', {}, `${def.s}–${def.e}${def.next ? ' (+1)' : ''}`));
            })));
          });
          if (state.code === 'ZEIT') {
            parts.push(this.customTimeBox(state));
            parts.push(el('button', { type: 'button', class: 'btn primary block', onclick: () => {
              if (!state.s || !state.e || state.s === state.e) return App.toast('Bitte Beginn und Ende angeben.', 'err');
              saveAndNext({ status: 'dienst', code: 'ZEIT', custom: { s: state.s, e: state.e }, isEd: true });
            } }, last ? 'Übernehmen' : 'Übernehmen & weiter'));
          }
          parts.push(el('button', { type: 'button', class: 'btn ghost block', onclick: () => { step = 'choose'; state.code = null; draw(); } }, icon('back', 16), 'Zurück'));
        }

        parts.push(el('div', { class: 'between assist-nav' },
          el('button', { type: 'button', class: 'btn small ghost', disabled: idx === 0, onclick: () => go(idx - 1) }, icon('back', 16), 'Vorheriger Tag'),
          last
            ? el('button', { type: 'button', class: 'btn primary', onclick: finish }, icon('check', 16), 'Abschließen')
            : el('button', { type: 'button', class: 'btn small ghost', onclick: () => go(idx + 1) }, 'Überspringen', icon('next', 16))));
        parts.push(el('div', { class: 'center' }, el('button', { type: 'button', class: 'link small', onclick: () => { step = 'month'; draw(); } }, 'Anderen Monat wählen')));
        box.replaceChildren(...parts);
      };

      const draw = () => (step === 'month' ? drawMonth() : drawDay());

      draw();
      m = App.modal({
        title: 'Planungsassistent',
        body: box,
        onClose: () => this.afterChange(),
      });
      loadMonth().then(() => { if (step === 'month') draw(); });
    },
  });
})();
