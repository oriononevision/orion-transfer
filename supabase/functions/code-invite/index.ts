/**
 * Invite un membre à un projet de code partagé (RPC + e-mail Resend).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { AppError } from '../_shared/deps.ts'
import { bearer, corsHeaders, errorResponse, json, readJson } from '../_shared/http.ts'
import { codeInviteMail } from '../_shared/mailTemplate.ts'
import { prodDeps } from '../_shared/prod.ts'

Deno.serve(async (req) => {
  const deps = prodDeps()
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req, deps.config) })
  if (req.method !== 'POST') return json(req, deps.config, { error: 'invalid_request' }, 405)

  try {
    const token = bearer(req)
    if (!token) throw new AppError('not_authenticated', 401)

    const userId = await deps.db.userIdFromToken(token)
    if (!userId) throw new AppError('not_authenticated', 401)

    const body = await readJson(req)
    const projectId = typeof body.project_id === 'string' ? body.project_id : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!projectId || !email) throw new AppError('invalid_request')

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data, error } = await userClient.schema('transfer').rpc('code_invite_email', {
      p_project_id: projectId,
      p_email: email,
    })
    if (error) throw new AppError(error.message || 'unknown', 400)

    const invite = data as {
      token: string
      email: string
      project_name: string
      share_token: string
    }

    const sender = await deps.db.senderInfo(userId)
    const joinUrl = new URL('/connexion', deps.config.appUrl)
    joinUrl.searchParams.set('invite', '1')
    joinUrl.searchParams.set('email', invite.email)
    joinUrl.searchParams.set('next', `/code/rejoindre/${invite.token}`)

    try {
      await deps.mailer.send(
        codeInviteMail({
          to: invite.email,
          senderName: sender.name,
          senderEmail: sender.email,
          projectName: invite.project_name,
          joinUrl: joinUrl.toString(),
        }),
      )
    } catch (err) {
      deps.log?.('e-mail code non envoyé', { error: err instanceof Error ? err.message : String(err) })
    }

    const shareUrl = new URL(`/code/rejoindre/${invite.share_token}`, deps.config.appUrl).toString()
    return json(req, deps.config, {
      ok: true,
      share_url: shareUrl,
      invite_token: invite.token,
    })
  } catch (err) {
    return errorResponse(req, deps.config, err, deps.log)
  }
})
