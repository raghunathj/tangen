---
title: Getting started
description: Project structure, configuration, generated types and the schema workflow.
audience: site-developer
type: concept
status: stable
lastVerified: 2026-09-01
verification: executable
verifiedBy: stage-f/clean-room#create
---

# Getting started

Tangen is code-first: your content model is TypeScript in your repository, and
`tangen push` makes the database match it.

The loop you will live in:

```text
edit app/content-objects/  →  tangen push  →  generated types  →  query with the SDK
```

- [Project structure](/build/getting-started/project-structure) - what each
  directory is for
- [Configuring a project](/build/getting-started/configuration) - which file to
  reach for, and where secrets go
- [Generated types](/build/getting-started/generated-types) - what the CLI
  writes, and why your queries are typed without generics
- [The schema workflow](/build/getting-started/schema-workflow) - check, push,
  and what a plan tells you

Then: [Content modeling](/build/content-modeling) ·
[Querying](/build/querying) · [Frontend](/build/frontend)
