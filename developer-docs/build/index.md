---
title: Build with Tangen
description: "Everything you need to build an application on Tangen: modeling content, querying it, and shipping it."
audience: site-developer
type: concept
status: stable
lastVerified: 2026-09-01
verification: source
verifiedBy: developer-docs/nav.json
---

# Build with Tangen

Your content model is TypeScript you own. `tangen push` makes the database
match it, generates your types, and the SDK reads it back typed.

## Start here

- [Getting started](/build/getting-started) - project structure, configuration,
  generated types, and the schema workflow

## Model your content

- [Content modeling](/build/content-modeling) - types, fields, structure,
  relations, links and localization decisions

## Work with content

- [Content](/build/content) - drafts, publishing, scheduling, writing from code,
  and preview
- [Globals](/build/globals) - site settings, navigation and other singletons

## Read it

- [Querying](/build/querying) - TangenQL, the SDK, filtering, paging, relations
- [Frontend integration](/build/frontend) - fetching, routing, rendering,
  caching
- [Media](/build/media) - uploading, transforms and rendering

## Add capabilities

- [Localization](/build/localization) - locales, fallbacks and routing
- [Site authentication](/build/auth) - accounts for your site's users
- [Forms](/extensions/forms) - definitions, rendering, submissions
- [Search](/build/search) - full-text search over published content
- [SEO](/extensions/seo) - what Tangen holds and what your app owns

## Ship it

- [Deployments in practice](/build/deployments) - three roles, and moving
  schema and content between them
- [Performance](/build/performance) - caching, query cost, Performance Monitor
- [Testing your application](/build/testing) - what to test, and what not to
- [Deploying Tangen](/operate/deployment) - in Operate

Exact contracts - every field option, operator, endpoint and error code - are
in [Reference](/reference).
