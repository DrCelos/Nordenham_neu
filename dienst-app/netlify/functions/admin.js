// Netlify Function: Verwaltungsaktionen, die den Supabase-Service-Key brauchen
// (Person anlegen, entfernen, Passwort setzen). Nur für Admins aufrufbar.
//
// Benötigte Umgebungsvariablen (Netlify -> Site configuration -> Environment variables):
//   SUPABASE_URL                z. B. https://abcdxyz.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   Supabase -> Project Settings -> API -> service_role (GEHEIM!)

const { createClient } = require('@supabase/supabase-js');

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Nur POST erlaubt.' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return json(500, { error: 'Server nicht konfiguriert: SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY fehlen in Netlify.' });
  }

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1) Aufrufer prüfen
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Nicht angemeldet.' });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData || !userData.user) return json(401, { error: 'Sitzung ungültig. Bitte neu anmelden.' });
  const callerId = userData.user.id;

  // 2) Admin-Rolle prüfen
  const { data: adminRole } = await admin.from('roles').select('id').eq('name', 'Admin').maybeSingle();
  if (!adminRole) return json(500, { error: 'Rolle "Admin" fehlt in der Datenbank.' });
  const { data: has } = await admin
    .from('profile_roles').select('role_id')
    .eq('profile_id', callerId).eq('role_id', adminRole.id);
  if (!has || !has.length) return json(403, { error: 'Nur Admins dürfen das.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Ungültige Anfrage.' }); }

  try {
    switch (body.action) {
      case 'create': {
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'Ungültige E-Mail-Adresse.' });
        if (password.length < 8) return json(400, { error: 'Das Passwort muss mindestens 8 Zeichen haben.' });

        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) {
          const msg = /already|registered|exists/i.test(error.message) ? 'Diese E-Mail ist bereits vergeben.' : error.message;
          return json(400, { error: msg });
        }
        const newId = data.user.id;

        const names = Array.isArray(body.roles) ? body.roles : [];
        if (names.length) {
          const { data: roleRows } = await admin.from('roles').select('id,name').in('name', names);
          const rows = (roleRows || []).map((r) => ({ profile_id: newId, role_id: r.id }));
          if (rows.length) await admin.from('profile_roles').insert(rows);
        }
        return json(200, { ok: true, id: newId });
      }

      case 'delete': {
        const id = String(body.id || '');
        if (!id) return json(400, { error: 'Person fehlt.' });
        if (id === callerId) return json(400, { error: 'Du kannst dich nicht selbst entfernen.' });
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) return json(400, { error: error.message });
        return json(200, { ok: true });
      }

      case 'setPassword': {
        const id = String(body.id || '');
        const password = String(body.password || '');
        if (!id) return json(400, { error: 'Person fehlt.' });
        if (password.length < 8) return json(400, { error: 'Das Passwort muss mindestens 8 Zeichen haben.' });
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) return json(400, { error: error.message });
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: 'Unbekannte Aktion.' });
    }
  } catch (e) {
    return json(500, { error: 'Serverfehler: ' + (e && e.message ? e.message : e) });
  }
};
