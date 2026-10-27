-- Limite fichier / envoi : 1 Go (après le passage temporaire à 50 Mo Storage free).
-- Nécessite l'offre Supabase Pro (ou équivalent) pour les uploads > 50 Mo.

create or replace function transfer.limits()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'max_file_bytes',        1073741824,  -- 1 Go
    'max_transfer_bytes',    1073741824,  -- 1 Go
    'max_files',             20,
    'max_recipients',        20,
    'max_active_bytes',      2147483648,  -- 2 Go actifs / utilisateur
    'max_transfers_per_day', 20,
    'expiry_days',           jsonb_build_array(1, 7, 14),
    'default_expiry_days',   7,
    'max_message_chars',     2000
  );
$$;

grant execute on function transfer.limits() to authenticated, service_role;

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'transfer.files'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%size_bytes%'
  loop
    execute format('alter table transfer.files drop constraint %I', r.conname);
  end loop;
end
$$;

alter table transfer.files
  add constraint files_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 1073741824);

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    update storage.buckets
    set file_size_limit = 1073741824
    where id = 'orion-transfer';
  end if;
end $$;
