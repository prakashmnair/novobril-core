import { NextRequest } from 'next/server'
import { getClientIp } from './client-ip'

export function getRequestContext(req: NextRequest) {
  return {
    ipAddress: getClientIp(req),
    userAgent: req.headers.get('user-agent') ?? undefined,
    requestId: req.headers.get('x-request-id') ?? crypto.randomUUID(),
  }
}
