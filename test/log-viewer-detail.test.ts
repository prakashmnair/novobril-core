/**
 * auditDetail — the Detail column of the shared LogViewer.
 *
 * WHY IT EXISTS. The audit table rendered `entityType` and a truncated id — "PAGE  cmr93ju2…" —
 * which reports that something happened to something and nothing else. The information needed to
 * read the row was already being sent: bookme's page-view beacon stores
 * `{ page: 'Team', path: '/settings/team' }` on every row, so the table could have said
 * "Viewed Team" and instead said "PAGE". Seven projects share this component and all seven had the
 * same blindness.
 *
 * WHY THE TESTS ARE MOSTLY ABOUT GARBAGE INPUT. No two consuming projects agree on a `changes`
 * shape — there was never a reason to, because nothing read it. So the risk here is not "does it
 * format nicely", it is "does it throw on a shape its author never saw". This runs inside the log
 * viewer, which is the screen an operator opens when something is already wrong; a helper that
 * throws there takes down the tool being used to diagnose the original problem.
 *
 * Every case below therefore asserts BOTH that it does not throw and that it degrades to a value
 * the table can render.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditDetail, type AuditLogRow } from '../src/LogViewer'

const row = (over: Partial<AuditLogRow>): AuditLogRow => ({
  id: 'a', createdAt: '2026-08-30T00:00:00Z', userId: null, userEmail: null,
  action: 'X.Y', entityType: null, entityId: null, outcome: 'SUCCESS', ipAddress: null,
  ...over,
})

test('renders a page view as a sentence', () => {
  // The case that motivated the column. The generic summary would read
  // "page: Team · path: /settings/team", which is worse than the thing it replaces.
  assert.equal(
    auditDetail(row({ action: 'PAGE.VIEW', changes: { page: 'Team', path: '/settings/team' } })),
    'Viewed Team',
  )
})

test('summarises an ordinary changes object', () => {
  const out = auditDetail(row({ changes: { self: true, assignee: 'Sarath S P' } }))
  assert.equal(out, 'self: true · assignee: Sarath S P')
})

test('falls back to metadata when there is no changes', () => {
  assert.equal(auditDetail(row({ metadata: { reason: 'manual correction' } })), 'reason: manual correction')
})

test('caps at three fields so the cell stays one line', () => {
  const out = auditDetail(row({ changes: { a: 1, b: 2, c: 3, d: 4, e: 5 } }))
  assert.equal(out, 'a: 1 · b: 2 · c: 3 · …')
})

test('truncates a long value rather than overflowing the column', () => {
  const out = auditDetail(row({ changes: { note: 'x'.repeat(80) } }))
  assert.ok(out.length < 45, `expected a truncated value, got ${out.length} chars`)
  assert.ok(out.endsWith('…'))
})

// ── The shapes a helper written for one project meets in another ────────────────────────────────

test('a project that sends no changes at all renders empty, not a crash', () => {
  // Consumers whose endpoint narrows its Prisma select simply have no `changes`. That must be an
  // empty cell, not an upgrade that breaks their log viewer.
  assert.equal(auditDetail(row({})), '')
})

test.each = undefined // (node:test has no .each; the cases below are explicit on purpose)

for (const [name, changes] of [
  ['null', null],
  ['undefined', undefined],
  ['a string', 'not an object'],
  ['a number', 42],
  ['an array', [1, 2, 3]],
  ['an empty object', {}],
  ['an object of only nulls', { a: null, b: undefined }],
] as const) {
  test(`survives ${name}`, () => {
    let out = 'UNSET'
    assert.doesNotThrow(() => { out = auditDetail(row({ changes })) })
    assert.equal(typeof out, 'string')
  })
}

test('a nested object is elided, not stringified into [object Object]', () => {
  const out = auditDetail(row({ changes: { before: { a: 1 }, after: { a: 2 } } }))
  assert.equal(out, 'before: … · after: …')
  assert.ok(!out.includes('[object'))
})

test('a non-string page field is ignored rather than trusted', () => {
  // `page` is special-cased; another project could legitimately use that key for something else.
  const out = auditDetail(row({ changes: { page: 3 } }))
  assert.equal(out, 'page: 3')
})

test('an empty-string page falls through to the generic summary', () => {
  const out = auditDetail(row({ changes: { page: '', path: '/x' } }))
  assert.equal(out, 'path: /x')
})
