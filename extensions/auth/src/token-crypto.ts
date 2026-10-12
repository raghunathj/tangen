/**
 * File Name: token-crypto.ts
 * Purpose: An SSO provider's tokens at rest: AES-256-GCM under a key derived
 *          from the site signing key, `enc:v1:` prefixed. A reader never
 *          accepts plaintext.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import type { ExtensionServerCtx } from '@tangen/cms'
import { siteKeyOf } from './jwt'

export const TOKEN_PREFIX = 'enc:v1:'
const IV_LEN = 12
const TAG_LEN = 16

async function keyOf(ctx: ExtensionServerCtx): Promise<Buffer> {
  const ikm = Buffer.from(await siteKeyOf(ctx))
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.from('tangen-sso-token-salt'), Buffer.from('sso-tokens-v1'), 32))
}

export async function encryptToken(ctx: ExtensionServerCtx, plain: string): Promise<string> {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', await keyOf(ctx), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return TOKEN_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

export async function encryptTokenOrNull(ctx: ExtensionServerCtx, plain: string | null | undefined): Promise<string | null> {
  return plain ? encryptToken(ctx, plain) : null
}

export async function decryptToken(ctx: ExtensionServerCtx, blob: string | null | undefined): Promise<string | null> {
  if (blob == null) return null
  if (!blob.startsWith(TOKEN_PREFIX)) throw new Error('stored SSO token is not encrypted')
  const raw = Buffer.from(blob.slice(TOKEN_PREFIX.length), 'base64')
  const decipher = createDecipheriv('aes-256-gcm', await keyOf(ctx), raw.subarray(0, IV_LEN))
  decipher.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN))
  return Buffer.concat([decipher.update(raw.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString('utf8')
}
