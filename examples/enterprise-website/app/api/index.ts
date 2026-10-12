import { helloRoute } from './hello/route'

// Register all custom routes here.
// Each route file exports a CustomRoute object — add the import and include it below.
// Routes are served under /api/v1/custom/<path> (workspace + env resolved from the key).
export default [
  helloRoute,
]
