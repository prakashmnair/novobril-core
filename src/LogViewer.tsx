'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Shield, FileText, ChevronLeft, ChevronRight, Search, Download, Eye, EyeOff,
} from 'lucide-react'
import { maskEmail } from './pii'
import {
  toLogCsv, AUDIT_CSV_COLUMNS, SECURITY_CSV_COLUMNS, type LogKind, type LogMeta,
} from './log-query'

// Superadmin audit + security log viewer.
//
// Extracted from screendex's bespoke /admin/logs page, which every other project
// would otherwise have hand-copied. Two things changed in the extraction:
//   1. The audit and security tabs were ~270 near-identical lines each; they're
//      now one renderer driven by a column/filter config, so a fix lands on both.
//   2. That page carried its own local `maskEmail`, a third copy of an algorithm
//      this package already exports. Now imported.
//
// The project injects only what the package can't know: how to get an auth token
// and where to send someone who isn't allowed in.

export interface AuditLogRow {
  id: string
  createdAt: string
  userId: string | null
  userEmail: string | null
  action: string
  entityType: string | null
  entityId: string | null
  outcome: string
  ipAddress: string | null
}

export interface SecurityLogRow {
  id: string
  createdAt: string
  userId: string | null
  userEmail: string | null
  event: string
  severity: string
  ipAddress: string | null
}

export interface LogViewerProps {
  /**
   * Returns a bearer token for the log API calls, or null if unavailable.
   * Firebase projects pass `() => user.getIdToken()`; cookie-session projects
   * can return null and rely on the cookie travelling with the request.
   */
  getToken?: () => Promise<string | null>
  /** Called on a 403 — typically `() => router.push('/')`. */
  onForbidden?: () => void
  auditEndpoint?: string
  securityEndpoint?: string
  /** Rows per page. The CSV export always pulls up to `exportLimit`. */
  pageSize?: number
  exportLimit?: number
  /** Filename stem for exports, e.g. "quizrazor" → `quizrazor-audit-logs-YYYY-MM-DD.csv`. */
  filePrefix?: string
}

type Filters = Record<string, string>

const INPUT =
  'bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm px-3 py-2 text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'
const BTN_SECONDARY =
  'flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-900 dark:text-white rounded-xl font-bold px-5 py-2.5 text-sm transition-colors border border-slate-300 dark:border-slate-700'
const PAGE_BTN =
  'flex items-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm transition-colors'

function fmt(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function outcomeClass(outcome: string) {
  if (outcome === 'SUCCESS') return 'text-green-600 dark:text-green-400'
  if (outcome === 'FAILURE') return 'text-red-600 dark:text-red-400'
  return 'text-amber-600 dark:text-amber-400'
}

function severityClass(severity: string) {
  if (severity === 'CRITICAL') return 'text-red-600 dark:text-red-400'
  if (severity === 'WARNING') return 'text-amber-600 dark:text-amber-400'
  return 'text-slate-500 dark:text-slate-400'
}

export function LogViewer({
  getToken,
  onForbidden,
  auditEndpoint = '/api/admin/logs/audit',
  securityEndpoint = '/api/admin/logs/security',
  pageSize = 50,
  exportLimit = 10_000,
  filePrefix = '',
}: LogViewerProps) {
  const [tab, setTab] = useState<LogKind>('audit')
  const [revealPii, setRevealPii] = useState(false)

  const [rows, setRows] = useState<(AuditLogRow | SecurityLogRow)[]>([])
  const [meta, setMeta] = useState<LogMeta>({ page: 1, limit: pageSize, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [page, setPage] = useState(1)

  // Draft = what's in the inputs; applied = what the last search actually used.
  // Keeping them separate is why typing in a filter doesn't refetch on every
  // keystroke, and why paging keeps the filters you searched with.
  const [draft, setDraft] = useState<Filters>({})
  const [applied, setApplied] = useState<Filters>({})

  const endpoint = tab === 'audit' ? auditEndpoint : securityEndpoint

  const buildParams = useCallback(
    (p: number, limit: number, f: Filters) => {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) })
      for (const [k, v] of Object.entries(f)) if (v) params.set(k, v)
      return params
    },
    [],
  )

  const request = useCallback(
    async (url: string) => {
      const token = getToken ? await getToken() : null
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.status === 403 || res.status === 401) {
        onForbidden?.()
        throw new Error('forbidden')
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      return res.json()
    },
    [getToken, onForbidden],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    request(`${endpoint}?${buildParams(page, pageSize, applied)}`)
      .then((data) => {
        if (cancelled) return
        setRows(data.logs ?? [])
        setMeta(data.meta ?? { page: 1, limit: pageSize, total: 0, pages: 1 })
      })
      .catch((err) => {
        if (cancelled || err?.message === 'forbidden') return
        setError(err?.message ?? 'Could not load logs')
        setRows([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [endpoint, page, pageSize, applied, buildParams, request])

  // Switching tabs resets paging and filters — the two tabs don't share filter
  // fields (action/outcome vs event/severity), so carrying them over would send
  // meaningless params.
  function switchTab(next: LogKind) {
    if (next === tab) return
    setTab(next)
    setPage(1)
    setDraft({})
    setApplied({})
  }

  function search() {
    setPage(1)
    setApplied(draft)
  }

  async function exportCsv() {
    setExporting(true)
    try {
      // `export=1` is explicit rather than inferred from a large `limit`: the
      // route has to emit a DATA_EXPORTED security event (WARNING) for a real
      // export, and guessing from page size would both miss exports and
      // false-positive on a wide page.
      const params = buildParams(1, exportLimit, applied)
      params.set('export', '1')
      const data = await request(`${endpoint}?${params}`)
      const all = data.logs ?? []
      const cols = (tab === 'audit' ? AUDIT_CSV_COLUMNS : SECURITY_CSV_COLUMNS) as unknown as string[]
      const csv = toLogCsv(all, cols)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filePrefix ? `${filePrefix}-` : ''}${tab}-logs-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Export failed — nothing was downloaded.')
    } finally {
      setExporting(false)
    }
  }

  const displayEmail = (email: string | null, userId: string | null) => {
    if (!email) return userId ?? '—'
    return revealPii ? email : maskEmail(email)
  }

  const filterFields = useMemo(
    () =>
      tab === 'audit'
        ? [
            { key: 'userId', label: 'User ID', type: 'text' as const, placeholder: 'Filter by user ID…' },
            { key: 'action', label: 'Action', type: 'text' as const, placeholder: 'e.g. QUIZ.CREATE' },
            { key: 'outcome', label: 'Outcome', type: 'select' as const, options: ['SUCCESS', 'FAILURE', 'ERROR'] },
          ]
        : [
            { key: 'userId', label: 'User ID', type: 'text' as const, placeholder: 'Filter by user ID…' },
            { key: 'event', label: 'Event', type: 'text' as const, placeholder: 'e.g. LOGIN_SUCCESS' },
            { key: 'severity', label: 'Severity', type: 'select' as const, options: ['INFO', 'WARNING', 'CRITICAL'] },
          ],
    [tab],
  )

  const headers = tab === 'audit'
    ? ['Timestamp', 'User', 'Action', 'Entity', 'Outcome']
    : ['Timestamp', 'User', 'Event', 'Severity', 'IP']

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1 w-fit">
          {(['audit', 'security'] as const).map((k) => (
            <button
              key={k}
              onClick={() => switchTab(k)}
              aria-pressed={tab === k}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === k
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {k === 'audit' ? <FileText size={14} /> : <Shield size={14} />}
              {k === 'audit' ? 'Audit Log' : 'Security Log'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setRevealPii((v) => !v)}
          aria-label={revealPii ? 'Hide email addresses' : 'Reveal email addresses'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            revealPii
              ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
              : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          {revealPii ? <Eye size={12} /> : <EyeOff size={12} />}
          {revealPii ? 'PII On' : 'PII'}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        {filterFields.map((f) => (
          <div key={f.key}>
            <label htmlFor={`log-${f.key}`} className="block text-xs text-slate-500 mb-1">{f.label}</label>
            {f.type === 'select' ? (
              <select
                id={`log-${f.key}`}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                className={INPUT}
              >
                <option value="">All</option>
                {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                id={`log-${f.key}`}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') search() }}
                placeholder={f.placeholder}
                className={`${INPUT} w-48`}
              />
            )}
          </div>
        ))}
        {(['from', 'to'] as const).map((k) => (
          <div key={k}>
            <label htmlFor={`log-${k}`} className="block text-xs text-slate-500 mb-1">{k === 'from' ? 'From' : 'To'}</label>
            <input
              id={`log-${k}`}
              type="date"
              value={draft[k] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              className={INPUT}
            />
          </div>
        ))}
        <button
          onClick={search}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold px-5 py-2.5 text-sm transition-colors"
        >
          <Search size={14} /> Search
        </button>
        <button onClick={exportCsv} disabled={exporting || meta.total === 0} className={BTN_SECONDARY}>
          <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      <p className="text-slate-500 text-sm mb-3">{meta.total.toLocaleString()} entries</p>

      {error && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 px-4 py-3 mb-4 flex items-center justify-between gap-4">
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
          <button onClick={() => setApplied({ ...applied })} className="text-sm font-semibold text-red-700 dark:text-red-300 underline">
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
              <tr>{headers.map((h) => <th key={h} scope="col" className="px-4 py-3 text-left">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {rows.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap text-xs">{fmt(log.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200 text-xs font-mono">
                    {displayEmail(log.userEmail, log.userId)}
                  </td>
                  {tab === 'audit' ? (
                    <>
                      <td className="px-4 py-3">
                        <span className="font-mono text-indigo-600 dark:text-indigo-400 text-xs">{(log as AuditLogRow).action}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                        <span className="text-slate-600 dark:text-slate-300">{(log as AuditLogRow).entityType ?? '—'}</span>
                        {(log as AuditLogRow).entityId && (
                          <span className="text-slate-400 dark:text-slate-600 ml-1 font-mono">
                            {(log as AuditLogRow).entityId!.slice(0, 8)}…
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${outcomeClass((log as AuditLogRow).outcome)}`}>
                          {(log as AuditLogRow).outcome}
                        </span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3">
                        <span className="font-mono text-indigo-600 dark:text-indigo-400 text-xs">{(log as SecurityLogRow).event}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${severityClass((log as SecurityLogRow).severity)}`}>
                          {(log as SecurityLogRow).severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs font-mono">{log.ipAddress ?? '—'}</td>
                    </>
                  )}
                </tr>
              ))}
              {rows.length === 0 && !error && (
                <tr>
                  <td colSpan={headers.length} className="px-4 py-12 text-center text-slate-500">
                    {Object.values(applied).some(Boolean)
                      ? 'No entries match those filters. Try widening the date range or clearing a field.'
                      : `No ${tab} entries yet. They appear here as soon as the first one is recorded.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {meta.pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-slate-500 text-sm">Page {meta.page} of {meta.pages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className={PAGE_BTN}>
              <ChevronLeft size={14} /> Prev
            </button>
            <button onClick={() => setPage((p) => Math.min(meta.pages, p + 1))} disabled={page >= meta.pages} className={PAGE_BTN}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
