/**
 * Northwind Systems - the public website.
 *
 * Everything on the page comes from Tangen through @tangen/sdk. Nothing about
 * the site's content, navigation or footer is hardcoded here: an editor owns
 * all of it. The only things this file decides are routing and markup.
 */
import { createClient } from '@tangen/sdk'

const tangen = createClient({
  apiUrl: process.env.TANGEN_API_URL ?? 'http://localhost:3000',
  apiKey: process.env.TANGEN_API_KEY!,
})

// ── reading Tangen ──────────────────────────────────────────────────────────

/** A global's content sits at data.values - one unwrap, in one place. */
async function global<T = Record<string, any>>(name: string): Promise<T> {
  const r = (await tangen.globals(name).get()) as any
  return (r?.data?.values ?? r?.values ?? r ?? {}) as T
}

/** Locales the site serves. 'en' is the default and carries no prefix. */
const LOCALES = ['en', 'fr', 'de'] as const
type Locale = (typeof LOCALES)[number]

/**
 * Splits /fr/products/gridlock into ['fr', '/products/gridlock']. A locale
 * lives in the first path segment; anything else is the default locale.
 */
function splitLocale(path: string): [Locale, string] {
  const [, first, ...rest] = path.split('/')
  if ((LOCALES as readonly string[]).includes(first)) return [first as Locale, '/' + rest.join('/')]
  return ['en', path]
}

const pageByPath = async (path: string, locale: Locale) =>
  (await tangen.objects('page').locale(locale).where({ path: { eq: path } }).limit(1).get()).data[0] as any

/**
 * `objects()` is typed from the generated registry, so its argument is a
 * literal union of your content types, not `string`. Typing the parameter that
 * way is what makes a typo here a compile error instead of an empty page.
 */
type ContentType = Parameters<typeof tangen.objects>[0]

const bySlug = async (type: ContentType, slug: string, locale: Locale, depth = 1) =>
  (await tangen.objects(type).locale(locale).where({ slug: { eq: slug } }).depth(depth).limit(1).get()).data[0] as any

// ── markup ──────────────────────────────────────────────────────────────────

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const href = (l: any) => esc(typeof l === 'string' ? l : (l?.href ?? l?.url ?? '#'))

/**
 * Forms come from Tangen's PUBLIC schema endpoint - no credential, because the
 * browser that renders the form is the browser that will post it. The site
 * never sees a form definition in its own code.
 */
async function formHtml(slug: string): Promise<string> {
  const base = process.env.TANGEN_API_URL ?? 'http://localhost:3900'
  // Addressed by SLUG, with no credential: the schema route takes either. A
  // delivery key cannot list forms - correctly - so a frontend that had to
  // look the id up would need an admin token it should never hold.
  const schema = await fetch(`${base}/api/v1/forms/${encodeURIComponent(slug)}/schema`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null) as any
  const f = schema?.data ?? schema
  if (!f?.fields) return '<p>Form unavailable.</p>'

  const input = (x: any) => {
    const req = x.required ? ' required' : ''
    if (x.type === 'textarea') return `<textarea name="${esc(x.name)}" rows="4"${req}></textarea>`
    if (x.type === 'select') return `<select name="${esc(x.name)}"${req}><option value="">Choose…</option>${
      (x.options ?? []).map((o: any) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`
    const type = x.type === 'email' ? 'email' : x.type === 'number' ? 'number' : 'text'
    return `<input type="${type}" name="${esc(x.name)}"${req}>`
  }
  return `<form class="tangen-form" method="post" action="${esc(f.submitUrl)}">
    ${f.fields.filter((x: any) => !['html', 'image', 'submit'].includes(x.type)).map((x: any) =>
      `<label><span>${esc(x.label)}${x.required ? ' *' : ''}</span>${input(x)}</label>`).join('')}
    <button class="btn" type="submit">Submit</button>
  </form>`
}

/**
 * An <img> for a media asset. `transformUrl` is a method on the client's media
 * accessor and only builds a URL - transforms serve without a key, which is
 * why a browser can load one directly. Alt text is `altText`, and the
 * intrinsic width/height come off the asset so the layout does not shift.
 */
function img(asset: any, w: number, cls = ''): string {
  // A media field on a CONTENT OBJECT expands to the asset under depth(1). The
  // same field on a GLOBAL comes back as the bare id string - globals have no
  // depth. Accept both so one helper serves the page and the header.
  const id = typeof asset === 'string' ? asset : asset?.id
  if (!id) return ''
  const meta = typeof asset === 'string' ? {} : asset
  const src = tangen.media.transformUrl(id, { width: w, format: 'webp' })
  return `<img${cls ? ` class="${cls}"` : ''} src="${esc(src)}" alt="${esc(meta.altText ?? '')}"${
    meta.width ? ` width="${meta.width}" height="${meta.height}"` : ''} loading="lazy">`
}

/** Renders one page block. An unknown block renders nothing rather than crashing. */
function block(b: any): string {
  switch (b?._type) {
    case 'hero':
      return `<section class="hero"><h1>${esc(b.heading)}</h1>${b.subheading ? `<p class="lede">${esc(b.subheading)}</p>` : ''}
        ${img(b.image, 1200, 'hero-image')}
        ${b.primaryCta ? `<a class="btn" href="${href(b.primaryCta)}">${esc(b.primaryCta.label ?? 'Learn more')}</a>` : ''}</section>`
    case 'richText':
      return `<section class="prose">${b.body ?? ''}</section>`
    case 'featureGrid':
      return `<section><h2>${esc(b.heading ?? '')}</h2><div class="grid">${(b.features ?? [])
        .map((f: any) => `<div class="card"><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p></div>`).join('')}</div></section>`
    case 'statsBand':
      return `<section class="stats">${(b.stats ?? [])
        .map((s: any) => `<div><strong>${esc(s.value)}</strong><span>${esc(s.label)}</span></div>`).join('')}</section>`
    case 'ctaBanner':
      return `<section class="cta"><h2>${esc(b.heading)}</h2>${b.body ? `<p>${esc(b.body)}</p>` : ''}
        <a class="btn" href="${href(b.cta)}">${esc(b.cta?.label ?? 'Get in touch')}</a></section>`
    case 'faq':
      return `<section><h2>${esc(b.heading ?? 'FAQ')}</h2>${(b.items ?? [])
        .map((i: any) => `<details><summary>${esc(i.question)}</summary>${i.answer ?? ''}</details>`).join('')}</section>`
    default:
      return ''
  }
}

/**
 * Resolved SEO metadata for one object, from the SEO extension.
 *
 * The canonical URL and the OpenGraph block are built by the extension from
 * the `resolveUrl` we gave it in app/config/extensions.ts - the site does not
 * compose them, so one routing change moves both. Public route, no credential.
 * A failure here must never take the page down: SEO tags are an enhancement.
 */
async function seoMeta(type: string, id: string, locale: string) {
  const base = process.env.TANGEN_API_URL ?? 'http://localhost:3000'
  try {
    const r = await fetch(`${base}/api/v1/ext/seo/meta?type=${type}&id=${id}&locale=${locale}`)
    if (!r.ok) return null
    return ((await r.json()) as any).data ?? null
  } catch { return null }
}

/** Renders what seoMeta returned. Nothing at all when it returned nothing. */
function seoTags(meta: any): string {
  if (!meta) return ''
  const og = meta.openGraph ?? {}
  return [
    meta.canonical ? `<link rel="canonical" href="${esc(meta.canonical)}">` : '',
    meta.robots?.content ? `<meta name="robots" content="${esc(meta.robots.content)}">` : '',
    og.title ? `<meta property="og:title" content="${esc(og.title)}">` : '',
    og.url ? `<meta property="og:url" content="${esc(og.url)}">` : '',
    og.type ? `<meta property="og:type" content="${esc(og.type)}">` : '',
    (meta.structuredData ?? []).length
      ? `<script type="application/ld+json">${JSON.stringify(meta.structuredData)}</script>` : '',
  ].filter(Boolean).join('\n')
}

async function shell(title: string, description: string, body: string, locale = 'en', here = '/', seoMetaData: any = null) {
  /** CMS links are stored once, in default-locale form; the site prefixes them. */
  const L = (p: string) => (locale === 'en' || !p.startsWith('/') ? p : `/${locale}${p === '/' ? '' : p}`)
  const [settings, nav, footer, seo] = await Promise.all([
    global('site-settings'), global('navigation'), global('footer'), global('seo-defaults'),
  ])
  const menu = (nav.primary ?? []).map((i: any) => `<li><a href="${L(href(i.href))}">${esc(i.label)}</a>${
    i.children?.length ? `<ul>${i.children.map((c: any) => `<li><a href="${L(href(c.href))}">${esc(c.label)}</a></li>`).join('')}</ul>` : ''
  }</li>`).join('')
  const cols = (footer.columns ?? []).map((c: any) => `<div><h4>${esc(c.heading)}</h4><ul>${
    (c.links ?? []).map((l: any) => `<li><a href="${L(href(l.href))}">${esc(l.label)}</a></li>`).join('')}</ul></div>`).join('')

  return new Response(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}${esc(seo.titleSuffix ?? '')}</title>
<meta name="description" content="${esc(description || seo.defaultDescription || '')}">
${seoTags(seoMetaData)}
<style>
:root{--ink:#111;--dim:#666;--line:#e5e5e5;--accent:#1a4bd8}
*{box-sizing:border-box}body{margin:0;font:16px/1.6 ui-sans-serif,system-ui,sans-serif;color:var(--ink)}
header,footer,main{max-width:64rem;margin:0 auto;padding:1.5rem}
header{display:flex;gap:2rem;align-items:baseline;border-bottom:1px solid var(--line)}
nav ul{display:flex;gap:1.25rem;list-style:none;margin:0;padding:0}
nav ul ul{display:none;position:absolute;background:#fff;border:1px solid var(--line);padding:.5rem;flex-direction:column}
nav li{position:relative}nav li:hover>ul{display:flex}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.hero h1{font-size:2.5rem;margin:.2em 0}.hero-image{max-width:100%;height:auto;border-radius:.4rem}
header .logo{vertical-align:middle;margin-right:.5rem;border-radius:.2rem}
.lede{font-size:1.2rem;color:var(--dim)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem}
.card{border:1px solid var(--line);padding:1rem;border-radius:.4rem}
.stats{display:flex;gap:2rem;flex-wrap:wrap}.stats strong{display:block;font-size:1.8rem}.stats span{color:var(--dim)}
.cta{border:1px solid var(--line);padding:1.5rem;border-radius:.4rem;margin:2rem 0}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:.6rem 1.1rem;border-radius:.3rem}
footer{border-top:1px solid var(--line);color:var(--dim);display:flex;gap:3rem;flex-wrap:wrap}
footer h4{margin:.2em 0}footer ul{list-style:none;padding:0;margin:0}
form.tangen-form label{display:block;margin:.6rem 0}form.tangen-form span{display:block;font-size:.9rem;color:var(--dim)}
form.tangen-form input,form.tangen-form select,form.tangen-form textarea{width:100%;max-width:28rem;padding:.5rem;border:1px solid var(--line);border-radius:.3rem;font:inherit}
table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:.4rem .8rem;text-align:left}
</style></head><body>
<header><a href="${L('/')}">${img(settings.logo, 32, 'logo')}<strong>${esc(settings.siteName ?? 'Northwind')}</strong></a><nav><ul>${menu}</ul></nav>
<span style="margin-left:auto">${['en','fr','de'].map((c) => c === locale
  ? `<strong>${c.toUpperCase()}</strong>`
  : `<a href="${c === 'en' ? (here || '/') : `/${c}${here === '/' ? '' : here}`}">${c.toUpperCase()}</a>`).join(' · ')}</span></header>
<main>${body}</main>
<footer><div><p>${esc(footer.blurb ?? '')}</p><p>${esc(footer.legalLine ?? '')}</p></div>${cols}</footer>
</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

const notFound = (locale = 'en', here = '/') => shell('Not found', '', '<h1>Not found</h1><p>No page at that address.</p>', locale, here)
  .then((r) => new Response(r.body, { status: 404, headers: r.headers }))

// ── routes ──────────────────────────────────────────────────────────────────

const server = Bun.serve({
  // WEB_PORT, not PORT: Bun auto-loads the project's .env, where PORT is the
  // TANGEN API's port. A frontend reading PORT here binds 3000 and collides
  // with the API it is trying to read from.
  port: Number(process.env.WEB_PORT ?? 4321),
  async fetch(req) {
    const url = new URL(req.url)
    const raw = url.pathname.replace(/\/+$/, '') || '/'
    const [locale, path] = splitLocale(raw)
    /** Prefix a link with the active locale, so navigation stays in-language. */
    const L = (p: string) => (locale === 'en' ? p : `/${locale}${p === '/' ? '' : p}`)

    try {
      // Products index and detail
      if (path === '/products') {
        const { data } = await tangen.objects('product').locale(locale).sort('order', 'asc').get()
        return shell('Products', 'Northwind products', `<h1>Products</h1><div class="grid">${
          data.map((p: any) => `<div class="card"><h3><a href="${L(`/products/${esc(p.slug)}`)}">${esc(p.title)}</a></h3><p>${esc(p.tagline)}</p></div>`).join('')}</div>`, locale, path)
      }
      if (path.startsWith('/products/')) {
        const p = await bySlug('product', path.split('/')[2], locale)
        if (!p) return notFound(locale, path)
        // tagline and summary are the LOCALIZED fields on this type, so this is
        // where a French visitor sees French. The blocks above are not
        // localized - localization is per field, and this model marks the
        // fields a translator actually owns.
        return shell(p.title, p.summary, `${(p.body ?? []).map(block).join('')}
          <p class="lede">${esc(p.tagline ?? '')}</p><p>${esc(p.summary)}</p>`,
          locale, path, await seoMeta('product', p.id, locale))
      }

      // Solutions
      if (path === '/solutions') {
        const { data } = await tangen.objects('solution').locale(locale).get()
        return shell('Solutions', '', `<h1>Solutions</h1><ul>${
          data.map((s: any) => `<li><a href="${L(`/solutions/${esc(s.slug)}`)}">${esc(s.title)}</a> - ${esc(s.summary)}</li>`).join('')}</ul>`, locale, path)
      }
      if (path.startsWith('/solutions/')) {
        const s = await bySlug('solution', path.split('/')[2], locale)
        if (!s) return notFound(locale, path)
        const products = (s.products ?? []).map((p: any) => `<li><a href="${L(`/products/${esc(p.slug)}`)}">${esc(p.title)}</a></li>`).join('')
        return shell(s.title, s.summary, `<h1>${esc(s.title)}</h1><p class="lede">${esc(s.summary)}</p>
          ${(s.body ?? []).map(block).join('')}${products ? `<h2>Built on</h2><ul>${products}</ul>` : ''}`, locale, path)
      }

      // Resources
      if (path === '/resources/articles') {
        const { data } = await tangen.objects('article').locale(locale).depth(1).sort('publishedAt', 'desc').get()
        return shell('Articles', '', `<h1>Articles</h1>${data.map((a: any) =>
          `<article><h3><a href="${L(`/resources/articles/${esc(a.slug)}`)}">${esc(a.title)}</a></h3>
           <p>${esc(a.excerpt)}</p><p class="lede">${esc(a.author?.title ?? '')}</p></article>`).join('')}`, locale, path)
      }
      if (path.startsWith('/resources/articles/')) {
        const a = await bySlug('article', path.split('/')[3], locale)
        if (!a) return notFound(locale, path)
        const cats = (a.categories ?? []).map((c: any) => esc(c.title)).join(', ')
        return shell(a.title, a.excerpt, `<h1>${esc(a.title)}</h1>
          <p class="lede">${esc(a.author?.title ?? '')}${cats ? ` · ${cats}` : ''}</p>
          ${img(a.heroImage, 1200)}
          <div class="prose">${a.body ?? ''}</div>`,
          locale, path, await seoMeta('article', a.id, locale))
      }
      if (path === '/resources/case-studies') {
        const { data } = await tangen.objects('caseStudy').locale(locale).depth(1).get()
        return shell('Case studies', '', `<h1>Case studies</h1>${data.map((c: any) =>
          `<article><h3><a href="${L(`/resources/case-studies/${esc(c.slug)}`)}">${esc(c.title)}</a></h3>
           <p>${esc(c.summary)}</p></article>`).join('')}`, locale, path)
      }
      if (path.startsWith('/resources/case-studies/')) {
        const c = await bySlug('caseStudy', path.split('/')[3], locale)
        if (!c) return notFound(locale, path)
        const metrics = (c.metrics ?? []).map((m: any) => `<tr><td><strong>${esc(m.value)}</strong></td><td>${esc(m.label)}</td></tr>`).join('')
        return shell(c.title, c.summary, `<h1>${esc(c.title)}</h1><p class="lede">${esc(c.client)} · ${esc(c.industry ?? '')}</p>
          ${metrics ? `<table>${metrics}</table>` : ''}<div class="prose">${c.body ?? ''}</div>`, locale, path)
      }
      if (path === '/resources/downloads') {
        const { data } = await tangen.objects('download').locale(locale).depth(1).get()
        return shell('Downloads', '', `<h1>Downloads</h1><ul>${data.map((d: any) =>
          `<li><a href="${esc(tangen.media.fileUrl(d.file?.id ?? ''))}">${esc(d.title)}</a>${
             d.gated ? ' (request a demo for access)' : ''} - ${esc(d.description ?? '')}</li>`).join('')}</ul>`, locale, path)
      }
      if (path === '/resources') {
        return shell('Resources', '', `<h1>Resources</h1><ul>
          <li><a href="/resources/articles">Articles</a></li>
          <li><a href="/resources/case-studies">Case studies</a></li>
          <li><a href="/resources/downloads">Downloads</a></li></ul>`, locale, path)
      }

      // Everything else is an authored page, addressed by its path.
      const page = await pageByPath(path, locale)
      if (!page) return notFound(locale, path)
      const extra = path === '/company/contact'
        ? `<h2>Contact us</h2>${await formHtml('contact-us')}<h2>Request a demo</h2>${await formHtml('request-a-demo')}`
        : ''
      return shell(page.title, page.summary ?? '', (page.body ?? []).map(block).join('') + extra, locale, path)
    } catch (e) {
      console.error(e)
      return new Response('Upstream error', { status: 502 })
    }
  },
})
console.log(`northwind web on http://localhost:${server.port}`)
