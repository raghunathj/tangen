import type { CustomRoute } from '@tangen/cms'

/**
 * GET /hello
 *
 * Example custom route — replace or delete this file when you add real routes.
 *
 * URL:  GET /api/v1/custom/hello
 * Auth: any valid API Manager key
 *
 * Example:
 *   curl https://your-domain.com/api/v1/custom/hello \
 *     -H "Authorization: Bearer tgn_..."
 *
 * To scope this route to a specific permission in the API Manager, add apiGroup:
 *   apiGroup: { id: 'hello', label: 'Hello API', action: 'Read' }
 */
export const helloRoute: CustomRoute = {
  method: 'GET',
  path: '/hello',
  auth: 'key',

  async handler(ctx) {
    // Return a plain value — the router serializes it to JSON.
    return { message: 'Hello from Tangen!', workspace: ctx.workspaceId }
  },
}
