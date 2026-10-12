/**
 * File Name: shared-runtime.ts
 * Purpose: Exposes the modules the Admin already ships - React, the router,
 *          the UI kit - on the shared runtime global (Extension Kernel
 *          K7.3), so an extension bundle built with `tangen extension
 *          bundle-ui` reads them instead of carrying its own copies (one
 *          React, one router, one kit). Called once, before the first
 *          render, from the Admin entry.
 *
 * Author: Raghunath J
 * License: MIT
 */
import * as React from 'react'
import * as JsxRuntime from 'react/jsx-runtime'
import * as JsxDevRuntime from 'react/jsx-dev-runtime'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as ReactRouterDom from 'react-router-dom'
import * as TangenUi from '@tangen/ui'
import * as TangenIcons from '@tangen/icons'
import { exposeSharedRuntime } from '@/lib/runtime-extensions'

export function installSharedRuntime(): void {
  exposeSharedRuntime({
    'react': React,
    'react/jsx-runtime': JsxRuntime,
    'react/jsx-dev-runtime': JsxDevRuntime,
    'react-dom': ReactDOM,
    'react-dom/client': ReactDOMClient,
    'react-router-dom': ReactRouterDom,
    '@tangen/ui': TangenUi,
    '@tangen/icons': TangenIcons,
  })
}
