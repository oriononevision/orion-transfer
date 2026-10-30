-- Onboarding code : photo de couverture + préférences IDE

drop function if exists transfer.code_create_project(text, text, text, text);

alter table transfer.code_projects
  add column if not exists cover_image text
    check (cover_image is null or char_length(cover_image) <= 600000),
  add column if not exists ide_links jsonb not null default '{}'::jsonb;

create or replace function transfer.code_create_project(
  p_name text,
  p_description text default null,
  p_github_url text default null,
  p_content text default '',
  p_cover_image text default null,
  p_ide_links jsonb default '{}'::jsonb
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
  v_cover text := nullif(btrim(coalesce(p_cover_image, '')), '');
  v_links jsonb := coalesce(p_ide_links, '{}'::jsonb);
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 1 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if v_cover is not null and char_length(v_cover) > 600000 then
    raise exception 'cover_too_large' using errcode = 'P0001';
  end if;
  if v_cover is not null and v_cover !~ '^data:image/(jpeg|png|webp);base64,' then
    raise exception 'invalid_cover' using errcode = 'P0001';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  insert into transfer.code_projects (owner_id, name, description, github_url, cover_image, ide_links)
  values (
    v_uid,
    left(btrim(p_name), 120),
    nullif(left(btrim(coalesce(p_description, '')), 2000), ''),
    nullif(left(btrim(coalesce(p_github_url, '')), 500), ''),
    v_cover,
    jsonb_build_object(
      'vscode', coalesce((v_links->>'vscode')::boolean, false),
      'cursor', coalesce((v_links->>'cursor')::boolean, false),
      'github', coalesce((v_links->>'github')::boolean, false)
    )
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
        p.cover_image,
        p.ide_links,
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
    'cover_image', v_project.cover_image,
    'ide_links', v_project.ide_links,
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

grant execute on function transfer.code_create_project(text, text, text, text, text, jsonb) to authenticated;
