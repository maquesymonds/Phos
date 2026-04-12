// ─────────────────────────────────────────────────────────────
//  main.js — Application entry point
//
//  Boot order:
//    1.  Init renderer
//    2.  Init UI + audio
//    3.  Load single GLTF (with progress bar)
//    4.  Build scene — parked at frame 0
//    5.  Activate scene (hands scene+camera to renderer)
//    6.  Start render loop
//    7.  Hide loader, reveal hero overlay
//    8.  Init scroll system (waits internally for phos:activate)
//    9.  Signal phos:productReady so scroll can wire up
// ─────────────────────────────────────────────────────────────

import './theatreSetup.js'
import { initRenderer, startLoop }                   from './scene.js'
import { initUI, setLoadProgress, hideLoader, revealHero } from './ui.js'
import { loadGLB }                                   from './loaders.js'
import { initProductScene, activateProductScene }    from './productScene.js'
import { initScroll }                                from './scroll.js'
import { initAudio }                                 from './audio.js'
import { CONFIG }                                    from './config.js'
import { initTransition }                            from './transition.js'
import { initTooltips }                              from './tooltips.js'

async function boot() {

  // ── 1. Renderer ──────────────────────────────────────────────
  const canvas = document.getElementById('phos-canvas')
  initRenderer(canvas)

  // ── 2. UI + audio ────────────────────────────────────────────
  initUI()
  initAudio()

  // ── 3. Load single GLTF ──────────────────────────────────────
  let glb
  try {
    glb = await loadGLB(CONFIG.assets.model, setLoadProgress)
  } catch {
    console.warn('[PHOS] Model failed to load.')
    glb = { scene: null, cameras: [], animations: [] }
  }

  // ── 4. Build scene (parked at t=0, hero state) ───────────────
  initProductScene(glb)

  // ── 4b. Tooltips — must run after initProductScene so nodes exist
  initTooltips(glb.animations?.[0]?.duration ?? 0)

  // ── 5. Hand scene + camera to renderer ───────────────────────
  activateProductScene()

  // ── 6. Render loop ───────────────────────────────────────────
  startLoop()
  initTransition()

  // ── 7. Hide loader → reveal hero overlay ────────────────────
  setLoadProgress(1)
  await hideLoader()
  revealHero()

  // ── 8. Init scroll (waits for phos:activate internally) ──────
  initScroll()

  // ── 9. Model is ready — scroll can wire up once user activates
  window.dispatchEvent(new CustomEvent('phos:productReady'))
}

boot()
