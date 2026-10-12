/**
 * File Name: core-config-keys.ts
 * Purpose: Tangen Core's own configuration keys, declared once
 *          (tasks/plan-config-resolver.md, section 11). Everything a Core
 *          service used to resolve for itself - the database binding, Redis,
 *          the URLs, mail, storage, AI, the signing secrets, cache, logging -
 *          is a ConfigKeySpec here, with the layers that may set it, the
 *          deployment variables that supply it, and whether it is a secret
 *          reference.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A URL key reads its deployment variable (`SERVER_URL`,
 *          `ADMIN_URL`, `FRONTEND_URL`) and defaults to localhost on a
 *          development deployment from the process port. Operational keys
 *          a deployment sets (LOG_LEVEL, TANGEN_DEBUG, CACHE_DEFAULT_TTL,
 *          STORAGE_ADAPTER, MAIL_SERVICE) are deployment variables. A secret key
 *          names its platform default reference; the deployment's secret
 *          provider resolves it; the reference may be renamed at workspace
 *          or environment scope where the key allows.
 */
import type { ConfigKeySpec } from './config-registry'
import type { AIProviderName } from './config'

const localhost = (portVar: string, fallback: number) => ({ role, variables }: { role: string; variables: Record<string, string | undefined> }) =>
  role === 'development' ? `http://localhost:${variables[portVar]?.trim() || fallback}` : undefined

/** The site's own preview route, under the frontend URL the deployment supplies (or the development default). */
const previewRoute = (ctx: { role: string; variables: Record<string, string | undefined> }) => {
  const site = ctx.variables.FRONTEND_URL?.trim() || localhost('FRONTEND_PORT', 4321)(ctx)
  return site ? `${site.replace(/\/+$/, '')}/preview?id={id}&type={type}` : undefined
}

const secret = (key: string, secretRef: string, over: Partial<ConfigKeySpec> = {}): ConfigKeySpec => ({
  key, owner: 'core', type: 'secretRef', secret: true, secretRef, scopes: ['deployment'], fallback: 'allowed', ...over,
})

/** The provider keys, by provider: the variable a self-hosted deployment sets. */
export const AI_PROVIDER_SECRET_REFS: Record<AIProviderName, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
  qwen: 'DASHSCOPE_API_KEY',
}

export function coreConfigSpecs(): ConfigKeySpec[] {
  return [
    // ── redis: enabled is configuration, the URL is a deployment secret ──────
    { key: 'redis.enabled', owner: 'core', type: 'boolean', scopes: ['deployment'], deploymentVariables: ['REDIS_ENABLED'], default: true, diagnostic: true, description: 'false switches Redis off on purpose (REDIS_ENABLED=false, or redis.enabled in the environment file); the PostgreSQL fallbacks then serve without a warning. Unset REDIS_URL with enabled true is MISSING, which is reported' },
    secret('redis.url', 'REDIS_URL', { description: 'The Redis connection URL. Missing means Redis is unavailable, not disabled' }),

    // ── URLs: environment-authored, or supplied by the deployment ────────────
    { key: 'server.url', owner: 'core', type: 'url', scopes: ['deployment'], deploymentVariables: ['SERVER_URL'], default: localhost('PORT', 3000), diagnostic: true },
    { key: 'admin.url', owner: 'core', type: 'url', scopes: ['deployment'], deploymentVariables: ['ADMIN_URL'], default: localhost('ADMIN_PORT', 3001), diagnostic: true },
    { key: 'frontend.url', owner: 'core', type: 'url', scopes: ['deployment'], deploymentVariables: ['FRONTEND_URL'], default: localhost('FRONTEND_PORT', 4321), diagnostic: true },
    { key: 'frontend.previewUrl', owner: 'core', type: 'string', scopes: ['deployment'], deploymentVariables: ['FRONTEND_PREVIEW_URL'], default: previewRoute, diagnostic: true, description: 'The preview page template ({id}, {type}); defaults to <frontend URL>/preview?id={id}&type={type}' },
    { key: 'frontend.previewUrls', owner: 'core', type: 'json', scopes: ['workspace'] },
    { key: 'frontend.livePreview', owner: 'core', type: 'boolean', scopes: ['workspace'], diagnostic: true },
    { key: 'frontend.previewBreakpoints', owner: 'core', type: 'json', scopes: ['workspace'] },

    // ── mail ─────────────────────────────────────────────────────────────────
    { key: 'mail.service', owner: 'core', type: 'string', scopes: ['workspace', 'deployment'], deploymentVariables: ['MAIL_SERVICE'], default: 'smtp', diagnostic: true, validate: (v) => ['smtp', 'sendgrid', 'resend'].includes(String(v)) ? null : 'smtp, sendgrid or resend' },
    { key: 'mail.fromEmail', owner: 'core', type: 'string', scopes: ['workspace', 'deployment'], deploymentVariables: ['MAIL_FROM', 'SMTP_FROM'] },
    { key: 'mail.fromName', owner: 'core', type: 'string', scopes: ['workspace', 'deployment'], deploymentVariables: ['MAIL_FROM_NAME'] },
    { key: 'mail.smtp.host', owner: 'core', type: 'string', scopes: ['deployment'], deploymentVariables: ['SMTP_HOST'], default: 'localhost' },
    { key: 'mail.smtp.port', owner: 'core', type: 'number', scopes: ['deployment'], deploymentVariables: ['SMTP_PORT'], default: 587 },
    secret('mail.smtp.user', 'SMTP_USER'),
    secret('mail.smtp.pass', 'SMTP_PASS'),
    secret('mail.apiKey', 'MAIL_API_KEY', { scopes: ['workspace', 'deployment'], description: 'The SendGrid or Resend key, as the NAME of the variable that holds it' }),

    // ── storage ──────────────────────────────────────────────────────────────
    { key: 'storage.adapter', owner: 'core', type: 'string', scopes: ['workspace', 'deployment'], deploymentVariables: ['STORAGE_ADAPTER'], default: 'local', disable: true, diagnostic: true, validate: (v) => /^[a-z0-9][a-z0-9._-]*$/.test(String(v)) ? null : 'local, s3, or the id of a storage.provider@1 an installed extension contributes' },
    { key: 'storage.mediaDir', owner: 'core', type: 'string', scopes: ['workspace', 'deployment'], deploymentVariables: ['MEDIA_DIR'] },
    { key: 'storage.bucket', owner: 'core', type: 'string', scopes: ['workspace', 'deployment'], deploymentVariables: ['AWS_S3_BUCKET'] },
    { key: 'storage.region', owner: 'core', type: 'string', scopes: ['workspace', 'deployment'], deploymentVariables: ['AWS_S3_REGION'] },
    { key: 'storage.endpoint', owner: 'core', type: 'string', scopes: ['workspace', 'deployment'], deploymentVariables: ['AWS_S3_ENDPOINT'] },
    { key: 'storage.publicBaseUrl', owner: 'core', type: 'string', scopes: ['workspace', 'deployment'], deploymentVariables: ['MEDIA_PUBLIC_BASE_URL'], diagnostic: true },
    secret('storage.accessKeyId', 'AWS_ACCESS_KEY_ID', { scopes: ['workspace', 'deployment'], description: 'The access key, as the NAME of the variable that holds it (R2_ACCESS_KEY_ID); AWS_ACCESS_KEY_ID by default' }),
    secret('storage.secretAccessKey', 'AWS_SECRET_ACCESS_KEY', { scopes: ['workspace', 'deployment'], description: 'The secret key, as the NAME of the variable that holds it; AWS_SECRET_ACCESS_KEY by default' }),

    // ── AI: provider and model are configuration; the keys are deployment secrets ─
    { key: 'ai.disabled', owner: 'core', type: 'boolean', scopes: ['workspace'], default: false, diagnostic: true },
    { key: 'ai.providers', owner: 'core', type: 'string[]', scopes: ['workspace'], diagnostic: true },
    { key: 'ai.models', owner: 'core', type: 'json', scopes: ['workspace'] },
    { key: 'ai.imageModels', owner: 'core', type: 'json', scopes: ['workspace'] },
    ...(Object.entries(AI_PROVIDER_SECRET_REFS) as Array<[AIProviderName, string]>).map(([name, ref]) =>
      secret(`ai.apiKey.${name}`, ref, { scopes: ['workspace', 'deployment'], description: `${name} API key, as the NAME of the variable that holds it` })),
    secret('ai.translate.apiKey', 'GOOGLE_TRANSLATE_API_KEY', { scopes: ['workspace', 'deployment'] }),
    { key: 'ai.translate.referer', owner: 'core', type: 'string', scopes: ['deployment'], deploymentVariables: ['GOOGLE_TRANSLATE_REFERER'] },
    secret('knowledge.embeddings.apiKey', 'EMBEDDINGS_API_KEY', { scopes: ['workspace', 'deployment'], description: 'The embedding key for openai-compatible providers, as the NAME of the variable; a named provider (openai, gemini, …) uses its ai.apiKey.<provider> reference unless this names one' }),

    // ── signing secrets ──────────────────────────────────────────────────────
    secret('auth.jwtSecret', 'JWT_SECRET', { required: 'production', description: 'Signs member sessions. Development generates one when unset; production refuses to' }),
    secret('auth.siteJwtSecret', 'TANGEN_SITE_JWT_SECRET', { description: 'Signs site-user sessions; derived from the member secret when unset' }),
    secret('connections.encryptionKey', 'TANGEN_CONNECTIONS_KEY', { description: 'Seals connection credentials at rest (Extension Kernel K6); derived from the member session secret when unset - set it, and rotate the two together' }),

    // ── cache, logging, gateway ──────────────────────────────────────────────
    { key: 'cache.ttl', owner: 'core', type: 'number', scopes: ['workspace'], diagnostic: true },
    { key: 'cache.defaultTtl', owner: 'core', type: 'number', scopes: ['workspace', 'deployment'], deploymentVariables: ['CACHE_DEFAULT_TTL'], diagnostic: true },
    { key: 'cache.types', owner: 'core', type: 'json', scopes: ['workspace'] },
    { key: 'logger.level', owner: 'core', type: 'string', scopes: ['workspace', 'deployment'], deploymentVariables: ['LOG_LEVEL'], default: 'info', diagnostic: true },
    { key: 'debug', owner: 'core', type: 'boolean', scopes: ['workspace', 'deployment'], deploymentVariables: ['TANGEN_DEBUG'], default: false, diagnostic: true },
    { key: 'gateway', owner: 'core', type: 'json', scopes: ['workspace', 'deployment'], description: 'Gateway policy per scope; effective-policy.ts applies the per-field narrowing rules' },
  ]
}
