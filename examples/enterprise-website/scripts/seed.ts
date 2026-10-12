/**
 * Seeds Northwind with enough content to prove behaviour. Uses the public REST
 * API with an admin token - the same surface an external seed script has.
 */
const API = process.env.API ?? 'http://localhost:3900/api/v1'
const TOKEN = process.env.TOKEN!
const H = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)?.slice(0, 300)}`)
  return json as any
}

/** Create, then publish - an unpublished object is invisible to the Delivery API. */
async function create(type: string, values: Record<string, unknown>, title: string, slug: string) {
  // Re-runnable: a seed you can only run once is a seed you stop trusting.
  // Filtering a list is POST /objects/<type>/query with a TangenQL body - the
  // list route takes only status, limit, offset, depth, locale, sort, props, total.
  const found = await call('POST', `/objects/${type}/query`, { query: { slug: { eq: slug } }, limit: 1 })
  // Update, do not skip. A seed that only creates looks idempotent and is not:
  // edit a value here, re-run, and the old record silently survives.
  const id: string = found?.data?.length
    ? ((await call('PATCH', `/objects/${type}/${found.data[0].id}`, { title, ...values })).data.id as string)
    : ((await call('POST', `/objects/${type}`, { title, slug, ...values })).data.id as string)
  // Publishing is what makes it visible to the Delivery API, and a republish
  // is also what makes an edited translation visible.
  await call('POST', `/objects/${type}/${id}/publish`, {})
  return id
}

const setGlobal = (name: string, values: unknown) =>
  call('PUT', `/globals/${name}`, { values })

/**
 * Uploads a file from assets/ and returns its asset id.
 *
 * Media is multipart, so it does not go through `call` - and note the
 * response envelope is `{ asset }`, not the `{ data }` every content route
 * returns. Re-runnable: an upload of the same filename returns the existing
 * asset rather than a duplicate.
 */
const uploaded = new Map<string, string>()
async function upload(file: string): Promise<string> {
  const cached = uploaded.get(file)
  if (cached) return cached
  const found = await call('GET', `/media?search=${encodeURIComponent(file)}&limit=1`)
  const hit = (found?.data ?? []).find((a: any) => a.filename === file || a.originalName === file)
  if (hit) { uploaded.set(file, hit.id); return hit.id }
  const body = new FormData()
  body.append('file', new File([await Bun.file(`${import.meta.dir}/../assets/${file}`).arrayBuffer()], file))
  const res = await fetch(`${API}/media/upload`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body,
  })
  const json: any = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`upload ${file} -> ${res.status} ${JSON.stringify(json)?.slice(0, 300)}`)
  const id = json.asset.id as string
  uploaded.set(file, id)
  return id
}

// ── media ───────────────────────────────────────────────────────────────────
const logoId = await upload('logo.png')
const heroId = await upload('hero-pipeline.png')
const avaPhoto = await upload('ava-owen.png')
const rioPhoto = await upload('rio-metaxas.png')
const architecturePdf = await upload('reference-architecture.pdf')

// ── taxonomy and people ─────────────────────────────────────────────────────
const catEng = await create('category', { description: 'Engineering practice' }, 'Engineering', 'engineering')
const catOps = await create('category', { description: 'Running systems' }, 'Operations', 'operations')
const avaOwen = await create('person', { role: 'Principal Engineer', bio: 'Works on data infrastructure.', avatar: avaPhoto }, 'Ava Owen', 'ava-owen')
const rioMeta = await create('person', { role: 'Field CTO', bio: 'Talks to customers about scale.', avatar: rioPhoto }, 'Rio Metaxas', 'rio-metaxas')

// ── products ────────────────────────────────────────────────────────────────
const gridlock = await create('product', {
  tagline: 'Streaming ingestion that does not drop events',
  summary: 'Gridlock ingests millions of events a second and guarantees ordering per key.',
  order: 1,
  body: [
    { _type: 'hero', heading: 'Gridlock', subheading: 'Ingestion you can reason about.' },
    { _type: 'featureGrid', heading: 'Why Gridlock', features: [
      { title: 'Ordered per key', body: 'Ordering is a guarantee, not a hope.' },
      { title: 'Backpressure', body: 'Slow consumers slow producers, never lose data.' },
    ] },
  ],
}, 'Gridlock', 'gridlock')

const ledgerline = await create('product', {
  tagline: 'An audit log your auditors actually accept',
  summary: 'Ledgerline records every state change with a verifiable hash chain.',
  order: 2,
  body: [{ _type: 'hero', heading: 'Ledgerline', subheading: 'Append-only, verifiable, boring.' }],
}, 'Ledgerline', 'ledgerline')

// ── solutions ───────────────────────────────────────────────────────────────
await create('solution', {
  audience: 'enterprise',
  summary: 'Consolidate event pipelines without a two-year migration.',
  products: [gridlock, ledgerline],
  body: [{ _type: 'ctaBanner', heading: 'Talk to an architect', cta: { label: 'Request a demo', href: '/company/contact' } }],
}, 'For enterprise platform teams', 'enterprise')

await create('solution', {
  audience: 'developers',
  summary: 'One SDK, typed end to end, no bespoke glue.',
  products: [gridlock],
  body: [{ _type: 'richText', body: '<p>Install the SDK and read your first event in under five minutes.</p>' }],
}, 'For developers', 'developers')

// ── pages ───────────────────────────────────────────────────────────────────
const pages: Array<[string, string, string, unknown]> = [
  ['Northwind Systems', 'home', '/', [
    { _type: 'hero', heading: 'Infrastructure that tells you the truth', subheading: 'Event pipelines and audit trails for teams that get audited.', image: heroId },
    { _type: 'statsBand', stats: [{ value: '4.1B', label: 'events per day' }, { value: '99.99%', label: 'ingestion SLA' }] },
    { _type: 'ctaBanner', heading: 'See it on your data', cta: { label: 'Request a demo', href: '/company/contact' } },
  ]],
  ['About', 'about', '/company/about', [{ _type: 'richText', body: '<p>Founded in 2019. Remote, 60 people.</p>' }]],
  ['Careers', 'careers', '/company/careers', [{ _type: 'richText', body: '<p>We hire engineers who write things down.</p>' }]],
  ['Contact', 'contact', '/company/contact', [{ _type: 'richText', body: '<p>Talk to us.</p>' }]],
  ['Privacy', 'privacy', '/legal/privacy', [{ _type: 'richText', body: '<p>We collect the minimum.</p>' }]],
  ['Terms', 'terms', '/legal/terms', [{ _type: 'richText', body: '<p>Standard terms.</p>' }]],
]
for (const [title, slug, path, body] of pages) {
  await create('page', { path, summary: `${title} - Northwind Systems`, body }, title, slug)
}

// ── resources ───────────────────────────────────────────────────────────────
await create('article', {
  excerpt: 'Ordering guarantees are worth more than throughput numbers.',
  heroImage: heroId,
  author: avaOwen, categories: [catEng],
  body: '<p>Every ingestion benchmark quotes throughput. Almost none quote ordering.</p>',
}, 'Why we publish ordering guarantees, not throughput', 'ordering-over-throughput')

await create('article', {
  excerpt: 'What we changed after a bad week.',
  author: rioMeta, categories: [catOps, catEng],
  body: '<p>In March we lost four hours to a backpressure bug. Here is what we changed.</p>',
}, 'A postmortem worth reading', 'a-postmortem-worth-reading')

await create('caseStudy', {
  client: 'Halden Bank', industry: 'Financial services',
  summary: 'Replaced a nightly batch reconciliation with a streaming ledger.',
  product: ledgerline,
  metrics: [{ value: '6 hours', label: 'to 90 seconds' }, { value: '0', label: 'reconciliation breaks' }],
  body: '<p>Halden ran reconciliation nightly. Now it runs continuously.</p>',
}, 'Halden Bank closes the books continuously', 'halden-bank')

await create('download', {
  description: 'Reference architecture, 14 pages.', gated: true, file: architecturePdf,
}, 'Event pipeline reference architecture', 'reference-architecture')

// ── globals ─────────────────────────────────────────────────────────────────
await setGlobal('site-settings', {
  siteName: 'Northwind Systems', tagline: 'Infrastructure that tells you the truth',
  logo: logoId,
  supportEmail: 'support@northwind.test', salesEmail: 'sales@northwind.test',
})
await setGlobal('navigation', {
  primary: [
    { label: 'Products', href: { label: 'Products', href: '/products' }, children: [
      { label: 'Gridlock', href: { label: 'Gridlock', href: '/products/gridlock' } },
      { label: 'Ledgerline', href: { label: 'Ledgerline', href: '/products/ledgerline' } },
    ] },
    { label: 'Solutions', href: { label: 'Solutions', href: '/solutions' }, children: [
      { label: 'Enterprise', href: { label: 'Enterprise', href: '/solutions/enterprise' } },
      { label: 'Developers', href: { label: 'Developers', href: '/solutions/developers' } },
    ] },
    { label: 'Resources', href: { label: 'Resources', href: '/resources' }, children: [
      { label: 'Articles', href: { label: 'Articles', href: '/resources/articles' } },
      { label: 'Case studies', href: { label: 'Case studies', href: '/resources/case-studies' } },
    ] },
    { label: 'Company', href: { label: 'Company', href: '/company/about' }, children: [] },
  ],
})
await setGlobal('footer', {
  blurb: 'Northwind Systems builds event infrastructure.',
  columns: [
    { heading: 'Product', links: [{ label: 'Gridlock', href: { label: 'Gridlock', href: '/products/gridlock' } }] },
    { heading: 'Legal', links: [{ label: 'Privacy', href: { label: 'Privacy', href: '/legal/privacy' } }] },
  ],
  legalLine: '(c) 2026 Northwind Systems',
})
await setGlobal('seo-defaults', {
  titleSuffix: ' | Northwind Systems',
  defaultDescription: 'Event pipelines and audit trails for teams that get audited.',
})

console.log('seeded')

// Each script is a MODULE, not a global script: without this they share one
// scope and TypeScript reports every shared name as a redeclaration.
export {}
