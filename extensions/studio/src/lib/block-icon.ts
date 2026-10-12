/**
 * File Name: block-icon.ts
 * Purpose: The icon a block wears in the navigator - chosen by what the
 *          block IS, so a deep tree is scannable instead of a column of
 *          identical dots.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Three tiers, in order. An `icon` a developer declared
 *          on the component def always wins. Kit blocks have hand-picked
 *          ones. Everything else is INFERRED FROM ITS FIELDS - a component
 *          holding blocks is a container, one bound to a relation is data, a
 *          label beside a url is a link - so a site's own components get a
 *          meaningful tree with nothing annotated.
 *
 *          Icon names are strings resolved by the renderer, keeping this
 *          module free of the admin's icon bundle (same shape as panels.ts).
 */

/** A developer component we could not read anything from. */
export const FALLBACK_ICON = 'IconPuzzle'

/** Hand-picked, because a kit block's meaning is known exactly. */
const KIT_ICONS: Record<string, string> = {
  'kit.section': 'IconStack',
  'kit.row': 'IconLayoutLeft',
  'kit.loop': 'IconDatabase',
  // WF-T12 layout boxes: a container is a centred measure, distinct from the stack.
  'kit.container': 'IconAlignCenter',
  'kit.div': 'IconLayoutColumn',
  'kit.grid': 'IconLayoutGrid',
  'kit.link': 'IconLink',
  'kit.list': 'IconListOrdered',
  'kit.richText': 'IconFileText',
  'kit.heading': 'IconText',
  'kit.text': 'IconArticle',
  'kit.image': 'IconImage',
  'kit.buttons': 'IconRadioButton',
  'kit.spacer': 'IconExpandUpDown',
  'kit.divider': 'IconMoreHorizontal',
  'kit.video': 'IconPlayCircle',
  'kit.iconList': 'IconListUnordered',
  // An accordion is the thing that expands, and the chevron says so.
  'kit.accordion': 'IconChevronDown',
  'kit.form': 'IconSurvey',
  // A reference: one tree shared by many pages.
  'kit.instance': 'IconShare',
}

interface DefLike {
  icon?: unknown
  fields?: Array<{ name: string; fieldType: string }>
}

const LINKISH = ['url', 'href', 'link']

/**
 * The icon name for a block. Inference is ordered most-distinctive first:
 * structure beats data, data beats lists, and a picture only wins when the
 * component has no words of its own - otherwise every banner with a
 * background image would read as a photograph.
 */
export function blockIconName(type: string, def: DefLike | null | undefined): string {
  const declared = typeof def?.icon === 'string' ? def.icon.trim() : ''
  if (declared) return declared

  const kit = KIT_ICONS[type]
  if (kit) return kit

  const fields = def?.fields ?? []
  const has = (pred: (f: { name: string; fieldType: string }) => boolean) => fields.some(pred)

  if (has((f) => f.fieldType === 'component')) return 'IconStack'
  if (has((f) => f.fieldType === 'relation')) return 'IconDatabase'
  if (has((f) => f.fieldType === 'repeater')) return 'IconListUnordered'
  if (has((f) => LINKISH.includes(f.name.toLowerCase()) && f.fieldType === 'text')) return 'IconLink'

  const hasWords = has((f) => ['text', 'textarea', 'richtext'].includes(f.fieldType))
  if (has((f) => f.fieldType === 'media') && !hasWords) return 'IconImage'
  if (has((f) => ['textarea', 'richtext'].includes(f.fieldType))) return 'IconArticle'
  if (has((f) => f.fieldType === 'text')) return 'IconText'

  return FALLBACK_ICON
}
