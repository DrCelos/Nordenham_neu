/* admin.js – Verwaltung: Personen anlegen/entfernen, Rollen vergeben, Farben ändern */
(function () {
  'use strict';
  const App = window.App;
  const { S, el, icon } = App;

  const view = (App.views.admin = {
    root: null,

    mount(root) {
      this.root = root;
      root.replaceChildren();
      if (!App.isAdmin()) {
        root.append(el('div', { class: 'card' }, el('p', {}, 'Dieser Bereich ist nur für Admins.')));
        return;
      }
      this.newRoles = new Set();
      this.createCard = this.buildCreate();
      this.peopleBox = el('div', { class: 'people' });
      this.rolesBox = el('div', { class: 'role-colors' });

      root.append(
        this.createCard,
        el('section', { class: 'card' },
          el('h3', {}, icon('users', 18), ' Personen'),
          el('p', { class: 'small muted' }, 'Auf eine Rolle tippen, um sie zu vergeben oder wieder zu entfernen. Mehrere Rollen pro Person sind möglich.'),
          this.peopleBox),
        el('section', { class: 'card' },
          el('h3', {}, 'Rollen & Farben'),
          el('p', { class: 'small muted' }, 'Die Farbe erscheint im Dienstplan, im Chat und bei den Namen. „Einsatzdienst“ wird automatisch dem zugeordnet, der laut Dienstplan gerade im Dienst ist – oder fest über die Rollen-Zuweisung oben.'),
          this.rolesBox));
      this.update();
    },

    update() {
      if (!this.root || !this.root.isConnected || !App.isAdmin()) return;
      this.renderRolePick();
      this.renderPeople();
      this.renderRoles();
    },

    /* ---------- Neue Person ---------- */
    buildCreate() {
      this.email = el('input', { class: 'input', type: 'email', placeholder: 'name@beispiel.de', autocomplete: 'off' });
      this.pw = el('input', { class: 'input', type: 'text', placeholder: 'Startpasswort (mind. 8 Zeichen)', autocomplete: 'off' });
      this.rolePick = el('div', { class: 'chips' });
      const btn = el('button', { class: 'btn primary', type: 'button', onclick: () => this.create(btn) }, icon('plus', 18), 'Person anlegen');
      return el('section', { class: 'card' },
        el('h3', {}, 'Neue Person anlegen'),
        el('p', { class: 'small muted' }, 'Die Person meldet sich mit E-Mail und Startpasswort an und legt beim ersten Login ihren Anzeigenamen fest.'),
        el('div', { class: 'stack' },
          el('label', { class: 'field' }, 'E-Mail', this.email),
          el('label', { class: 'field' }, 'Startpasswort', this.pw),
          el('div', { class: 'field' }, 'Rollen', this.rolePick),
          el('div', { class: 'row end' }, btn)));
    },

    renderRolePick() {
      this.rolePick.replaceChildren(...S.roles.map((r) => {
        const on = this.newRoles.has(r.name);
        return el('button', {
          type: 'button', class: 'chip-btn' + (on ? ' on' : ''),
          style: on ? { background: r.color, color: App.contrast(r.color), borderColor: r.color } : { borderColor: r.color },
          onclick: () => { on ? this.newRoles.delete(r.name) : this.newRoles.add(r.name); this.renderRolePick(); },
        }, r.name);
      }));
    },

    create(btn) {
      const email = this.email.value.trim();
      const password = this.pw.value;
      if (!email) return App.toast('Bitte eine E-Mail angeben.', 'err');
      if (password.length < 8) return App.toast('Das Passwort braucht mindestens 8 Zeichen.', 'err');
      btn.disabled = true;
      App.guard(async () => {
        await App.adminCall({ action: 'create', email, password, roles: [...this.newRoles] });
        App.toast(`${email} wurde angelegt.`, 'ok');
        this.email.value = ''; this.pw.value = ''; this.newRoles.clear();
        await Promise.all([App.load.profiles(), App.load.profileRoles()]);
        this.update();
      }).finally(() => { btn.disabled = false; });
    },

    /* ---------- Personenliste ---------- */
    renderPeople() {
      this.peopleBox.replaceChildren(...S.profiles.map((p) => {
        const mine = new Set(App.realRoles(p.id).map((r) => r.id));
        const isMe = p.id === S.me.id;
        return el('div', { class: 'person' },
          el('div', { class: 'between wrap' },
            el('div', {},
              el('strong', {}, p.display_name || 'Noch kein Anzeigename'), isMe ? el('span', { class: 'small muted' }, ' (du)') : null,
              el('div', { class: 'small muted' }, p.email || '')),
            el('div', { class: 'row tight' },
              el('button', { class: 'btn small ghost', type: 'button', onclick: () => this.setPassword(p) }, icon('key', 16), 'Passwort'),
              isMe ? null : el('button', { class: 'btn small ghost danger-text', type: 'button', onclick: () => this.remove(p) }, icon('trash', 16), 'Entfernen'))),
          el('div', { class: 'chips' }, S.roles.map((r) => {
            const on = mine.has(r.id);
            return el('button', {
              type: 'button', class: 'chip-btn' + (on ? ' on' : ''),
              style: on ? { background: r.color, color: App.contrast(r.color), borderColor: r.color } : { borderColor: r.color },
              'aria-pressed': on ? 'true' : 'false',
              onclick: () => this.toggleRole(p, r, on),
            }, r.name);
          })));
      }));
    },

    async toggleRole(p, role, on) {
      if (on && role.name === 'Admin' && p.id === S.me.id) {
        App.toast('Du kannst dir die Admin-Rolle nicht selbst entziehen.', 'err');
        return;
      }
      App.guard(async () => {
        if (on) {
          const { error } = await App.sb.from('profile_roles').delete().eq('profile_id', p.id).eq('role_id', role.id);
          if (error) throw error;
        } else {
          const { error } = await App.sb.from('profile_roles').insert({ profile_id: p.id, role_id: role.id });
          if (error) throw error;
        }
        await App.load.profileRoles();
        this.update();
      });
    },

    async setPassword(p) {
      const pw = await App.prompt(`Neues Passwort für ${App.name(p)} (mind. 8 Zeichen):`, { title: 'Passwort setzen', ok: 'Setzen' });
      if (pw == null) return;
      if (pw.length < 8) return App.toast('Das Passwort braucht mindestens 8 Zeichen.', 'err');
      App.guard(async () => {
        await App.adminCall({ action: 'setPassword', id: p.id, password: pw });
        App.toast('Passwort geändert.', 'ok');
      });
    },

    async remove(p) {
      const ok = await App.confirm(
        `${App.name(p)} (${p.email || ''}) wird samt Dienstplan-Einträgen, Notizen und Nachrichten endgültig entfernt.`,
        { ok: 'Entfernen', danger: true, title: 'Person entfernen?' });
      if (!ok) return;
      App.guard(async () => {
        await App.adminCall({ action: 'delete', id: p.id });
        App.toast('Person entfernt.', 'ok');
        await Promise.all([App.load.profiles(), App.load.profileRoles(), App.load.chat(), App.load.notes()]);
        await App.load.edWindow();
        this.update();
      });
    },

    /* ---------- Rollenfarben ---------- */
    renderRoles() {
      // Farbfelder nicht neu aufbauen, solange eines gerade benutzt wird
      if (this.rolesBox.contains(document.activeElement) && document.activeElement.type === 'color') return;
      this.rolesBox.replaceChildren(...S.roles.map((r) => {
        const input = el('input', { type: 'color', value: r.color, 'aria-label': 'Farbe für ' + r.name });
        let t;
        input.addEventListener('input', () => { swatch.style.background = input.value; swatch.style.color = App.contrast(input.value); });
        input.addEventListener('change', () => {
          clearTimeout(t);
          t = setTimeout(() => App.guard(async () => {
            const { error } = await App.sb.from('roles').update({ color: input.value }).eq('id', r.id);
            if (error) throw error;
            await App.load.roles();
            App.toast(`Farbe für ${r.name} gespeichert.`, 'ok', 1800);
          }), 200);
        });
        const swatch = el('span', { class: 'chip', style: { background: r.color, color: App.contrast(r.color) } }, r.name);
        return el('label', { class: 'role-color' }, swatch, input);
      }));
    },
  });
})();
