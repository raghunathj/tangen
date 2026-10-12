/**
 * File Name: form.tsx
 * Purpose: kit.form - delegates to the site-provided formRenderer(slug); a
 *          labeled placeholder card when the site provides none.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This wrapper is server-component-safe ON PURPOSE even
 *          though the contract tags kit.form as an island: formRenderer is a
 *          FUNCTION prop, and functions cannot cross an RSC client boundary,
 *          so the delegation must happen server-side. The interactive form
 *          itself is whatever the site's formRenderer returns - typically
 *          the site's own client component, which is where the island
 *          actually lives.
 */
import type { BlockNode, RenderContext } from '../types'
import { str } from '../util'

export function renderForm(block: BlockNode, ctx: RenderContext) {
  const formSlug = str(block.formSlug)
  if (ctx.formRenderer) return <div className="tg-form">{ctx.formRenderer(formSlug)}</div>
  return (
    <div className="tg-form tg-form--placeholder">
      <p className="tg-form__label">Form</p>
      <p className="tg-form__slug">{formSlug === '' ? 'No form selected' : formSlug}</p>
      <p className="tg-form__hint">Pass a formRenderer prop to StudioBlocks to render this form.</p>
    </div>
  )
}
