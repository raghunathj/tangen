/**
 * File Name: chat.ts
 * Purpose: `slack.chat@1` (plan-connectors E1): the two operations another
 *          extension needs, each asserting the CAPABILITY it requires before
 *          Slack is called. A consumer passes the connection an operator chose
 *          and a channel id from the picker; it never sees a token, a Slack
 *          scope or a Slack URL - and never learns which auth model the
 *          operator used, because that is the point of the provider seam.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import { readSlack } from './connector'
import {
  SLACK_CAPABILITIES, SLACK_PROVIDER,
  type ListChannelsInput, type ListChannelsResult, type PostMessageInput, type PostMessageResult,
  type SlackChannel, type SlackChatService,
} from './contract'

/** The one refusal a consumer sees when nothing usable is configured. */
export class SlackConnectionMissing extends Error {
  constructor(readonly connectionId: string) {
    super(`No usable Slack connection '${connectionId}'. Connect Slack under Settings > Connections, or choose another connection.`)
    this.name = 'SlackConnectionMissing'
  }
}

/** An authed client over the connection an operator chose, or a refusal that says what to do. */
async function open(ctx: ExtensionServerCtx, connectionId: string, capabilities: string[]) {
  const conn = await ctx.connections?.get(SLACK_PROVIDER, { id: connectionId, capabilities })
  if (!conn) throw new SlackConnectionMissing(connectionId)
  return conn
}

export function createChatService(ctx: ExtensionServerCtx): SlackChatService {
  return {
    async postMessage({ connectionId, channelId, text, threadTs }): Promise<PostMessageResult> {
      const conn = await open(ctx, connectionId, [SLACK_CAPABILITIES.chatPost])
      if (!text.trim()) throw new Error('A Slack message needs some text')
      const answer = await readSlack<{ ts?: string; channel?: string }>(
        await conn.request('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          body: JSON.stringify({
            channel: channelId,
            text,
            ...(threadTs ? { thread_ts: threadTs } : {}),
          }),
        }),
        'post that message',
      )
      return { ts: String(answer.ts ?? ''), channelId: String(answer.channel ?? channelId) }
    },

    async listChannels({ connectionId, query, limit, cursor }): Promise<ListChannelsResult> {
      const conn = await open(ctx, connectionId, [SLACK_CAPABILITIES.channelsRead])
      const params = new URLSearchParams({
        types: 'public_channel,private_channel',
        exclude_archived: 'true',
        // Slack's own maximum is 200 and it recommends far less; a consumer
        // asking for more is clamped rather than refused.
        limit: String(Math.min(Math.max(limit ?? 100, 1), 200)),
      })
      if (cursor) params.set('cursor', cursor)
      const answer = await readSlack<{
        channels?: Array<{ id: string; name: string; is_private?: boolean; is_member?: boolean }>
        response_metadata?: { next_cursor?: string }
      }>(await conn.request(`https://slack.com/api/conversations.list?${params.toString()}`), 'list your channels')

      const q = query?.trim().toLowerCase().replace(/^#/, '')
      const channels = (answer.channels ?? [])
        .map<SlackChannel>((c) => ({ id: c.id, name: c.name, private: c.is_private === true, member: c.is_member === true }))
        .filter((c) => !q || c.name.toLowerCase().includes(q))
      const next = answer.response_metadata?.next_cursor
      // Slack sends an EMPTY next_cursor on the last page, which is not a
      // cursor: handing it back would page forever.
      return { channels, ...(next ? { nextCursor: next } : {}) }
    },
  }
}
