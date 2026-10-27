import { describe, expect, it } from 'vitest'
import type { InboxItem, OutboxItem } from '../api/transfers'
import { inboxStatus, outboxStatus } from './status'

const now = new Date('2026-10-27T16:00:00Z')
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString()

const inbox = (over: Partial<InboxItem>): InboxItem => ({
  id: 'x', sender_name: 'Sam', sender_email: 'sam@orion.dev', message: null, status: 'ready',
  expires_at: inDays(7), total_bytes: 1, file_count: 1, created_at: now.toISOString(),
  first_downloaded_at: null, ...over,
})

const outbox = (over: Partial<OutboxItem>): OutboxItem => ({
  id: 'x', recipient_emails: ['a@b.fr', 'c@d.fr'], recipient_count: 2, downloaded_count: 0, message: null,
  status: 'ready', expires_at: inDays(7), total_bytes: 1, file_count: 1, created_at: now.toISOString(), ...over,
})

describe('statut des transferts reçus', () => {
  it('nouveau tant que rien n’est téléchargé', () => {
    expect(inboxStatus(inbox({}), now)).toEqual({ tone: 'accent', label: 'Nouveau' })
  })
  it('téléchargé ensuite', () => {
    expect(inboxStatus(inbox({ first_downloaded_at: now.toISOString() }), now).label).toBe('Téléchargé')
  })
  it('prévient quand l’expiration approche', () => {
    expect(inboxStatus(inbox({ first_downloaded_at: now.toISOString(), expires_at: inDays(1.5) }), now).label).toBe('Expire dans 2 j')
  })
  it('expiré dès la date passée, même avant le passage de la tâche planifiée', () => {
    expect(inboxStatus(inbox({ expires_at: inDays(-0.1) }), now).label).toBe('Expiré')
  })
})

describe('statut des transferts envoyés', () => {
  it('pas encore téléchargé', () => {
    expect(outboxStatus(outbox({}), now).label).toBe('Pas encore téléchargé')
  })
  it('téléchargé par une partie des destinataires', () => {
    expect(outboxStatus(outbox({ downloaded_count: 1 }), now).label).toBe('Téléchargé par 1 sur 2')
  })
  it('téléchargé par tout le monde', () => {
    expect(outboxStatus(outbox({ downloaded_count: 2 }), now)).toEqual({ tone: 'success', label: 'Téléchargé' })
  })
  it('envoi en cours', () => {
    expect(outboxStatus(outbox({ status: 'uploading' }), now).label).toBe('Envoi en cours')
  })
})

describe('textes', async () => {
  const { t } = await import('../i18n')
  it('accorde le pluriel', () => {
    expect(t('send.days', { count: 1 })).toBe('1 jour')
    expect(t('send.days', { count: 14 })).toBe('14 jours')
    expect(t('detail.sentTitle', { files: 3, people: 1 })).toBe('3 fichiers envoyés à 1 personne')
  })
})
