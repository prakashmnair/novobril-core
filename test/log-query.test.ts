import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseLogQuery, buildLogMeta, toLogCsv, AUDIT_CSV_COLUMNS,
} from '../src/log-query'

const sp = (q: string) => new URLSearchParams(q)

describe('parseLogQuery — pagination', () => {
  test('defaults to page 1 with the default limit', () => {
    const q = parseLogQuery(sp(''), 'audit')
    assert.equal(q.page, 1)
    assert.equal(q.limit, 50)
    assert.equal(q.skip, 0)
  })

  test('clamps limit to maxLimit rather than rejecting', () => {
    assert.equal(parseLogQuery(sp('limit=999999'), 'audit').limit, 10_000)
    assert.equal(parseLogQuery(sp('limit=999999'), 'audit', { maxLimit: 100 }).limit, 100)
  })

  test('rejects junk and non-positive paging instead of producing a negative skip', () => {
    // `skip: -50` is the bug this guards: Prisma throws, and a hand-rolled
    // route that trusted parseInt would 500 on `?page=0`.
    for (const q of ['page=0', 'page=-3', 'page=abc', 'page=']) {
      const r = parseLogQuery(sp(q), 'audit')
      assert.equal(r.page, 1, q)
      assert.equal(r.skip, 0, q)
    }
    assert.equal(parseLogQuery(sp('limit=0'), 'audit').limit, 1)
    assert.equal(parseLogQuery(sp('limit=-10'), 'audit').limit, 1)
  })

  test('skip follows page and limit', () => {
    const q = parseLogQuery(sp('page=3&limit=25'), 'audit')
    assert.equal(q.skip, 50)
  })

  test('isExport is only set by an explicit export=1', () => {
    // Routes gate the DATA_EXPORTED security event on this, so a large page
    // must NOT be mistaken for an export, and vice versa.
    assert.equal(parseLogQuery(sp('export=1'), 'audit').isExport, true)
    assert.equal(parseLogQuery(sp('limit=10000'), 'audit').isExport, false)
    assert.equal(parseLogQuery(sp(''), 'audit').isExport, false)
    assert.equal(parseLogQuery(sp('export=0'), 'audit').isExport, false)
  })
})

describe('parseLogQuery — filters', () => {
  test('audit: action is a case-insensitive contains, outcome is exact', () => {
    const { where } = parseLogQuery(sp('action=quiz.create&outcome=FAILURE'), 'audit')
    assert.deepEqual(where.action, { contains: 'quiz.create', mode: 'insensitive' })
    assert.equal(where.outcome, 'FAILURE')
  })

  test('security: event/severity map to their own fields', () => {
    const { where } = parseLogQuery(sp('event=LOGIN&severity=CRITICAL'), 'security')
    assert.deepEqual(where.event, { contains: 'LOGIN', mode: 'insensitive' })
    assert.equal(where.severity, 'CRITICAL')
    assert.ok(!('action' in where))
    assert.ok(!('outcome' in where))
  })

  test('omits absent and empty filters entirely', () => {
    const { where } = parseLogQuery(sp('userId=&action='), 'audit')
    assert.deepEqual(where, {})
  })

  test('an unparseable date is dropped, not passed through as Invalid Date', () => {
    // Prisma rejects an Invalid Date with an opaque error; silently ignoring a
    // malformed `?from=` is the kinder failure.
    const { where } = parseLogQuery(sp('from=not-a-date'), 'audit')
    assert.deepEqual(where, {})
  })

  test('a valid date range becomes gte/lte', () => {
    const { where } = parseLogQuery(sp('from=2026-01-01&to=2026-02-01'), 'audit')
    const range = where.createdAt as { gte: Date; lte: Date }
    assert.equal(range.gte.toISOString().slice(0, 10), '2026-01-01')
    assert.equal(range.lte.toISOString().slice(0, 10), '2026-02-01')
  })

  test('scope is merged in — this is how tenant isolation is enforced', () => {
    const { where } = parseLogQuery(sp('userId=u1'), 'audit', { scope: { tenantId: 't1' } })
    assert.equal(where.tenantId, 't1')
    assert.equal(where.userId, 'u1')
  })

  test('a query param cannot override the server-supplied scope', () => {
    // The whole point: scope is applied last, so ?tenantId=other is inert.
    const { where } = parseLogQuery(sp('tenantId=attacker'), 'audit', { scope: { tenantId: 'real' } })
    assert.equal(where.tenantId, 'real')
  })
})

describe('buildLogMeta', () => {
  test('computes page count', () => {
    assert.deepEqual(buildLogMeta(120, 2, 50), { page: 2, limit: 50, total: 120, pages: 3 })
  })

  test('an empty table still reports one page, never zero', () => {
    assert.equal(buildLogMeta(0, 1, 50).pages, 1)
  })
})

describe('toLogCsv', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: '1', createdAt: '2026-07-20T00:00:00Z', userId: 'u1', userEmail: 'a@b.com',
    action: 'QUIZ.CREATE', entityType: 'QUIZ', entityId: 'q1', outcome: 'SUCCESS',
    ipAddress: '1.2.3.4', ...over,
  })

  test('emits a header row then the data', () => {
    const csv = toLogCsv([row()], AUDIT_CSV_COLUMNS as unknown as string[])
    const [header, first] = csv.split('\n')
    assert.equal(header, 'id,createdAt,userId,userEmail,action,entityType,entityId,outcome,ipAddress')
    assert.ok(first.startsWith('1,2026-07-20T00:00:00Z,u1,a@b.com,QUIZ.CREATE'))
  })

  test('null and undefined become empty cells', () => {
    const csv = toLogCsv([row({ userId: null, entityId: undefined })], ['userId', 'entityId'])
    assert.equal(csv.split('\n')[1], ',')
  })

  test('quotes and escapes cells containing commas, quotes or newlines', () => {
    const csv = toLogCsv([row({ action: 'A,B' })], ['action'])
    assert.equal(csv.split('\n')[1], '"A,B"')
    assert.equal(toLogCsv([row({ action: 'say "hi"' })], ['action']).split('\n')[1], '"say ""hi"""')
  })

  test('neutralises spreadsheet formula injection', () => {
    // Audit content is attacker-influenced (an action name, a user agent), and
    // the export's entire audience opens it in Excel/Sheets. A leading =, +, -
    // or @ would otherwise execute on open.
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      const cell = toLogCsv([row({ action: dangerous })], ['action']).split('\n')[1]
      assert.ok(cell.startsWith("'"), `${dangerous} should be prefixed, got ${cell}`)
    }
  })

  test('a formula that also needs quoting gets both treatments', () => {
    const cell = toLogCsv([row({ action: '=a,b' })], ['action']).split('\n')[1]
    assert.equal(cell, `"'=a,b"`)
  })

  test('no rows still yields a usable header-only file', () => {
    assert.equal(toLogCsv([], ['id', 'action']), 'id,action')
  })
})
