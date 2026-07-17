const SUPERUSER_EMAIL = 'prakashmnair@gmail.com'

/**
 * The one hardcoded rule every project must enforce: this email is always a superuser, and no
 * one — including this account itself — can revoke it. This is intentionally the ONLY piece of
 * the superuser pattern shared here; the surrounding request/cookie/DB-session plumbing differs
 * too much per project to unify yet (4 genuinely different architectures found — see
 * admin/docs/patterns.md). Callers still need their own enforcement around this check
 * (self-revoke guard, audit logging of grants/revokes, etc. per admin/docs/templates/superuser.md).
 */
export function isNovobrilSuperuser(email: string | null | undefined): boolean {
  return email?.toLowerCase() === SUPERUSER_EMAIL
}
