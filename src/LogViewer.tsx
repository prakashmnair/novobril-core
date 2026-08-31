'use client'

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import {
  Shield, FileText, ChevronLeft, ChevronRight, Search, Download, Eye, EyeOff,
} from 'lucide-react'
import { maskEmail, maskIp } from './pii'
import { classifyUserAgent, type ClientVerdict } from './user-agent'
import {
  toLogCsv, maskLogRowsForExport, AUDIT_CSV_COLUMNS, SECURITY_CSV_COLUMNS, type LogKind, type LogMeta,
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
  /**
   * OPTIONAL on purpose. Every consuming project's audit endpoint returns whatever its Prisma
   * `findMany` selects; most select everything and so already send this, but a project that
   * narrows its select simply has no `changes` and the Detail column renders a dash. Marking it
   * optional keeps this a non-breaking addition — no consumer has to change anything to upgrade.
   */
  changes?: unknown
  metadata?: unknown
  /**
   * Client context for the Bot/Human badge and the expandable row detail. Optional and non-breaking,
   * exactly like `changes`: a project whose audit `findMany` selects these already sends them (most
   * do, via `...row`), and one that doesn't shows a dash and a null badge. `ipAddress` above is the
   * real visitor IP wherever the project resolves it (bookme injects it via a Cloudflare header).
   */
  userAgent?: string | null
  sessionId?: string | null
  requestId?: string | null
  /**
   * A human name for whatever `entityId` points at, resolved by the consuming project's endpoint —
   * only it knows a Booking id means "Chendamelam performance — 19 Sept". Optional: a project that
   * resolves nothing still renders the entityType and id exactly as before.
   */
  entityLabel?: { label: string; ref?: string } | null
}

/**
 * A one-line, human summary of an audit row's `changes`/`metadata`.
 *
 * WHY THIS EXISTS. The audit table showed `entityType` and a truncated id — "PAGE  cmr93ju2…" —
 * which says something happened to something and nothing more. The information needed to read the
 * row was already being sent: bookme's page-view beacon, for instance, stores
 * `{ page: 'Team', path: '/settings/team' }`, so the table could say "Viewed Team" and instead said
 * "PAGE". Every project using this viewer had the same blindness.
 *
 * DEFENSIVE BY DESIGN. Seven projects share this component and each writes a different `changes`
 * shape — none of them agreed on a schema, because until now nothing read it. So this makes no
 * assumption beyond "it might be an object": a missing field, a null, an array, a string, or a
 * project that does not send `changes` at all all degrade to an empty string and the cell renders a
 * dash. It must never throw, because a rendering helper that throws takes the whole log viewer down
 * on the one screen an operator opens when something is already wrong.
 */
export function auditDetail(log: AuditLogRow): string {
  const src = (log.changes ?? log.metadata) as unknown
  if (!src || typeof src !== 'object' || Array.isArray(src)) return ''
  const obj = src as Record<string, unknown>

  // PAGE.VIEW is the case that motivated this and the one where the generic summary reads worst
  // ("page: Team · path: /settings/team"). A recognised page name is rendered as a sentence.
  if (typeof obj.page === 'string' && obj.page) return `Viewed ${obj.page}`

  const parts: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    // Empty strings are skipped alongside null/undefined: a key whose value is '' renders as
    // "page:  · path: /x", which reads as a broken field rather than an absent one. Found by the
    // empty-page test, which exists because `page` is special-cased above and '' falls through it.
    if (v === null || v === undefined || v === '') continue
    if (parts.length === 3) { parts.push('…'); break }
    const val =
      typeof v === 'object' ? '…'
      : typeof v === 'boolean' ? String(v)
      : String(v)
    parts.push(`${k}: ${val.length > 28 ? val.slice(0, 28) + '…' : val}`)
  }
  return parts.join(' · ')
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
  /**
   * Whether PII starts revealed. Defaults to false, preserving the behaviour every consumer had
   * before v0.4.5 — an existing project upgrades and sees no change.
   */
  defaultRevealPii?: boolean
}

type Filters = Record<string, string>

const INPUT =
  'bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm px-3 py-2 text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'
const BTN_SECONDARY =
  'flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-900 dark:text-white rounded-xl font-bold px-5 py-2.5 text-sm transition-colors border border-slate-300 dark:border-slate-700'
const PAGE_BTN =
  'flex items-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm transition-colors'
const DETAIL_LABEL = 'text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] pt-0.5'

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

// Background tint, not just text colour. A CRITICAL or WARNING row has to be
// findable by scanning a long table, and screendex's QA checklist asserts the
// tint explicitly ("row has amber background tint" for DATA_EXPORTED/WARNING) —
// dropping it during the extraction would have been a silent regression against
// a documented, human-run test.
function severityClass(severity: string) {
  if (severity === 'CRITICAL') return 'bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400'
  if (severity === 'WARNING') return 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400'
  return 'text-slate-500 dark:text-slate-400'
}

export function LogViewer({
  getToken,
  onForbidden,
  auditEndpoint = '/api/admin/logs/audit',
  securityEndpoint = '/api/admin/logs/security',
  pageSize = 50,
  exportLimit = 10_000,
  filePrefix = '', defaultRevealPii = false }: LogViewerProps) {
  const [tab, setTab] = useState<LogKind>('audit')
  // Default is per-project, not global. bookme turns this on because its superadmin is the sole
  // operator looking at their own platform's logs, and masking made them unreadable without a click
  // every visit. Another project may have several operators, an outsourced support desk, or a
  // regulator's expectation that PII is hidden until deliberately revealed — so the SHARED default
  // stays off and each consumer opts in. Changing the default here would flip the privacy posture
  // of seven products at once, which is not a decision this component gets to make.
  const [revealPii, setRevealPii] = useState(defaultRevealPii)

  const [rows, setRows] = useState<(AuditLogRow | SecurityLogRow)[]>([])
  const [meta, setMeta] = useState<LogMeta>({ page: 1, limit: pageSize, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [page, setPage] = useState(1)
  // Which audit rows have their client-detail drawer open. A Set so several open at once; cleared
  // whenever the data reloads (below) so an id can't point at a row that has since paged away.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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
        setExpanded(new Set())
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
      const raw: (AuditLogRow | SecurityLogRow)[] = data.logs ?? []
      const cols = (tab === 'audit' ? AUDIT_CSV_COLUMNS : SECURITY_CSV_COLUMNS) as unknown as string[]
      // Export must match what's on screen: masked by default, real values only
      // once the admin has explicitly hit Reveal. Fixed 2026-07-22 — this
      // previously serialised the raw API response regardless of `revealPii`,
      // so a masked-looking table still produced an unmasked CSV on every
      // export. Found auditing @novobril/core's LogViewer for smartreceipt's
      // adoption; live in every project that had adopted the viewer before
      // this fix (screendex, quizzly, bookme) since the bug is in the shared
      // component, not any one consumer.
      //
      // Deliberately NOT reusing `displayEmail`/`displayIp` here — those fall
      // back to showing userId in place of a missing email for a single
      // on-screen cell, which is right for the table but wrong for a CSV where
      // userId and userEmail are separate columns; a null email must stay
      // empty in its own column, not silently filled with the userId.
      const all = maskLogRowsForExport(raw, revealPii)
      const csv = toLogCsv(all as unknown as Record<string, unknown>[], cols)
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

  // IP is PII per the portfolio's own masking policy ("email, name, phone, DOB,
  // location, IP") and belongs behind the same reveal toggle as email — it was
  // shown raw and unconditionally before this fix, which the toggle's own label
  // ("PII") already implied it should cover.
  const displayIp = (ip: string | null) => {
    if (!ip) return '—'
    return revealPii ? ip : maskIp(ip)
  }

  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Bot / Human / Unknown chip. Colour carries the signal: rose = flagged automated, amber = can't
  // tell, slate = looks like a real browser — deliberately the quiet colour, since most rows are it.
  const verdictChip = (v: ClientVerdict) => {
    const cls =
      v === 'bot'
        ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
        : v === 'unknown'
        ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
    const label = v === 'bot' ? 'Bot' : v === 'unknown' ? 'Unknown' : 'Human'
    return (
      <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold leading-none ${cls}`}>
        {label}
      </span>
    )
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
    ? ['Timestamp', 'User', 'Action', 'Entity', 'Detail', 'Outcome']
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
          aria-label={revealPii ? 'Hide email addresses and IPs' : 'Reveal email addresses and IPs'}
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
              {rows.map((log) => {
                const isAudit = tab === 'audit'
                const a = log as AuditLogRow
                const ua = isAudit ? (a.userAgent ?? null) : null
                const cls = ua ? classifyUserAgent(ua) : null
                const open = expanded.has(log.id)
                return (
                <Fragment key={log.id}>
                <tr
                  className={`hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors ${isAudit ? 'cursor-pointer' : ''}`}
                  onClick={isAudit ? () => toggleExpand(log.id) : undefined}
                  role={isAudit ? 'button' : undefined}
                  tabIndex={isAudit ? 0 : undefined}
                  aria-expanded={isAudit ? open : undefined}
                  onKeyDown={isAudit ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(log.id) } } : undefined}
                >
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      {isAudit && (
                        <ChevronRight size={12} aria-hidden className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                      )}
                      {fmt(log.createdAt)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200 text-xs font-mono">
                    <span className="inline-flex items-center gap-1.5">
                      <span>{displayEmail(log.userEmail, log.userId)}</span>
                      {cls && verdictChip(cls.verdict)}
                    </span>
                  </td>
                  {tab === 'audit' ? (
                    <>
                      <td className="px-4 py-3">
                        <span className="font-mono text-indigo-600 dark:text-indigo-400 text-xs">{(log as AuditLogRow).action}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                        {/* Prefer the resolved name. `Booking cmr93ju2…` told a reader that
                            something happened to something; the id is only useful to somebody who
                            already has a database console open. The short ref stays because it is
                            what gets quoted in support, and the entityType remains the fallback for
                            projects that resolve no labels. */}
                        {(log as AuditLogRow).entityLabel ? (
                          <>
                            <span className="text-slate-700 dark:text-slate-200">{(log as AuditLogRow).entityLabel!.label}</span>
                            {(log as AuditLogRow).entityLabel!.ref && (
                              <span className="text-slate-400 dark:text-slate-600 ml-1 font-mono">#{(log as AuditLogRow).entityLabel!.ref}</span>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="text-slate-600 dark:text-slate-300">{(log as AuditLogRow).entityType ?? '—'}</span>
                            {(log as AuditLogRow).entityId && (
                              <span className="text-slate-400 dark:text-slate-600 ml-1 font-mono">
                                {(log as AuditLogRow).entityId!.slice(0, 8)}…
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-xs max-w-xs">
                        <span className="block truncate" title={auditDetail(log as AuditLogRow)}>
                          {auditDetail(log as AuditLogRow) || '—'}
                        </span>
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
                        {/* Tinted by severity, matching the pre-extraction behaviour. */}
                        <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${severityClass((log as SecurityLogRow).severity)}`}>
                          {(log as SecurityLogRow).event}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${severityClass((log as SecurityLogRow).severity)} bg-transparent dark:bg-transparent`}>
                          {(log as SecurityLogRow).severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs font-mono">{displayIp(log.ipAddress)}</td>
                    </>
                  )}
                </tr>
                {isAudit && open && (
                  // Solid surface, deliberately NOT a /opacity tint: a translucent dark background
                  // composites over the page backdrop to a washed mid-grey, and light value text on
                  // it fails contrast in dark mode (the bug this replaced). slate-800 is a hair
                  // lighter than the rows, so the drawer still reads as an inset panel.
                  <tr className="bg-slate-100 dark:bg-slate-800">
                    <td colSpan={headers.length} className="px-4 pb-4 pt-1">
                      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr] max-w-3xl">
                        <span className={DETAIL_LABEL}>Client</span>
                        <span className="flex items-center gap-2 flex-wrap text-xs">
                          {cls ? verdictChip(cls.verdict) : <span className="text-slate-400">—</span>}
                          <span className="text-slate-600 dark:text-slate-300">{cls?.reason ?? 'No user-agent was recorded for this request.'}</span>
                        </span>

                        <span className={DETAIL_LABEL}>IP address</span>
                        <span className="font-mono text-xs text-slate-800 dark:text-slate-100">{displayIp(a.ipAddress)}</span>

                        <span className={DETAIL_LABEL}>User agent</span>
                        <span className="font-mono text-xs break-all text-slate-800 dark:text-slate-100">{a.userAgent || '—'}</span>

                        <span className={DETAIL_LABEL}>Request ID</span>
                        <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{a.requestId || '—'}</span>

                        <span className={DETAIL_LABEL}>Session</span>
                        <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{a.sessionId || '—'}</span>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
                )
              })}
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
