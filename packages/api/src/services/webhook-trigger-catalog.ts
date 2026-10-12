/**
 * File Name: webhook-trigger-catalog.ts
 * Purpose: Assembles the webhook-trigger catalog for a workspace — built-in
 *          object.* events plus site (config.webhookTriggers) and extension
 *          (server.webhookTriggers) custom triggers. One source used by BOTH the
 *          dispatcher gate and the admin picker route, so what you can select is
 *          exactly what will fire.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: reads the live extension registry, so it reflects whatever
 *          is installed at call time.
 */
import { buildWebhookTriggerCatalog, type WebhookTriggerCatalogEntry, type WebhookTriggerDefinition } from '@tangen/types'
import { contributions } from '../kernel/contributions'

/**
 * Build the trigger catalog for a workspace project (undefined project =
 * built-ins only). Extension triggers are scoped to the extensions THIS
 * workspace has installed (`project.extensions`), so excluding/disabling/
 * removing an extension drops its triggers from the picker and the dispatcher
 * gate — a workspace never sees triggers from an extension it doesn't run.
 */
export function webhookTriggerCatalog(
  project: { webhookTriggers?: WebhookTriggerDefinition[]; extensions?: { id: string }[] } | undefined,
  /** The extensions ACTIVE in the caller's workspace x environment (Phase 4); omitted = every configured one. */
  active?: Set<string>,
): WebhookTriggerCatalogEntry[] {
  return buildWebhookTriggerCatalog({
    siteTriggers: project?.webhookTriggers ?? [],
    // K2.1: `webhook.triggers@1` through the contribution registry, for the configured and active extensions.
    extensionTriggers: (project?.extensions ?? []).filter((ext) => !active || active.has(ext.id)).map((ext) => ({
      extensionId: ext.id,
      triggers: contributions<WebhookTriggerDefinition>('webhook.triggers@1', { activeIds: new Set([ext.id]) }).map((c) => c.item),
    })),
  })
}
