import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskEmail, maskName, maskPhone, maskIp } from '../src/pii'

test('maskName never returns an email address verbatim', () => {
  // The defect: the first whitespace-separated part was returned as-is, and an
  // address has no spaces — so it passed straight through, unmasked, every time.
  // Shipped in bookme (B-162) and in quizzly's admin user list.
  for (const addr of ['prakashmnair@gmail.com', 'jane.doe@example.co.uk', ' spaced@example.com ']) {
    const out = maskName(addr)
    assert.notEqual(out, addr.trim(), `maskName leaked ${addr}`)
    assert.ok(!out.includes(addr.trim().split('@')[0]), `maskName leaked the local part of ${addr}`)
  }
})

test('maskName still abbreviates ordinary names', () => {
  assert.equal(maskName('Jane Smith'), 'Jane S***')
  assert.equal(maskName('Ada Lovelace King'), 'Ada L*** K***')
})

test('maskEmail keeps the domain and hides the local part', () => {
  assert.equal(maskEmail('someone@example.com'), 'so***@example.com')
  assert.equal(maskEmail('not-an-address'), '***')
})

test('maskPhone and maskIp keep only what is not identifying', () => {
  assert.equal(maskPhone('+61 400 123 456'), '*******3456')
  // Two octets kept, two masked. Note bookme's lib/pii.ts documents this as
  // "203.x.x.x", which is not what the code does — the comment is stale, and
  // asserting it here is how I found that out.
  assert.equal(maskIp('203.0.113.42'), '203.0.*.*')
})
