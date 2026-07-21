// Standalone unit test for the audit/security factory logic — no jest, run with tsx:
//   npx tsx test/factory.test.ts   (uses a consuming project's tsx, e.g. screendex's)
// Lives outside src/ so it's never part of the package's import surface.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeLogAudit } from '../src/audit'
import { makeLogSecurity } from '../src/security-log'

test('makeLogAudit: applies defaults (entityType from action, outcome SUCCESS)', async () => {
  let row: any
  const logAudit = makeLogAudit({ persist: async (r) => { row = r } })
  await logAudit('PROFILE.UPDATE', { userId: 'u1', changes: { name: 'x' } })
  assert.equal(row.action, 'PROFILE.UPDATE')
  assert.equal(row.entityType, 'PROFILE') // derived from action prefix
  assert.equal(row.outcome, 'SUCCESS')
  assert.equal(row.userId, 'u1')
})

test('makeLogAudit: explicit entityType/outcome win over defaults', async () => {
  let row: any
  const logAudit = makeLogAudit({ persist: async (r) => { row = r } })
  await logAudit('X.Y', { entityType: 'CUSTOM', outcome: 'FAILURE' })
  assert.equal(row.entityType, 'CUSTOM')
  assert.equal(row.outcome, 'FAILURE')
})

test('makeLogAudit: scrubPii off (default) passes changes through raw', async () => {
  let row: any
  const logAudit = makeLogAudit({ persist: async (r) => { row = r } })
  await logAudit('U.CREATE', { changes: { email: 'a@b.com', count: 3 } })
  assert.deepEqual(row.changes, { email: 'a@b.com', count: 3 })
})

test('makeLogAudit: scrubPii on redacts PII keys, keeps non-PII', async () => {
  let row: any
  const logAudit = makeLogAudit({ persist: async (r) => { row = r }, scrubPii: true })
  await logAudit('U.CREATE', { changes: { email: 'a@b.com', count: 3 } })
  assert.equal(row.changes.email, '[REDACTED]')
  assert.equal(row.changes.count, 3)
})

test('makeLogAudit: a throwing persist is swallowed (never rejects)', async () => {
  const errs: unknown[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => { errs.push(a) }
  try {
    const logAudit = makeLogAudit({ persist: async () => { throw new Error('db down') } })
    await assert.doesNotReject(() => logAudit('X.Y', {}))
    assert.ok(errs.some((a: any) => String(a[0]).includes('[audit] Failed')))
  } finally {
    console.error = orig
  }
})

test('makeLogSecurity: severity defaults to INFO, no CRITICAL stdout', async () => {
  let row: any
  const lines: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => { lines.push(String(a[0])) }
  try {
    const logSecurity = makeLogSecurity({ persist: async (r) => { row = r } })
    await logSecurity('LOGIN_SUCCESS', { userId: 'u1' })
    assert.equal(row.severity, 'INFO')
    assert.equal(lines.length, 0) // nothing streamed for non-CRITICAL
  } finally {
    console.error = orig
  }
})

test('makeLogSecurity: CRITICAL emits one masked-email, masked-IP JSON line', async () => {
  // ipAddress masking fixed 2026-07-22 — this was raw/unmasked before, live in
  // production for every project already firing this CRITICAL path (screendex,
  // quizzly both fire it on superadmin grant/revoke).
  const lines: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => { lines.push(String(a[0])) }
  try {
    const logSecurity = makeLogSecurity({ persist: async () => {} })
    await logSecurity('SUPERADMIN_GRANTED', {
      userId: 'u1', userEmail: 'prakash@novobril.com', ipAddress: '203.0.113.7', severity: 'CRITICAL',
    })
    assert.equal(lines.length, 1)
    const payload = JSON.parse(lines[0])
    assert.equal(payload.severity, 'CRITICAL')
    assert.equal(payload.event, 'SUPERADMIN_GRANTED')
    assert.equal(payload.userEmail, 'pr***@novobril.com') // masked, not raw
    assert.equal(payload.ipAddress, '203.0.*.*') // masked, not raw
    assert.ok(payload.timestamp)
  } finally {
    console.error = orig
  }
})

test('makeLogSecurity: a null ipAddress stays undefined in the CRITICAL line, not masked into a garbage string', async () => {
  const lines: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => { lines.push(String(a[0])) }
  try {
    const logSecurity = makeLogSecurity({ persist: async () => {} })
    await logSecurity('SUPERADMIN_REVOKED', { userId: 'u1', severity: 'CRITICAL' })
    const payload = JSON.parse(lines[0])
    assert.equal(payload.ipAddress, undefined)
  } finally {
    console.error = orig
  }
})

test('makeLogSecurity: scrubPii on redacts details before persist', async () => {
  let row: any
  const logSecurity = makeLogSecurity({ persist: async (r) => { row = r }, scrubPii: true })
  await logSecurity('DATA_EXPORTED', { details: { email: 'a@b.com', rows: 10 } })
  assert.equal(row.details.email, '[REDACTED]')
  assert.equal(row.details.rows, 10)
})
