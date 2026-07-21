import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { searchHelpArticles, type HelpArticle } from '../src/help'

// These assert the *exact* scoring of the eight copies this replaces. Adoption
// has to be a behaviour-preserving import swap — if any weight changes here,
// every project's help search silently reorders.

type Cat = 'getting-started' | 'billing'

const article = (over: Partial<HelpArticle<Cat>> = {}): HelpArticle<Cat> => ({
  slug: 'a', category: 'getting-started', title: 'Title', summary: 'Summary',
  tags: [], sections: [], ...over,
})

describe('searchHelpArticles', () => {
  test('an empty or whitespace query returns nothing', () => {
    assert.deepEqual(searchHelpArticles([article()], ''), [])
    assert.deepEqual(searchHelpArticles([article()], '   '), [])
  })

  test('articles with no match are excluded entirely, not returned at score 0', () => {
    assert.equal(searchHelpArticles([article({ title: 'Billing' })], 'zzz').length, 0)
  })

  test('an exact title match scores 28 (20 exact + 8 includes)', () => {
    const [r] = searchHelpArticles([article({ title: 'Public link' })], 'public link')
    // Two terms, both in the title: 20+8 for "public", 20+8 for "link" = 56.
    // Locking the arithmetic down because it is easy to "tidy" the exact-match
    // bonus into the loop and silently double it.
    assert.equal(r.score, 56)
  })

  test('title beats tag beats summary beats body — the whole point of the weighting', () => {
    const results = searchHelpArticles([
      article({ slug: 'body', sections: [{ type: 'p', text: 'refund' }] }),
      article({ slug: 'summary', summary: 'refund' }),
      article({ slug: 'tag', tags: ['refund'] }),
      article({ slug: 'title', title: 'refund' }),
    ], 'refund')
    assert.deepEqual(results.map(r => r.article.slug), ['title', 'tag', 'summary', 'body'])
  })

  test('search is case-insensitive on both sides', () => {
    const [r] = searchHelpArticles([article({ title: 'REFUND Policy', tags: ['Billing'] })], 'refund billing')
    assert.ok(r.score > 0)
  })

  test('body text is indexed across every section type', () => {
    for (const section of [
      { type: 'p' as const, text: 'needle' },
      { type: 'note' as const, text: 'needle' },
      { type: 'warning' as const, text: 'needle' },
      { type: 'steps' as const, items: ['a', 'needle'] },
      { type: 'list' as const, items: ['needle'] },
      { type: 'image' as const, src: '/x.png', alt: 'needle', width: 1, height: 1 },
      { type: 'image' as const, src: '/x.png', alt: 'x', width: 1, height: 1, caption: 'needle' },
    ]) {
      const found = searchHelpArticles([article({ sections: [section] })], 'needle')
      assert.equal(found.length, 1, `section type ${section.type} should be searchable`)
    }
  })

  test('a partial tag match scores lower than an exact tag match', () => {
    const [exact] = searchHelpArticles([article({ tags: ['refund'] })], 'refund')
    const [partial] = searchHelpArticles([article({ tags: ['refunds-policy'] })], 'refund')
    // 7+4 (exact also satisfies includes) vs 4 — the ordering, not the numbers,
    // is what callers depend on.
    assert.ok(exact.score > partial.score)
  })

  test('QUIRK: adding a matching term can LOWER the score', () => {
    // Not a bug introduced here — this is how all eight copies behave, and the
    // extraction is deliberately behaviour-preserving. The +20 exact-title bonus
    // only fires when the *entire query* equals the title, so a more specific
    // query loses it:
    //   "refund"         -> 20 (exact) + 8 (includes)            = 28
    //   "refund billing" ->  8 (title) + 7 (tag) + 4 (tag part)  = 19
    // Pinned as a test so the behaviour is visible rather than surprising. Worth
    // revisiting — but as one deliberate change here, landing in all adopters at
    // once, which is precisely the point of sharing it.
    const a = article({ title: 'Refund', tags: ['billing'] })
    assert.equal(searchHelpArticles([a], 'refund')[0].score, 28)
    assert.equal(searchHelpArticles([a], 'refund billing')[0].score, 19)
  })

  test('multi-term queries do accumulate when no exact-title bonus is in play', () => {
    const a = article({ title: 'Payment settings', tags: ['billing'] })
    const one = searchHelpArticles([a], 'payment')[0]
    const both = searchHelpArticles([a], 'payment billing')[0]
    assert.ok(both.score > one.score)
  })

  test('results are sorted by score descending', () => {
    const r = searchHelpArticles([
      article({ slug: 'weak', sections: [{ type: 'p', text: 'refund' }] }),
      article({ slug: 'strong', title: 'refund', tags: ['refund'] }),
    ], 'refund')
    assert.deepEqual(r.map(x => x.article.slug), ['strong', 'weak'])
    assert.ok(r[0].score > r[1].score)
  })
})
