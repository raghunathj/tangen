/**
 * Site-wide content. None of this belongs in the frontend: an editor changes
 * the navigation, the support email or the default share image without a
 * deploy.
 *
 * Global fields are the ARRAY form ({ name, label, fieldType, config }) - the
 * keyed `field.*` builder map is for content types only.
 */
import { defineGlobals } from '@tangen/cms'

export default defineGlobals([
  {
    name: 'site-settings',
    label: 'Site settings',
    description: 'Identity and contact details used across the site.',
    fields: [
      { name: 'siteName', label: 'Site name', fieldType: 'text', required: true },
      { name: 'tagline', label: 'Tagline', fieldType: 'text' },
      { name: 'logo', label: 'Logo', fieldType: 'media', config: { accept: ['image'] } },
      { name: 'supportEmail', label: 'Support email', fieldType: 'email' },
      { name: 'salesEmail', label: 'Sales email', fieldType: 'email' },
    ],
  },
  {
    name: 'navigation',
    label: 'Navigation',
    description: 'The primary menu. Two levels, which is all this IA needs.',
    fields: [
      {
        name: 'primary', label: 'Primary menu', fieldType: 'repeater',
        config: { fields: [
          { name: 'label', label: 'Label', fieldType: 'text', required: true },
          { name: 'href', label: 'Link', fieldType: 'link' },
          {
            name: 'children', label: 'Sub-items', fieldType: 'repeater',
            config: { fields: [
              { name: 'label', label: 'Label', fieldType: 'text', required: true },
              { name: 'href', label: 'Link', fieldType: 'link', required: true },
            ] },
          },
        ] },
      },
    ],
  },
  {
    name: 'footer',
    label: 'Footer',
    fields: [
      { name: 'blurb', label: 'Blurb', fieldType: 'textarea' },
      {
        name: 'columns', label: 'Columns', fieldType: 'repeater',
        config: { fields: [
          { name: 'heading', label: 'Heading', fieldType: 'text', required: true },
          {
            name: 'links', label: 'Links', fieldType: 'repeater',
            config: { fields: [
              { name: 'label', label: 'Label', fieldType: 'text', required: true },
              { name: 'href', label: 'Link', fieldType: 'link', required: true },
            ] },
          },
        ] },
      },
      { name: 'legalLine', label: 'Legal line', fieldType: 'text' },
    ],
  },
  {
    name: 'seo-defaults',
    label: 'SEO defaults',
    description: 'Fallbacks for any page that does not set its own.',
    fields: [
      { name: 'titleSuffix', label: 'Title suffix', fieldType: 'text' },
      { name: 'defaultDescription', label: 'Default description', fieldType: 'textarea' },
      { name: 'shareImage', label: 'Default share image', fieldType: 'media', config: { accept: ['image'] } },
    ],
  },
])
