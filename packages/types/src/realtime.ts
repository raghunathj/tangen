/**
 * File Name: realtime.ts
 * Purpose: The realtime section of tangen.config - presence timing and the
 *          replay window - as a small, additive config type.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md section 45
 *          names these as config ceilings ("presence heartbeat, replay size
 *          and duration"), and section 44 says the numbers are starting
 *          points until R6 benchmarks them. R1 and R2 used the replay keys
 *          as constants; R3 (presence) is the first slice that reads them
 *          from config, so the type lands here, next to GatewayConfig, and
 *          TangenConfig gains an optional `realtime` key. Every field is
 *          optional: an absent section means the defaults below.
 */

/** Presence timing. Heartbeat well under TTL; a missed heartbeat or two must not expire a session. */
export interface RealtimePresenceConfig {
  /** Seconds between client heartbeats while a scope is joined. Default 20. */
  heartbeatSeconds?: number
  /** Seconds without a heartbeat after which a session is gone. Default 60. */
  ttlSeconds?: number
}

/** The bounded replay window per channel (not the audit log). */
export interface RealtimeReplayConfig {
  /** Events kept per channel. Default 200. */
  maxEvents?: number
  /** Seconds an event stays replayable. Default 60. */
  seconds?: number
}

export interface RealtimeConfig {
  /** Realtime transport, presence and fan-out. Default true; false mounts no realtime route and starts no subscriber or sweep. */
  enabled?: boolean
  presence?: RealtimePresenceConfig
  replay?: RealtimeReplayConfig
}

export const REALTIME_PRESENCE_DEFAULTS: Required<RealtimePresenceConfig> = { heartbeatSeconds: 20, ttlSeconds: 60 }
export const REALTIME_REPLAY_DEFAULTS: Required<RealtimeReplayConfig> = { maxEvents: 200, seconds: 60 }
