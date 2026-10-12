/**
 * File Name: builder-kit.ts
 * Purpose: The Builder Kit - Studio's first-party generic component defs
 *          (kit.section / kit.row layout blocks + the widget library), the
 *          Elementor-class vocabulary a marketer composes with when a site
 *          registers no section vocabulary of its own. Names, props, and
 *          option values are CANONICAL per the phase 2 contract; the
 *          @tangen/studio-react runtime renders exactly these shapes.
 *          Token-typed props are select fields whose options are the
 *          DEFAULT token slot lists - Studio's style panel swaps in the
 *          workspace's extended lists at runtime (GET tokens), the defs
 *          stay contract-pure.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure data over @tangen/types - safe in workspace
 *          config, server, and admin bundles alike. Child restrictions ride
 *          the platform's own mechanism (a component field's
 *          config.components list): section children are any kit.* except
 *          kit.section, row columns are widgets only. Thumbnails are left
 *          unset - the palette's letter tiles cover them; sites may
 *          override per def if they want imagery.
 *
 *          PROTECTION is declared per def (see the block comments below and
 *          docs/studio.md, "Declaring protection"). Layout blocks and the
 *          single-element widgets are Open: a designer styles them freely,
 *          which is the whole Phase 1 story. Widgets with internal structure
 *          are Guided: their public root is stylable, and an internal is
 *          reachable only where it is declared as a Style Part. Nothing is
 *          Locked by default - Locked is for a site's own checkout, not for
 *          a button group. Every declaration, the kit's and the site's, is
 *          validated where it is read, so a typo is a boot error rather than
 *          an Open Block nobody decided on.
 *
 *          LOCALIZATION is declared per prop, where the schema keeps it for
 *          a sub-field (`config.localized`, the key `tangen push` stores and
 *          the API's overlay writes accept). The kit's TEXT is localized by
 *          default (user decision, 2026-08-23): a heading's text, a body, a
 *          link's label, a button's label, list and accordion items, an
 *          image's alt. A destination (href, a form slug, a video URL), a
 *          token, a layout choice, a child slot and a loop's query are ONE
 *          value for every language, so a translator cannot quietly change
 *          them from inside Tamil. __tests__/kit-localized.test.ts is the
 *          table; changing it is a product decision.
 */
import type { ComponentDef, ComponentProtection, SubField } from '@tangen/types'
import { readProtectionDeclaration, type BlockProtection } from '@tangen/studio-schema'
import { DEFAULT_TOKENS } from './tokens'

type Option = { label: string; value: string }

/** Options whose label IS the value (token slots, technical values). */
const opts = (values: readonly string[]): Option[] => values.map((v) => ({ label: v, value: v }))

/** Options with hand-picked labels; values stay contract-verbatim. */
const labeled = (pairs: Array<[string, string]>): Option[] =>
  pairs.map(([value, label]) => ({ label, value }))

const ALIGN_H = labeled([['left', 'Left'], ['center', 'Center'], ['right', 'Right']])

// ── Protection vocabulary ─────────────────────────────────────────────────────

/** The properties a Style Part opens up, by what the part IS. */
const TYPOGRAPHY = [
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-align', 'color', 'text-transform', 'text-decoration',
]
const SURFACE = [
  'background-color', 'border-style', 'border-color',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'box-shadow', 'opacity',
]
const PADDING = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']
const MOTION = ['transition', 'transform']

/**
 * Guided, root exposed in full. The model refuses the dangerous set
 * (display, position, overflow, height) on a protected root whatever the
 * list says, so an empty root part means "everything that cannot break it".
 */
const guided = (parts: Record<string, { properties?: string[] }> = {}): ComponentProtection =>
  ({ level: 'guided', parts: { root: {}, ...parts } })

// ── v2 style depth (token-bound, never raw CSS) ───────────────────────────────

/**
 * Box styling and responsive visibility are NOT declared here any more.
 * Studio supplies them to every block through the wrapper (lib/wrapper.ts),
 * stored under the reserved `_studio` key - so a developer's own component
 * gets the same chrome without hand-authoring a single field, and the set
 * is defined once instead of repeated across thirteen defs.
 */

// ── Widgets (kit.heading .. kit.form) ─────────────────────────────────────────

// kit.heading, kit.text, kit.spacer and kit.divider declare NO protection:
// each is one element, and a designer styling it IS the feature. A spacer
// whose height could not be set would be a spacer in name only.
const kitHeading: ComponentDef = {
  name: 'kit.heading',
  label: 'Heading',
  group: 'Widgets',
  description: 'A headline: text, heading level, type size, alignment.',
  fields: [
    { name: 'text', label: 'Text', fieldType: 'text', config: { localized: true } },
    { name: 'level', label: 'Level', fieldType: 'select', config: { options: labeled([['h1', 'H1'], ['h2', 'H2'], ['h3', 'H3'], ['h4', 'H4']]) } },
    { name: 'size', label: 'Size', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.type) } },
    { name: 'align', label: 'Align', fieldType: 'select', group: 'style', config: { options: ALIGN_H } },
  ],
}

const kitText: ComponentDef = {
  name: 'kit.text',
  label: 'Text',
  group: 'Widgets',
  description: 'Rich text copy with a type size and alignment.',
  fields: [
    { name: 'body', label: 'Body', fieldType: 'richtext', config: { localized: true } },
    { name: 'size', label: 'Size', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.type) } },
    { name: 'align', label: 'Align', fieldType: 'select', group: 'style', config: { options: ALIGN_H } },
  ],
}

/**
 * Guided. An image is a figure around an <img>, and a class lands on the
 * figure: sizing the root is fine, hiding or repositioning it is not. The
 * picture itself is the one internal a designer obviously wants - rounding,
 * a shadow, a fade - so it is exposed as the `image` part.
 */
const kitImage: ComponentDef = {
  name: 'kit.image',
  label: 'Image',
  group: 'Widgets',
  description: 'An image with alt text, a width token, and corner rounding.',
  protection: guided({ image: { properties: [...SURFACE, ...MOTION] } }),
  fields: [
    { name: 'image', label: 'Image', fieldType: 'media', config: { accept: ['image'] } },
    { name: 'alt', label: 'Alt text', fieldType: 'text', config: { localized: true } },
    { name: 'width', label: 'Width', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.width) } },
    { name: 'rounded', label: 'Rounded', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.radius) } },
  ],
}

/**
 * Guided. The group root takes spacing and background; the buttons inside
 * are what a designer actually wants to skin, and they are exposed as ONE
 * `button` part rather than per variant, so a brand colour is one rule.
 * Their box, typography and motion are open; their layout is the widget's
 * (variant and size are props).
 */
const kitButtons: ComponentDef = {
  name: 'kit.buttons',
  label: 'Buttons',
  group: 'Widgets',
  description: 'A group of call-to-action buttons.',
  protection: guided({ button: { properties: [...TYPOGRAPHY, ...SURFACE, ...PADDING, ...MOTION, 'cursor'] } }),
  fields: [
    {
      name: 'items', label: 'Buttons', fieldType: 'repeater',
      config: {
        fields: [
          { name: 'label', label: 'Label', fieldType: 'text', config: { localized: true } },
          { name: 'href', label: 'Link', fieldType: 'text' },
          { name: 'variant', label: 'Variant', fieldType: 'select', config: { options: labeled([['primary', 'Primary'], ['secondary', 'Secondary'], ['ghost', 'Ghost']]) } },
          { name: 'size', label: 'Size', fieldType: 'select', config: { options: labeled([['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']]) } },
        ] satisfies SubField[],
      },
    },
    { name: 'align', label: 'Align', fieldType: 'select', group: 'style', config: { options: ALIGN_H } },
  ],
}

const kitSpacer: ComponentDef = {
  name: 'kit.spacer',
  label: 'Spacer',
  group: 'Widgets',
  description: 'Vertical breathing room from the spacing scale.',
  fields: [
    { name: 'size', label: 'Size', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.space) } },
  ],
}

const kitDivider: ComponentDef = {
  name: 'kit.divider',
  label: 'Divider',
  group: 'Widgets',
  description: 'A horizontal rule between sections of content.',
  // No props by design: a divider's whole meaning is its presence. The flag
  // is what lets an empty field list through the empty-container validation.
  leaf: true,
  fields: [],
}

/**
 * Guided, root only. The aspect box and the player inside it are the whole
 * behaviour: an iframe given its own height or display stops playing. The
 * root takes rounding, shadow and spacing, which is what a video needs.
 */
const kitVideo: ComponentDef = {
  name: 'kit.video',
  label: 'Video',
  group: 'Widgets',
  description: 'An embedded video by URL with a fixed aspect ratio.',
  protection: guided(),
  fields: [
    { name: 'url', label: 'Video URL', fieldType: 'text' },
    { name: 'aspect', label: 'Aspect ratio', fieldType: 'select', group: 'style', config: { options: opts(['16:9', '4:3', '1:1']) } },
  ],
}

/**
 * Guided, root only for now. It has internals (icon, title, body per item)
 * and exposing them is a product decision about which ones, so none are
 * guessed here; the columns layout is a prop and must not be fought by a
 * class on the root.
 */
const kitIconList: ComponentDef = {
  name: 'kit.iconList',
  label: 'Icon list',
  group: 'Widgets',
  description: 'Feature points with an icon, a title, and a short body.',
  protection: guided(),
  fields: [
    { name: 'columns', label: 'Columns', fieldType: 'select', group: 'style', config: { options: labeled([['1', '1 column'], ['2', '2 columns'], ['3', '3 columns']]) } },
    {
      name: 'items', label: 'Items', fieldType: 'repeater',
      config: {
        fields: [
          { name: 'icon', label: 'Icon', fieldType: 'select', config: { options: labeled([['spark', 'Spark'], ['code', 'Code'], ['check', 'Check'], ['star', 'Star'], ['shield', 'Shield'], ['clock', 'Clock'], ['globe', 'Globe'], ['heart', 'Heart']]) } },
          { name: 'title', label: 'Title', fieldType: 'text', config: { localized: true } },
          { name: 'body', label: 'Body', fieldType: 'text', config: { localized: true } },
        ] satisfies SubField[],
      },
    },
  ],
}

/**
 * Guided. Native <details>/<summary> is the behaviour, and `display` on any
 * of it breaks the disclosure - which is exactly the dangerous set. What a
 * designer wants is obvious from the structure: the `item` box, the `title`
 * row and the `body` text, so those three are exposed.
 */
const kitAccordion: ComponentDef = {
  name: 'kit.accordion',
  label: 'Accordion',
  group: 'Widgets',
  description: 'Expandable items - FAQs, specs, fine print.',
  protection: guided({
    item: { properties: [...SURFACE, ...PADDING, 'margin-top', 'margin-bottom'] },
    title: { properties: [...TYPOGRAPHY, ...SURFACE, ...PADDING, 'cursor'] },
    body: { properties: [...TYPOGRAPHY, ...SURFACE, ...PADDING] },
  }),
  fields: [
    {
      name: 'items', label: 'Items', fieldType: 'repeater',
      config: {
        fields: [
          { name: 'title', label: 'Title', fieldType: 'text', config: { localized: true } },
          { name: 'body', label: 'Body', fieldType: 'richtext', config: { localized: true } },
        ] satisfies SubField[],
      },
    },
  ],
}

/**
 * Guided, root only. The form renders through the SITE's renderer, so its
 * internals belong to the site and nothing here may reach them; `display:
 * none` on a form is a form nobody can submit.
 */
const kitForm: ComponentDef = {
  name: 'kit.form',
  label: 'Form',
  group: 'Widgets',
  description: 'Embeds a form by slug (renders through the site\'s form renderer).',
  protection: guided(),
  fields: [
    { name: 'formSlug', label: 'Form slug', fieldType: 'text' },
  ],
}

/**
 * Open. One anchor, and a designer styling it IS the feature - colour,
 * underline, weight, a hover state. The text element is the anchor itself.
 * It is also the one kit block that can honestly be `display:inline`: the
 * wrapper holds an inline child, so two links share a line (see
 * display-support.ts in @tangen/studio-schema). The destination is
 * scheme-checked at render, like every href the kit writes.
 */
const kitLink: ComponentDef = {
  name: 'kit.link',
  label: 'Link',
  group: 'Widgets',
  description: 'An inline link: text, destination, and whether it opens a new tab.',
  fields: [
    { name: 'text', label: 'Text', fieldType: 'text', config: { localized: true } },
    { name: 'href', label: 'Link', fieldType: 'text' },
    { name: 'target', label: 'Opens in', fieldType: 'select', group: 'advanced', config: { options: labeled([['_self', 'Same tab'], ['_blank', 'New tab']]) } },
  ],
}

/**
 * Guided. A list is a <ul> or <ol> of <li>: `display` on the root turns
 * bullets into a row of unmarked boxes and `height` clips items, which is
 * the dangerous set exactly. What a designer wants is the ITEM - its text,
 * its spacing, a rule between items - so `item` is the one part exposed;
 * the marker style stays the widget's (ordered or not is a prop).
 */
const kitList: ComponentDef = {
  name: 'kit.list',
  label: 'List',
  group: 'Widgets',
  description: 'A bulleted or numbered list of short items.',
  protection: guided({ item: { properties: [...TYPOGRAPHY, ...PADDING, 'margin-top', 'margin-bottom'] } }),
  fields: [
    { name: 'style', label: 'Style', fieldType: 'select', config: { options: labeled([['unordered', 'Bulleted'], ['ordered', 'Numbered']]) } },
    {
      name: 'items', label: 'Items', fieldType: 'repeater',
      config: { fields: [{ name: 'text', label: 'Text', fieldType: 'text', config: { localized: true } }] satisfies SubField[] },
    },
  ],
}

/**
 * Guided. A long-form body from the platform's richtext value - the TipTap
 * document the admin editor stores - rendered through the same safe
 * renderer kit.text uses. Where kit.text is one sized, aligned paragraph,
 * this is the article: headings, paragraphs, links and lists together, so
 * `display` on the root would unmake its flow (refused) and the four
 * element kinds the document renders are the parts a designer reaches.
 */
const kitRichText: ComponentDef = {
  name: 'kit.richText',
  label: 'Rich text',
  group: 'Widgets',
  description: 'A long-form body: headings, paragraphs, links and lists from the rich text editor.',
  protection: guided({
    heading: { properties: [...TYPOGRAPHY, 'margin-top', 'margin-bottom'] },
    paragraph: { properties: [...TYPOGRAPHY, 'margin-top', 'margin-bottom'] },
    link: { properties: [...TYPOGRAPHY, ...MOTION, 'cursor'] },
    item: { properties: [...TYPOGRAPHY, ...PADDING, 'margin-top', 'margin-bottom'] },
  }),
  fields: [
    { name: 'body', label: 'Body', fieldType: 'richtext', config: { localized: true } },
  ],
}

/** The widget defs, contract order (everything but section and row). */
/**
 * A reference to an INSTANCE: one shared authored tree, edited in one place
 * and shown identically everywhere it is placed. Presented as "Instance" in
 * every surface of the UI; the `kit.` wire name keeps it inside the existing
 * block vocabulary, and therefore inside the unknown-block degrade policy.
 *
 * LOCKED, with no parts, and that is the whole protection story: the borrowed
 * subtree is not in this document, so there is nothing here to select, restyle
 * or edit. Styling belongs to the instance, which is the only place it can
 * mean the same thing on every page that uses it. Locked rather than merely
 * childless, because a class or a raw-CSS rule aimed at the reference would
 * otherwise reach the shared tree from ONE page.
 *
 * Both props are Studio's: `instanceId` is minted when a reference is placed
 * from the Instances panel, and `label` is a cached copy of the instance's
 * title so the tree can still name the row when the instance cannot be read.
 * Neither is drawn as a control (see `INSTANCE_REF_PROPS`) - typing an object
 * id into a text box is not an edit anyone means to make.
 */
const kitInstance: ComponentDef = {
  name: 'kit.instance',
  label: 'Instance',
  group: 'Widgets',
  description: 'A shared instance: one authored tree, identical on every page that uses it.',
  protection: { level: 'locked' },
  fields: [
    { name: 'instanceId', label: 'Instance', fieldType: 'text' },
    { name: 'label', label: 'Name', fieldType: 'text' },
  ],
}

const widgets: ComponentDef[] = [
  kitHeading, kitText, kitImage, kitButtons, kitSpacer, kitDivider,
  kitVideo, kitIconList, kitAccordion, kitForm, kitLink, kitList, kitRichText,
  kitInstance,
]

// ── Layout blocks (kit.row, kit.section) ──────────────────────────────────────

// kit.row and kit.section are Open. They are layout, and styling layout
// freely - display, height, position included - is the whole Phase 1 story;
// the 447/447 conformance matrix is built on it.
const kitRow: ComponentDef = {
  name: 'kit.row',
  label: 'Row',
  group: 'Layout',
  description: 'Side-by-side columns of widgets; layout picks the split.',
  fields: [
    {
      name: 'layout', label: 'Layout', fieldType: 'select', group: 'style',
      config: {
        options: labeled([
          ['1', 'One column'],
          ['2', 'Two columns'],
          ['3', 'Three columns'],
          ['1/3-2/3', 'Narrow left (1/3-2/3)'],
          ['2/3-1/3', 'Narrow right (2/3-1/3)'],
        ]),
      },
    },
    { name: 'gap', label: 'Gap', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.space) } },
    { name: 'align', label: 'Align', fieldType: 'select', group: 'style', config: { options: labeled([['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']]) } },
    // Columns hold WIDGETS only - no nested sections or rows (the contract's
    // constrained tree). col2/col3 are ignored by the renderer when the
    // layout has fewer columns.
    { name: 'col1', label: 'Column 1', fieldType: 'component', config: { components: [...widgets] } },
    { name: 'col2', label: 'Column 2', fieldType: 'component', config: { components: [...widgets] } },
    { name: 'col3', label: 'Column 3', fieldType: 'component', config: { components: [...widgets] } },
    // Responsive stacking: columns collapse to one below the breakpoint.
    // Absent means 'mobile' - the runtime's default, the sensible one.
    { name: 'stackOn', label: 'Stack columns', fieldType: 'select', group: 'advanced', config: { options: labeled([['mobile', 'On mobile'], ['tablet', 'On tablet and below'], ['never', 'Never']]) } },
  ],
}

/**
 * A Tangen collection query, driving a repeated itemTemplate over real
 * data - the Loop/Query builder primitive (Phase 3). `query` stores the
 * exact TangenQL filter shape (docs/tangenql.md) verbatim - no parallel
 * DSL; the Studio Query Builder panel (D-T4) authors it, and the
 * blocks-react renderer (D-T3) passes it straight to a site-supplied
 * resolver. `sortField`/`sortDirection` mirror TangenQL's `sort: {field,
 * direction}` as flat props, matching every other kit def's flat-prop
 * style. itemTemplate holds widgets only, same restriction as kit.row's
 * columns - a loop item is content, not another container.
 */
/**
 * Guided. The loop lays its items out itself (layout and columns are props),
 * so a class on the root must not take `display` from it; gap and spacing
 * are fine. The repeated `item` box is the obvious part: a card background,
 * border and padding are what a listing is styled with.
 */
const kitLoop: ComponentDef = {
  name: 'kit.loop',
  label: 'Loop',
  group: 'Data',
  description: 'Repeats a template over a Tangen collection query - dynamic listings without code.',
  protection: guided({ item: { properties: [...SURFACE, ...PADDING, ...MOTION] } }),
  fields: [
    { name: 'source', label: 'Collection', fieldType: 'text' },
    { name: 'query', label: 'Query', fieldType: 'json' },
    { name: 'sortField', label: 'Sort by', fieldType: 'text' },
    { name: 'sortDirection', label: 'Sort direction', fieldType: 'select', config: { options: labeled([['asc', 'Ascending'], ['desc', 'Descending']]) } },
    { name: 'limit', label: 'Limit', fieldType: 'number' },
    { name: 'layout', label: 'Layout', fieldType: 'select', group: 'style', config: { options: labeled([['grid', 'Grid'], ['list', 'List']]) } },
    { name: 'columns', label: 'Columns', fieldType: 'select', group: 'style', config: { options: labeled([['1', '1 column'], ['2', '2 columns'], ['3', '3 columns'], ['4', '4 columns']]) } },
    { name: 'gap', label: 'Gap', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.space) } },
    { name: 'pagination', label: 'Pagination', fieldType: 'select', group: 'advanced', config: { options: labeled([['none', 'None'], ['loadMore', 'Load more'], ['pages', 'Pages']]) } },
    { name: 'itemTemplate', label: 'Item template', fieldType: 'component', config: { components: [...widgets] } },
    // State slots: ordinary block subtrees, so a marketer designs the empty
    // and failed cases with the same widgets as everything else rather than
    // getting a hardcoded string nobody can rebrand.
    { name: 'emptyState', label: 'Empty state', fieldType: 'component', config: { components: [...widgets] } },
    { name: 'errorState', label: 'Error state', fieldType: 'component', config: { components: [...widgets] } },
  ],
}

// ── Layout boxes (WF-T12) ─────────────────────────────────────────────────────
//
// Open, like section and row: a box is layout, and styling layout freely -
// display, height, position included - is the point of a box. Each renders a
// CONTENT element holding its children, so a class's container-layout rules
// (`.hero--content{display:flex}`) reach them, as they do on a section.
//
// A box never lists ITSELF among its children: that is a cycle in the def
// graph, which the schema could not serialise for push or GET /types. Width
// inside width is not a real need; a bare kit.div inside a container is.

/**
 * The free-form box: nothing of its own but children. Every property it
 * has comes from the class it wears, which is what a designer building a
 * card, a badge row or a sticky footer actually wants - a box that gets out
 * of the way. Bare on purpose: no width, no padding, no gap.
 */
const kitDiv: ComponentDef = {
  name: 'kit.div',
  label: 'Box',
  group: 'Layout',
  description: 'A bare box holding blocks; everything about it comes from its class.',
  fields: [
    { name: 'children', label: 'Content', fieldType: 'component', config: { components: [kitRow, kitLoop, ...widgets] } },
  ],
}

/**
 * A CSS grid of equal columns, responsive by prop: the column count per
 * breakpoint, the gap from the space scale, and each child is a cell. Where
 * kit.row is a fixed set of column presets over three slots, this is N
 * cells flowing into N columns - the card grid, the logo wall, the feature
 * tiles. Cells are bare boxes and widgets; a grid in a grid is a cycle.
 */
const kitGrid: ComponentDef = {
  name: 'kit.grid',
  label: 'Grid',
  group: 'Layout',
  description: 'Equal columns that wrap: a column count per breakpoint, a gap, and each block a cell.',
  fields: [
    { name: 'columns', label: 'Columns', fieldType: 'select', group: 'style', config: { options: labeled([['1', '1 column'], ['2', '2 columns'], ['3', '3 columns'], ['4', '4 columns']]) } },
    { name: 'columnsTablet', label: 'Columns on tablet', fieldType: 'select', group: 'style', config: { options: labeled([['1', '1 column'], ['2', '2 columns'], ['3', '3 columns']]) } },
    { name: 'columnsMobile', label: 'Columns on mobile', fieldType: 'select', group: 'style', config: { options: labeled([['1', '1 column'], ['2', '2 columns']]) } },
    { name: 'gap', label: 'Gap', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.space) } },
    { name: 'children', label: 'Cells', fieldType: 'component', config: { components: [kitDiv, ...widgets] } },
  ],
}

/**
 * A width-constrained box: the width token, children. The piece of a
 * section a designer reaches for when the band should stay full-bleed but
 * part of its content should sit on the narrow measure. Holds a bare box
 * and a grid, so "narrow measure, then a card grid inside it" needs no
 * second container.
 */
const kitContainer: ComponentDef = {
  name: 'kit.container',
  label: 'Container',
  group: 'Layout',
  description: 'A centred box on the width scale, holding blocks.',
  fields: [
    { name: 'width', label: 'Width', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.width) } },
    { name: 'children', label: 'Content', fieldType: 'component', config: { components: [kitRow, kitLoop, kitDiv, kitGrid, ...widgets] } },
  ],
}

/** The layout boxes, in the order the palette lists them. */
const boxes: ComponentDef[] = [kitContainer, kitDiv, kitGrid]

const kitSection: ComponentDef = {
  name: 'kit.section',
  label: 'Section',
  group: 'Layout',
  description: 'A full-width band: background, padding, content width, children.',
  fields: [
    { name: 'background', label: 'Background', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.palette) } },
    { name: 'padding', label: 'Padding', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.space) } },
    { name: 'width', label: 'Content width', fieldType: 'select', config: { options: opts(DEFAULT_TOKENS.width) } },
    // Any kit.* except kit.section - sections never nest.
    { name: 'children', label: 'Content', fieldType: 'component', config: { components: [kitRow, kitLoop, ...boxes, ...widgets] } },
  ],
}

/**
 * The Builder Kit, contract order: layout blocks first, then the widget
 * library. Every entry is a plain inline ComponentDef - Studio's palette,
 * the object editor, validation, and AI generation all consume them through
 * the platform's normal component-field machinery.
 */
export const builderKitComponents: ComponentDef[] = [kitSection, kitRow, kitLoop, ...boxes, ...widgets]

/**
 * The kit's protection, by block type - the map `compileStyles` takes.
 *
 * Read through the validator at module load, so a typo in the kit's own
 * declarations fails the import rather than shipping an Open widget. Only
 * declaring blocks appear; an absent entry is Open by the model's rule.
 */
export const builderKitProtections: Readonly<Record<string, BlockProtection>> = Object.freeze(
  Object.fromEntries(
    builderKitComponents.flatMap((d) => {
      const protection = readProtectionDeclaration(d.name, d.protection)
      return protection ? [[d.name, protection]] : []
    }),
  ),
)

/**
 * Appends the Builder Kit to a field's components list. Site entries lead
 * and WIN on a name clash (an inline def or string ref named kit.* keeps
 * the site's version); the input array is never mutated.
 *
 *   fields: [component('sections', 'Sections', { components: withBuilderKit([hero, 'cta']) })]
 */
export function withBuilderKit(components?: Array<string | ComponentDef>): Array<string | ComponentDef> {
  const existing = components ?? []
  // The site's inline defs are validated HERE because this runs when the
  // config loads - at boot and at push - which is the earliest a malformed
  // declaration can be refused with the component and the key named. A
  // string ref is a registry component and is validated where it is read.
  for (const c of existing) {
    if (typeof c !== 'string') readProtectionDeclaration(c.name, c.protection)
  }
  const taken = new Set(existing.map((c) => (typeof c === 'string' ? c : c.name)))
  return [...existing, ...builderKitComponents.filter((d) => !taken.has(d.name))]
}
