---
name: tangen-developer
description: Build, modify and debug a Tangen CMS project - content types, queries, frontends, Forms, Flow, extensions and deployments - by retrieving the current canonical documentation at docs.tangen.app rather than working from memory. Use for any task on a project that depends on @tangen/* packages.
---

# Working on a Tangen project

Tangen is a code-first headless CMS: content types are TypeScript files you push
to a database, and you read content through a typed SDK or REST.

**This skill is a procedure, not a manual.** It does not carry Tangen's API
contracts, because they change and the documentation is verified against the
running product. Your job is to find the right page, apply what it says, and
prove the result. Where this file and the documentation disagree, **the
documentation is right**.

## When this applies

A task on a project that depends on `@tangen/*`: creating one, modeling content,
querying it, building a frontend against it, Forms, Flow, official extensions,
authoring an extension, deployments, auth, search, preview, or
debugging any of these.

Not merely because someone said "CMS".

## 1. Look before you touch

Never assume a project's shape. Establish, from the files:

- Is this a Tangen project? Look for `@tangen/*` in `package.json` and an `app/`
  directory with a Tangen config - not the repository's name.
- Which package manager, and which `@tangen/*` versions.
- What already exists: content types, config, deployments (`.env` files), a frontend, scripts.
- What conventions this repository has for running, testing and building.
- What the user has changed that you must not overwrite.

If the directory is empty, that is its own case: go to the documentation's
getting-started path and follow the current commands rather than any you
remember.

**Are you building *with* Tangen, or working *on* Tangen itself?** In the Tangen
monorepo, platform source is legitimately in scope. In a user's project it is
not: they cannot install it.

## 2. Find the documentation before you plan

Canonical documentation is **https://docs.tangen.app**.

```text
task  →  /llms.txt  →  the page(s) that own the topic  →  read them  →  plan
```

- **`/llms.txt`** is the index: a short "Start here" list, then every page by
  section with its own one-line description. Read this first when you do not
  already know which page owns a topic.
- **A page as Markdown**: append `.md` to its URL, e.g.
  `https://docs.tangen.app/build/globals.md`.
- **`/llms-full.txt`** is the entire corpus in one file. Use it when a task
  genuinely spans the product, not as a first read.

**Retrieval is lexical, not semantic.** There is no embedding search and no
documentation MCP server. If a search comes back weak, do not give up - change
the words:

| you might say | Tangen says |
|---|---|
| plugin | **extension** |
| record, document | **entry** |
| tenant | **workspace** |
| repo, repository | **project** |
| env, environment | a **deployment**: one process, one database (`DATABASE_URL`), one role (`TANGEN_DEPLOYMENT_ROLE`) |
| secret, credential (in config) | a **reference** - the NAME of the variable the deployment supplies |
| API key's environment | the key **is** issued by one deployment; nothing is passed |

Then follow the section index and the page's own Related links.

**Read one to three pages for a narrow change.** Read more only when the task
really crosses capabilities - a form that triggers an automation needs both.

When several pages cover a topic: the **task-specific guide** first, then the
**reference** for exact signatures, then the concept or index page. The
Enterprise Website tutorial is an integrated example - excellent for seeing how
pieces fit, not the place to look up a method signature.

Prefer canonical documentation over anything else in the repository. A README,
an `docs/` folder or a wiki inside a project may predate the current contract.

## 3. Separate what you know from what you are guessing

Before writing code, be able to label every load-bearing statement:

- **Known** - you read it in the documentation or saw it in this project.
- **Inferred** - reasonable from context, and you will verify it.
- **Unknown** - you must look it up, inspect, or test.

Never promote *unknown* to *known* because a shape looks conventional. Tangen's
own history is full of confident, wrong guesses about method arity, default
behaviour, payload shapes and what a status code means. If you are about to
write something you have not read, read it.

State assumptions to the user rather than burying them.

## 4. Plan small

A brief plan, sized to the task: which files change, which Tangen surfaces are
involved, which pages you used, how you will verify. Do not write a design
document for a one-field change.

Use **public surfaces only** in a user's project: the published `@tangen/*`
packages, the `tangen` CLI, the documented HTTP API. Not platform source, not
private packages, not `workspace:` or `file:` dependencies, not the database
directly. If a task seems to need one of those, you have probably not found the
right page yet.

## 5. Implement in the project's own style

Smallest change that delivers the behaviour. Keep the existing package manager,
structure and conventions. Do not refactor what you were not asked to touch, and
do not regenerate a project to add a feature to it.

## 6. Prove it

**A task is not done because files were written.** Compiling is not evidence,
and an exit code of zero is not evidence.

Use the strongest proof the change deserves:

```text
typecheck  →  a focused test  →  the command or API actually answering
           →  runtime behaviour  →  the page or route rendering
```

A content model change should end with the schema applied and the type usable.
A query should return the shape you expected. An automation should run and take
the branch you intended. An extension should install, enable, and be observably
contributing. A frontend route should respond with the content in it.

The documentation tells you the commands; this file tells you not to skip them.

Watch for the failure that looks like success: a server already running on the
port you expected, a cached package version, the wrong `.env`, a database
that was not the one you migrated. Check which process and which database
answered you.

## 7. When something fails

1. Read the actual error. Tangen's errors usually name the fix.
2. Check the project's state and prerequisites before changing code.
3. Go back to the page for that capability - the prerequisite is often stated.
4. Make the smallest correction and re-run the proof that failed.

Do not invent a workaround before you understand the failure, and do not start
mutating unrelated code.

If the documentation, the published types and the runtime genuinely disagree,
**say so**. That is a contract discrepancy worth reporting, not something to
paper over. In a user's project, take a documented supported path if one exists.

## 8. Deployments and safety

Know which deployment you are acting on - development, staging or production -
before anything that writes: the `.env` the command runs with decides the
database (`DATABASE_URL`) and the role (`TANGEN_DEPLOYMENT_ROLE`). Nothing on
a command line, a request or an SDK call selects an environment; `--env` and
`?env=` do not exist. Do not infer the deployment from a directory name.

Configuration is declared once and resolved by one resolver; a config file
never quotes `process.env`:

- The workspace config says what the site is; the deployment's variables say
  where it runs: `DATABASE_URL`, `TANGEN_DEPLOYMENT_ROLE`, `SERVER_URL`,
  `ADMIN_URL`, `FRONTEND_URL`, `REDIS_URL`, `STORAGE_ADAPTER` and the
  `AWS_S3_*` set, the keys. Resolution is defaults, then the workspace config,
  then the deployment's variables, then secrets.
- `app/config/site.ts` (`defineSiteConfig`) declares the site's own keys;
  `app/config/integrations.ts` (`defineIntegrations`) the services it talks
  to; `app/config/members.ts` (`defineMembers`) the desired membership -
  including optional per-member, per-deployment **grants** (extra capabilities
  or extension access on top of a role, additive only; `docs/rbac.md`). A
  route or job reads `ctx.config.site.<key>`, `ctx.secrets.get(name)`,
  `ctx.integration(name)` - never `process.env`.
- A secret in any config file is a **reference** (the variable's NAME); the
  material lives in the deployment. Production binds its own credentials.
- An extension defines its RBAC permissions declaratively with
  `permissions.resources` (nouns x actions); each compiles to a
  `<action>:<resource>` capability that renders as Read/Write/Delete in the
  roles editor's permission tree, gated with `req.can('write:x')`. Ship a
  `read:` alongside any write verb so a role can be read-only (`docs/rbac.md`,
  `docs/extensions.md`).
- **Reaching an outside service** (Google Sheets, Slack, anything with an API)
  goes through a **connector pack**, not through code you write: Tangen ships
  zero connectors, a project installs the ones it uses
  (`@tangen/connectors-google`), and one connection then serves a flow, a
  form's destination and an extension alike. An operator connects it in
  Settings > Connections; a deployment supplies the OAuth client as
  `CONNECTOR_<PROVIDER>_CLIENT_ID` / `_SECRET`; nothing that uses a connection
  ever sees the credential. Write your own pack only for a provider nobody has
  packed yet (`docs/connectors.md` covers both halves).
- `tangen doctor --deployment` explains a deployment the way boot
  judges it (every key with provenance, references and whether they resolved,
  extension activation, findings incl. a coarse-capability nudge; exit 1 when
  boot would refuse). Run it before starting a process for staging or production.
- Each deployment holds its own database; where it runs (laptop, a staging
  server, a production server, or one server for two) is an infrastructure
  choice; `developer-docs/operate/deployment/scenarios.md` sets up every
  arrangement on one machine with hosts-file domains. Content moves between
  deployments with Porter; a Release publishes reviewed drafts in place.
- A production role refuses destructive pushes, purges and seeds whatever is
  approved, and the Admin writes no schema code there. An API key exists only
  on the deployment that issued it, so an SDK or API caller passes no
  environment at all.
- `tangen build` writes a static Admin; serve it from any host. Same origin
  behind one proxy needs nothing; split domains rewrite the `tangen:config`
  meta tag in the served `index.html` and set `ADMIN_URL`.

Never print or commit secrets, keys or tokens. Never weaken authentication or
disable a security control to make a check pass. If a proof needs credentials,
use the documented local-development mechanism.

## 9. If distribution is part of the task

Something that works in your working directory has not been proven to work for
whoever installs it. If the task involves a published package, verify against
the installed artifact, not the source you just wrote.

## 10. Report honestly

Say what you changed, what you actually ran, and what it showed. Name what you
did not verify. Do not describe a test you did not run, and do not imply more
certainty than your evidence supports.

## What this skill is not

It is not a Tangen reference. It carries no API signatures, no payload shapes,
no defaults - those live in the documentation and are verified there against the
running platform. If you find yourself wanting a contract, that is the signal to
retrieve a page, not to guess.
