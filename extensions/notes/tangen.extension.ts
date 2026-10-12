import { defineExtension } from "@tangen/cms";

/**
 * File Name: tangen.extension.ts (notes)
 * Purpose: Editor notes - internal, per-entry notes for the people who work
 *          on the content (2026-09-13). A note is for the team: it is never
 *          delivered through REST or GraphQL, never exported to a site, and
 *          never part of a revision. The panel sits in the editor's sidebar;
 *          the notes live in the extension's own store, one row per note.
 *
 * Author: Raghunath J
 * License: MIT
 */
export default defineExtension({
  id: "notes",
  name: "Notes",
  version: "0.1.0",
  // Provenance, shown on Settings > Extensions.
  author: "Tangen",
  homepage: "https://tangen.app",
  license: "MIT",
  contract: 1,
  description:
    "Internal notes on an entry for the people who work on it - a sidebar thread with author and time, never delivered to a site.",
  // Notes are not content: they do not travel into revisions.
  versionedData: false,
  server: "./src/server.ts",
  // Block E: what the server needs, and nothing more (tasks/audit-extension-grants.md).
  grants: {
    required: [
      { grant: "store:own", reason: "Keeps each note in the extension's own store, under the entry it belongs to." },
      { grant: "realtime:publish", reason: "Tells other editors on the same entry that a note was added or removed." },
      { grant: "routes:member", reason: "Serves the notes panel's list, add and remove requests to signed-in members." },
    ],
  },
  realtime: { channels: [{ name: "notes" }] },
  capabilities: [
    { id: "notes:read", label: "Read editor notes", description: "See the notes the team left on an entry." },
    { id: "notes:write", label: "Write editor notes", description: "Add a note to an entry, and remove your own.", implies: ["notes:read"] },
  ],
  sidebarPanels: [
    {
      id: "notes",
      label: "Notes",
      icon: "IconFileText",
      component: "NotesPanel",
      renderMode: "inline",
    },
  ],
});
