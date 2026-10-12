---
title: Operate Tangen
description: "Deploying, configuring and running Tangen: deployments, schema changes, storage, security and upgrades."
audience: operator
type: concept
status: stable
lastVerified: 2026-09-02
verification: source
verifiedBy: packages/cli/src/commands/dev.ts
---

# Operate Tangen

Deploying, configuring and running Tangen: deployments, schema changes, storage, security and upgrades.

Tangen has three deployment roles - development, staging and production - and
they are roles of a process rather than names you invent. This section covers
deployment, what belongs on each, applying schema changes safely, moving
content with Porter, storage and mail, security, backups and upgrades.

- [Deploying Tangen](/operate/deployment) - what runs, what to configure, and
  the order to bring it up in

More pages land here through later stages. The
[CLI reference](/reference/cli) already covers the commands, and
[Deployments](/reference/deployments) the roles.
