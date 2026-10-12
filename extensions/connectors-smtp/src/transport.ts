/**
 * File Name: transport.ts
 * Purpose: The SMTP transport, and the two decisions that are this pack's own
 *          rather than the platform's.
 *
 *          1. WHAT A CONNECTION MAY REACH. Every other connector names its
 *             hosts and the platform binds the client to them; an SMTP
 *             connection's host is the operator's, so the bound seam cannot
 *             apply. `smtpTarget` is the check that replaces it: a host and a
 *             port, parsed from the sealed material, refusing anything that is
 *             not a plain hostname and refusing a LOOPBACK or private address
 *             unless the connection says so deliberately - because "send mail
 *             through localhost:25" from a workspace form is how a CMS becomes
 *             an internal port scanner.
 *
 *          2. HOW THE SOCKET IS OPENED. nodemailer, with the credentials the
 *             platform sealed, and `secure` derived from the port the way
 *             every mail client does (465 implicit TLS, otherwise STARTTLS).
 *             Pure and injectable, so every rule above is tested without a
 *             mail server.
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface SmtpTarget {
  host: string
  port: number
  /** 465 is implicit TLS; everything else upgrades with STARTTLS. */
  secure: boolean
  username?: string
  password?: string
}

/** A private or loopback address, which a workspace form must not reach by accident. */
export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0') return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true
  // 172.16.0.0 - 172.31.255.255
  const m = /^172\.(\d{1,3})\./.exec(h)
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true
  return false
}

/**
 * The server this connection sends through, or a refusal that says what to
 * fix. `allowPrivate` is the connection's own deliberate opt-in (a field an
 * operator ticks), never a default: a private target is exactly what an
 * operator running a relay in their own network needs, and exactly what a
 * misconfiguration would reach for.
 */
export function smtpTarget(credentials: Record<string, unknown>, opts: { allowPrivate?: boolean } = {}): SmtpTarget {
  const host = String(credentials.host ?? '').trim().toLowerCase()
  if (host === '') throw new Error('This SMTP connection has no server: reconnect it with the host your provider gave you')
  // A hostname or an IPv4 address, and nothing that could carry a scheme, a
  // path, a port or a credential.
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) {
    throw new Error(`'${host}' is not a plain SMTP host name (no scheme, no port, no path)`)
  }
  if (isPrivateHost(host) && !opts.allowPrivate) {
    throw new Error(`This SMTP connection points at a private address (${host}). Connect it again with "Allow a private server" if that is deliberate.`)
  }
  const rawPort = credentials.port
  const port = Number(typeof rawPort === 'string' ? rawPort.trim() : rawPort ?? 587)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`'${String(rawPort)}' is not an SMTP port. The usual ones are 587, 465 and 25.`)
  }
  const username = typeof credentials.username === 'string' && credentials.username.trim() ? credentials.username.trim() : undefined
  const password = typeof credentials.password === 'string' && credentials.password !== '' ? credentials.password : undefined
  return {
    host, port, secure: port === 465,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  }
}

/** What nodemailer is handed. Separated so a test reads the decision, not the library. */
export function transportOptions(target: SmtpTarget): Record<string, unknown> {
  return {
    host: target.host,
    port: target.port,
    secure: target.secure,
    // A server that offers no STARTTLS on 587 is a plaintext credential on
    // the wire. nodemailer's default would proceed; this refuses.
    requireTLS: !target.secure,
    ...(target.username ? { auth: { user: target.username, pass: target.password ?? '' } } : {}),
    // A mail server that does not answer must not hold a Flow run open.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  }
}

/** One address or several, trimmed, with the blanks a text field produces dropped. */
export const addressList = (v: string | string[] | undefined): string[] | undefined => {
  if (v === undefined) return undefined
  const out = (Array.isArray(v) ? v : String(v).split(','))
    .map((a) => a.trim())
    .filter((a) => a !== '')
  return out.length > 0 ? out : undefined
}

/** The transport seam: a sender built from options, injectable for tests. */
export interface SmtpSender {
  send(message: Record<string, unknown>): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>
  verify(): Promise<true>
  close?(): void
}

export type SmtpSenderFactory = (options: Record<string, unknown>) => SmtpSender

/** The real one: nodemailer, imported lazily so a pack that never sends never loads it. */
export const nodemailerSender: SmtpSenderFactory = (options) => {
  let transport: { sendMail: (m: unknown) => Promise<unknown>; verify: () => Promise<unknown>; close: () => void } | null = null
  const open = async () => {
    if (!transport) {
      const mod = await import('nodemailer') as unknown as { createTransport: (o: unknown) => typeof transport }
      transport = mod.createTransport(options)!
    }
    return transport!
  }
  return {
    async send(message) {
      const t = await open()
      return await t.sendMail(message) as { messageId?: string; accepted?: unknown[]; rejected?: unknown[] }
    },
    async verify() {
      const t = await open()
      await t.verify()
      return true
    },
    close() { transport?.close() },
  }
}
