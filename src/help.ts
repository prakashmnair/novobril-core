// Help Center content model + search.
//
// `searchHelpArticles` was byte-for-byte identical in **8 of 10 projects** — the
// only difference across all eight was the example query inside a doc comment.
// 57 lines of pure logic, carried eight times, with no coupling to anything.
// That makes it the cleanest extraction in the portfolio and, incidentally, the
// strongest evidence the copy-paste problem is real: nobody diverged, they each
// just carried the same file.
//
// The types needed a smaller cut. `HelpSection` and the *shape* of `HelpArticle`
// are identical everywhere; what genuinely differs per project is the category
// vocabulary — screendex has `watchlists`/`tracking`, quizzly has
// `live-sessions`/`players`, taxagent has its own again. So `HelpArticle` is
// generic over its category union: each project keeps its own union and its own
// `HELP_CATEGORIES` array, and gets full type-safety on `category` without the
// package knowing anything about its domain.
//
//   // in the project:
//   import type { HelpArticle as CoreArticle } from '@novobril/core'
//   export type HelpCategoryId = 'getting-started' | 'live-sessions' | ...
//   export type HelpArticle = CoreArticle<HelpCategoryId>

export type HelpSection =
  | { type: 'p'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'list'; items: string[] }
  | { type: 'note'; text: string }
  | { type: 'warning'; text: string }
  | { type: 'image'; src: string; alt: string; width: number; height: number; caption?: string }

// width/height are the screenshot's real captured pixel dimensions (not a
// display size) — the renderer sizes its box to that exact aspect ratio via CSS
// `aspect-ratio`, so differently-shaped screenshots never sit inside a
// fixed-height box with dead letterboxed space around them.
export interface HelpArticle<TCategory extends string = string> {
  slug: string
  category: TCategory
  title: string
  summary: string
  tags: string[]
  screenshot?: { src: string; alt: string; width: number; height: number }
  sections: HelpSection[]
  related?: string[] // slugs
}

export interface HelpCategory<TCategory extends string = string> {
  id: TCategory
  label: string
  description: string
}

export interface HelpSearchResult<TCategory extends string = string> {
  article: HelpArticle<TCategory>
  score: number
}

function sectionText(section: HelpSection): string {
  switch (section.type) {
    case 'p':
    case 'note':
    case 'warning':
      return section.text
    case 'steps':
    case 'list':
      return section.items.join(' ')
    case 'image':
      return section.alt + ' ' + (section.caption ?? '')
  }
}

function bodyText(article: HelpArticle<string>): string {
  return article.sections.map(sectionText).join(' ')
}

/**
 * Small hand-rolled scorer — deliberately not a search-as-a-service dependency.
 * At a few dozen articles, weighted substring matching over
 * title/tags/summary/body comfortably covers real queries without the bundle
 * size or infra of a full search library. Title and tag matches are weighted far
 * above body text so a query matching an article's title surfaces it ahead of a
 * paragraph that merely mentions the phrase in passing.
 *
 * Scoring is unchanged from the eight copies this replaces — deliberately, so
 * adoption is a behaviour-preserving import swap. Tuning it is a separate change
 * that should be made once, here, and land everywhere at once.
 */
export function searchHelpArticles<TCategory extends string = string>(
  articles: HelpArticle<TCategory>[],
  query: string,
): HelpSearchResult<TCategory>[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return []
  const terms = trimmed.split(/\s+/).filter(Boolean)

  const results: HelpSearchResult<TCategory>[] = []
  for (const article of articles) {
    const title = article.title.toLowerCase()
    const summary = article.summary.toLowerCase()
    const tags = article.tags.map(t => t.toLowerCase())
    const body = bodyText(article).toLowerCase()

    let score = 0
    for (const term of terms) {
      if (title === trimmed) score += 20
      if (title.includes(term)) score += 8
      if (tags.some(t => t === term)) score += 7
      if (tags.some(t => t.includes(term))) score += 4
      if (summary.includes(term)) score += 3
      if (body.includes(term)) score += 1
    }
    if (score > 0) results.push({ article, score })
  }

  return results.sort((a, b) => b.score - a.score)
}
