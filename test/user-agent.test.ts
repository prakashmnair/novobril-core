/**
 * classifyUserAgent — the Bot/Human/Unknown badge in the shared LogViewer.
 *
 * WHAT THESE TESTS PROTECT. The badge exists so a superadmin can tell crawler noise from real
 * prospects in the anonymous PAGE.VIEW rows. Two failure modes matter more than raw accuracy:
 *
 *   1. Calling a real person a bot. A heuristic that flags a "CUBOT" phone — a real Android device
 *      whose model name simply ends in "bot" — as automated would quietly slander real traffic. The
 *      generic-bot matcher is built to avoid exactly that, so it is pinned here with a device UA.
 *   2. Pretending to catch spoofers it cannot. A headless browser and a real browser print the same
 *      user-agent, and Google's own crawler reports `Chrome/151.0.7922.173` — so a browser-shaped UA
 *      is classified 'human' with an honest hedge, never upgraded to 'bot' on a version guess.
 *
 * The UAs below are taken from bookme's real production request logs, not invented.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyUserAgent } from '../src/user-agent'

const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/143.0.0.0 Mobile Safari/537.36'
const CUBOT = 'Mozilla/5.0 (Linux; Android 11; CUBOT P80 Build/RP1A.200720.011) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.173 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const BAIDU = 'Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)'
const SPIDER_360 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0; 360Spider'

test('self-identified crawlers are bots — even when the UA also carries a browser token', () => {
  // Googlebot and 360Spider both embed a full Chrome/Edge UA; the bot marker must win over the
  // browser shape, or every modern crawler would read as human.
  for (const ua of [GOOGLEBOT, BAIDU, SPIDER_360]) {
    assert.equal(classifyUserAgent(ua).verdict, 'bot', ua)
  }
})

test('AI, scanner, and script clients are bots', () => {
  for (const ua of [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.3; +https://openai.com/gptbot)',
    'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    'Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)',
    'Mozilla/5.0 (compatible; Google-CloudVertexBot; +https://cloud.google.com/vertex-ai-bot)',
    'curl/8.7.1',
    'python-requests/2.31.0',
    'PostmanRuntime/7.36.0',
  ]) {
    assert.equal(classifyUserAgent(ua).verdict, 'bot', ua)
  }
})

test('an empty or missing user-agent is a bot, and never throws', () => {
  for (const ua of ['', '   ', null, undefined]) {
    assert.equal(classifyUserAgent(ua as string | null | undefined).verdict, 'bot')
  }
})

test('real browsers are human — including the ambiguous reduced-UA Chrome', () => {
  // CHROME_MAC is the exact string that made 448 requests in a day; UA reduction makes every macOS
  // Chrome user identical, so it is classified 'human' with a hedge, NOT bot-by-volume (the viewer
  // has no volume context per row anyway).
  for (const ua of [CHROME_MAC, IPHONE_SAFARI, SAMSUNG,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  ]) {
    assert.equal(classifyUserAgent(ua).verdict, 'human', ua)
  }
})

test('a real device whose model ends in "bot" (CUBOT) is NOT flagged as a bot', () => {
  // The whole reason the generic matcher requires 'bot' to be a delimited token: "CUBOT P80" is a
  // person on a phone, not a crawler.
  assert.equal(classifyUserAgent(CUBOT).verdict, 'human')
})

test('a non-browser, non-bot string is unknown, not guessed either way', () => {
  assert.equal(classifyUserAgent('Mozilla/5.0 (compatible; MysteryClient/1.0)').verdict, 'unknown')
  assert.equal(classifyUserAgent('-').verdict, 'unknown')
})

test('the reason names the matched marker for a self-identified bot', () => {
  assert.match(classifyUserAgent(BAIDU).reason, /baidu|spider/i)
})
