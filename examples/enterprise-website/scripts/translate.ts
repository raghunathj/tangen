/**
 * Translations. A locale-scoped write goes to the <type>_i18n side row:
 * PATCH /objects/<type>/<id>?locale=<code>. The default locale lives in the
 * main table and is written the ordinary way.
 */
const API = process.env.API!, TOKEN = process.env.TOKEN!
const H = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)?.slice(0, 250)}`)
  return json as any
}

const find = async (type: string, slug: string) =>
  (await call('POST', `/objects/${type}/query`, { query: { slug: { eq: slug } }, limit: 1 })).data[0]?.id

/**
 * Writes one locale, then REPUBLISHES.
 *
 * The republish is not optional bookkeeping. A locale-scoped PATCH returns 200
 * and writes the side row, but the Delivery API keeps serving the published
 * snapshot - so without this line every translation here would be invisible to
 * the site while every write looked successful.
 */
async function translate(type: string, id: string, locale: string, values: Record<string, unknown>) {
  await call('PATCH', `/objects/${type}/${id}?locale=${locale}`, values)
  await call('POST', `/objects/${type}/${id}/publish`, {})
}

const home = await find('page', 'home')
await translate('page', home, 'fr', { title: 'Northwind Systems', summary: "Des pipelines d'événements et des pistes d'audit pour les équipes auditées." })
await translate('page', home, 'de', { title: 'Northwind Systems', summary: 'Ereignis-Pipelines und Audit-Trails für Teams, die geprüft werden.' })

const about = await find('page', 'about')
await translate('page', about, 'fr', { title: 'À propos', summary: 'Fondée en 2019.' })
await translate('page', about, 'de', { title: 'Über uns', summary: 'Gegründet 2019.' })

const gridlock = await find('product', 'gridlock')
await translate('product', gridlock, 'fr', { tagline: "Une ingestion qui ne perd aucun événement", summary: "Gridlock ingère des millions d'événements par seconde et garantit l'ordre par clé." })
await translate('product', gridlock, 'de', { tagline: 'Streaming-Ingestion, die keine Ereignisse verliert', summary: 'Gridlock verarbeitet Millionen Ereignisse pro Sekunde und garantiert die Reihenfolge pro Schlüssel.' })

const ledgerline = await find('product', 'ledgerline')
await translate('product', ledgerline, 'fr', { tagline: "Un journal d'audit que vos auditeurs acceptent", summary: 'Ledgerline enregistre chaque changement dans une chaîne de hachage vérifiable.' })
await translate('product', ledgerline, 'de', { tagline: 'Ein Audit-Log, das Ihre Prüfer akzeptieren', summary: 'Ledgerline speichert jede Änderung in einer verifizierbaren Hash-Kette.' })

console.log('translated')

// Each script is a MODULE, not a global script: without this they share one
// scope and TypeScript reports every shared name as a redeclaration.
export {}
