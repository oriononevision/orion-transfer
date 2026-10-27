-- Remplace search_members (fuite de tous les profils ORION) par une suggestion
-- limitée aux personnes déjà croisées via un transfert + saisie e-mail exacte côté UI.

drop function if exists transfer.search_members(text, integer);

create or replace function transfer.search_contacts(p_query text default '', p_limit integer default 12)
returns table (id uuid, email text, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select
      auth.uid() as uid,
      lower((select u.email from auth.users u where u.id = auth.uid())) as my_email
  ),
  prior as (
    -- Destinataires de mes envois
    select
      lower(r.email) as email,
      r.user_id,
      max(t.created_at) as last_at
    from transfer.recipients r
    join transfer.transfers t on t.id = r.transfer_id
    cross join me
    where me.uid is not null
      and t.sender_id = me.uid
      and r.email is not null
      and btrim(r.email) <> ''
      and lower(r.email) is distinct from me.my_email
    group by lower(r.email), r.user_id

    union all

    -- Expéditeurs de transferts que j’ai reçus
    select
      lower(su.email) as email,
      t.sender_id as user_id,
      max(t.created_at) as last_at
    from transfer.recipients r
    join transfer.transfers t on t.id = r.transfer_id
    join auth.users su on su.id = t.sender_id
    cross join me
    where me.uid is not null
      and (
        r.user_id = me.uid
        or lower(r.email) = me.my_email
      )
      and su.email is not null
      and lower(su.email) is distinct from me.my_email
    group by lower(su.email), t.sender_id
  ),
  contacts as (
    select
      p.email,
      -- Un même e-mail peut apparaître plusieurs fois (union) : on garde le plus récent
      (array_agg(p.user_id order by p.last_at desc nulls last))[1] as user_id,
      max(p.last_at) as last_at
    from prior p
    group by p.email
  ),
  q as (
    select
      nullif(lower(btrim(coalesce(p_query, ''))), '') as term,
      least(greatest(coalesce(p_limit, 12), 1), 20) as lim
  )
  select
    coalesce(c.user_id, pr.id) as id,
    c.email,
    nullif(trim(both from concat_ws(' ', pr.first_name, pr.last_name)), '') as display_name
  from contacts c
  cross join q
  left join public.profiles pr
    on pr.id = c.user_id
    or lower(pr.email) = c.email
  where (select uid from me) is not null
    and (
      q.term is null
      or c.email ilike '%' || q.term || '%'
      or coalesce(pr.first_name, '') ilike '%' || q.term || '%'
      or coalesce(pr.last_name, '') ilike '%' || q.term || '%'
    )
  order by
    c.last_at desc nulls last,
    c.email
  limit (select lim from q);
$$;

revoke all on function transfer.search_contacts(text, integer) from public;
grant execute on function transfer.search_contacts(text, integer) to authenticated;
grant execute on function transfer.search_contacts(text, integer) to service_role;

comment on function transfer.search_contacts is
  'Suggestions de destinataires : uniquement des e-mails déjà croisés via un transfert.';
