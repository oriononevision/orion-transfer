import { Check, Clock } from 'lucide-react'

export type Tone = 'accent' | 'success' | 'neutral' | 'muted'

export default function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`pill pill--${tone}`}>
      {tone === 'accent' ? <span className="pill__dot" aria-hidden="true" /> : null}
      {tone === 'success' ? <Check size={14} aria-hidden="true" /> : null}
      {tone === 'neutral' ? <Clock size={14} aria-hidden="true" /> : null}
      {label}
    </span>
  )
}
