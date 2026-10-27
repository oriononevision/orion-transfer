import type { Mail } from './deps.ts'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Une ligne, sans retour à la ligne (évite l'injection d'en-têtes dans le sujet). */
function oneLine(value: string, max = 120): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })

/**
 * E-mail d'invitation : il annonce les fichiers et renvoie vers ORION
 * Transfer. Il ne contient JAMAIS de lien de téléchargement direct.
 */
export function invitationMail(input: {
  to: string
  senderName: string | null
  senderEmail: string
  fileCount: number
  message: string | null
  expiresAt: string
  transferId: string
  appUrl: string
}): Mail {
  const sender = oneLine(input.senderName || input.senderEmail, 80)
  const files = input.fileCount >= 2 ? `${input.fileCount} fichiers` : '1 fichier'
  const link = new URL('/connexion', input.appUrl)
  link.searchParams.set('invite', '1')
  link.searchParams.set('email', input.to)
  link.searchParams.set('next', `/t/${input.transferId}`)
  const expiry = dateFormat.format(new Date(input.expiresAt))
  const message = input.message ? input.message.slice(0, 2000) : null

  const subject = oneLine(`${sender} vous a envoyé ${files}`, 150)
  const text = [
    `${sender} (${input.senderEmail}) vous a envoyé ${files} avec ORION Transfer.`,
    message ? `\nMessage :\n${message}\n` : '',
    `Pour les récupérer, ouvrez ce lien et confirmez votre adresse e-mail :`,
    link.toString(),
    `\nIls sont disponibles jusqu'au ${expiry}.`,
    `\nVous ne connaissez pas l'expéditeur ? Ignorez simplement cet e-mail.`,
  ].join('\n')

  const html = `<!doctype html>
<html lang="fr"><body style="margin:0;background:#06080f;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#f4f7fa">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0c101a;border:1px solid #232838;border-radius:16px">
<tr><td style="padding:32px">
<p style="margin:0 0 24px;font-size:13px;letter-spacing:4px;color:#f4f7fa">ORION <span style="color:#f59e0b;letter-spacing:3px">TRANSFER</span></p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#f4f7fa">${escapeHtml(sender)} vous a envoyé ${files}</h1>
<p style="margin:0 0 20px;font-size:14px;color:#a7aab0">${escapeHtml(input.senderEmail)}</p>
${message ? `<p style="margin:0 0 24px;padding:16px;border-radius:12px;background:#121826;font-size:15px;line-height:1.5;color:#f4f7fa;white-space:pre-wrap">${escapeHtml(message)}</p>` : ''}
<p style="margin:0 0 24px"><a href="${escapeHtml(link.toString())}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#f59e0b;color:#06080f;font-weight:bold;text-decoration:none">Récupérer les fichiers</a></p>
<p style="margin:0 0 8px;font-size:14px;color:#a7aab0">Disponibles jusqu'au ${escapeHtml(expiry)}. Vous confirmerez votre adresse e-mail, sans mot de passe.</p>
<p style="margin:0;font-size:13px;color:#a7aab0">Vous ne connaissez pas l'expéditeur ? Ignorez simplement cet e-mail.</p>
</td></tr></table>
</td></tr></table>
</body></html>`

  return { to: input.to, subject, html, text }
}
