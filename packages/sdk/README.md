# @tangen/sdk

TypeScript SDK for querying content, globals, and search from a Tangen CMS API.

## Install

```sh
bun add @tangen/sdk
# or: npm install @tangen/sdk
```

## Usage

```ts
import { createClient } from '@tangen/sdk'

const client = createClient({
  apiUrl: 'https://cms.example.com/api/v1',
  apiKey: process.env.TANGEN_API_KEY!,
  timeoutMs: 10_000, // optional, default 30s
  retries: 2,        // optional, retries 429/502/503/504 + network errors
})

// Query content objects
const posts = await client
  .objects<{ title: string; slug: string }>('post')
  .where('status', 'published')
  .limit(10)
  .find()

// Read a global
const settings = await client.globals('site-settings').get()

// Full-text search
const results = await client.search('headless cms', { type: 'post', limit: 5 })
```

## Error handling

All failures throw `TangenError` with `status` and optional `code` — including
non-JSON responses from proxies (HTML error pages never surface as syntax errors):

```ts
import { TangenError } from '@tangen/sdk'

try {
  await client.objects('post').find()
} catch (err) {
  if (err instanceof TangenError && err.status === 401) {
    // bad or missing API key
  }
}
```

## License

MIT
