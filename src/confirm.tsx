'use client'
import { createContext, useContext, useState, useCallback } from 'react'
export interface ConfirmOptions { title: string; message: string; confirmLabel?: string; cancelLabel?: string; variant?: 'danger' | 'default' }
interface ConfirmState extends ConfirmOptions { open: boolean; resolve: (ok: boolean) => void }
interface Ctx { request: (opts: ConfirmOptions) => Promise<boolean>; state: ConfirmState | null; respond: (ok: boolean) => void }
const ConfirmContext = createContext<Ctx | null>(null)
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null)
  const request = useCallback((opts: ConfirmOptions): Promise<boolean> =>
    new Promise(resolve => setState({ ...opts, open: true, resolve })), [])
  const respond = useCallback((ok: boolean) => { state?.resolve(ok); setState(null) }, [state])
  return <ConfirmContext.Provider value={{ request, state, respond }}>{children}</ConfirmContext.Provider>
}
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx.request
}
export function useConfirmState() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirmState must be used within ConfirmProvider')
  return { state: ctx.state, respond: ctx.respond }
}
