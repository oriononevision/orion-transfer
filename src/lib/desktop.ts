/** Détection / API du logiciel bureau ORION Transfer. */

export type DesktopFolderResult = {
  rootName: string
  files: Record<string, string>
  skipped: number
  truncated: boolean
}

type OrionDesktopApi = {
  isDesktop: true
  platform: string
  openFolderWorkspace: () => Promise<DesktopFolderResult | null>
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
