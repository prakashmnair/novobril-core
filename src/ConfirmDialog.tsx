'use client'
import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useConfirmState } from './confirm'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function ConfirmDialog() {
  const { state, respond } = useConfirmState()

  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = 'novobril-confirm-title'
  const descId = 'novobril-confirm-desc'

  const open = Boolean(state?.open)

  // Held in a ref so the key listener is bound once per open rather than re-bound on
  // every render. Synced in an effect — writing a ref during render is unsafe under
  // concurrent rendering.
  const respondRef = useRef(respond)
  useEffect(() => {
    respondRef.current = respond
  })

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    // Focus Cancel, not Confirm. A confirm dialog is frequently destructive, so the
    // control that should be one stray Enter away is the safe one.
    cancelRef.current?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        respondRef.current(false)
        return
      }

      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) {
        e.preventDefault()
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      // Wrap at both ends, and pull focus back if it has escaped the dialog entirely.
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Return focus to whatever opened the dialog, guarded because that element may
      // have unmounted as a result of the confirmed action.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [open])

  if (!state?.open) return null
  const isDanger = state.variant === 'danger'

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => respond(false)} aria-hidden="true" />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={state.message ? descId : undefined}
        className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4"
      >
        {isDanger && <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 mx-auto"><AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" aria-hidden="true" /></div>}
        <div className="text-center">
          <h2 id={titleId} className="text-base font-bold text-slate-900 dark:text-slate-100">{state.title}</h2>
          {state.message && <p id={descId} className="mt-1 text-sm text-slate-500 dark:text-slate-400">{state.message}</p>}
        </div>
        <div className="flex gap-3 mt-2">
          <button ref={cancelRef} onClick={() => respond(false)} className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">{state.cancelLabel ?? 'Cancel'}</button>
          <button onClick={() => respond(true)} className={`flex-1 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-colors ${isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>{state.confirmLabel ?? 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}
