/**
 * Projets de code partagé : éditeur collaboratif léger + invitations.
 */
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase, transferDb } from '../lib/supabase'
import { IS_DEMO, TransferError } from './transfers'

function fail(error: { message?: string } | null | undefined): never {
  throw new TransferError(error?.message?.trim() || 'unknown')
}

export type IdeLinks = {
  vscode?: boolean
  cursor?: boolean
  github?: boolean
}

export type CodeProjectListItem = {
  id: string
  name: string
  description: string | null
  github_url: string | null
  cover_image: string | null
  ide_links: IdeLinks | null
  invite_token: string
  created_at: string
  updated_at: string
  role: 'owner' | 'member'
  last_seen_revision_id: string | null
  latest_revision_id: string | null
  latest_at: string | null
  latest_author: string | null
  member_count: number
}

export type CodeMember = {
  user_id: string
  email: string
  role: 'owner' | 'member'
  joined_at: string
  last_seen_revision_id: string | null
}

export type CodeRevision = {
  id: string
  content: string
  message: string | null
  author_id: string
  created_at: string
  author: string | null
}

export type CodeProjectDetail = {
  id: string
  name: string
  description: string | null
  github_url: string | null
  cover_image: string | null
  ide_links: IdeLinks | null
  invite_token: string
  role: 'owner' | 'member'
  last_seen_revision_id: string | null
  latest_revision: CodeRevision | null
  members: CodeMember[]
  is_outdated: boolean
}

const demoProjects = new Map<string, CodeProjectDetail & { invite_token: string }>()

function demoSeed(): void {
  if (demoProjects.size > 0) return
  const id = 'demo-code-0001'
  const revId = 'demo-rev-0001'
  demoProjects.set(id, {
    id,
    name: 'Démo partagée',
    description: 'Exemple de projet code (mode démo).',
    github_url: null,
    cover_image: null,
    ide_links: { vscode: true, cursor: true, github: false },
    invite_token: 'demo-invite-token',
    role: 'owner',
    last_seen_revision_id: revId,
    latest_revision: {
      id: revId,
      content: '// Bienvenue dans le code partagé ORION Transfer\nconsole.log("hello");\n',
      message: 'Création du projet',
      author_id: 'demo',
      created_at: new Date().toISOString(),
      author: 'Alex Martin',
    },
    members: [
      {
        user_id: 'demo',
        email: 'alex@orion.dev',
        role: 'owner',
        joined_at: new Date().toISOString(),
        last_seen_revision_id: revId,
      },
    ],
    is_outdated: false,
  })
}

export async function listCodeProjects(): Promise<CodeProjectListItem[]> {
  if (IS_DEMO) {
    demoSeed()
    return [...demoProjects.values()].map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      github_url: p.github_url,
      cover_image: p.cover_image,
      ide_links: p.ide_links,
      invite_token: p.invite_token,
      created_at: p.latest_revision?.created_at ?? new Date().toISOString(),
      updated_at: p.latest_revision?.created_at ?? new Date().toISOString(),
      role: p.role,
      last_seen_revision_id: p.last_seen_revision_id,
      latest_revision_id: p.latest_revision?.id ?? null,
      latest_at: p.latest_revision?.created_at ?? null,
      latest_author: p.latest_revision?.author ?? null,
      member_count: p.members.length,
    }))
  }
  const { data, error } = await transferDb.rpc('code_list_projects')
  if (error) fail(error)
  return (data ?? []) as CodeProjectListItem[]
}

export async function createCodeProject(input: {
  name: string
  description?: string
  githubUrl?: string
  content?: string
  coverImage?: string
  ideLinks?: IdeLinks
}): Promise<{ id: string; invite_token: string }> {
  if (IS_DEMO) {
    demoSeed()
    const id = `demo-code-${Date.now()}`
    const revId = `demo-rev-${Date.now()}`
    demoProjects.set(id, {
      id,
      name: input.name,
      description: input.description ?? null,
      github_url: input.githubUrl ?? null,
      cover_image: input.coverImage ?? null,
      ide_links: input.ideLinks ?? { vscode: true, cursor: true, github: false },
      invite_token: `demo-${id}`,
      role: 'owner',
      last_seen_revision_id: revId,
      latest_revision: {
        id: revId,
        content: input.content ?? '',
        message: 'Création du projet',
        author_id: 'demo',
        created_at: new Date().toISOString(),
        author: 'Vous',
      },
      members: [
        {
          user_id: 'demo',
          email: 'alex@orion.dev',
          role: 'owner',
          joined_at: new Date().toISOString(),
          last_seen_revision_id: revId,
        },
      ],
      is_outdated: false,
    })
    return { id, invite_token: `demo-${id}` }
  }
  const { data, error } = await transferDb.rpc('code_create_project', {
    p_name: input.name,
    p_description: input.description ?? null,
    p_github_url: input.githubUrl ?? null,
    p_content: input.content ?? '',
    p_cover_image: input.coverImage ?? null,
    p_ide_links: input.ideLinks ?? {},
  })
  if (error) fail(error)
  const row = data as { id: string; invite_token: string }
  return { id: row.id, invite_token: row.invite_token }
}

export async function getCodeProject(id: string): Promise<CodeProjectDetail> {
  if (IS_DEMO) {
    demoSeed()
    const p = demoProjects.get(id)
    if (!p) fail({ message: 'not_found' })
    return p
  }
  const { data, error } = await transferDb.rpc('code_get_project', { p_project_id: id })
  if (error) fail(error)
  return data as CodeProjectDetail
}

export async function pushCodeRevision(
  projectId: string,
  content: string,
  message?: string,
): Promise<{ id: string; created_at: string }> {
  if (IS_DEMO) {
    demoSeed()
    const p = demoProjects.get(projectId)
    if (!p) fail({ message: 'not_found' })
    const revId = `demo-rev-${Date.now()}`
    p.latest_revision = {
      id: revId,
      content,
      message: message ?? null,
      author_id: 'demo',
      created_at: new Date().toISOString(),
      author: 'Vous',
    }
    p.last_seen_revision_id = revId
    p.is_outdated = false
    return { id: revId, created_at: p.latest_revision.created_at }
  }
  const { data, error } = await transferDb.rpc('code_push_revision', {
    p_project_id: projectId,
    p_content: content,
    p_message: message ?? null,
  })
  if (error) fail(error)
  return data as { id: string; created_at: string }
}

export async function markCodeSeen(projectId: string, revisionId: string): Promise<void> {
  if (IS_DEMO) {
    const p = demoProjects.get(projectId)
    if (p) {
      p.last_seen_revision_id = revisionId
      p.is_outdated = false
    }
    return
  }
  const { error } = await transferDb.rpc('code_mark_seen', {
    p_project_id: projectId,
    p_revision_id: revisionId,
  })
  if (error) fail(error)
}

export async function joinCodeByToken(token: string): Promise<{ project_id: string; name: string }> {
  if (IS_DEMO) {
    demoSeed()
    const found = [...demoProjects.values()].find((p) => p.invite_token === token)
    if (!found) fail({ message: 'not_found' })
    return { project_id: found.id, name: found.name }
  }
  const { data, error } = await transferDb.rpc('code_join_by_token', { p_token: token })
  if (error) fail(error)
  return data as { project_id: string; name: string }
}

/** Invite par e-mail : RPC + e-mail via fonction serveur. */
export async function inviteCodeByEmail(
  projectId: string,
  email: string,
): Promise<{ shareUrl: string }> {
  if (IS_DEMO) {
    return { shareUrl: `${window.location.origin}/#/code/rejoindre/demo-invite-token` }
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) fail({ message: 'not_authenticated' })

  const { data, error } = await supabase.functions.invoke('code-invite', {
    body: { project_id: projectId, email },
  })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { error?: string }
        fail({ message: body.error || 'unknown' })
      } catch {
        fail({ message: 'unknown' })
      }
    }
    fail({ message: error.message || 'unknown' })
  }
  const shareUrl = (data as { share_url?: string })?.share_url
  if (!shareUrl) fail({ message: 'unknown' })
  return { shareUrl }
}

export function projectShareUrl(inviteToken: string): string {
  const base = window.location.origin
  if (IS_DEMO) return `${base}/#/code/rejoindre/${inviteToken}`
  return `${base}/code/rejoindre/${inviteToken}`
}
