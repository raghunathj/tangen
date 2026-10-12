/**
 * File Name: sse-manager.ts
 * Purpose: Manages active Server-Sent Events connections and broadcasts formatted messages
 *          to all subscribers scoped to a given workspace and environment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None — uses the native ReadableStream controller API
 */

interface SseConnection {
  workspaceId: string
  controller: ReadableStreamDefaultController<string>
}

export class SseConnectionManager {
  private connections = new Map<string, SseConnection>()

  /**
   * Registers a new SSE connection under the given unique ID.
   * @param id - Unique connection identifier (e.g. a UUID per request)
   * @param workspaceId - The workspace this connection belongs to
   * @param controller - The ReadableStream controller used to push data to the client
   */
  add(id: string, workspaceId: string, controller: ReadableStreamDefaultController<string>): void {
    this.connections.set(id, { workspaceId, controller })
  }

  /**
   * Unregisters and removes the SSE connection with the given ID.
   * @param id - The connection ID to remove
   */
  remove(id: string): void {
    this.connections.delete(id)
  }

  /**
   * Sends a message to every active connection scoped to the specified workspace and environment, silently ignoring already-closed streams.
   * @param workspaceId - Target workspace identifier
   * @param message - Pre-formatted SSE message string to enqueue
   */
  broadcast(workspaceId: string, message: string): void {
    for (const conn of this.connections.values()) {
      if (conn.workspaceId === workspaceId) {
        try {
          conn.controller.enqueue(message)
        } catch {
          // Stream already closed — swallow silently
        }
      }
    }
  }

  /**
   * Returns the total number of active SSE connections across all workspaces and environments.
   * @returns Total connection count
   */
  /** DISPOSE: ends every stream so no client waits on a server that is going away. Returns how many were open. */
  closeAll(): number {
    const open = [...this.connections.entries()]
    for (const [id, c] of open) {
      try { c.controller.close() } catch { /* already closed */ }
      this.connections.delete(id)
    }
    return open.length
  }

  get size(): number {
    return this.connections.size
  }

  /**
   * Counts how many active SSE connections exist for a specific workspace/environment pair.
   * @param workspaceId - The workspace identifier to count connections for
   * @returns Number of matching active connections
   */
  countForWorkspace(workspaceId: string): number {
    let count = 0
    for (const conn of this.connections.values()) {
      if (conn.workspaceId === workspaceId) count++
    }
    return count
  }
}

export const sseManager = new SseConnectionManager()
