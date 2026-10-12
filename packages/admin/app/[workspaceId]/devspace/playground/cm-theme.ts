/**
 * File Name: cm-theme.ts
 * Purpose: Shared CodeMirror theme + syntax colors for the playground editors
 *          (GraphQL and JSON) — token palette matched to the admin's Tremor
 *          colors instead of CodeMirror's washed-out defaults. Loaded lazily
 *          with the editors.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const colors = HighlightStyle.define([
  { tag: [t.keyword, t.definitionKeyword, t.modifier], color: '#4f46e5', fontWeight: '600' },   // query/mutation, json $
  { tag: [t.string, t.special(t.string)], color: '#059669' },                                    // strings
  { tag: [t.number], color: '#2563eb' },                                                         // numbers
  { tag: [t.bool, t.null], color: '#7c3aed', fontWeight: '500' },                                // true/false/null
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: '#b45309' },    // json keys / gql fields
  { tag: [t.typeName, t.className], color: '#0f766e', fontWeight: '500' },                       // GraphQL types
  { tag: [t.variableName, t.special(t.variableName)], color: '#be185d' },                        // $variables
  { tag: [t.comment], color: '#9ca3af', fontStyle: 'italic' },
  { tag: [t.punctuation, t.bracket, t.brace, t.operator], color: '#6b7280' },
  { tag: [t.invalid], color: '#dc2626' },
])

const chrome = EditorView.theme({
  '&': { fontSize: '12.5px', backgroundColor: 'transparent' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', caretColor: '#4f46e5' },
  '.cm-cursor': { borderLeftColor: '#4f46e5' },
  '.cm-activeLine': { backgroundColor: 'rgba(79, 70, 229, 0.04)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(79, 70, 229, 0.06)' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#9ca3af' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(79, 70, 229, 0.14)' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(79, 70, 229, 0.15)', outline: 'none' },
  '.cm-tooltip': { borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#eef2ff', color: '#111827' },
})

/** Drop-in extension list: playground look + admin-palette token colors. */
export const playgroundTheme = [chrome, syntaxHighlighting(colors)]
