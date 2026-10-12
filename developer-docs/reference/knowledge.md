---
title: Knowledge
description: "Semantic search and ask-with-citations over your own content: the two endpoints, the grants they need, and the three things that must be in place first."
audience: site-developer
type: reference
status: experimental
package: "@tangen/knowledge"
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g12/clean-room
---

# Knowledge

Knowledge indexes your content as vectors and answers two questions over it:
*what is relevant to this* (`/knowledge/search`) and *answer this, citing my
content* (`/knowledge/ask`).

> **Status: public, constrained.** The endpoints, grants and error codes below are
> real and enforced. But Knowledge cannot run on a stock installation: it needs
> the **pgvector** extension in your database and an **embedding model**, and
> Tangen provides neither. Outside those prerequisites every endpoint is a
> documented `404` or `409`, not a broken feature. Treat the retrieval *quality*
> as untuned; the contract is what is documented here.

## The three prerequisites

| | why | what happens without it |
|---|---|---|
| `knowledge.enabled` in your config | nothing indexes and no endpoint answers while it is off | `POST /api/v1/knowledge/search` → `404` |
| **pgvector** in the database | the vectors have nowhere to live | `tangen knowledge index` refuses and tells you to run `CREATE EXTENSION vector;` |
| an **embedding model** | there is no default provider - enabling must never quietly bill an API key | `embeddings` is required when `enabled` is true |

There is no `tangen enable knowledge`. It is configuration:

```ts app/config/knowledge.ts
import type { KnowledgeConfig } from '@tangen/cms'

export const knowledgeConfig: KnowledgeConfig = {
  enabled: true,
  embeddings: { provider: 'openai', model: 'text-embedding-3-small' },
}
```

then `knowledge: knowledgeConfig` in your workspace config. `tangen knowledge
status` tells you which of the three is missing.

### Bringing your own embedder

`embeddings.adapter` replaces the provider entirely, which is how you run
Knowledge with a local model - or with no external service at all:

```ts
const local = {
  name: 'my-embedder',
  dimensions: 384,
  async embed(texts: string[]): Promise<number[][]> { /* … */ },
}

export const knowledgeConfig: KnowledgeConfig = {
  enabled: true,
  embeddings: { adapter: local },
}
```

The index records which model built it. Change the model or its dimensions and
every query answers `409 KNOWLEDGE_MODEL_MISMATCH` until you
`tangen knowledge index --rebuild` - a deliberate refusal, because querying one
vector space with another model's vectors returns confident nonsense.

## Opting content in

Nothing is indexed unless it says so, per type and per field:

```ts app/content-objects/article/schema.ts
export default defineObjectType({
  name: 'article',
  knowledge: { enabled: true },
  fields: {
    body: field.richtext({ label: 'Body', knowledge: true }),
  },
})
```

A field without `knowledge: true` never reaches the index, so the title is often
all that gets indexed if you forget.

## Building the index

```bash
tangen knowledge index
tangen knowledge status
```

```text
  Enabled: yes
  Embeddings: openai/text-embedding-3-small (1536 dims)
  Types opted in: article
  Index model: openai/text-embedding-3-small (1536 dims)
  Chunks: 2 (object: 2)
  Audiences: public: 2
```

Indexing is not automatic on write - it is a command you run, or schedule.

## Search

```http
POST /api/v1/knowledge/search
Authorization: Bearer <api key>

{ "query": "how do refunds work", "limit": 5 }
```

```json
{ "data": [ { "sourceKind": "object", "sourceId": "…", "sourceGroup": "article",
              "field": "body", "content": "…", "title": "…", "score": 0.82 } ] }
```

`sources`, `types`, `tables`, `locale` and `audience` narrow the search.

## Ask

`POST /api/v1/knowledge/ask` retrieves, then generates an answer with citations
using the workspace's configured AI provider. It needs Content AI configured as
well as Knowledge; without a provider key it fails rather than answering from
the model's own memory.

Send `Accept: text/event-stream` (or `?stream=1`) for token streaming; the
default is a single JSON response.

> The retrieval half of `/ask` is the same one `/search` uses and was verified
> with it. The **generation** half was not exercised in that run - it needs a
> provider credential - so treat the answer envelope as stated from the source
> rather than observed.

## Grants

**Two are needed**, and this is the one that surprises people:

| grant | without it |
|---|---|
| `search: read` | `403` - *"This API key has no 'search' read grant"* |
| `objects: read` for the retrieved type | the request succeeds and returns **`{ "data": [] }`** |

A search key with `search: read` alone retrieves nothing from content, because
every hit is filtered against the key's own read grants before it is returned.
That is deliberate - Knowledge is not a way around the permission model - but it
looks like an empty index. Grant both.

Knowledge has its own `public` / `internal` audiences, granted per key under
`search.audiences`. A key's grant is the ceiling; a request's `audience` may
only narrow within it, and omitting it means `public` only.

## Errors

| code | status | means |
|---|---|---|
| - | `404` | Knowledge is disabled for this workspace |
| `FORBIDDEN` | `403` | the key lacks `search: read`, or the audience it asked for |
| `KNOWLEDGE_NOT_INDEXED` | `409` | nothing has been indexed yet |
| `KNOWLEDGE_MODEL_MISMATCH` | `409` | the index was built by a different model or dimension count |
| `VALIDATION_ERROR` | `422` | no `query` |

## Related

- [Permissions](/reference/permissions) - the grants above
- [Search](/build/search) - keyword search, which needs none of this
