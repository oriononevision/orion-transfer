/** Détection / API du logiciel bureau ORION Transfer. */

export type DesktopFolderResult = {
  rootName: string
  files: Record<string, string>
  skipped: number
  truncated: boolean
}

export type DesktopAuthResult =
  | { ok: true; callbackUrl: string }
  | { ok: false; cancelled?: boolean; error?: string }

type OrionDesktopApi = {
  isDesktop: true
  platform: string
  openFolderWorkspace: () => Promise<DesktopFolderResult | null>
  /** Ouvre la page Orion web pour Google, puis renvoie l’URL de retour avec jetons. */
  openExternalAuth: (input: { url: string }) => Promise<DesktopAuthResult>
  getDesktopDownloadHint?: () => string
}

declare global {
  interface Window {
    orionDesktop?: OrionDesktopApi
  }
}

/** true dans Electron (preload) ou si le build desktop le signale. */
export function isDesktopApp(): boolean {
  if (typeof window !== 'undefined' && window.orionDesktop?.isDesktop) return true
  return import.meta.env.VITE_ORION_DESKTOP === '1'
}

export async function openNativeFolderWorkspace(): Promise<DesktopFolderResult | null> {
  if (!window.orionDesktop?.openFolderWorkspace) return null
  return window.orionDesktop.openFolderWorkspace()
}

export async function openDesktopExternalAuth(url: string): Promise<DesktopAuthResult> {
  if (!window.orionDesktop?.openExternalAuth) {
    return { ok: false, error: 'API desktop indisponible' }
  }
  return window.orionDesktop.openExternalAuth({ url })
}
