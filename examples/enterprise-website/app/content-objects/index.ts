/**
 * Northwind Systems - content architecture.
 *
 * Eight types. The shape of the site drove them, not a desire to exercise
 * features: a marketing page is a stack of blocks, and everything that is NOT
 * a marketing page is a type with real fields of its own.
 *
 * `title`, `slug`, `status` and the publish timestamps are BUILT IN - every
 * content type already has them, and declaring one is an error. That is why
 * none of these types names a title, and why Article has no publishedAt: the
 * platform already tracks when a thing was published, and articles order by
 * it.
 */
import { defineSchema, defineObjectType, field } from '@tangen/cms'
import { PAGE_BLOCKS } from '../components'

/**
 * A marketing page. `path` is the routable URL and is authored, not derived:
 * the IA nests (/solutions/enterprise) and a slug alone cannot express that.
 * Home is path '/'.
 */
export const Page = defineObjectType({
  name: 'page',
  label: 'Page',
  plural: 'Pages',
  fields: {
    path: field.text({
      label: 'URL path',
      validation: { required: true, unique: true },
      admin: { helpText: 'Leading slash. The home page is "/".' },
    }),
    summary: field.textarea({ label: 'Summary', localized: true, admin: { helpText: 'Used as the meta description fallback.' } }),
    body: field.component({ label: 'Body', config: { components: PAGE_BLOCKS } }),
  },
})

/** A product. Distinct from Page because a product has fields a page does not. */
export const Product = defineObjectType({
  name: 'product',
  label: 'Product',
  plural: 'Products',
  fields: {
    tagline: field.text({ label: 'Tagline', validation: { required: true }, localized: true }),
    summary: field.textarea({ label: 'Summary', validation: { required: true }, localized: true }),
    logo: field.media({ label: 'Logo', config: { accept: ['image'] } }),
    order: field.number({ label: 'Sort order', config: { default: 0 } }),
    body: field.component({ label: 'Body', config: { components: PAGE_BLOCKS } }),
  },
})

/** A solution: the same content sold to a different audience. */
export const Solution = defineObjectType({
  name: 'solution',
  label: 'Solution',
  plural: 'Solutions',
  fields: {
    audience: field.select({
      label: 'Audience', validation: { required: true },
      config: { options: [
        { label: 'Enterprise', value: 'enterprise' },
        { label: 'Developers', value: 'developers' },
      ] },
    }),
    summary: field.textarea({ label: 'Summary', validation: { required: true }, localized: true }),
    // A solution is sold THROUGH products, so the relation is the point of the type.
    products: field.relation({ label: 'Products', config: { targetType: 'product', many: true } }),
    body: field.component({ label: 'Body', config: { components: PAGE_BLOCKS } }),
  },
})

export const Person = defineObjectType({
  name: 'person',
  label: 'Person',
  plural: 'People',
  fields: {
    role: field.text({ label: 'Role' }),
    bio: field.textarea({ label: 'Bio' }),
    avatar: field.media({ label: 'Photo', config: { accept: ['image'] } }),
  },
})

export const Category = defineObjectType({
  name: 'category',
  label: 'Category',
  plural: 'Categories',
  fields: {
    description: field.textarea({ label: 'Description' }),
  },
})

export const Article = defineObjectType({
  name: 'article',
  label: 'Article',
  plural: 'Articles',
  fields: {
    excerpt: field.textarea({ label: 'Excerpt', validation: { required: true }, localized: true }),
    heroImage: field.media({ label: 'Hero image', config: { accept: ['image'] } }),
    // Authorship is a relation, not a string, so an author's name changes once.
    author: field.relation({ label: 'Author', config: { targetType: 'person' } }),
    categories: field.relation({ label: 'Categories', config: { targetType: 'category', many: true } }),
    body: field.richtext({ label: 'Body', validation: { required: true }, localized: true }),
  },
})

export const CaseStudy = defineObjectType({
  name: 'caseStudy',
  label: 'Case study',
  plural: 'Case studies',
  fields: {
    client: field.text({ label: 'Client', validation: { required: true } }),
    industry: field.text({ label: 'Industry' }),
    summary: field.textarea({ label: 'Summary', validation: { required: true } }),
    product: field.relation({ label: 'Product', config: { targetType: 'product' } }),
    metrics: field.repeater({
      label: 'Metrics',
      config: { fields: [
        { name: 'value', label: 'Value', fieldType: 'text', required: true },
        { name: 'label', label: 'Label', fieldType: 'text', required: true },
      ] },
    }),
    body: field.richtext({ label: 'Body', validation: { required: true } }),
  },
})

export const Download = defineObjectType({
  name: 'download',
  label: 'Download',
  plural: 'Downloads',
  fields: {
    description: field.textarea({ label: 'Description' }),
    file: field.media({ label: 'File', validation: { required: true } }),
    gated: field.boolean({ label: 'Requires a demo request', config: { default: false } }),
  },
})

export default defineSchema({
  types: [Page, Product, Solution, Person, Category, Article, CaseStudy, Download],
})
