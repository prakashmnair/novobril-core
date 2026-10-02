/**
 * classifyAiError — telling an empty wallet apart from a busy minute.
 *
 * WHAT THESE TESTS PROTECT. QuizRazor's AI quiz generation failed in production for
 * two weeks (2026-09-18 to 2026-10-02) while telling every user "try again". It
 * could not succeed on retry: the billing account had no prepayment method at all.
 * Two failure modes matter more than coverage:
 *
 *   1. Calling an empty wallet retryable. The user is told to wait, waits, fails,
 *      and concludes the product is broken — and because it reads like a transient
 *      blip, nobody investigates. That is exactly how it ran dead for a fortnight.
 *   2. Calling a rate limit permanent. The opposite error sends away a user whose
 *      next attempt would have worked.
 *
 * Both arrive as `status: 'RESOURCE_EXHAUSTED'`, so only the message separates them.
 *
 * The payloads below are the REAL ones from quizzly-prod's Cloud Run logs, not
 * invented: both a 429 and a 402 carrying identical billing text, which is why the
 * HTTP code alone is not a safe discriminator.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyAiError } from '../src/ai-error'

// quizzly-prod, 2026-09-18T19:22:40Z — thrown by the SDK with the JSON body as `message`.
const REAL_429 = new Error(
  '{"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing. Learn more at https://ai.google.dev/gemini-api/docs/billing#prepay. ","status":"RESOURCE_EXHAUSTED"}}',
)
// quizzly-prod, 2026-09-26T17:41:48Z — same text, different code.
const REAL_402 = new Error(
  '{"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing. ","status":"RESOURCE_EXHAUSTED"}}',
)
// A genuine per-minute limit: RESOURCE_EXHAUSTED with no billing language.
const REAL_RATE_LIMIT = {
  error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' },
}

test('the real 429 billing payload is permanent, not retryable', () => {
  const c = classifyAiError(REAL_429)
  assert.equal(c.kind, 'BILLING_EXHAUSTED')
  assert.equal(c.retryable, false)
  assert.equal(c.logMarker, 'AI_BILLING_EXHAUSTED')
})

test('the real 402 billing payload classifies the same way', () => {
  assert.equal(classifyAiError(REAL_402).kind, 'BILLING_EXHAUSTED')
})

test('a RESOURCE_EXHAUSTED rate limit stays retryable — the inverse error', () => {
  const c = classifyAiError(REAL_RATE_LIMIT)
  assert.equal(c.kind, 'RATE_LIMITED')
  assert.equal(c.retryable, true)
  assert.match(c.userMessage, /try again/i)
})

test('a billing failure never tells the user to try again', () => {
  assert.doesNotMatch(classifyAiError(REAL_429).userMessage, /try again/i)
})

test('vendor text never reaches the user message', () => {
  for (const err of [REAL_429, REAL_402]) {
    const m = classifyAiError(err).userMessage
    // screendex's chat route echoed err.message straight to the client, which would
    // have shown an end user the operator's billing console URL.
    assert.doesNotMatch(m, /ai\.studio|google|billing|prepay|credit/i)
  }
})

test('manualFallback puts product-specific copy in the product', () => {
  const c = classifyAiError(REAL_429, { manualFallback: 'You can add questions manually.' })
  assert.match(c.userMessage, /add questions manually/)
})

test('a parsed object, not just a JSON string, is classified', () => {
  const parsed = { error: { code: 429, message: 'Your prepayment credits are depleted.', status: 'RESOURCE_EXHAUSTED' } }
  assert.equal(classifyAiError(parsed).kind, 'BILLING_EXHAUSTED')
})

test('a nested cause is reached', () => {
  const outer = new Error('stream failed')
  ;(outer as Error & { cause?: unknown }).cause = REAL_429
  assert.equal(classifyAiError(outer).kind, 'BILLING_EXHAUSTED')
})

test('an unrelated failure is UNKNOWN and retryable', () => {
  const c = classifyAiError(new Error('socket hang up'))
  assert.equal(c.kind, 'UNKNOWN')
  assert.equal(c.retryable, true)
  assert.equal(c.logMarker, 'AI_ERROR')
})

test('never throws on junk — it runs inside a catch block', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  for (const junk of [null, undefined, 0, '', 'plain string', [], circular, Symbol('x')]) {
    assert.doesNotThrow(() => classifyAiError(junk as unknown))
  }
})

test('log markers are stable per kind — alerts key on them', () => {
  assert.equal(classifyAiError(REAL_429).logMarker, 'AI_BILLING_EXHAUSTED')
  assert.equal(classifyAiError(REAL_RATE_LIMIT).logMarker, 'AI_RATE_LIMITED')
  assert.equal(classifyAiError(new Error('x')).logMarker, 'AI_ERROR')
})
