'use client'

import { createContext, useContext } from 'react'

const ComponentDepthContext = createContext(0)

export function useComponentDepth(): number {
  return useContext(ComponentDepthContext)
}

export function ComponentDepthProvider({
  depth,
  children,
}: {
  depth: number
  children: React.ReactNode
}) {
  return (
    <ComponentDepthContext.Provider value={depth}>
      {children}
    </ComponentDepthContext.Provider>
  )
}
