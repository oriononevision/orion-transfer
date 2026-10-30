const KEY = 'orion-transfer-welcome-v1'

export function isWelcomeComplete(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function completeWelcome(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* ignore */
  }
}

export function resetWelcome(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
