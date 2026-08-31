// Bot-vs-human classification from a request's User-Agent, for the audit log viewer.
//
// WHY THIS IS DELIBERATELY MODEST. A superadmin looking at anonymous PAGE.VIEW rows wants to know
// which are real prospects and which are crawlers. The RELIABLE half of that question is answered
// here: a huge amount of automated traffic *self-identifies* — Baiduspider, 360Spider, GPTBot,
// Amazonbot, curl, python-requests, empty user-agents. Those we call 'bot' with confidence.
//
// The UNRELIABLE half we refuse to guess at. A bot that spoofs a real browser UA cannot be told
// apart from a real browser by the string alone — a genuine Chrome and a headless Chrome print the
// same thing, and Google's own crawler currently reports `Chrome/151.0.7922.173`, so "the version
// looks too new" is not a bot tell (it mislabels real people the moment the browser catches up, and
// misses same-version spoofers today). When a UA looks like a browser we return 'human'; when it
// looks like neither a known bot nor a standard browser we return 'unknown'. The one rule that never
// bends: a heuristic must never accuse a real person of being a bot, so nothing here upgrades a
// browser-shaped UA to 'bot'. The operator still has the IP and the full UA on expand for the
// genuinely ambiguous rows.

export type ClientVerdict = 'bot' | 'human' | 'unknown'

export interface UaClassification {
  verdict: ClientVerdict
  /** A short, human sentence explaining the verdict — shown in the log viewer's expanded detail. */
  reason: string
}

// Substrings that only ever appear in automated clients — vendor crawler names, HTTP libraries,
// headless frameworks, scanners, and the safe generic tokens ('spider'/'crawler'/'scraper'/'slurp',
// which do not occur in real browser or device UAs). Matched case-insensitively.
//
// Deliberately NOT here: a bare 'bot'. It is a substring of real Android device models such as
// "CUBOT", so flagging it directly would accuse those phones' owners. The generic "<vendor>Bot"
// self-identifier is handled by BOT_TOKEN below, which requires 'bot' to be a real token.
const BOT_SUBSTRINGS = [
  // search + AI + social crawlers (vendor names, unambiguous)
  'googlebot', 'google-cloudvertexbot', 'googleother', 'google-inspectiontool', 'google-extended',
  'adsbot', 'mediapartners-google', 'apis-google', 'bingbot', 'bingpreview', 'yandex', 'baidu',
  'duckduck', 'sogou', 'seznam', 'exabot', 'gptbot', 'chatgpt', 'oai-searchbot', 'perplexity',
  'claudebot', 'anthropic-ai', 'ccbot', 'amazonbot', 'applebot', 'petalbot', 'bytespider',
  'facebookexternalhit', 'facebot', 'ia_archiver', 'archive.org', 'meta-externalagent',
  // safe generic self-identifiers
  'crawler', 'crawl', 'spider', 'scraper', 'slurp',
  // SEO / analytics / uptime / monitoring
  'semrush', 'ahrefs', 'mj12', 'dotbot', 'dataprovider', 'feedfetcher', 'lighthouse', 'gtmetrix',
  'pingdom', 'uptimerobot', 'statuscake', 'site24x7', 'newrelic', 'datadog',
  // headless / automation frameworks
  'headlesschrome', 'headless', 'phantomjs', 'puppeteer', 'playwright', 'selenium', 'scrapy', 'cypress',
  // scripts + HTTP libraries
  'python-requests', 'python-urllib', 'python/', 'aiohttp', 'httpx', 'curl/', 'wget', 'go-http-client',
  'okhttp', 'java/', 'libwww', 'lwp::', 'axios', 'node-fetch', 'undici', 'guzzle', 'httpclient',
  'apache-httpclient', 'restsharp', 'postmanruntime', 'insomnia',
  // scanners
  'zgrab', 'masscan', 'nmap', 'nuclei', 'censys', 'expanse', 'internetmeasurement', 'paloaltonetworks',
]

// Catches the generic "<vendor>Bot" self-identifier without matching device names. 'bot' must be a
// real token — immediately followed by a version/url/list delimiter (`/`, `;`, `)`) or at the very
// end of the string. "Googlebot/2.1" and "compatible; Foo-Bot;" match; "CUBOT P80 Build/…" does not,
// because there 'bot' is followed by a space.
const BOT_TOKEN = /bot(?:[/;)]|$)/i

// A genuine browser: the Mozilla/5.0 preamble plus a recognised engine token, OR the Safari pair
// (Version/… together with Safari/…), which is how desktop and iOS Safari present after UA reduction.
function looksLikeBrowser(lower: string): boolean {
  if (!/mozilla\/\d/.test(lower)) return false
  if (/(?:chrome|crios|firefox|fxios|edg|edga|edgios|opr|opera|samsungbrowser|ucbrowser)\/\d/.test(lower)) return true
  return lower.includes('safari/') && lower.includes('version/')
}

export function classifyUserAgent(uaRaw: string | null | undefined): UaClassification {
  const ua = (uaRaw ?? '').trim()

  // An empty or missing UA is not a browser — browsers always send one. In practice it is a script,
  // a scanner, or a raw HTTP client, so it counts as a bot rather than an unknown.
  if (!ua) return { verdict: 'bot', reason: 'No user-agent sent — typically a script or scanner, not a browser.' }

  const lower = ua.toLowerCase()

  const marker = BOT_SUBSTRINGS.find((m) => lower.includes(m))
  if (marker) return { verdict: 'bot', reason: `Self-identified automated client (matched "${marker}").` }
  if (BOT_TOKEN.test(lower)) return { verdict: 'bot', reason: 'Self-identified automated client (a "…Bot" agent).' }

  if (looksLikeBrowser(lower)) {
    return {
      verdict: 'human',
      // Honest hedge: this is what the UA claims, not proof of a person. A UA-spoofing bot lands here
      // too — the IP shown alongside is the tie-breaker for a suspicious row.
      reason: 'User-agent matches a genuine web browser (a spoofing bot can also look like this — check the IP).',
    }
  }

  return { verdict: 'unknown', reason: 'Unrecognised user-agent — neither a known bot nor a standard browser.' }
}
