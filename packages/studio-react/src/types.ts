/**
 * File Name: types.ts
 * Purpose: Public and internal types for @tangen/studio-react - the block
 *          node shape on the wire, the <StudioBlocks/> props, and the render
 *          context the built-in widgets receive.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: BlockNode mirrors the platform's block JSON exactly:
 *          { _key, _type, _disabled?, _label?, ...props }; nested component
 *          fields (section children, row columns) carry child block arrays.
 *          Override components receive ONLY { block } - a serializable prop -
 *          so a site may pass a client component without tripping the RSC
 *          boundary. Sites that nest blocks inside an override re-render them
 *          with their own <StudioBlocks/>.
 */
import type { ComponentType, ReactNode } from 'react'
import type { LoopData } from './loop'

/** One block as stored by the platform. Unknown props ride along untyped. */
export type BlockNode = {
  /** Stable identity minted by the admin; used for overlay + React keys. */
  _key?: string
  /** Component name, e.g. 'kit.heading'. */
  _type: string
  /** Hidden blocks render nothing (publish already skips them server-side). */
  _disabled?: boolean
  /** Editor-facing label; never rendered. */
  _label?: string
  [prop: string]: unknown
}

/** What to do with a `_type` no renderer knows. */
export type UnknownBlockMode = 'skip' | 'placeholder'

/** A site-supplied renderer for one `_type`. Receives only the block. */
export type BlockComponent = ComponentType<{ block: BlockNode }>

/** Per-_type override/extension map (checked before the built-in kit). */
export type ComponentsMap = Record<string, BlockComponent>

/** Props for the one component a site drops in. */
export type StudioBlocksProps = {
  /** The block tree (a component field's value). Nullish renders nothing. */
  blocks?: BlockNode[] | null
  /** Override or extend renderers per `_type`. */
  components?: ComponentsMap
  /** Renders kit.form blocks; a labeled placeholder card appears when absent. */
  formRenderer?: (formSlug: string) => ReactNode
  /** Unknown `_type` handling; defaults to 'skip'. */
  unknown?: UnknownBlockMode
  /**
   * Resolved kit.loop results, keyed by loop `_key` - await
   * resolveStudioData(blocks, resolver) in your loader and pass it here.
   * Loops render their container and nothing else when it is absent.
   */
  loopData?: LoopData
}

/**
 * Context threaded through the built-in widgets. `renderList` renders a
 * nested child-block array (section children, row columns) with the same
 * configuration - widgets never import the dispatcher, so the module graph
 * stays acyclic.
 */
export type RenderContext = {
  formRenderer?: (formSlug: string) => ReactNode
  renderList: (blocks: unknown) => ReactNode
  loopData?: LoopData
}

/** A built-in widget: a plain render function, not a component boundary. */
export type WidgetRenderer = (block: BlockNode, ctx: RenderContext) => ReactNode
