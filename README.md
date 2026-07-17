# @novobril/core

Shared, deliberately small v1 of the mandated cross-project features that turned out to be
pure and already converged (or trivial to newly create) across the Novobril portfolio. See
`admin/docs/patterns.md` (in the main `projects/` workspace) for the full research behind what
is and isn't in here — most of the "~20 mandated features" from CLAUDE.md are NOT in this
package yet, on purpose, because the research found real behavioral divergence or structural
coupling that needs its own reconciliation work first (audit/security logging, the full
superuser check, ProfileMenu, design tokens).

## What's here

| Export | Source of truth | Note |
|---|---|---|
| `ThemeToggle` | screendex | Byte-identical across screendex/smartassociation already |
| `ToastProvider`/`useToast`/`Toaster` | screendex | Canonical API; bookme independently reimplemented a different shape and will need to adapt its call sites when it adopts this |
| `ConfirmProvider`/`useConfirm`/`ConfirmDialog` | screendex | Same as above |
| `BackButton` | new | Formalizes the previously-inline `ChevronLeft` className (hand-typed in 28-60+ files per project) |
| `getRequestContext`/`getClientIp` | screendex | Includes the S-28 IP-spoofing fix (right-to-left XFF walk) — smartassociation/bookme were both still doing naive leftmost parsing before adopting this |
| `maskEmail`/`maskName`/`maskPhone`/`maskIp`/`scrubPii` | bookme | Chosen as canonical over screendex/smartassociation's simpler versions because of the entity-based non-PII allowlist — **this is a real behavior change** for any project whose masking output differs today, not a no-op |
| `isNovobrilSuperuser` | new (extracted from bookme/quizzly's pattern) | Just the hardcoded-email check — deliberately NOT the full request/cookie/DB-coupled superuser guard, which differs too much per project to share yet |

## Install

No private registry — this installs directly from a git tag:

```json
"@novobril/core": "github:prakashmnair/novobril-core#v0.1.0"
```

Ships raw `.ts` source (same pattern as screendex's internal `packages/types`) — no build step.
Your project's own Next.js/tsc compiles it like any other source file.

## Releasing a new version

No publish step — tag the commit and push the tag:
```
git tag v0.1.1 && git push --tags
```
Consuming projects pick it up on their next `npm install` once their `package.json` is bumped
to point at the new tag.

## Peer dependencies

`react`, `next`, `next-themes`, `lucide-react` — not bundled, expected to already exist in the
consuming project.
