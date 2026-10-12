/**
 * File Name: sql-values.ts
 * Purpose: Bind runtime values as parameters instead of pasting them into SQL
 *   text, so one logical write is one SQL shape whatever the data says.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The write paths used to build JSONB and TEXT[] clauses by
 *   string concatenation with hand-rolled quote doubling:
 *
 *     sql.raw(`"${col}" = '${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`)
 *
 *   That is escaping the driver already does better, and it makes the SQL text
 *   a function of the DATA: a hundred autosaves of a hundred different
 *   documents are a hundred different statements. Under prepared execution each
 *   one becomes its own named statement, cached per connection until that
 *   connection closes.
 *
 *   JSONB goes over the wire as a text parameter with an explicit cast, which
 *   is what postgres.js can bind and what keeps `JSON.stringify` output
 *   byte-identical end to end.
 *
 *   TEXT[] cannot use a plain parameter, because drizzle expands a JS array in
 *   a `sql` template into one placeholder per element - which is both a syntax
 *   error for an empty array and a fresh SQL shape for every length. Sending
 *   the array as one JSON parameter and unnesting it server-side gives a single
 *   shape for every length, including zero.
 */
import { sql, type SQL } from 'drizzle-orm'

/**
 * A JSONB value as a bound parameter.
 * @param value - Anything JSON-serialisable, including null and bare scalars.
 * @returns `$n::jsonb`, carrying exactly what JSON.stringify produced.
 */
export function jsonbParam(value: unknown): SQL {
  return sql`${JSON.stringify(value)}::jsonb`
}

/**
 * A TEXT[] value as a single bound parameter, one SQL shape for any length.
 *
 * Elements are stringified the way the concatenating code did, so a null
 * element still stores the text "null" rather than becoming a SQL NULL. That
 * is not obviously right, but it is what these columns already hold and this
 * is not the change that should alter it.
 *
 * @param values - The array to store; may be empty.
 * @returns `ARRAY(SELECT jsonb_array_elements_text($n::jsonb))::text[]`.
 */
export function textArrayParam(values: readonly unknown[]): SQL {
  const asText = values.map((v) => String(v))
  return sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(asText)}::jsonb))::text[]`
}
