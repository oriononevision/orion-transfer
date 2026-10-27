import { t } from '../i18n'
import type { InboxItem, OutboxItem } from '../api/transfers'
import type { Tone } from '../components/StatusPill'

const DAY = 86_400_000

function expiringSoon(expiresAt: string, now: Date): { tone: Tone; label: string } | null {
  const left = new Date(expiresAt).getTime() - now.getTime()
  if (left <= 0) return { tone: 'muted', label: t('status.expired') }
  if (left < DAY) return { tone: 'neutral', label: t('status.expiresToday') }
  if (left <= 2 * DAY) return { tone: 'neutral', label: t('status.expiresIn', { days: Math.ceil(left / DAY) }) }
  return null
}

export function inboxStatus(item: InboxItem, now = new Date()): { tone: Tone; label: string } {
  if (item.status === 'expired') return { tone: 'muted', label: t('status.expired') }
  const soon = expiringSoon(item.expires_at, now)
  if (soon?.tone === 'muted') return soon
  if (!item.first_downloaded_at) return { tone: 'accent', label: t('status.new') }
  return soon ?? { tone: 'success', label: t('status.downloaded') }
}

export function outboxStatus(item: OutboxItem, now = new Date()): { tone: Tone; label: string } {
  if (item.status === 'uploading') return { tone: 'accent', label: t('status.uploading') }
  if (item.status === 'expired') return { tone: 'muted', label: t('status.expired') }
  const soon = expiringSoon(item.expires_at, now)
  if (soon?.tone === 'muted') return soon
  if (item.recipient_count > 0 && item.downloaded_count >= item.recipient_count) {
    return { tone: 'success', label: t('status.downloadedAll') }
  }
  if (item.downloaded_count > 0) {
    return { tone: 'neutral', label: t('status.downloadedBy', { done: item.downloaded_count, total: item.recipient_count }) }
  }
  return { tone: 'neutral', label: t('status.notDownloaded') }
}
