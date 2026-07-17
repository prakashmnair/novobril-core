'use client'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const CLASS_NAME =
  'p-1.5 -ml-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors'

export interface BackButtonProps {
  /** Navigate to a specific route instead of browser history — preferred when the target is
   * known (e.g. a detail page going back to its list), since it's predictable regardless of
   * how the user actually arrived. */
  href?: string
  /** Custom handler; overrides both href and the router.back() default. */
  onClick?: () => void
  'aria-label'?: string
}

/**
 * Canonical back-navigation control — formalizes the className that was previously hand-typed
 * inline in 28-60+ files per project (see admin/docs/patterns.md). Icon-only ChevronLeft,
 * never "← Text" links, per the design system.
 */
export function BackButton({ href, onClick, 'aria-label': ariaLabel = 'Back' }: BackButtonProps) {
  const router = useRouter()

  if (href && !onClick) {
    return (
      <Link href={href} className={CLASS_NAME} aria-label={ariaLabel}>
        <ChevronLeft size={20} />
      </Link>
    )
  }

  return (
    <button onClick={onClick ?? (() => router.back())} className={CLASS_NAME} aria-label={ariaLabel}>
      <ChevronLeft size={20} />
    </button>
  )
}
