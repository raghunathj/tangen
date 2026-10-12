/**
 * File Name: slot.tsx
 * Purpose: The rendering half of Admin slots (Extension Kernel K7.2). Every
 *          item renders inside its own boundary keyed by extension, so an
 *          extension that throws shows an inline "failed" line and the
 *          screen survives; every item receives the same SlotContext shape.
 *          `SlotItems` is the pure renderer (what the test drives);
 *          `Slot` is the mounted form that reads the build's registry, the
 *          server's allow-list and the member's permissions.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `Slot` lives in slot-mount.tsx because it imports
 *          the Vite virtual module, which bun tests cannot resolve; import
 *          `Slot` from there, `SlotItems` / `SlotFailed` from here.
 */
import React, { Component, Suspense, type ReactNode } from 'react'
import { Callout } from '@tangen/ui'
import type { SlotContext, SlotItem } from '@/lib/slots'

/** What a member sees when an extension's item throws: which extension, never the error text (it may carry data). */
export function SlotFailed({ extensionId }: { extensionId: string; error?: unknown }) {
  return (
    <div data-slot-failed={extensionId}>
      <Callout variant="danger">Extension {extensionId} failed to render this section.</Callout>
    </div>
  )
}

interface BoundaryState { error: unknown | null }

/** One boundary per item, keyed by extension: a throw in one extension's UI never takes the screen down. */
export class SlotErrorBoundary extends Component<{ extensionId: string; children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null }
  static getDerivedStateFromError(error: unknown): BoundaryState { return { error } }
  componentDidCatch(error: unknown) {
    if (typeof console !== 'undefined') console.warn(`[tangen] slot item from extension "${this.props.extensionId}" failed`, error)
  }
  render() {
    if (this.state.error !== null) return <SlotFailed extensionId={this.props.extensionId} error={this.state.error} />
    return this.props.children
  }
}

export function SlotItems({ slot, items, context }: {
  slot: string
  items: readonly SlotItem[]
  /** Screen facts; `extensionId` and `slot` are added per item. */
  context: { workspaceId: string; [key: string]: unknown }
}) {
  if (items.length === 0) return null
  return (
    <>
      {items.map((item) => {
        const Item = item.component
        const itemContext: SlotContext = { ...context, extensionId: item.extensionId, slot }
        return (
          <div key={`${item.extensionId}:${item.id}`} data-slot-item={`${item.extensionId}:${item.id}`}>
            <SlotErrorBoundary extensionId={item.extensionId}>
              <Suspense fallback={null}>
                <Item context={itemContext} />
              </Suspense>
            </SlotErrorBoundary>
          </div>
        )
      })}
    </>
  )
}
