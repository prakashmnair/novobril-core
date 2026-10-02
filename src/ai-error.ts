// Classify a failed Gemini API call so a route can tell a PERMANENT billing failure
// apart from a TRANSIENT rate limit.
//
// WHY THIS EXISTS. On 2026-09-18 QuizRazor's AI quiz generation began failing with
// `{"error":{"code":429,"message":"Your prepayment credits are depleted...","status":
// "RESOURCE_EXHAUSTED"}}` — the Novobril billing account had no prepayment method at
// all, so every call from its six projects had nothing to draw on. The route caught
// it and told the user "AI generation failed — try again or add questions manually".
// It can never succeed on retry. Presenters retried, failed, and concluded the
// product was broken. It stayed that way for two weeks and surfaced only because
// Google emailed about an unrelated tier change.
//
// THE DISTINCTION THAT MATTERS. `status: 'RESOURCE_EXHAUSTED'` covers BOTH cases:
// a genuine per-minute rate limit (retry works, and telling the user to wait is
// correct) and an empty wallet (retry can never work, and telling the user to wait
// is a lie). Only the message text separates them, so that is what is matched here.
// Getting this backwards in either direction is a real cost: say "permanent" to a
// rate limit and you send someone away who would have succeeded in ten seconds;
// say "try again" to an empty wallet and nobody ever finds out it is broken.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It never returns vendor text as the user
// message. Google's own wording is "Please go to AI Studio at ai.studio/projects to
// manage your project and billing" — screendex's chat route echoed `err.message`
// straight to the client, which would have shown an end user the operator's billing
// state. `userMessage` here is always written by us; the raw error belongs in logs.

export type AiErrorKind = 'BILLING_EXHAUSTED' | 'RATE_LIMITED' | 'UNKNOWN'

export interface AiErrorClassification {
  kind: AiErrorKind
  /** Safe to show an end user. Never contains vendor text, URLs, or billing state. */
  userMessage: string
  /**
   * Stable, greppable token for server logs — the thing a log-based alert matches on.
   * Kept constant per kind on purpose: an alert keyed to a message that someone later
   * rewords is an alert that silently stops firing.
   */
  logMarker: string
  /** True only when retrying the same call could plausibly succeed. */
  retryable: boolean
}

// Billing exhaustion, in the vendor's own words. `prepayment`/`credits`/`depleted`
// are what Gemini actually returns (confirmed against quizzly-prod's Cloud Run logs,
// 2026-09-18 and 2026-09-26); `billing`/`payment method`/`quota exceeded for quota
// metric` cover adjacent phrasings seen in Google's docs for the same condition.
const BILLING_PHRASES = [
  'prepayment',
  'prepaid',
  'credits are depleted',
  'depleted',
  'insufficient credit',
  'billing account',
  'payment method',
  'spending limit',
  'spend limit',
]

/**
 * Pull every bit of text worth matching out of an unknown thrown value.
 *
 * The SDK throws an `ApiError` whose `message` is the raw JSON body, but a fetch
 * wrapper may instead throw the parsed object, and a transport failure throws a
 * plain Error. Rather than guess the shape, collect what is readable and match over
 * the lot. Must never throw: this runs inside a catch block, and a classifier that
 * explodes turns a handled failure into an unhandled one.
 */
function readable(err: unknown): { text: string; code: number | null; status: string } {
  let text = ''
  let code: number | null = null
  let status = ''

  const visit = (v: unknown, depth: number): void => {
    if (depth > 4 || v == null) return
    if (typeof v === 'string') { text += ' ' + v; return }
    if (typeof v === 'number') return
    if (typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (typeof o.message === 'string') text += ' ' + o.message
    if (typeof o.status === 'string' && !status) status = o.status
    if (typeof o.code === 'number' && code == null) code = o.code
    if (o.error != null) visit(o.error, depth + 1)
    if (o.cause != null) visit(o.cause, depth + 1)
    if (Array.isArray(o.details)) for (const d of o.details) visit(d, depth + 1)
  }

  try {
    visit(err, 0)
    // The SDK's `message` is frequently a JSON document. Parsing it surfaces the
    // structured `code`/`status` that the string form hides.
    const brace = text.indexOf('{')
    if (brace !== -1) {
      try { visit(JSON.parse(text.slice(brace)), 1) } catch { /* not JSON — the raw text still matched below */ }
    }
  } catch { /* unreadable value — fall through to UNKNOWN */ }

  return { text: text.toLowerCase(), code, status: status.toUpperCase() }
}

/**
 * @param err      the value caught from a Gemini call
 * @param opts.manualFallback appended to the billing message, e.g. "You can add
 *                 questions manually." Keeps per-product copy in the product.
 */
export function classifyAiError(
  err: unknown,
  opts: { manualFallback?: string } = {},
): AiErrorClassification {
  const { text, code, status } = readable(err)
  const looksBilling = BILLING_PHRASES.some((p) => text.includes(p))

  // 402 Payment Required is unambiguous whatever the message says.
  if (code === 402 || looksBilling) {
    const tail = opts.manualFallback ? ` ${opts.manualFallback}` : ''
    return {
      kind: 'BILLING_EXHAUSTED',
      // No "try again": this cannot succeed until a human tops up the account.
      userMessage: `AI is temporarily unavailable.${tail}`,
      logMarker: 'AI_BILLING_EXHAUSTED',
      retryable: false,
    }
  }

  if (status === 'RESOURCE_EXHAUSTED' || code === 429) {
    return {
      kind: 'RATE_LIMITED',
      userMessage: 'AI is busy right now — try again in a moment.',
      logMarker: 'AI_RATE_LIMITED',
      retryable: true,
    }
  }

  return {
    kind: 'UNKNOWN',
    userMessage: 'AI request failed — please try again.',
    logMarker: 'AI_ERROR',
    retryable: true,
  }
}
