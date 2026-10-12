/**
 * File Name: receive.ts
 * Purpose: Arc R receiver surface (R-T1). Owner-side gatekeeper code
 *   management (generate / list / revoke - member auth, OWNER only per
 *   S20) plus the public redemption endpoint the SENDING instance calls
 *   with the dictated code. Redemption trades the single-use code for a
 *   transfer token scoped to porter ingest endpoints only.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: /api/v1/porter/receive/* is auth-middleware-exempt -
 *   the CODE is the credential (S20b envelope: entropy + TTL + single-use
 *   + rate-limited lockout). Everything the token can do arrives in the
 *   transfer routes (R-T2/T3), each validating X-Tangen-Transfer itself.
 */
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { clientIp, getTrustedProxy, socketAddressOf } from '../../lib/client-ip'
import {
  generateTransferCode, listActiveCodes, revokeCode,
  redeemTransferCode, RedemptionError,
  validateTransferToken, bindTokenToRun, revokeToken,
} from '../../services/porter-gatekeeper'
import {
  remotePreflight, createRemoteImportRun, confirmedChunks, recordChunk, finishTransfer,
  TRANSFER_CHUNK_BYTES,
} from '../../services/porter-remote'
import { getRun } from '../../services/migration-runs'
import { enqueuePorterRun, resolvePorterStorage } from '../../services/migration-run-worker'
import { getWorkspaceProvider } from '../../services/porter-providers'
import { porterActivePredicate } from '../../services/extension-server'

function projectOf(ctx: any, workspaceId: string) {
  return ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === workspaceId)
}

/** S20: gatekeeper code generation is FOREVER owner-only. */
function gateOwner(ctx: any): void {
  if (!ctx.memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
  if (ctx.memberRole !== 'owner' && ctx.memberRole !== 'superadmin') {
    throw new RequestError('FORBIDDEN', 'Only the workspace owner can manage receive codes', 403)
  }
}

/** Resolves X-Tangen-Transfer to its token row or 403s. */
async function requireTransferToken(ctx: any) {
  const token = ctx.request?.headers?.get?.('x-tangen-transfer') as string | null
  const row = token ? await validateTransferToken(ctx.db, token) : null
  if (!row) throw new RequestError('FORBIDDEN', 'Invalid or expired transfer token', 403)
  return row
}

/**
 * The lockout bucket for a redemption attempt.
 *
 * It used to read the leftmost X-Forwarded-For hop, so an attacker rotating
 * that header got a fresh lockout budget per guess - which is the whole point
 * of the gatekeeper defeated by one header. The canonical resolver ignores
 * forwarding headers unless the operator declared a trusted proxy; 'local' is
 * the fallback when no address can be trusted, which buckets every such caller
 * TOGETHER rather than apart.
 */
function callerKey(ctx: any): string {
  return clientIp(ctx.request, getTrustedProxy(), socketAddressOf(ctx)) ?? 'local'
}

export const porterReceiveRoutes = (app: Elysia) =>
  app
    .post('/api/v1/sync/receive/codes', async (ctx: any) => {
      gateOwner(ctx)
      const { db, workspaceId, set } = ctx
      const generated = await generateTransferCode(db, { workspaceId, createdBy: ctx.memberId })
      set.status = 201
      return { data: generated }
    })

    .get('/api/v1/sync/receive/codes', async (ctx: any) => {
      gateOwner(ctx)
      const { db, workspaceId } = ctx
      return { data: await listActiveCodes(db, workspaceId) }
    })

    .post('/api/v1/sync/receive/codes/:id/revoke', async (ctx: any) => {
      gateOwner(ctx)
      const revoked = await revokeCode(ctx.db, ctx.workspaceId, ctx.params.id)
      if (!revoked) throw new RequestError('NOT_FOUND', 'Code not found', 404)
      return { data: { revoked: true } }
    })

    // ── public: the sending instance redeems the dictated code ────────────
    .post('/api/v1/porter/receive/redeem', async (ctx: any) => {
      const { db, body } = ctx
      const code = (body?.code as string | undefined)?.trim()
      if (!code) throw new RequestError('VALIDATION_ERROR', 'code is required', 422)
      try {
        const redeemed = await redeemTransferCode(db, {
          code,
          callerKey: callerKey(ctx),
          senderInfo: {
            url: typeof body?.senderUrl === 'string' ? body.senderUrl.slice(0, 300) : undefined,
            label: typeof body?.senderLabel === 'string' ? body.senderLabel.slice(0, 120) : undefined,
          },
        })
        // The sender learns the token and the receiving env's id - never
        // workspace internals beyond what the transfer itself needs.
        return { data: { token: redeemed.token, expiresAt: redeemed.expiresAt } }
      } catch (err) {
        if (err instanceof RedemptionError) {
          throw new RequestError(err.locked ? 'RATE_LIMITED' : 'FORBIDDEN', err.message, err.locked ? 429 : 403)
        }
        throw err
      }
    })

    // ── token-authed ingest (R-T2/T3): X-Tangen-Transfer is the credential ─

    .post('/api/v1/porter/receive/handshake', async (ctx: any) => {
      const tok = await requireTransferToken(ctx)
      const manifest = ctx.body?.manifest
      if (!manifest) throw new RequestError('VALIDATION_ERROR', 'manifest is required', 422)
      const totalBytes = Number(ctx.body?.totalBytes) || 0
      const receiveActive = await porterActivePredicate(tok.workspaceId)
      const out = await remotePreflight(ctx.db, manifest, { totalBytes }, undefined,
        (key) => getWorkspaceProvider(projectOf(ctx, tok.workspaceId), key, receiveActive))
      return { data: { ...out, chunkBytes: TRANSFER_CHUNK_BYTES } }
    })

    .post('/api/v1/porter/receive/transfers', async (ctx: any) => {
      const tok = await requireTransferToken(ctx)
      const { db, body } = ctx

      // Resume: a token already bound to a run returns THAT run's ledger.
      if (tok.runId) {
        const existing = await getRun(db, tok.workspaceId, tok.runId)
        if (!existing) throw new RequestError('NOT_FOUND', 'Transfer run not found', 404)
        return { data: { runId: existing.id, confirmed: confirmedChunks(existing) } }
      }

      const bundleId = (body?.bundleId as string | undefined)?.trim()
      const manifest = body?.manifest
      const totalChunks = Number(body?.totalChunks)
      const archiveSha256 = (body?.archiveSha256 as string | undefined)?.trim()
      if (!bundleId || !manifest || !Number.isInteger(totalChunks) || totalChunks < 1 || !archiveSha256) {
        throw new RequestError('VALIDATION_ERROR', 'bundleId, manifest, totalChunks and archiveSha256 are required', 422)
      }

      const ingestActive = await porterActivePredicate(tok.workspaceId)
      const preflight = await remotePreflight(db, manifest, { totalBytes: Number(body?.totalBytes) || 0 }, undefined,
        (key) => getWorkspaceProvider(projectOf(ctx, tok.workspaceId), key, ingestActive))
      if (!preflight.ok) {
        throw new RequestError('VALIDATION_ERROR',
          `Receiver refused the transfer: ${[
            ...preflight.violations,
            ...preflight.blockers.map((b: any) => `schema mismatch: ${b.typeName}`),
          ].join('; ')}`, 422)
      }

      // R-T5: media-by-URL list (sender's presigned object-storage URLs).
      const mediaUrls = Array.isArray(body?.mediaUrls)
        ? (body.mediaUrls as unknown[])
            .filter((u: any): u is { assetId: string; filename: string; url: string; sha256?: string } =>
              !!u && typeof u.assetId === 'string' && typeof u.filename === 'string'
              && typeof u.url === 'string' && /^https?:\/\//.test(u.url))
            .slice(0, 10_000)
        : undefined

      const run = await createRemoteImportRun(db, {
        workspaceId: tok.workspaceId,
        bundleId,
        totalBytes: Number(body?.totalBytes) || 0,
        totalChunks,
        archiveSha256,
        options: body?.options && typeof body.options === 'object' ? body.options : undefined,
        senderLabel: typeof body?.senderLabel === 'string' ? body.senderLabel.slice(0, 120) : undefined,
        mediaUrls,
      })
      const bound = await bindTokenToRun(db, tok.id, run.id)
      if (!bound) throw new RequestError('CONFLICT', 'This token already started a transfer', 409)
      ctx.set.status = 201
      return { data: { runId: run.id, confirmed: [] } }
    })

    .get('/api/v1/porter/receive/transfers/state', async (ctx: any) => {
      const tok = await requireTransferToken(ctx)
      if (!tok.runId) throw new RequestError('NOT_FOUND', 'No transfer started on this token', 404)
      const run = await getRun(ctx.db, tok.workspaceId, tok.runId)
      if (!run) throw new RequestError('NOT_FOUND', 'Transfer run not found', 404)
      return { data: { runId: run.id, status: run.status, confirmed: confirmedChunks(run) } }
    })

    .post('/api/v1/porter/receive/transfers/chunk', async (ctx: any) => {
      const tok = await requireTransferToken(ctx)
      if (!tok.runId) throw new RequestError('VALIDATION_ERROR', 'Start the transfer before sending chunks', 422)
      const run = await getRun(ctx.db, tok.workspaceId, tok.runId)
      if (!run) throw new RequestError('NOT_FOUND', 'Transfer run not found', 404)
      if (run.status === 'cancelled' || run.status === 'failed') {
        throw new RequestError('CONFLICT', `Transfer run is ${run.status}`, 409)
      }
      if (run.cancelRequested) throw new RequestError('CONFLICT', 'Transfer was cancelled by the receiver', 409)

      const index = Number(ctx.query?.index)
      const declared = (ctx.request.headers.get('x-chunk-sha256') as string | null) ?? ''
      if (!declared) throw new RequestError('VALIDATION_ERROR', 'X-Chunk-Sha256 header is required', 422)
      const bytes = ctx.body instanceof ArrayBuffer
        ? new Uint8Array(ctx.body)
        : ctx.body instanceof Uint8Array
          ? ctx.body
          : new Uint8Array(await ctx.request.arrayBuffer())
      if (bytes.byteLength === 0) throw new RequestError('VALIDATION_ERROR', 'Empty chunk', 422)

      const storage = ctx.porterStorage ?? resolvePorterStorage(
        ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === tok.workspaceId))
      try {
        const out = await recordChunk(ctx.db, storage, run, index, bytes, declared)
        return { data: out }
      } catch (err: any) {
        throw new RequestError('VALIDATION_ERROR', String(err?.message ?? err), 422)
      }
    })

    .post('/api/v1/porter/receive/transfers/finish', async (ctx: any) => {
      const tok = await requireTransferToken(ctx)
      if (!tok.runId) throw new RequestError('VALIDATION_ERROR', 'Start the transfer before finishing it', 422)
      const run = await getRun(ctx.db, tok.workspaceId, tok.runId)
      if (!run) throw new RequestError('NOT_FOUND', 'Transfer run not found', 404)

      const storage = ctx.porterStorage ?? resolvePorterStorage(
        ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === tok.workspaceId))
      try {
        await finishTransfer(ctx.db, storage, run)
      } catch (err: any) {
        throw new RequestError('VALIDATION_ERROR', String(err?.message ?? err), 422)
      }

      // Bytes are in - the run now executes as a NORMAL import.
      const enqueue = ctx.porterEnqueue ?? undefined
      await enqueuePorterRun(
        { workspaceId: tok.workspaceId, runId: run.id },
        ...(enqueue ? [enqueue] : []),
      )
      // The token's job is done - a finished transfer cannot be reopened.
      await revokeToken(ctx.db, tok.id)
      return { data: { runId: run.id, importing: true } }
    })
