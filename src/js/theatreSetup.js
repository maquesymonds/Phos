// ─────────────────────────────────────────────────────────────
//  theatreSetup.js — Theatre.js project + sheet structure
//
//  Exports:
//    phosProject     — top-level Theatre project ("Phos")
//    backgroundSheet — sheet for atmospheric background animation
//
//  Studio loads only in dev mode — tree-shaken out in production.
//  No sheet objects, scene values, or scroll connections yet.
// ─────────────────────────────────────────────────────────────

import { getProject } from '@theatre/core'

export const phosProject     = getProject('Phos')
export const backgroundSheet = phosProject.sheet('Background')

// Studio disabled — uncomment to re-enable in dev
// if (import.meta.env.DEV) {
//   import('@theatre/studio').then(({ default: studio }) => {
//     studio.initialize()
//   })
// }
