-- Projets code partagés (éditeur + invites e-mail / lien)

create table if not exists transfer.code_projects (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  description   text check (description is null or char_length(description) <= 2000),
  github_url    text check (github_url is null or char_length(github_url) <= 500),
  invite_token  text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists transfer.code_members (
  project_id              uuid not null references transfer.code_projects (id) on delete cascade,
  user_id                 uuid not null references auth.users (id) on delete cascade,
  email                   text not null,
  role                    text not null check (role in ('owner', 'member')),
  last_seen_revision_id   uuid,
  joined_at               timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists transfer.code_revisions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references transfer.code_projects (id) on delete cascade,
  author_id   uuid not null references auth.users (id) on delete cascade,
  content     text not null default '',
  message     text check (message is null or char_length(message) <= 500),
  created_at  timestamptz not null default now()
);

create index if not exists code_revisions_project_created_idx
  on transfer.code_revisions (project_id, created_at desc);

create table if not exists transfer.code_invites (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references transfer.code_projects (id) on delete cascade,
  email        text not null,
  token        text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz
);

create index if not exists code_invites_project_email_idx
  on transfer.code_invites (project_id, lower(email));

alter table transfer.code_projects enable row level security;
alter table transfer.code_members enable row level security;
alter table transfer.code_revisions enable row level security;
alter table transfer.code_invites enable row level security;

-- Lecture seule via RLS pour les membres ; écritures via fonctions security definer.
create policy code_projects_select on transfer.code_projects
  for select to authenticated
  using (
    exists (
      select 1 from transfer.code_members m
      where m.project_id = id and m.user_id = auth.uid()
    )
  );

create policy code_members_select on transfer.code_members
  for select to authenticated
  using (
    exists (
      select 1 from transfer.code_members m
      where m.project_id = code_members.project_id and m.user_id = auth.uid()
    )
  );

create policy code_revisions_select on transfer.code_revisions
  for select to authenticated
  using (
    exists (
      select 1 from transfer.code_members m
      where m.project_id = code_revisions.project_id and m.user_id = auth.uid()
    )
  );

revoke all on transfer.code_projects from public, anon;
revoke all on transfer.code_members from public, anon;
revoke all on transfer.code_revisions from public, anon;
revoke all on transfer.code_invites from public, anon;
grant select on transfer.code_projects to authenticated;
grant select on transfer.code_members to authenticated;
grant select on transfer.code_revisions to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function transfer.code_list_projects()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc)
    from (
      select
        p.id,
        p.name,
        p.description,
        p.github_url,
        p.invite_token,
        p.created_at,
        p.updated_at,
        m.role,
        m.last_seen_revision_id,
        (
          select r.id
          from transfer.code_revisions r
          where r.project_id = p.id
          order by r.created_at desc
          limit 1
        ) as latest_revision_id,
        (
          select r.created_at
          from transfer.code_revisions r
          where r.project_id = p.id
          order by r.created_at desc
          limit 1
        ) as latest_at,
        (
          select coalesce(
            nullif(btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
            u.email
          )
          from transfer.code_revisions r
          join auth.users u on u.id = r.author_id
          left join public.profiles pr on pr.id = r.author_id
          where r.project_id = p.id
          order by r.created_at desc
          limit 1
        ) as latest_author,
        (
          select count(*)::int from transfer.code_members cm where cm.project_id = p.id
        ) as member_count
      from transfer.code_projects p
      join transfer.code_members m on m.project_id = p.id and m.user_id = v_uid
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function transfer.code_create_project(
  p_name text,
  p_description text default null,
  p_github_url text default null,
  p_content text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_project transfer.code_projects%rowtype;
  v_rev transfer.code_revisions%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 1 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  insert into transfer.code_projects (owner_id, name, description, github_url)
  values (
    v_uid,
    left(btrim(p_name), 120),
    nullif(left(btrim(coalesce(p_description, '')), 2000), ''),
    nullif(left(btrim(coalesce(p_github_url, '')), 500), '')
  )
  returning * into v_project;

  insert into transfer.code_members (project_id, user_id, email, role)
  values (v_project.id, v_uid, lower(v_email), 'owner');

  insert into transfer.code_revisions (project_id, author_id, content, message)
  values (v_project.id, v_uid, coalesce(p_content, ''), 'Création du projet')
  returning * into v_rev;

  update transfer.code_members
  set last_seen_revision_id = v_rev.id
  where project_id = v_project.id and user_id = v_uid;

  return jsonb_build_object(
    'id', v_project.id,
    'name', v_project.name,
    'invite_token', v_project.invite_token,
    'revision_id', v_rev.id
  );
end;
$$;

create or replace function transfer.code_get_project(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member transfer.code_members%rowtype;
  v_project transfer.code_projects%rowtype;
  v_latest transfer.code_revisions%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_member from transfer.code_members
  where project_id = p_project_id and user_id = v_uid;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  select * into v_project from transfer.code_projects where id = p_project_id;
  select * into v_latest from transfer.code_revisions
  where project_id = p_project_id
  order by created_at desc
  limit 1;

  return jsonb_build_object(
    'id', v_project.id,
    'name', v_project.name,
    'description', v_project.description,
    'github_url', v_project.github_url,
    'invite_token', v_project.invite_token,
    'role', v_member.role,
    'last_seen_revision_id', v_member.last_seen_revision_id,
    'latest_revision', case when v_latest.id is null then null else jsonb_build_object(
      'id', v_latest.id,
      'content', v_latest.content,
      'message', v_latest.message,
      'author_id', v_latest.author_id,
      'created_at', v_latest.created_at,
      'author', (
        select coalesce(
          nullif(btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
          u.email
        )
        from auth.users u
        left join public.profiles pr on pr.id = u.id
        where u.id = v_latest.author_id
      )
    ) end,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'email', m.email,
        'role', m.role,
        'joined_at', m.joined_at,
        'last_seen_revision_id', m.last_seen_revision_id
      ) order by m.joined_at)
      from transfer.code_members m
      where m.project_id = p_project_id
    ), '[]'::jsonb),
    'is_outdated', (
      v_latest.id is not null
      and v_member.last_seen_revision_id is distinct from v_latest.id
    )
  );
end;
$$;

create or replace function transfer.code_push_revision(
  p_project_id uuid,
  p_content text,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rev transfer.code_revisions%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from transfer.code_members
    where project_id = p_project_id and user_id = v_uid
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_content, '')) > 1500000 then
    raise exception 'content_too_large' using errcode = 'P0001';
  end if;

  insert into transfer.code_revisions (project_id, author_id, content, message)
  values (
    p_project_id,
    v_uid,
    coalesce(p_content, ''),
    nullif(left(btrim(coalesce(p_message, '')), 500), '')
  )
  returning * into v_rev;

  update transfer.code_projects set updated_at = now() where id = p_project_id;
  update transfer.code_members
  set last_seen_revision_id = v_rev.id
  where project_id = p_project_id and user_id = v_uid;

  return jsonb_build_object(
    'id', v_rev.id,
    'created_at', v_rev.created_at,
    'message', v_rev.message
  );
end;
$$;

create or replace function transfer.code_mark_seen(p_project_id uuid, p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  update transfer.code_members
  set last_seen_revision_id = p_revision_id
  where project_id = p_project_id and user_id = auth.uid();
end;
$$;

create or replace function transfer.code_invite_email(p_project_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_invite transfer.code_invites%rowtype;
  v_project transfer.code_projects%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_recipient' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from transfer.code_members
    where project_id = p_project_id and user_id = v_uid
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  select * into v_project from transfer.code_projects where id = p_project_id;

  select * into v_invite from transfer.code_invites
  where project_id = p_project_id and lower(email) = v_email and accepted_at is null
  limit 1;

  if not found then
    insert into transfer.code_invites (project_id, email, invited_by)
    values (p_project_id, v_email, v_uid)
    returning * into v_invite;
  end if;

  return jsonb_build_object(
    'invite_id', v_invite.id,
    'token', v_invite.token,
    'email', v_email,
    'project_id', p_project_id,
    'project_name', v_project.name,
    'share_token', v_project.invite_token
  );
end;
$$;

create or replace function transfer.code_join_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_project transfer.code_projects%rowtype;
  v_invite transfer.code_invites%rowtype;
  v_token text := btrim(coalesce(p_token, ''));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = v_uid;

  -- Lien projet public (invite_token)
  select * into v_project from transfer.code_projects where invite_token = v_token;
  if found then
    insert into transfer.code_members (project_id, user_id, email, role)
    values (v_project.id, v_uid, lower(v_email), 'member')
    on conflict (project_id, user_id) do nothing;
    return jsonb_build_object('project_id', v_project.id, 'name', v_project.name);
  end if;

  -- Invitation e-mail
  select * into v_invite from transfer.code_invites where token = v_token;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  select * into v_project from transfer.code_projects where id = v_invite.project_id;

  insert into transfer.code_members (project_id, user_id, email, role)
  values (v_project.id, v_uid, lower(v_email), 'member')
  on conflict (project_id, user_id) do nothing;

  update transfer.code_invites set accepted_at = now() where id = v_invite.id;

  return jsonb_build_object('project_id', v_project.id, 'name', v_project.name);
end;
$$;

grant execute on function transfer.code_list_projects() to authenticated;
grant execute on function transfer.code_create_project(text, text, text, text) to authenticated;
grant execute on function transfer.code_get_project(uuid) to authenticated;
grant execute on function transfer.code_push_revision(uuid, text, text) to authenticated;
grant execute on function transfer.code_mark_seen(uuid, uuid) to authenticated;
grant execute on function transfer.code_invite_email(uuid, text) to authenticated;
grant execute on function transfer.code_join_by_token(text) to authenticated;
