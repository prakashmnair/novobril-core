// Shared audit-log writer factory. The package owns the cross-cutting behavior (defaults,
// optional PII scrubbing, error swallowing) but NOT the DB write — each project injects a
// `persist` callback that maps the normalized row onto its own Prisma model (schemas have
// drifted: tenant column name, changes String-vs-Json, missing columns, etc. — all handled
// naturally in the project's own typed persist). This keeps @novobril/core free of any
// @prisma/client coupling. See admin/docs/patterns.md.

import { scrubPii } from './pii'

export interface AuditOptions {
  userId?: string | null
  userEmail?: string | null
  sessionId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  /** Tenant scope (associationId / storeId / etc.). Omit for single-tenant projects. */
  tenantId?: string | null
  /** Defaults to the part of `action` before the first `.` (e.g. "PROFILE" from "PROFILE.UPDATE"). */
  entityType?: string
  entityId?: string | null
  changes?: Record<string, unknown>
  metadata?: Record<string, unknown>
  outcome?: 'SUCCESS' | 'FAILURE' | 'ERROR' | string
  requestId?: string | null
}

/** Normalized record handed to the project's `persist`. Defaults already applied. */
export interface AuditRow {
  action: string
  userId?: string | null
  userEmail?: string | null
  sessionId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  tenantId?: string | null
  entityType: string
  entityId?: string | null
  changes?: Record<string, unknown>
  metadata?: Record<string, unknown>
  outcome: string
  requestId?: string | null
}

export interface MakeLogAuditConfig {
  /** Persist the row — typically `(r) => db.auditLog.create({ data: { ... } })`. */
  persist: (row: AuditRow) => Promise<unknown>
  /** When true, PII keys in `changes`/`metadata` are redacted before persisting (default false). */
  scrubPii?: boolean
}

/**
 * Build a project's `logAudit(action, opts)`. Call once in the project's thin `lib/audit.ts`
 * and re-export the result, so existing call sites (`import { logAudit } from '@/lib/audit'`)
 * are unchanged. Logging failures are swallowed — audit logging must never break the request.
 */
export function makeLogAudit(cfg: MakeLogAuditConfig) {
  return async function logAudit(action: string, opts: AuditOptions = {}): Promise<void> {
    try {
      const entityType = opts.entityType ?? action.split('.')[0]
      const changes = opts.changes && cfg.scrubPii ? scrubPii(opts.changes, entityType) : opts.changes
      const metadata = opts.metadata && cfg.scrubPii ? scrubPii(opts.metadata, entityType) : opts.metadata
      await cfg.persist({
        action,
        userId: opts.userId,
        userEmail: opts.userEmail,
        sessionId: opts.sessionId,
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
        tenantId: opts.tenantId,
        entityType,
        entityId: opts.entityId,
        changes,
        metadata,
        outcome: opts.outcome ?? 'SUCCESS',
        requestId: opts.requestId,
      })
    } catch (err) {
      // Never let a logging failure break the main request.
      console.error('[audit] Failed to write audit log:', action, err)
    }
  }
}
