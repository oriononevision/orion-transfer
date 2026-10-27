/** Logo ORION (même dessin que le site et CORE). */
export function OrionMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M44.8 19.2 A18 18 0 0 1 44.8 44.8" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
      <path d="M19.2 44.8 A18 18 0 0 1 19.2 19.2" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
      <path
        d="M32 4 C33.1 23.4 41.2 31.2 60 32 C41.2 32.8 33.1 40.6 32 60 C30.9 40.6 22.8 32.8 4 32 C22.8 31.2 30.9 23.4 32 4Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <OrionMark />
      <span className="wordmark__orion">ORION</span>
      <span className="wordmark__product">TRANSFER</span>
    </span>
  )
}
