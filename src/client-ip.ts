// Cloud Run's load balancer appends its own observed peer IP as the rightmost hop on
// x-forwarded-for — it does not validate or strip whatever the client already sent to the
// left of that. Trusting the leftmost entry lets any caller inject an arbitrary IP —
// including '127.0.0.1', a value scanners deliberately send to probe for "trust localhost"
// bypass bugs — straight into security/audit logs. Walk from the right instead, skipping
// private/loopback hops, to find the first hop Cloud Run itself actually observed.
// (Originally fixed in screendex as S-28; backported here since smartassociation/bookme were
// both still doing naive leftmost parsing — see admin/docs/patterns.md.)
function isPrivateOrLoopback(ip: string): boolean {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  )
}

export function getClientIp(req: Request): string | undefined {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const ips = xff.split(',').map((s) => s.trim()).filter(Boolean)
    for (let i = ips.length - 1; i >= 0; i--) {
      if (!isPrivateOrLoopback(ips[i])) return ips[i]
    }
    if (ips.length > 0) return ips[0]
  }
  return req.headers.get('x-real-ip') ?? undefined
}
