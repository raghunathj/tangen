const API = process.env.API!, TOKEN = process.env.TOKEN!
const H = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }
async function call(m: string, p: string, b?: unknown) {
  const r = await fetch(`${API}${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j)?.slice(0, 300)}`)
  return j as any
}
const f = (id: string, type: string, name: string, label: string, extra: object = {}) =>
  ({ id, type, name, label, ...extra })

const existing = (await call('GET', '/forms')).data ?? []
const bySlug = new Map(existing.map((x: any) => [x.slug, x.id]))

const forms = [
  {
    name: 'Contact Us', slug: 'contact-us',
    fields: [
      f('n', 'text', 'name', 'Your name', { required: true }),
      f('e', 'email', 'email', 'Email', { required: true }),
      f('c', 'text', 'company', 'Company'),
      f('m', 'textarea', 'message', 'How can we help?', { required: true, validation: { minLength: 10 } }),
    ],
    settings: { notifications: [], uniqueBy: 'none', successTitle: 'Thanks', successMessage: 'We will reply within one business day.', submitButtonText: 'Send' },
  },
  {
    name: 'Request a Demo', slug: 'request-a-demo',
    fields: [
      f('n', 'text', 'name', 'Your name', { required: true }),
      f('e', 'email', 'businessEmail', 'Business email', { required: true }),
      f('c', 'text', 'company', 'Company', { required: true }),
      f('r', 'text', 'role', 'Role'),
      f('s', 'select', 'companySize', 'Company size', { required: true, options: [
        { label: '1-50', value: '1-50' }, { label: '51-500', value: '51-500' }, { label: '500+', value: '500+' },
      ] }),
      f('co', 'select', 'country', 'Country', { required: true, options: [
        { label: 'United Kingdom', value: 'GB' }, { label: 'Germany', value: 'DE' }, { label: 'France', value: 'FR' }, { label: 'Other', value: 'XX' },
      ] }),
      f('m', 'textarea', 'message', 'What would you like to see?'),
    ],
    settings: { notifications: [], uniqueBy: 'none', successTitle: 'Request received', successMessage: 'An architect will contact you.', submitButtonText: 'Request a demo' },
  },
]

for (const form of forms) {
  // Re-runnable: create once, then keep the definition in step with this file.
  // `isLive` is what makes the public schema route answer - a form that is not
  // live 404s to the frontend even though it exists.
  const body = { ...form, isLive: true }
  const existingId = bySlug.get(form.slug)
  const id = existingId
    ? ((await call('PATCH', `/forms/${existingId}`, body)).data.id as string)
    : ((await call('POST', '/forms', body)).data.id as string)
  console.log('configured:', form.slug, id)
}
console.log(JSON.stringify(((await call('GET', '/forms')).data ?? []).map((x: any) => ({ slug: x.slug, fields: x.fields.length }))))

// Each script is a MODULE, not a global script: without this they share one
// scope and TypeScript reports every shared name as a redeclaration.
export {}
