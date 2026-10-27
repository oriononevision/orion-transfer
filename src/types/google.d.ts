export {}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
            nonce?: string
            auto_select?: boolean
            cancel_on_tap_outside?: boolean
            use_fedcm_for_prompt?: boolean
          }) => void
          prompt: (momentListener?: (notification: {
            isNotDisplayed: () => boolean
            isSkippedMoment: () => boolean
            getNotDisplayedReason?: () => string
            getSkippedReason?: () => string
          }) => void) => void
          renderButton: (
            parent: HTMLElement,
            options: Record<string, unknown>,
          ) => void
          cancel: () => void
        }
      }
    }
  }
}
