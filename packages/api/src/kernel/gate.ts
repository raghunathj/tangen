/**
 * File Name: gate.ts
 * Purpose: The ctx facilities follow the grants (Extension Kernel K1.5,
 *          tasks/plan-extension-kernel.md). For an execution under the
 *          extension principal, `db` needs `db:own`, `ai` any `ai:*`,
 *          `resolveActor` (acting as another recorded principal)
 *          `delegation:act-as`; `enqueue`, `emit` and `emitPlatform` refuse
 *          by name without `jobs:enqueue` / `events:emit`. `clientFor` stays:
 *          the kernel binds callers through it and an extension only ever
 *          holds executions the kernel handed it. Under a system actor (an
 *          extension without grants) the ctx is returned untouched. Pure:
 *          policy only, so the testkit applies the same gate a boot does.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExecutionContext, ExtensionServerCtx } from '@tangen/types'
import { decide, requireDecision } from './policy'

/** The gate a boot applies in buildExtensionCtx and the testkit applies to a test ctx. */
export function gateExtensionCtx<C extends ExtensionServerCtx>(ctx: C, exec: ExecutionContext): C {
  const actor = exec.actor
  if (actor.identity.kind !== 'extension') return ctx
  const holds = (facility: string) => decide(actor, { kind: 'facility', facility }).allow
  const refusing = <F extends (...args: never[]) => unknown>(facility: string, fn: F | undefined): F | undefined =>
    fn ? ((...args: never[]) => { requireDecision(actor, { kind: 'facility', facility }); return fn(...args) }) as F : undefined
  const gated: Record<string, unknown> = { ...(ctx as unknown as Record<string, unknown>) }
  if (!holds('db:own')) delete gated.db
  // S3: media bytes follow the key-model media grant, the same rule the media routes enforce for a key.
  if (!decide(actor, { kind: 'media', action: 'read' }).allow) delete gated.media
  // K8.1: the AI facility by capability - generation under ai:generate, vision under ai:vision, embeddings under ai:embed.
  if (gated.ai && typeof gated.ai === 'object') {
    const ai = { ...(gated.ai as Record<string, unknown>) }
    const known = ['generateJSON', 'vision', 'embeddings'].some((k) => k in ai)
    if (!known) {
      // An opaque stand-in (tests, older builders): the whole facility under ai:generate, as before.
      if (!holds('ai:generate')) delete gated.ai
    } else {
      if (!holds('ai:generate')) { delete ai.generateJSON; delete ai.fieldSchema; delete ai.coerceField; delete ai.retrieve }
      if (!holds('ai:vision')) delete ai.vision
      if (!holds('ai:embed')) delete ai.embeddings
      const usable = ['generateJSON', 'vision', 'embeddings'].some((k) => ai[k] !== undefined)
      if (usable) gated.ai = ai; else delete gated.ai
    }
  } else if (!holds('ai:generate')) delete gated.ai
  if (!holds('delegation:act-as')) delete gated.resolveActor
  // E.2: the facilities the audit found in use, each behind its grant.
  if (!holds('store:own')) delete gated.store
  if (!holds('realtime:publish')) delete gated.realtime
  if (!holds('storage:deliver')) delete gated.delivery
  const tangen = gated.tangen as { sendMail?: (...a: never[]) => unknown } | undefined
  if (tangen && typeof tangen.sendMail === 'function') gated.tangen = { ...tangen, sendMail: refusing('mail:send', tangen.sendMail) }
  gated.enqueue = refusing('jobs:enqueue', ctx.enqueue)
  if (ctx.emit) gated.emit = refusing('events:emit', ctx.emit)
  const platform = (ctx as { emitPlatform?: (...a: never[]) => unknown }).emitPlatform
  if (platform) gated.emitPlatform = refusing('events:emit', platform)
  return gated as C
}

