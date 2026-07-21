// Shared security-log writer factory. Same injection model as makeLogAudit (project supplies
// `persist`), and additionally owns the ONE unified CRITICAL→stdout format. This replaces the 4
// divergent per-project variants (console.error vs console.log; email masked / unmasked / omitted)
// — the unified version ALWAYS masks email via maskEmail, which closes bookme's prior raw-email-to-
// Cloud-Logging leak. The stdout JSON's `severity: 'CRITICAL'` is what GCP Cloud Logging keys on.
//
// ipAddress is ALSO masked here (fixed 2026-07-22) — it wasn't originally, despite IP being listed
// as PII requiring server-log scrubbing by this portfolio's own policy just as much as email. The
// gap was live, not latent: screendex and quizzly already fire this CRITICAL path on every
// superadmin grant/revoke, so raw IPs had been shipping to GCP Cloud Logging on every one of those
// events since the factory's v0.2.0 release. Found auditing this file for smartreceipt's adoption.

import { scrubPii, maskEmail, maskIp } from './pii'

export type SecuritySeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface SecurityLogOptions {
  userId?: string | null
  userEmail?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  tenantId?: string | null
  severity?: SecuritySeverity
  details?: Record<string, unknown>
}

/** Normalized record handed to the project's `persist`. `severity` always set (satisfies schemas
 * where the column is required, e.g. smartreceipt). */
export interface SecurityRow {
  event: string
  userId?: string | null
  userEmail?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  tenantId?: string | null
  severity: SecuritySeverity
  details?: Record<string, unknown>
}

export interface MakeLogSecurityConfig {
  /** Persist the row — typically `(r) => db.securityLog.create({ data: { ... } })`. */
  persist: (row: SecurityRow) => Promise<unknown>
  /** When true, PII keys in `details` are redacted before persisting (default false). */
  scrubPii?: boolean
}

/**
 * Build a project's `logSecurity(event, opts)`. Call once in the project's thin
 * `lib/security-log.ts` and re-export, so existing call sites are unchanged. Persist failures are
 * swallowed; a CRITICAL event additionally emits a masked-email JSON line to stdout for tamper-
 * evident Cloud Logging.
 */
export function makeLogSecurity(cfg: MakeLogSecurityConfig) {
  return async function logSecurity(event: string, opts: SecurityLogOptions = {}): Promise<void> {
    const severity: SecuritySeverity = opts.severity ?? 'INFO'
    try {
      const details = opts.details && cfg.scrubPii ? scrubPii(opts.details) : opts.details
      await cfg.persist({
        event,
        userId: opts.userId,
        userEmail: opts.userEmail,
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
        tenantId: opts.tenantId,
        severity,
        details,
      })

      // Stream CRITICAL events to GCP Cloud Logging for tamper-evident storage. Email and IP are
      // always masked here (single unified format across all projects).
      if (severity === 'CRITICAL') {
        console.error(
          JSON.stringify({
            severity: 'CRITICAL',
            message: `[security] ${event}`,
            event,
            userId: opts.userId ?? undefined,
            userEmail: opts.userEmail ? maskEmail(opts.userEmail) : undefined,
            ipAddress: opts.ipAddress ? maskIp(opts.ipAddress) : undefined,
            tenantId: opts.tenantId ?? undefined,
            timestamp: new Date().toISOString(),
          }),
        )
      }
    } catch {
      // Never let a logging failure break the main request.
      console.error('[security-log] Failed to write security log:', event)
    }
  }
}
