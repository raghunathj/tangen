/**
 * File Name: tokens.ts
 * Purpose: The Studio design-token contract, as the extension imports it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The contract itself moved to
 *          `packages/studio-schema/src/tokens.ts` when WF-S10 landed: the
 *          platform's Porter provider has to validate a `theme:` row before
 *          copying it between deployments, and the platform may not import
 *          extension code. This file stays as the extension's own entry
 *          (`@tangen/ext-studio/tokens` is a published subpath, and roughly
 *          a dozen modules import `../tokens`), so nothing downstream
 *          learned a new import path.
 */
export {
  TOKEN_FAMILIES, DEFAULT_TOKENS, mergeTokens, tokenValues, fontTokens,
} from '@tangen/studio-schema'
export type {
  TokenFamily, StudioTokens, StudioTokensConfigLike, FontToken, FontFile,
} from '@tangen/studio-schema'
