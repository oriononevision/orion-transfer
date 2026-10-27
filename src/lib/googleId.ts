import { GOOGLE_CLIENT_ID } from './supabase'

let scriptPromise: Promise<void> | null = null

export type GoogleCredentialResult = {
  credential: string
  /** Nonce brut à passer à Supabase (Google reçoit la version SHA-256). */
  nonce: string
}

async function generateNonce(): Promise<{ nonce: string; hashedNonce: string }> {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  const encoded = new TextEncoder().encode(nonce)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashedNonce = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return { nonce, hashedNonce }
}

export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-gis-id]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () =>
        reject(new Error('Impossible de charger Google Identity Services')),
      )
      return
    }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.dataset.gisId = '1'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Impossible de charger Google Identity Services'))
    document.head.appendChild(s)
  })

  return scriptPromise
}

export async function requestGoogleCredential(): Promise<GoogleCredentialResult> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error(
      'Client ID Google manquant. Configurez VITE_GOOGLE_CLIENT_ID (même valeur que Core).',
    )
  }

  await loadGoogleIdentity()
  if (!window.google?.accounts?.id) {
    throw new Error('Google Identity Services indisponible')
  }

  const { nonce, hashedNonce } = await generateNonce()

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    window.google!.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      nonce: hashedNonce,
      use_fedcm_for_prompt: true,
      callback: (response) => {
        finish(() => {
          if (!response.credential) {
            reject(new Error('Connexion Google annulée'))
            return
          }
          resolve({ credential: response.credential, nonce })
        })
      },
    })

    window.google!.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        const host = document.createElement('div')
        host.style.position = 'fixed'
        host.style.left = '-9999px'
        document.body.appendChild(host)
        window.google!.accounts.id.renderButton(host, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          width: 320,
        })
        const btn = host.querySelector('div[role="button"]') as HTMLElement | null
        if (btn) {
          btn.click()
          window.setTimeout(() => {
            host.remove()
            finish(() =>
              reject(
                new Error(
                  'Fenêtre Google fermée. Autorisez localhost:5175 et orion-transfer.vercel.app dans Google Cloud (origines JavaScript).',
                ),
              ),
            )
          }, 120_000)
        } else {
          host.remove()
          const reason =
            notification.getNotDisplayedReason?.() ||
            notification.getSkippedReason?.() ||
            'indisponible'
          finish(() =>
            reject(new Error(`Connexion Google indisponible (${reason}).`)),
          )
        }
      }
    })
  })
}
