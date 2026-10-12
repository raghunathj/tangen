# @tangen/ext-review

Multi-stage editorial review for Tangen - editors submit drafts into a
configurable workflow (the LAST stage is terminal), reviewers advance,
reject, or assign items from a real work queue, and a publish gate lets
only content that reached the terminal stage unchanged go live, on every
publish path (admin, REST, bulk, scheduled, local client).

## What it contributes

- **Content hooks**: `beforeChange` blocks the draft → published
  transition for covered types unless the record sits in the TERMINAL
  stage and the content still hashes to the hash frozen on entering it;
  `afterChange` completes the cycle after a successful publish (record
  resets to null, history kept for the queue's Done tab).
- **Admin routes** (`/api/v1/admin/ext/review/…`):
  `GET state/:objectId`, `POST submit/:objectId` (member session, optional
  assignee; a resubmit after a rejection defaults the assignee back to the
  rejecting reviewer unless one is passed), `POST advance/:objectId`,
  `POST reject/:objectId` (note REQUIRED; returns the item to its AUTHOR -
  assignee becomes the cycle's submitter), `POST assign/:objectId` (all
  three gated on `review:approve`),
  `GET queue` (`?scope=all|mine|done`, `?stage`, `?type`; active scopes
  include returned items awaiting a resubmit),
  `GET workflow`, `PATCH workflow` (gated on `review:manage`).
- **Admin page** `Review` - the work queue: Assigned to me / All in
  review / Done recently tabs with INLINE advance/reject/assign, returned
  items badged "Returned" with the reviewer's note, plus the
  Workflow settings tab (stage editor + covered types) for
  `review:manage` holders.
- **Editor panel** `Review` - stage badge + assignee, Submit for review
  with optional assignee (prefilled with the rejecting reviewer on a
  resubmit), the same inline actions, rejection note, and a
  compact history.
- **Labels**: mirrors `review:pending` (non-terminal) / `review:approved`
  (terminal) / `review:rejected` on the object (replace-set of its own
  labels only).
- **Events**: `ext:review:submitted|stage-changed|approved|rejected` for
  webhooks/Flows - every transition emits `stage-changed`.
- **Flow actions** (`flowActions`, discovered by the Flows extension):
  `Advance review stage`, `Approve for publishing` (through every
  remaining stage, one history entry per stage), `Assign reviewer` -
  a flow PARTICIPATES in the state machine like a reviewer (the publish
  gate is untouched, no bypass). History attributes the moves as
  `Flow: <flow name>` (byId null + `actorLabel`); the target defaults to
  the triggering object; no-record / uncovered-type / already-terminal
  cases fail the step with a clear message in the flow run log.
- **Capabilities**: `review:approve` (act on items) and `review:manage`
  (edit the workflow; implies `review:approve`), surfaced in the roles
  editor while installed.

## Settings

One manifest setting, **Types that require review** (`requireReviewFor`, a
list fed by the workspace's content types), edited on the core settings form
under Settings, Extensions, Review. It SEEDS the covered types (empty = every
type) and remains the fallback until an admin saves the Workflow tab - the
admin-saved selection wins thereafter. The server and the content hooks both
read it through `ctx.settings.get()`; there is no install option and no store
mirror (an older install's mirrored option is carried into the setting at
start, once).

## The workflow model

Stored per workspace in the extension store (`__workflow__`): ordered
stages `{ id, name, color }` (ids stable across renames) + covered types.
Default: `Review → Approved`. Server-enforced rules: 2..10 stages, the
terminal stage cannot be deleted, deleting a stage reassigns its in-flight
items to the previous surviving stage (history + events recorded). v1
records (`state: pending|approved|rejected`) migrate lazily and
idempotently on read.

## Layout

```
tangen.extension.ts        browser-safe manifest (panel/page/capabilities)
src/server.ts              gate + workflow routes + events + tasks + flowActions
src/transitions.ts         the shared state-machine moves (routes + flow actions)
src/flow-actions.ts        contributed Flow actions (flow-as-reviewer, attributed)
src/hash.ts                canonical content hash (terminal-entry vs publish-time)
src/coverage.ts            covered-types resolution for the hook side
src/state.ts               workflow + record model, labels, v1 migration
src/workflow.ts            workflow validation + stage-deletion reassignment plan
src/queue-model.ts         pure view-model helpers (tabs, action labels, outcomes)
src/dialogs.tsx            reject/assign dialogs + members directory hook
src/panel.tsx              editor panel (ExtensionPanelProps contract)
src/pages/queue.tsx        the Review work queue page
src/pages/workflow-settings.tsx  the Workflow tab (review:manage)
__tests__/                 hash + model + gate + routes units, platform e2e
```

Docs: `docs/examples-review.md` (install, workflow, queue walkthrough,
capability grants, Flow notification recipes, v1 migration, honest limits).
