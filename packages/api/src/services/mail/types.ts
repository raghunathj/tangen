/**
 * File Name: types.ts
 * Purpose: The mail adapter contract + shared plumbing — mirrors the AI
 *          provider pattern (interface here, factory per provider, registry
 *          in index.ts). Built-ins: smtp (nodemailer), sendgrid + resend
 *          (native HTTP, plain fetch — no SDKs).
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { SendMailMessage } from '@tangen/types'

/** A message with the sender already resolved — what adapters deliver. */
export interface ResolvedMailMessage extends SendMailMessage {
  from: string
}

/** Pluggable delivery backend. Custom adapters via MailConfig.adapter. */
export interface MailAdapter {
  readonly name: string
  send(message: ResolvedMailMessage): Promise<void>
}

/** Uniform error for provider failures — message carries provider detail. */
export class MailAdapterError extends Error {
  constructor(
    public readonly adapter: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`mail(${adapter}): ${message}`)
  }
}

/** Shared fetch helper — non-2xx throws with the response body attached. */
export async function postJSON(
  adapter: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new MailAdapterError(adapter, `${res.status} ${detail.slice(0, 300)}`, res.status)
  }
}

/** Normalizes to → array (providers differ on the wire shape). */
export function toList(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to]
}
