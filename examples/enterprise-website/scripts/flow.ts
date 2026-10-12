/**
 * Demo-request routing. A submission on request-a-demo branches on the
 * company size the visitor selected: enterprise-sized accounts go to the field
 * team, everyone else to the standard queue.
 *
 * Everything here goes through the extension's supported admin API at
 * /api/v1/admin/ext/flows - nothing imports the extension.
 */
const A = `${process.env.API}/admin/ext/flows`, TOKEN = process.env.TOKEN!
const H = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }
async function call(m: string, p: string, b?: unknown) {
  const r = await fetch(`${A}${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j)?.slice(0, 400)}`)
  return j as any
}

const flow = {
  version: 2,
  name: 'Route demo requests',
  enabled: true,
  nodes: [
    { id: 'start', kind: 'trigger', position: { x: 0, y: 0 },
      data: { type: 'form.submitted', formSlug: 'request-a-demo' } },
    // The submission arrives HYDRATED: trigger.submission carries id, formId,
    // formSlug, createdAt and the submitted `values`. So the branch reads the
    // answer directly - no code step needed to fetch or reshape anything.
    { id: 'gate', kind: 'condition', position: { x: 0, y: 100 },
      data: { conditions: [{ path: 'trigger.submission.values.companySize', op: 'eq', value: '500+' }] } },
    { id: 'hot', kind: 'action', position: { x: -160, y: 220 },
      data: { action: 'log', config: {
        message: 'ENTERPRISE demo request from {{trigger.submission.values.company}} ({{trigger.submission.values.businessEmail}}) - route to the field team',
      } } },
    { id: 'standard', kind: 'action', position: { x: 160, y: 220 },
      data: { action: 'log', config: {
        message: 'demo request from {{trigger.submission.values.company}} (size {{trigger.submission.values.companySize}}) - standard queue',
      } } },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'gate' },
    { id: 'e2', from: 'gate', to: 'hot', outlet: 'yes' },
    { id: 'e3', from: 'gate', to: 'standard', outlet: 'no' },
  ],
}

const list = await call('GET', '/flows')
const existing = (list.data ?? []).find((f: any) => (f.name ?? f.data?.name) === flow.name)
const id = existing?.id ?? (await call('POST', '/flows', flow)).data.id
if (existing) await call('PATCH', `/flows/${id}`, flow)
console.log('flow:', id)
console.log(JSON.stringify((await call('GET', `/flows/${id}`)).data).slice(0, 160))

// Each script is a MODULE, not a global script: without this they share one
// scope and TypeScript reports every shared name as a redeclaration.
export {}
