/**
 * File Name: server.ts
 * Purpose: What the Slack pack contributes (plan-connectors E1): two
 *          connectors of ONE provider, one typed service, one Flow action and
 *          one preset. Three ways to reach a Slack workspace - code through
 *          the service, no-code through a flow, and a form's destination - and
 *          all three go through the same capability check and neither knows
 *          which auth model an operator used.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { defineExtensionServer } from '@tangen/cms'
import { SLACK_CAPABILITIES, SLACK_CHAT_SERVICE, SLACK_PROVIDER } from './contract'
import { slackOAuthConnector, slackTokenConnector, SLACK_BRAND } from './connector'
import { createChatService } from './chat'

/** A flow's config value as the builder stores it: an id, or nothing yet. */
const id = (config: Record<string, unknown>, key: string): string => {
  const v = config[key]
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`This step needs '${key}' to be chosen`)
  return v.trim()
}

export default defineExtensionServer({
  contributions: {
    // Two connectors, one provider. Ownership is per PROVIDER, so these
    // coexist while a second Slack pack would be a conflict.
    'connectors@1': [slackOAuthConnector, slackTokenConnector],

    'flow.actions@1': [
      {
        name: 'slack_post_message',
        label: 'Post a Slack message',
        description: 'Posts to a channel the app has been invited to. It cannot read messages.',
        configFields: [
          { key: 'connection', label: 'Slack workspace', kind: 'connection', connector: SLACK_PROVIDER, capabilities: [SLACK_CAPABILITIES.chatPost] },
          { key: 'channel', label: 'Channel', kind: 'resource', connector: SLACK_PROVIDER, resource: 'channel', dependsOn: 'connection' },
          { key: 'text', label: 'Message ({{tokens}} allowed)', kind: 'text' },
          { key: 'threadTs', label: 'Reply in thread (a message timestamp, optional)', kind: 'text' },
        ],
        output: [
          { key: 'ts', label: 'Message timestamp', type: 'string' },
          { key: 'channelId', label: 'Channel', type: 'string' },
        ],
        handler: async (config, ctx) => createChatService(ctx).postMessage({
          connectionId: id(config, 'connection'),
          channelId: id(config, 'channel'),
          text: String(config.text ?? ''),
          ...(typeof config.threadTs === 'string' && config.threadTs.trim() ? { threadTs: config.threadTs.trim() } : {}),
        }),
      },
    ],

    /**
     * The same post, offered where the work starts. Flows owns the graph from
     * the moment it is created, exactly as for the Google pack - a preset
     * contributes a shape and nothing else.
     */
    'flow.presets@1': [
      {
        id: 'slack.chat.form-submissions',
        label: 'Announce submissions in Slack',
        description: 'Posts a message for every submission of this form. Choose the workspace, the channel and what to say.',
        icon: 'IconHash',
        // The provider's own mark, so a form's destination list shows Google
        // and Slack rather than two grey glyphs.
        brand: { ...SLACK_BRAND },
        appliesTo: { trigger: 'form.submitted', scope: 'form' },
        configFields: [
          { key: 'connection', label: 'Slack workspace', kind: 'connection', connector: SLACK_PROVIDER, capabilities: [SLACK_CAPABILITIES.chatPost] },
          { key: 'channel', label: 'Channel', kind: 'resource', connector: SLACK_PROVIDER, resource: 'channel', dependsOn: 'connection' },
          { key: 'text', label: 'Message', kind: 'text' },
        ],
        build: ({ config, scope }) => ({
          name: 'Form submissions to Slack',
          nodes: [
            { id: 'trigger_1', kind: 'trigger', position: { x: 0, y: 0 }, data: { type: 'form.submitted' } },
            // One form, not every form.
            { id: 'this_form', kind: 'condition', position: { x: 0, y: 140 }, data: { conditions: [{ path: 'trigger.payload.formId', op: 'eq', value: scope.id }] } },
            {
              id: 'post_1', kind: 'action', position: { x: 0, y: 280 },
              data: {
                action: 'slack_post_message',
                config: {
                  ...config,
                  // A destination added with no message still says something
                  // useful, rather than posting an empty line.
                  text: String(config.text ?? '').trim() || 'A new submission arrived for {{trigger.submission.formSlug}}',
                },
              },
            },
          ],
          edges: [
            { id: 'edge_1', from: 'trigger_1', to: 'this_form' },
            { id: 'edge_2', from: 'this_form', to: 'post_1', outlet: 'yes' },
          ],
        }),
      },
    ],
  },

  /**
   * The service is provided as a FACTORY, so it is built with the calling
   * extension's execution and this pack's own ctx: the caller never borrows
   * the pack's authority, and the pack never borrows the caller's.
   */
  onStart: async (ctx) => {
    ctx.services?.provide(SLACK_CHAT_SERVICE, () => createChatService(ctx))
  },
})
