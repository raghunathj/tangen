/**
 * File Name: page.tsx
 * Purpose: <StudioPage/> - rendering a page that arrived from the Delivery
 *          Layer, styling and all, with no call to the authoring API.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is where zero-build publishing becomes visible: a
 *          designer publishes, the pointer moves, and this renders the new
 *          version on a site nobody rebuilt.
 *
 *          It takes a RESOLVED artifact rather than fetching one. Fetching
 *          belongs to the site - a server component, a loader, a route
 *          handler and a plain browser page all fetch differently, and a
 *          renderer that insisted on doing it would be wrong for most of
 *          them. Keeping the fetch outside is also what keeps this
 *          server-renderable, which is the point of the package.
 *
 *          The general Client SDK is deliberately NOT the way in. Studio has
 *          its own runtime, and routing published pages through a package
 *          every site installs would tax sites that never use Studio.
 *
 *          The stylesheet is a VERSIONED url. A publish changes the URL
 *          rather than the file, so a browser may cache it forever - which is
 *          what replaces the per-request stylesheet call the extension route
 *          used to serve.
 *
 *          The enter-view island is mounted only when the manifest asks for
 *          it. A page of hovers and load animations ships no observer at all.
 *
 *          The Tier 2 island is gated the same way, and harder: the manifest
 *          must NAME the module. Guessing from the presence of declarations
 *          would activate a module the artifact never asked for, which is how
 *          "the runtime activates only what a page needs" quietly stops being
 *          true.
 */
import { stylesheetUrl, INTERACTIONS_TIER2_MODULE, type DeliveredPage } from '@tangen/studio-runtime'
import { composeInstances } from '@tangen/studio-schema'
import { StudioBlocks } from './render'
import { EnterViewRuntime } from './enter-view'
import { InteractionsTier2Runtime } from './interactions-tier2'
import type { BlockNode, ComponentsMap, UnknownBlockMode } from './types'
import type { LoopData } from './loop'
import type { ReactNode } from 'react'

export type StudioPageProps = {
  /** The resolved artifact. Null renders nothing - the site owns its 404. */
  page: DeliveredPage | null
  /** Origin of the delivery endpoint, or '' for a same-origin proxy. */
  baseUrl: string
  /** Public routing identifiers; omit when a proxy supplies them. */
  workspace?: string
  env?: string
  /** Where delivery is mounted; a proxying site points this at its own route. */
  mount?: string
  /**
   * Whether to emit the stylesheet link. A framework with its own <head>
   * management may prefer to place it, and a duplicate link is a wasted
   * request.
   */
  stylesheet?: boolean
  components?: ComponentsMap
  formRenderer?: (formSlug: string) => ReactNode
  unknown?: UnknownBlockMode
  loopData?: LoopData
}

/**
 * The Tier 2 declarations this page asked to have interpreted.
 *
 * Empty unless the manifest names the module, so the island is never mounted
 * and the interpreter chunk is never requested.
 */
function tier2Declarations(page: DeliveredPage) {
  if (!page.runtime?.modules?.includes(INTERACTIONS_TIER2_MODULE)) return []
  return page.runtime.tier2 ?? []
}

/** The classes whose motion waits on the shim. */
function enterViewClasses(page: DeliveredPage): string[] {
  return page.runtime?.interactions
    ?.filter((i) => i.interaction?.event === 'enter-view')
    .map((i) => i.className) ?? []
}

export function StudioPage({
  page, baseUrl, workspace, env, mount, stylesheet = true,
  components, formRenderer, unknown, loopData,
}: StudioPageProps) {
  if (!page) return null

  const href = stylesheetUrl(baseUrl, { route: page.route, version: page.version, workspace, env, mount })
  const watched = page.runtime?.enterView ? enterViewClasses(page) : []
  const tier2 = tier2Declarations(page)
  // The shared surfaces, when the site resolved them beside the page. Their
  // classes were published with THEIR stylesheet, which may be newer than
  // the page's: a header styled after this page shipped would otherwise
  // render unstyled. Same version, one link - a duplicate is a wasted request.
  const shared = page.shared
  const sharedHref = shared && shared.version !== page.version
    ? stylesheetUrl(baseUrl, { route: page.route, version: shared.version, workspace, env, mount })
    : null
  // Instance references become the trees they name, here, at REQUEST time -
  // not at publish time. That is what an instance is for: the page artifact
  // holds a reference, the shared artifact holds the tree, and editing the
  // tree reaches every page without republishing one of them. An id nothing
  // answers is left in place and falls through to the unknown-block policy,
  // so it renders nothing and reports rather than showing a raw id.
  // A surface may hold a reference too, so its blocks are composed the same
  // way: a header that uses an instance is not a special case.
  const instances = shared?.instances
  const pageBlocks = composeInstances(page.blocks, instances)
  const surfacesAt = (position: 'header' | 'footer') =>
    (shared?.surfaces ?? []).filter((s) => s.position === position)
  const renderSurfaces = (position: 'header' | 'footer') => surfacesAt(position).map((s) => {
    const Landmark = position
    return (
      <Landmark key={s.name} data-tangen-surface={s.name}>
        <StudioBlocks
          blocks={composeInstances(s.blocks, instances) as BlockNode[]}
          components={components}
          formRenderer={formRenderer}
          unknown={unknown}
          loopData={loopData}
        />
      </Landmark>
    )
  })

  return (
    <>
      {stylesheet && <link rel="stylesheet" href={href} />}
      {stylesheet && sharedHref && <link rel="stylesheet" href={sharedHref} />}
      {/* Each surface is a landmark naming the global it came from, so a
          site can style or hide one, and Studio can tell a header click
          from a page click by the block keys inside. */}
      {renderSurfaces('header')}
      <StudioBlocks
        blocks={pageBlocks as BlockNode[]}
        components={components}
        formRenderer={formRenderer}
        unknown={unknown}
        loopData={loopData}
      />
      {renderSurfaces('footer')}
      {/* Only when the manifest asks. A page that animates nothing pays
          nothing, which is the whole dependency model in one line. */}
      {watched.length > 0 && <EnterViewRuntime classNames={watched} />}
      {/* Same gate, one tier up: no module named, no island, no chunk. */}
      {tier2.length > 0 && <InteractionsTier2Runtime declarations={tier2} />}
    </>
  )
}
