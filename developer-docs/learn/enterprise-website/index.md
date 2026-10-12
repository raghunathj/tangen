---
title: Build the Enterprise Website
description: A fourteen-chapter tutorial that builds a realistic multilingual B2B site on Tangen, composing every capability a real project uses.
audience: site-developer
type: guide
status: stable
lastVerified: 2026-09-02
verification: executable
verifiedBy: stage-g6/clean-room
---

# Build the Enterprise Website

You will build **Northwind Systems**, a fictional B2B infrastructure company:
eight content types, a page builder an editor can use, three languages, two
forms, an automation that routes demo requests, and three deployments ending
in a production boot.

It is not a blog with a title and a body. It is the shape of site people
actually get paid to build, and every chapter is executed against a running
server before it is published.

## What you end up with

| | |
|---|---|
| Content types | page, product, solution, person, category, article, caseStudy, download |
| Page blocks | hero, rich text, feature grid, stats band, CTA banner, FAQ |
| Globals | site settings, navigation, footer, SEO defaults |
| Locales | English, French, German, with per-field fallback |
| Forms | Contact Us and Request a Demo, submitted without a credential |
| Automation | a demo request branching on company size |
| Deployments | development, staging, production |
| SEO | a sitemap with hreflang alternates and a robots policy that differs by deployment role |

## The chapters

1. [Create the project](/learn/enterprise-website/create-the-project)
2. [Model the site](/learn/enterprise-website/model-the-site)
3. [Build reusable page blocks](/learn/enterprise-website/page-blocks)
4. [Add Globals and navigation](/learn/enterprise-website/globals-and-navigation)
5. [Add media and relationships](/learn/enterprise-website/media-and-relations)
6. [Seed and publish content](/learn/enterprise-website/seed-and-publish)
7. [Query with TangenQL and the SDK](/learn/enterprise-website/querying)
8. [Build dynamic frontend routes](/learn/enterprise-website/frontend-routes)
9. [Add localization](/learn/enterprise-website/localization)
10. [Add contact and demo forms](/learn/enterprise-website/forms)
11. [Automate demo requests with Flow](/learn/enterprise-website/flow)
12. [Deployments and permissions](/learn/enterprise-website/deployments)
13. [Cache and production](/learn/enterprise-website/production)
14. [SEO](/learn/enterprise-website/seo)

## How to read it

This tutorial **composes**; it does not re-explain. Each chapter says why the
site needs a capability, shows the exact integrated code, tells you what you
should see, and then links to the canonical page that owns the full contract.
When you want the complete rules for fields, TangenQL or Flow, follow the link:
that page is the authority, and this one only shows one project using it.

Every chapter is independently resumable. If you already have a Tangen project,
you can start at chapter 2 with your own workspace name.

## Prerequisites

- Bun, and a PostgreSQL you can create databases in
- [Quick start](/learn/quick-start) finished, or a willingness to meet the same
  material here at a slower pace

## The finished project

The complete implementation is `examples/enterprise-website` in the Tangen
repository. Every snippet in these chapters comes from that project, and a
guard fails the documentation build if the two disagree.

## Related

- [Quick start](/learn/quick-start) · [Build with Tangen](/build) ·
  [Resources](/resources)
