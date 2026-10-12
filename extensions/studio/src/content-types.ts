/**
 * File Name: content-types.ts
 * Purpose: The content types INSTALLING STUDIO PROVISIONS. `tangen push` reads
 *          this module through the manifest's `contentTypes` path, merges it
 *          with the site's own schema and creates the tables through the
 *          ordinary pipeline. Nobody hand-writes a schema file for an Instance.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Referenced BY PATH from tangen.extension.ts rather than
 *          inlined in it. The manifest is statically imported into the admin's
 *          entry chunk, and this module pulls the whole Builder Kit in through
 *          `withBuilderKit()`; a path keeps that out of the bundle every admin
 *          page waits for. See docs/extensions.md, "Declaring content types".
 */
import { defineObjectType, field } from '@tangen/schema'
import { withBuilderKit } from './builder-kit'

/**
 * The INSTANCE type - one shared authored tree, referenced from many pages.
 * Edit the source once and every placement updates.
 *
 * An Instance is a CONTENT OBJECT, not a row in Studio's key-value store, and
 * that is deliberate: as an object it inherits drafts and publish, revisions,
 * localization, RBAC, presence and Porter's content transfer, already built and
 * already tested. A global - the other candidate home - is one row per
 * workspace and environment with no draft and no status, so a save would go
 * live on every page at once; multiplied by the number of usages, that is the
 * blast radius nobody asked for.
 *
 * What a designer MEETS, though, is a Studio design resource and nothing else
 * (user rule, 2026-08-26): the model "may use Tangen's content/storage
 * infrastructure internally, but it should be exposed as a Studio design
 * resource rather than a normal editorial Content Object". Hence
 * `menu.show: false`, and hence this file: the type exists because Studio is
 * installed, not because a developer wrote a schema for it.
 */
const studioInstance = defineObjectType({
  // The WIRE name is namespaced; the label a designer reads stays "Instance".
  // A site may legitimately own a type called `instance` (a product instance,
  // a server instance), and Studio must never be the reason that name is
  // taken. Nothing discovers this type by name - discovery is the
  // `admin.studio.role === 'instance'` marker below - so the wire name is
  // free to be specific.
  name: 'studio_instance',
  // Workspaces that pushed before 2026-08-26 have `instance` and
  // `instance_i18n` with rows in them. previousName makes the next push one
  // RENAME_TYPE (table, side table, indexes, sibling registries) instead of a
  // create plus a drop that would take the authored instances with it.
  //
  // A site that hand-wrote `app/content-objects/instance/schema.ts` back when
  // that was the only way keeps it: the merge sees the site already owns that
  // row, leaves this definition out, and the push says so. Nothing renames
  // under them, and Studio still finds their type through the role marker.
  previousName: ['instance'],
  label: 'Instance',
  fields: {
    // Declared, never guessed. The model this replaces read a global's edge
    // from a regex over its name, so a global called "promo" could not be
    // placed at all and one called "topBar" was pinned above every page by its
    // spelling. An absent value reads as `manual` (lib/instances.ts
    // `readPlacement`), which is why the field carries no required flag.
    placement: field.select({
      label: 'Placement',
      config: {
        options: [
          { label: 'Placed by hand', value: 'manual' },
          { label: 'Header', value: 'header' },
          { label: 'Footer', value: 'footer' },
        ],
      },
      admin: { helpText: 'Placed by hand is inserted on a page from the Instances panel. Header and Footer are placed by the system on every page.' },
    }),
    description: field.textarea({
      label: 'Description',
      admin: { helpText: 'What this instance is for - shown beside it in the picker.' },
    }),
    blocks: field.component({
      label: 'Blocks',
      config: { components: withBuilderKit() },
    }),
  },
  admin: {
    // The marker Studio reads. A type with a component field is a Studio PAGE
    // by default, and from the outside the two look identical, so the
    // difference is DECLARED. Round-trips through `tangen pull` and the Schema
    // Builder with the rest of the admin config.
    studio: { role: 'instance' },
    listView: { columns: ['placement', 'description'], defaultSort: { field: 'updatedAt', direction: 'desc' } },
    editorView: { main: ['description', 'blocks'], sidebar: ['placement'] },
    // Not an editorial collection: listing it in the content nav beside Posts
    // would invite editing a shared tree with no idea of what else it renders
    // on. `show: false` is the platform's own flag, read by
    // `groupTypesBySidebar`, so this needs no Studio special case.
    menu: { icon: 'IconShare', label: 'Instances', show: false },
  },
})

export { studioInstance }

export default [studioInstance]
