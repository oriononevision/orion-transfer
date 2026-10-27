-- Recherche de membres ORION (profils) pour le destinataire « membre ».
-- Réservé aux utilisateurs connectés ; n’expose que id / e-mail / nom.

create or replace function transfer.search_members(p_query text default '', p_limit integer default 12)
returns table (id uuid, email text, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select nullif(lower(btrim(coalesce(p_query, ''))), '') as term,
           least(greatest(coalesce(p_limit, 12), 1), 20) as lim
  )
  select
    p.id,
    p.email,
    nullif(trim(both from concat_ws(' ', p.first_name, p.last_name)), '') as display_name
  from public.profiles p
  cross join q
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.email is not null
    and btrim(p.email) <> ''
    and (
      q.term is null
      or p.email ilike '%' || q.term || '%'
      or coalesce(p.first_name, '') ilike '%' || q.term || '%'
      or coalesce(p.last_name, '') ilike '%' || q.term || '%'
      or coalesce(p.org_name, '') ilike '%' || q.term || '%'
    )
  order by
    case when q.term is not null and p.email ilike q.term || '%' then 0 else 1 end,
    p.email
  limit (select lim from q);
$$;

revoke all on function transfer.search_members(text, integer) from public;
grant execute on function transfer.search_members(text, integer) to authenticated;
grant execute on function transfer.search_members(text, integer) to service_role;

comment on function transfer.search_members is
  'Liste des membres ORION (profils) pour choisir un destinataire Transfer.';
