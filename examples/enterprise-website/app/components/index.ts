/**
 * Page blocks. Every marketing page on this site is a stack of these, so a
 * marketer can build a landing page without a developer and without the
 * frontend growing a new template each time.
 *
 * A block is a `ComponentDef`: sub-fields are the array form ({ name, label,
 * fieldType }), not the keyed builder map that top-level type fields use.
 */
import { defineComponent } from '@tangen/cms'

export const Hero = defineComponent({
  name: 'hero',
  label: 'Hero',
  description: 'Headline, supporting line, one or two calls to action.',
  fields: [
    { name: 'heading', label: 'Heading', fieldType: 'text', required: true },
    { name: 'subheading', label: 'Subheading', fieldType: 'textarea' },
    { name: 'image', label: 'Image', fieldType: 'media', config: { accept: ['image'] } },
    { name: 'primaryCta', label: 'Primary call to action', fieldType: 'link' },
    { name: 'secondaryCta', label: 'Secondary call to action', fieldType: 'link' },
  ],
})

export const RichText = defineComponent({
  name: 'richText',
  label: 'Rich text',
  description: 'A prose section.',
  fields: [{ name: 'body', label: 'Body', fieldType: 'richtext', required: true }],
})

export const FeatureGrid = defineComponent({
  name: 'featureGrid',
  label: 'Feature grid',
  fields: [
    { name: 'heading', label: 'Heading', fieldType: 'text' },
    {
      name: 'features', label: 'Features', fieldType: 'repeater',
      config: { fields: [
        { name: 'title', label: 'Title', fieldType: 'text', required: true },
        { name: 'body', label: 'Body', fieldType: 'textarea' },
        { name: 'icon', label: 'Icon', fieldType: 'text' },
      ] },
    },
  ],
})

export const StatsBand = defineComponent({
  name: 'statsBand',
  label: 'Stats band',
  fields: [{
    name: 'stats', label: 'Stats', fieldType: 'repeater',
    config: { fields: [
      { name: 'value', label: 'Value', fieldType: 'text', required: true },
      { name: 'label', label: 'Label', fieldType: 'text', required: true },
    ] },
  }],
})

export const CtaBanner = defineComponent({
  name: 'ctaBanner',
  label: 'CTA banner',
  fields: [
    { name: 'heading', label: 'Heading', fieldType: 'text', required: true },
    { name: 'body', label: 'Body', fieldType: 'textarea' },
    { name: 'cta', label: 'Call to action', fieldType: 'link', required: true },
  ],
})

export const Faq = defineComponent({
  name: 'faq',
  label: 'FAQ',
  fields: [
    { name: 'heading', label: 'Heading', fieldType: 'text' },
    {
      name: 'items', label: 'Questions', fieldType: 'repeater',
      config: { fields: [
        { name: 'question', label: 'Question', fieldType: 'text', required: true },
        { name: 'answer', label: 'Answer', fieldType: 'richtext', required: true },
      ] },
    },
  ],
})

/** The registry a component field's string refs resolve against. */
export default [Hero, RichText, FeatureGrid, StatsBand, CtaBanner, Faq]

/** Every block a marketing page may contain, by name. */
export const PAGE_BLOCKS = ['hero', 'richText', 'featureGrid', 'statsBand', 'ctaBanner', 'faq']
