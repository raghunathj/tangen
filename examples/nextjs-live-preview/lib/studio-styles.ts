/**
 * File Name: studio-styles.ts
 * Purpose: The URL of Studio's published stylesheet for this site.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is what makes styling a page in Studio reach the
 *          live site with NO rebuild: the CSS is generated per environment,
 *          so publishing styles changes what this URL returns and nothing
 *          here is redeployed.
 *
 *          It points at THIS site's own route, which fetches upstream with
 *          the API key. The key already identifies the workspace and
 *          environment, so there is nothing extra to configure - and the
 *          workspace id never reaches the page source.
 */

/** Same-origin, so it needs no configuration and crosses no origins. */
export function studioStylesUrl(): string {
  return '/api/studio-styles'
}
