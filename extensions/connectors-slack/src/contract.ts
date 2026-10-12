/**
 * File Name: contract.ts
 * Purpose: What a CONSUMER imports (plan-connectors E1). The point of a second
 *          pack is to prove the model holds: the provider is `slack`, and it
 *          offers TWO auth models - an OAuth app and a pasted bot token -
 *          which are two connectors of one provider, not two providers.
 *
 *          So `chat.post` means the same thing whichever way an operator
 *          connected, and a consumer names the capability, never the auth
 *          model and never a Slack scope.
 *
 *          Nothing here imports the Admin, React or the pack's server, so a
 *          site project can import it and still typecheck.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** The provider id: what a grant, a picker and the ownership boundary name. */
export const SLACK_PROVIDER = 'slack'

/** The two connectors, in the normalized `<provider>.<authKind>` grammar. */
export const SLACK_OAUTH_CONNECTOR = 'slack.oauth'
export const SLACK_TOKEN_CONNECTOR = 'slack.token'

/**
 * Provider-scoped capabilities. Both connectors declare both, because a
 * capability describes what will be DONE, not how the credential was obtained.
 *
 * The difference between the two auth models is only where the check can
 * happen: an OAuth connection records the scopes Slack granted, so a missing
 * capability is refused BEFORE the call; a pasted token's scopes are Slack's
 * secret, so the refusal arrives from Slack in its own words and is passed
 * through unchanged.
 */
export const SLACK_CAPABILITIES = {
  /** Post a message as the app, to a channel it is in. */
  chatPost: 'chat.post',
  /** List and search the workspace's channels, so an operator can pick one. */
  channelsRead: 'channels.read',
} as const

/** The typed service this pack provides. */
export const SLACK_CHAT_SERVICE = 'slack.chat@1'

export interface SlackChannel {
  /** Slack's channel id (`C0123ABC`) - what a message is addressed to. */
  id: string
  /** Its name without the hash. */
  name: string
  private: boolean
  /** The app is a member: Slack refuses a post to a public channel it has not joined. */
  member: boolean
}

export interface PostMessageInput {
  /** The connection an operator chose (a connection id, never a label). */
  connectionId: string
  /** A channel id from the picker. A name would break the moment it is renamed. */
  channelId: string
  /** The message. Slack's mrkdwn, so `*bold*` and `<url|text>` work. */
  text: string
  /** Post as a reply in this thread (a message timestamp from a previous post). */
  threadTs?: string
}

export interface PostMessageResult {
  /** The message's timestamp, which is also its id: reply to it with `threadTs`. */
  ts: string
  channelId: string
}

export interface ListChannelsInput {
  connectionId: string
  query?: string
  /** At most 200, which is Slack's own page size. */
  limit?: number
  /** Slack's opaque cursor from a previous page. */
  cursor?: string
}

export interface ListChannelsResult {
  channels: SlackChannel[]
  /** Absent on the last page. */
  nextCursor?: string
}

/** `slack.chat@1`: what another extension may do with a Slack connection. */
export interface SlackChatService {
  postMessage(input: PostMessageInput): Promise<PostMessageResult>
  listChannels(input: ListChannelsInput): Promise<ListChannelsResult>
}
