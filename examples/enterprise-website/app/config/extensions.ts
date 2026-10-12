import { defineExtensions } from '@tangen/cms'

/**
 * Extensions this project declares. SEO and Flows ship with the platform, so
 * they are declared here already - you never install them yourself.
 *
 * Declaring one makes it available. Installing and enabling it is per
 * deployment and lives in its database:
 *   tangen extension install seo
 *   tangen extension list
 *
 * Add your own with a package specifier, e.g. { resolve: '@acme/analytics' }.
 * `tangen extension create` appends to this file.
 */
export default defineExtensions([
  {
    resolve: '@tangen/ext-seo',
    /**
     * SEO owns the metadata; THIS APPLICATION owns routing. `resolveUrl` is the
     * one function only we can write, and it is supplied here, as options.
     *
     * It receives `{ type, id, slug, locale }`. It does NOT receive the object's
     * fields - so a type routed by anything other than its slug cannot be
     * resolved here. Our `page` type routes by an authored `path` (the IA
     * nests, and a slug cannot express /solutions/enterprise), which is exactly
     * why `sitemapTypes` below lists the slug-routed types and leaves pages to
     * the site's own sitemap route.
     */
    options: {
      siteUrl: process.env.SITE_URL ?? 'http://localhost:4321',
      locales: ['en', 'fr', 'de'],
      sitemapTypes: ['product', 'solution', 'article', 'caseStudy'],
      resolveUrl: ({ type, slug, locale }: { type: string; slug?: string | null; locale?: string | null }) => {
        if (!slug) return null
        const base = process.env.SITE_URL ?? 'http://localhost:4321'
        const prefix = locale && locale !== 'en' ? `/${locale}` : ''
        const path = {
          product: `/products/${slug}`,
          solution: `/solutions/${slug}`,
          article: `/resources/articles/${slug}`,
          caseStudy: `/resources/case-studies/${slug}`,
        }[type]
        return path ? `${base}${prefix}${path}` : null
      },
      // `userAgents` is a LIST. A group with the singular `userAgent` is
      // dropped silently, and you get a robots.txt with no rules in it.
      robotsTxt: {
        groups: [{ userAgents: ['*'], allow: ['/'], disallow: ['/api/'] }],
        sitemaps: [`${process.env.SITE_URL ?? 'http://localhost:4321'}/sitemap.xml`],
      },
    },
  },
  { resolve: '@tangen/ext-flows' },
])
