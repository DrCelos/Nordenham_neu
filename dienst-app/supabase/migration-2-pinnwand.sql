-- =====================================================================
--  Update 2: bewegliche Pinnwand
--  Für eine BESTEHENDE Datenbank: einmal im Supabase SQL-Editor ausführen.
--  (Wer schema.sql neu einspielt, braucht diese Datei nicht – sie ist dort schon enthalten.)
-- =====================================================================

alter table public.notes
  add column if not exists pos_x    real,          -- Position von links in Prozent der Pinnwand-Breite
  add column if not exists pos_y    real,          -- Position von oben in Pixel
  add column if not exists moved_at timestamptz;   -- zuletzt bewegte Notiz liegt oben

-- Öffentliche Zettel dürfen alle verschieben, private nur der Besitzer.
-- (Per Funktion, damit andere nur die Position ändern können, nicht den Text.)
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

-- Einsatzdienst-Korrektur (falls noch nicht ausgeführt): jede Dienst-Schicht zählt als Einsatzdienst
update public.shifts set is_ed = true where status = 'dienst';
