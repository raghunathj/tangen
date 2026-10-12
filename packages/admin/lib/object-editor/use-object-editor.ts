/**
 * File Name: use-object-editor.ts
 * Purpose: React binding of the headless editor model (UI V2 stage V6). One
 *          model per mounted editor; the state slice re-renders the page the
 *          way the six useState calls it replaces did, and the setters keep
 *          the exact signatures the load, versions, lifecycle and slug hooks
 *          already accept - so the extraction changes no behaviour.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useState } from 'react'
import { useStore } from 'zustand'
import { createEditorModel, type EditorModel, type EditorModelState } from './editor-model'

export function useObjectEditor(): { model: EditorModel; state: EditorModelState } {
  const [model] = useState(() => createEditorModel())
  const state = useStore(model.store)
  return { model, state }
}

export type { EditorModel, EditorModelState, SaveStatus, AutosaveContext, AutosaveDecision } from './editor-model'
