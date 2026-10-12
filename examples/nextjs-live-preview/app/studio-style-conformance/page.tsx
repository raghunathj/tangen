/**
 * File Name: page.tsx
 * Purpose: The Studio style conformance page - every Style panel control
 *          rendered through the real pipeline, beside the result it is
 *          supposed to produce.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is a TEST SURFACE, not marketing content. Nothing
 *          here is decorated: every box is labelled, sized and coloured only
 *          so a human can see whether the layout is right, because a pretty
 *          fixture hides the failure it exists to expose.
 *
 *          The fixtures come from lib/style-conformance, the same module the
 *          Playwright matrix drives. One source of truth is the point: a page
 *          that agreed with itself but not with the harness would prove
 *          nothing about either.
 *
 *          CSS is generated HERE, at render time, by renderStylesheet and
 *          compileStyles - the shipped emitter. Class names are namespaced
 *          per fixture, so putting every fixture on one page cannot let one
 *          fixture style another.
 *
 *          A handful of fixtures need a driver (hover, focus, a viewport
 *          resize, a scroll, a published-vs-draft comparison) and are listed
 *          rather than rendered - see `harnessOnly` in the fixture module.
 */
import { StudioBlocks, type BlockNode, type LoopData } from '@tangen/studio-react'
import '@tangen/studio-react/styles.css'
import { renderStylesheet, compileStyles, sectionsFromBlocks, topLevelBlocks } from '@tangen/studio-compiler'
import { FIXTURES } from '../../lib/style-conformance/fixtures'
import type { Fixture } from '../../lib/style-conformance/types'

export const metadata = {
  title: 'Studio style conformance',
  description: 'Every Style panel control, and the browser result it must produce.',
}

/** The compiled stylesheet for one fixture, down whichever path it declares. */
function cssFor(fx: Fixture): string {
  // Per-section raw CSS rides the blocks (`_studio.css`) and compiles
  // through the enforcing path, protection or not - as publish does it.
  const sections = sectionsFromBlocks(fx.blocks)
  const page = fx.pageCss ? { css: fx.pageCss, blocks: topLevelBlocks(fx.blocks) } : undefined
  if (fx.protections || sections.length > 0 || page) {
    return compileStyles({
      classes: fx.classes as never,
      tagDefaults: (fx.tags ?? []) as never,
      protections: (fx.protections ?? {}) as never,
      sections,
      page,
    }).css
  }
  return renderStylesheet({
    classes: fx.classes as never,
    tagDefaults: (fx.tags ?? []) as never,
    fonts: fx.fonts as never,
  })
}

/** Layout for the page itself. Deliberately outside every fixture's names. */
const PAGE_CSS = `
.conf-wrap { max-width: none; }
.conf-head { padding: 24px 0 8px; }
.conf-head h1 { font-size: 24px; margin: 0 0 6px; }
.conf-head p { margin: 0; color: #606675; font-size: 14px; max-width: 70ch; }
.conf-group { margin: 32px 0 8px; font-size: 13px; letter-spacing: .08em;
  text-transform: uppercase; color: #4f46e5; border-bottom: 1px solid #e6e8ef; padding-bottom: 6px; }
.conf-case { border: 1px solid #e6e8ef; border-radius: 8px; background: #fff; margin: 0 0 18px; overflow: hidden; }
.conf-case > header { padding: 10px 14px; border-bottom: 1px solid #eef0f5; background: #fbfbfe; }
.conf-case h2 { margin: 0; font-size: 14px; font-weight: 650; }
.conf-case .conf-expect { margin: 4px 0 0; font-size: 13px; color: #606675; }
.conf-case .conf-id { font-size: 11px; color: #9aa0b0; font-family: ui-monospace, monospace; }
.conf-stage { width: 1000px; max-width: 100%; padding: 12px 14px; }
.conf-driver { margin: 0 0 18px; padding: 10px 14px; border: 1px dashed #d6d9f4;
  border-radius: 8px; background: #f7f8ff; font-size: 13px; color: #3a32c4; }
.conf-driver code { font-size: 12px; }
`

export default function StudioStyleConformancePage() {
  const rendered = FIXTURES.filter((f) => !f.harnessOnly)
  const driven = FIXTURES.filter((f) => f.harnessOnly)
  const groups = [...new Set(rendered.map((f) => f.group))]

  return (
    <div className="conf-wrap">
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: rendered.map(cssFor).join('\n') }} />

      <div className="conf-head">
        <h1>Studio style conformance</h1>
        <p>
          Every control the style registry exposes, rendered through the real
          compiler and the real runtime. Each case states the result it is
          supposed to produce; if what you see below it does not match, the
          control is not implemented however good the JSON looks.
        </p>
      </div>

      {groups.map((group) => (
        <section key={group}>
          <h2 className="conf-group">{group}</h2>
          {rendered.filter((f) => f.group === group).map((fx) => (
            <article className="conf-case" key={fx.id}>
              <header>
                <h2>{fx.label}</h2>
                <p className="conf-expect">Expected: {fx.expectation}</p>
                <span className="conf-id">{fx.id}</span>
              </header>
              <div className="conf-stage">
                <StudioBlocks
                  blocks={fx.blocks as unknown as BlockNode[]}
                  loopData={fx.loopData as unknown as LoopData}
                  unknown="placeholder"
                />
              </div>
            </article>
          ))}
        </section>
      ))}

      <section>
        <h2 className="conf-group">driver only</h2>
        <p className="conf-driver">
          These cases need something a static page cannot do: a hover, a focus,
          a viewport resize, a scroll, or a published artifact to compare
          against. They live in the same fixture module and are asserted by the
          Playwright matrix. Run it with{' '}
          <code>node run.mjs</code> in the style-conformance harness.
        </p>
        <ul>
          {driven.map((fx) => (
            <li key={fx.id}>
              <strong>{fx.label}</strong> - {fx.expectation} <span className="conf-id">{fx.id}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
