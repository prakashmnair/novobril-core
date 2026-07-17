export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const masked = local.slice(0, 2) + '***'
  return `${masked}@${domain}`
}

export function maskName(name: string): string {
  const parts = name.trim().split(' ')
  return parts.map((p, i) => (i === 0 ? p : p[0] + '***')).join(' ')
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '***'
  return digits.slice(0, -4).replace(/./g, '*') + digits.slice(-4)
}

export function maskIp(ip: string): string {
  const parts = ip.split('.')
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.*`
  }
  // IPv6
  const segments = ip.split(':')
  return segments.slice(0, 3).join(':') + ':****'
}

// Some entities legitimately have a "name"-shaped field that is business/
// product data, not a personal name — e.g. TicketCategory.name is "Adult"/
// "VIP", not a customer's name. The generic PII keyword match below can't
// tell these apart from a bare key name alone, so callers that know their
// entity type (audit log actions are "ENTITY.VERB") can pass it here to
// exempt those specific fields. Extend this map per-project as new
// legitimately-non-PII "name"-shaped fields are found.
const NON_PII_FIELDS_BY_ENTITY: Record<string, Set<string>> = {
  TICKET_CATEGORY: new Set(['name', 'description']),
  SERVICE: new Set(['name', 'category', 'description']),
  PROVIDER: new Set(['businessName', 'description']),
}

export function scrubPii<T extends Record<string, unknown>>(obj: T, entityType?: string): Partial<T> {
  const piiKeys = ['email', 'phone', 'name', 'firstName', 'lastName', 'address', 'dob', 'ip', 'ipAddress']
  const allowlist = entityType ? NON_PII_FIELDS_BY_ENTITY[entityType] : undefined
  const result: Partial<T> = {}
  for (const [key, value] of Object.entries(obj)) {
    const exempt = allowlist?.has(key)
    if (!exempt && piiKeys.some(k => key.toLowerCase().includes(k))) {
      result[key as keyof T] = '[REDACTED]' as unknown as T[keyof T]
    } else {
      result[key as keyof T] = value as T[keyof T]
    }
  }
  return result
}
