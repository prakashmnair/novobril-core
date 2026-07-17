'use client'
import { createContext, useContext, useState, useCallback } from 'react'
export type ToastType = 'success' | 'error' | 'warning' | 'info'
export interface ToastItem { id: string; type: ToastType; message: string; duration: number }
interface Ctx { toasts: ToastItem[]; add: (t: Omit<ToastItem, 'id'>) => void; remove: (id: string) => void }
const ToastContext = createContext<Ctx | null>(null)
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const remove = useCallback((id: string) => setToasts(p => p.filter(t => t.id !== id)), [])
  const add = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(p => [...p, { ...t, id }])
    setTimeout(() => remove(id), t.duration ?? 4000)
  }, [remove])
  return <ToastContext.Provider value={{ toasts, add, remove }}>{children}</ToastContext.Provider>
}
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return {
    success: (message: string, duration = 4000) => ctx.add({ type: 'success', message, duration }),
    error:   (message: string, duration = 5000) => ctx.add({ type: 'error',   message, duration }),
    warning: (message: string, duration = 4000) => ctx.add({ type: 'warning', message, duration }),
    info:    (message: string, duration = 4000) => ctx.add({ type: 'info',    message, duration }),
  }
}
export function useToastItems() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToastItems must be used within ToastProvider')
  return { toasts: ctx.toasts, remove: ctx.remove }
}
