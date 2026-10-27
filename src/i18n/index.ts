import { fr, type MessageKey } from './fr'

export type { MessageKey }

const messages: Record<MessageKey, string> = fr

/** Traduit une clé et remplace les {paramètres}. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = messages[key] ?? key
  if (!params) return template
  // Pluriel : « {count|jour|jours} » (en français, 0 et 1 sont au singulier).
  return template
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_m, name: string, one: string, many: string) =>
      Math.abs(Number(params[name])) >= 2 ? many : one,
    )
    .replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** Message lisible pour une erreur renvoyée par Supabase ou le réseau. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const code = raw.trim()
  if (`error.${code}` in messages) return messages[`error.${code}` as MessageKey]
  if (/network|fetch|failed to fetch/i.test(raw)) return messages['error.network']
  return messages['error.unknown']
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

export function formatLongDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso))
}

/** « Aujourd'hui, 15:48 », « Hier, 18:20 » ou « 22 oct. ». */
export function formatRelativeDay(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days === 0) return `Aujourd’hui, ${timeFormat.format(date)}`
  if (days === 1) return `Hier, ${timeFormat.format(date)}`
  return shortDate.format(date)
}
