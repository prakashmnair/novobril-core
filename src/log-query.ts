// Server-side halves of the audit/security log viewer.
//
// Same cut as `makeLogAudit`/`makeLogSecurity` in this package, one layer up:
// the package owns the parts that are identical everywhere (param parsing,
// clamping, the Prisma `where` shape, pagination meta, CSV escaping) and the
// project owns the two things only it knows — its auth guard and its Prisma
// delegate. A route ends up ~15 lines instead of ~50, and every project gets
// the same limit clamps and the same CSV hardening.

export type LogKind = 'audit' | 'security'

export interface LogQuery {
  page: number
  limit: number
  skip: number
  /** Prisma `where` — pass straight to `findMany`/`count`. */
  where: Record<string, unknown>
  /**
   * True when the caller is downloading a CSV rather than paging the table.
   * The viewer sets `?export=1` explicitly. Routes must emit a `DATA_EXPORTED`
   * security event (WARNING) when this is set — bulk extraction of an audit
   * trail is exactly the thing the audit trail should record.
   */
  isExport: boolean
}

export interface ParseLogQueryOptions {
  defaultLimit?: number
  /** Hard ceiling. Callers asking for more get clamped, never rejected. */
  maxLimit?: number
  /**
   * Extra equality filters merged into `where` — the escape hatch for
   * per-project columns the shared parser can't know about (`tenantId` in most
   * projects, `centreId` in sproutbase, absent in quizzly/screendex).
   * ALWAYS pass the tenant scope here from a trusted server-side source, never
   * from a query param.
   */
  scope?: Record<string, unknown>
}

function parseDateRange(from: string | null, to: string | null) {
  const gte = from ? new Date(from) : undefined
  const lte = to ? new Date(to) : undefined
  // An unparseable date silently became `Invalid Date` before this guard, which
  // Prisma then rejects at query time with an opaque error. Drop it instead.
  const valid = (d: Date | undefined) => (d && !Number.isNaN(d.getTime()) ? d : undefined)
  const g = valid(gte)
  const l = valid(lte)
  if (!g && !l) return undefined
  return { ...(g ? { gte: g } : {}), ...(l ? { lte: l } : {}) }
}

/**
 * Normalise `?page=&limit=&userId=&…` into a Prisma-ready query.
 *
 * `action`/`event` are matched case-insensitively with `contains` (they're the
 * fields people actually grep for); everything else is exact equality.
 */
export function parseLogQuery(
  searchParams: URLSearchParams,
  kind: LogKind,
  opts: ParseLogQueryOptions = {},
): LogQuery {
  const { defaultLimit = 50, maxLimit = 10_000, scope } = opts

  const rawPage = parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

  const rawLimit = parseInt(searchParams.get('limit') ?? String(defaultLimit), 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(maxLimit, Math.max(1, rawLimit)) : defaultLimit

  const userId = searchParams.get('userId') || undefined
  const createdAt = parseDateRange(searchParams.get('from'), searchParams.get('to'))

  const shared = {
    ...(userId ? { userId } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(scope ?? {}),
  }

  const where =
    kind === 'audit'
      ? {
          ...shared,
          ...(searchParams.get('action')
            ? { action: { contains: searchParams.get('action')!, mode: 'insensitive' as const } }
            : {}),
          ...(searchParams.get('outcome') ? { outcome: searchParams.get('outcome')! } : {}),
        }
      : {
          ...shared,
          ...(searchParams.get('event')
            ? { event: { contains: searchParams.get('event')!, mode: 'insensitive' as const } }
            : {}),
          ...(searchParams.get('severity') ? { severity: searchParams.get('severity')! } : {}),
        }

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    where,
    isExport: searchParams.get('export') === '1',
  }
}

export interface LogMeta {
  page: number
  limit: number
  total: number
  pages: number
}

export function buildLogMeta(total: number, page: number, limit: number): LogMeta {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
}

// A value that leads with one of these is interpreted as a formula by Excel and
// Google Sheets when the CSV is opened — the classic CSV-injection vector. Audit
// logs are attacker-influenced (an action name or user agent can contain
// anything), and their whole audience is admins opening the export in a
// spreadsheet, so neutralise it here rather than trusting every caller.
const FORMULA_LEAD = /^[=+\-@\t\r]/

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = value instanceof Date ? value.toISOString() : String(value)
  if (FORMULA_LEAD.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Serialise rows to CSV. Deliberately dependency-free — adding `papaparse` as a
 * peer would force it on all ten consuming projects for ~15 lines of work, and
 * papaparse does not do the formula-injection escaping above.
 */
export function toLogCsv<T extends Record<string, unknown>>(rows: T[], columns: (keyof T & string)[]): string {
  const header = columns.map(csvCell).join(',')
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))
  return [header, ...body].join('\n')
}

export const AUDIT_CSV_COLUMNS = [
  'id', 'createdAt', 'userId', 'userEmail', 'action', 'entityType', 'entityId', 'outcome', 'ipAddress',
] as const

export const SECURITY_CSV_COLUMNS = [
  'id', 'createdAt', 'userId', 'userEmail', 'event', 'severity', 'ipAddress',
] as const
