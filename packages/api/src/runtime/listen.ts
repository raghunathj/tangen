/**
 * File Name: listen.ts
 * Purpose: How the API binds its port, and what it says when it cannot.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia's `listen` defaults to `reusePort: true`. With
 *          that flag a SECOND process binds an already-taken port without an
 *          error (macOS always; Linux when both sides set it), and the kernel
 *          hands connections to one of them. Two Tangen servers on one PORT -
 *          the platform repo and a site, or two sites - then answer for each
 *          other: the Admin logs in against the wrong database and reports
 *          "Invalid email or password" for the right password, with nothing
 *          in either terminal. One server per port, and a taken port is a
 *          boot failure that names the port and the way out.
 */

/** The options every listen call uses: no port sharing, generous idle timeout. */
export function listenOptions(port: number): { port: number; idleTimeout: number; reusePort: false } {
  // idleTimeout: Bun kills connections idle ~10s by default - long-running
  // requests (AI generation, big queries) got their socket dropped and
  // surfaced as proxy 502s.
  return { port, idleTimeout: 120, reusePort: false }
}

/** True when the runtime's listen error means the port is held by someone else. */
export function isPortTaken(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: unknown } | null)?.code
  return code === 'EADDRINUSE' || /in use/i.test(msg)
}

/** The message a developer sees: the port, the likely cause, the two ways out. */
export function describeListenFailure(port: number, err: unknown): string {
  if (!isPortTaken(err)) return `could not listen on port ${port}: ${err instanceof Error ? err.message : String(err)}`
  return `port ${port} is already in use by another server - most likely another Tangen API (the platform repo, or a second site) started with the same PORT. Stop that server, or set PORT to a free port in this project's .env.`
}
