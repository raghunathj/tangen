/**
 * File Name: all.ts
 * Purpose: The FULL @remixicon/react namespace - the escape hatch that lets
 *          configs use any raw Ri* icon name. Import this ONLY dynamically
 *          (the admin's DynamicIcon does); a static import would pull the
 *          2.3MB single-file pack back into the eager graph.
 *
 * Author: Raghunath J
 * License: MIT
 */
export * from '@remixicon/react'
