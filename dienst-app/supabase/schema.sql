-- =====================================================================
--  Dienst-App – Supabase Schema
--  Im Supabase Dashboard unter "SQL Editor" -> "New query" komplett
--  einfügen und einmal ausführen.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Rollen (Farben sind vom Admin änderbar)
-- ---------------------------------------------------------------------
create table public.roles (
  id    uuid primary key default gen_random_uuid(),
  name  text unique not null,
  color text not null default '#64748b',
  sort  int  not null default 0
);

insert into public.roles (name, color, sort) values
  ('Admin',         '#7c3aed', 1),
  ('Einsatzdienst', '#dc2626', 2),
  ('Springer',      '#2563eb', 3),
  ('Lager',         '#d97706', 4),
  ('FSJ',           '#059669', 5),
  ('Ehrenamt',      '#db2777', 6);

-- ---------------------------------------------------------------------
-- Profile (1:1 zu auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text,
  display_name     text,
  material_seen_at timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

-- Rollen je Person (mehrfach möglich)
create table public.profile_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id    uuid not null references public.roles(id)    on delete cascade,
  primary key (profile_id, role_id)
);

-- ---------------------------------------------------------------------
-- Dienstplan
-- ---------------------------------------------------------------------
create table public.shifts (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  status     text not null check (status in ('dienst','frei')),
  code       text,                 -- S8, S10, NACHT, EDT, EDN, ED24, ZEIT
  start_at   timestamptz,
  end_at     timestamptz,
  is_ed      boolean not null default false,   -- zählt als Einsatzdienst
  updated_at timestamptz not null default now(),
  unique (profile_id, day)
);
create index shifts_day_idx on public.shifts (day);
create index shifts_ed_idx  on public.shifts (is_ed, start_at, end_at);

-- ---------------------------------------------------------------------
-- Pinnwand (gemeinsam) inkl. privater, nur für den Ersteller sichtbarer Notizen
-- ---------------------------------------------------------------------
create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (length(body) between 1 and 2000),
  is_private boolean not null default false,
  pos_x      real,                 -- Position von links in Prozent der Pinnwand-Breite
  pos_y      real,                 -- Position von oben in Pixel
  moved_at   timestamptz,          -- zuletzt bewegte Notiz liegt oben
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Notizen & Aufgaben für die Rolle Einsatzdienst
-- ---------------------------------------------------------------------
create table public.ed_items (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('note','task')),
  body       text not null check (length(body) between 1 and 500),
  done       boolean not null default false,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Chat (recipient_id = NULL -> Gruppenchat)
-- ---------------------------------------------------------------------
create table public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,
  body         text not null check (length(body) between 1 and 4000),
  created_at   timestamptz not null default now()
);
create index chat_created_idx on public.chat_messages (created_at);

-- ---------------------------------------------------------------------
-- Material
-- ---------------------------------------------------------------------
create table public.material_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 200),
  quantity   int  not null check (quantity > 0),
  reason     text not null check (reason in ('verbraucht','abgelaufen')),
  note       text,
  done       boolean not null default false,
  done_at    timestamptz,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Hilfsfunktionen
-- =====================================================================
create or replace function public.has_role(role_name text, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profile_roles pr
    join public.roles r on r.id = pr.role_id
    where pr.profile_id = uid and r.name = role_name
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('Admin', auth.uid());
$$;

-- Hat die Person aktuell die Rolle Einsatzdienst?
--  1) fest zugeordnet, oder
--  2) laut Dienstplan gerade im Einsatzdienst, oder
--  3) niemand ist gerade im Einsatzdienst -> der Nächste im Plan
create or replace function public.is_ed(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.has_role('Einsatzdienst', uid)
    or exists (
      select 1 from public.shifts s
      where s.profile_id = uid and s.status = 'dienst' and s.is_ed
        and s.start_at <= now() and s.end_at > now()
    )
    or (
      not exists (
        select 1 from public.shifts s
        where s.status = 'dienst' and s.is_ed
          and s.start_at <= now() and s.end_at > now()
      )
      and exists (
        select 1 from public.shifts s
        where s.profile_id = uid and s.status = 'dienst' and s.is_ed
          and s.start_at = (
            select min(x.start_at) from public.shifts x
            where x.status = 'dienst' and x.is_ed and x.start_at > now()
          )
      )
    );
$$;

-- Neues Auth-Konto -> Profil anlegen; das allererste Konto wird Admin
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  if (select count(*) from public.profiles) = 1 then
    insert into public.profile_roles (profile_id, role_id)
    select new.id, id from public.roles where name = 'Admin';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.roles          enable row level security;
alter table public.profiles       enable row level security;
alter table public.profile_roles  enable row level security;
alter table public.shifts         enable row level security;
alter table public.notes          enable row level security;
alter table public.ed_items       enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.material_items enable row level security;

-- roles
create policy roles_read   on public.roles for select to authenticated using (true);
create policy roles_update on public.roles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- profiles
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- profile_roles
create policy pr_read   on public.profile_roles for select to authenticated using (true);
create policy pr_insert on public.profile_roles for insert to authenticated with check (public.is_admin());
create policy pr_delete on public.profile_roles for delete to authenticated using (public.is_admin());

-- shifts: alle sehen alles, bearbeiten nur eigene (Admin: alle)
create policy shifts_read   on public.shifts for select to authenticated using (true);
create policy shifts_insert on public.shifts for insert to authenticated
  with check (profile_id = auth.uid() or public.is_admin());
create policy shifts_update on public.shifts for update to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());
create policy shifts_delete on public.shifts for delete to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- notes: private Notizen sind für andere unsichtbar (auch für Admins)
create policy notes_read   on public.notes for select to authenticated
  using (not is_private or owner_id = auth.uid());
create policy notes_insert on public.notes for insert to authenticated
  with check (owner_id = auth.uid());
create policy notes_update on public.notes for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy notes_delete on public.notes for delete to authenticated
  using (owner_id = auth.uid() or (public.is_admin() and not is_private));

-- Position einer Notiz ändern: öffentliche Zettel alle, private nur der Besitzer
create or replace function public.move_note(note_id uuid, x real, y real)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notes
     set pos_x = x, pos_y = y, moved_at = now()
   where id = note_id
     and (not is_private or owner_id = auth.uid());
end;
$$;
revoke all on function public.move_note(uuid, real, real) from public, anon;
grant execute on function public.move_note(uuid, real, real) to authenticated;

-- ed_items: nur wer gerade die Rolle Einsatzdienst hat
create policy ed_all on public.ed_items for all to authenticated
  using (public.is_ed(auth.uid())) with check (public.is_ed(auth.uid()));

-- chat: Gruppenchat für alle, Direktnachrichten nur für die beiden Beteiligten
create policy chat_read on public.chat_messages for select to authenticated
  using (recipient_id is null or sender_id = auth.uid() or recipient_id = auth.uid());
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (sender_id = auth.uid());
create policy chat_delete on public.chat_messages for delete to authenticated
  using (sender_id = auth.uid());

-- material: alle dürfen eintragen, Liste sehen nur Lager/Admin (sonst nur eigene Einträge)
create policy mat_read on public.material_items for select to authenticated
  using (public.has_role('Lager') or public.is_admin() or created_by = auth.uid());
create policy mat_insert on public.material_items for insert to authenticated
  with check (created_by = auth.uid());
create policy mat_update on public.material_items for update to authenticated
  using (public.has_role('Lager') or public.is_admin())
  with check (public.has_role('Lager') or public.is_admin());
create policy mat_delete on public.material_items for delete to authenticated
  using (public.has_role('Lager') or public.is_admin());

-- =====================================================================
-- Realtime (Chat, Hinweispunkt, Dienstplan usw. live)
-- =====================================================================
alter publication supabase_realtime add table
  public.chat_messages, public.notes, public.ed_items, public.shifts,
  public.material_items, public.profiles, public.profile_roles, public.roles;
