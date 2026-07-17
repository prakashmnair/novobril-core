'use client'
import { AlertTriangle } from 'lucide-react'
import { useConfirmState } from './confirm'
export function ConfirmDialog() {
  const { state, respond } = useConfirmState()
  if (!state?.open) return null
  const isDanger = state.variant === 'danger'
  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => respond(false)} />
      <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
        {isDanger && <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 mx-auto"><AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" /></div>}
        <div className="text-center">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{state.title}</h2>
          {state.message && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{state.message}</p>}
        </div>
        <div className="flex gap-3 mt-2">
          <button onClick={() => respond(false)} className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">{state.cancelLabel ?? 'Cancel'}</button>
          <button onClick={() => respond(true)} className={`flex-1 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-colors ${isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>{state.confirmLabel ?? 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}
