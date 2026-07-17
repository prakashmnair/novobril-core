'use client'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useToastItems, type ToastType } from './toast'
const styles: Record<ToastType, { border: string; icon: React.ReactNode }> = {
  success: { border: 'border-l-green-500',  icon: <CheckCircle  className="h-5 w-5 text-green-500 shrink-0" /> },
  error:   { border: 'border-l-red-500',    icon: <XCircle      className="h-5 w-5 text-red-500 shrink-0" /> },
  warning: { border: 'border-l-amber-500',  icon: <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" /> },
  info:    { border: 'border-l-indigo-500', icon: <Info         className="h-5 w-5 text-indigo-500 shrink-0" /> },
}
export function Toaster() {
  const { toasts, remove } = useToastItems()
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-6 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(t => {
        const s = styles[t.type]
        return (
          <div key={t.id} className={`pointer-events-auto flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 border-l-4 ${s.border} bg-white dark:bg-slate-900 px-4 py-3 shadow-lg`}>
            {s.icon}
            <p className="flex-1 text-sm text-slate-800 dark:text-slate-100">{t.message}</p>
            <button onClick={() => remove(t.id)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </div>
        )
      })}
    </div>
  )
}
