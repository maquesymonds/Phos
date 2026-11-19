// ─────────────────────────────────────────────────────────────
//  scene.js — Three.js renderer, animation loop, resize
//
//  Owns: WebGLRenderer, active camera reference, RAF loop.
//  Does NOT know about the GLB or UI — purely engine plumbing.
// ─────────────────────────────────────────────────────────────

import * as THREE from 'three'
import { CONFIG } from './config.js'

const toneMappingMap = {
  ACESFilmic: THREE.ACESFilmicToneMapping,
  Linear:     THREE.LinearToneMapping,
  Reinhard:   THREE.ReinhardToneMapping,
  Cineon:     THREE.CineonToneMapping,
}

// Internal state
let _renderer      = null
let _camera        = null     // set via setCamera()
let _scene         = null     // set via setThreeScene()
let _composer      = null     // set via setComposer() — used instead of renderer.render()
let _rafId         = null
let _tickListeners = []       // per-frame callbacks registered via onTick()
let _renderPaused  = false    // true while an opaque section fully covers the canvas

/**
 * Initialize the WebGL renderer attached to the given canvas.
 * Call once during app boot.
 */
export function initRenderer(canvas) {
  const cfg = CONFIG.renderer

  _renderer = new THREE.WebGLRenderer({
    canvas,
    antialias:             cfg.antialias,
    alpha:                 cfg.alpha,
  })

  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  // updateStyle=false: CSS keeps the canvas at 100% of the viewport, so it
  // can never end up shorter than the window (the old inline px size could)
  _renderer.setSize(window.innerWidth, window.innerHeight, false)
  _renderer.toneMapping         = toneMappingMap[cfg.toneMapping] ?? THREE.ACESFilmicToneMapping
  _renderer.toneMappingExposure = cfg.toneMappingExposure
  _renderer.shadowMap.enabled   = cfg.shadowMapEnabled
  _renderer.shadowMap.type      = THREE.PCFSoftShadowMap

  window.addEventListener('resize', _onResize)

  return _renderer
}

/**
 * Set the Three.js scene to render each frame.
 */
export function setThreeScene(threeScene) {
  _scene = threeScene
}

/**
 * Set (or swap) the active camera.
 */
export function setCamera(camera) {
  _camera = camera
  _onResize()   // sync to the current window — it may have changed while loading
}

/**
 * Set the EffectComposer. When present, composer.render() replaces
 * renderer.render() so bloom and other passes run every frame.
 */
export function setComposer(composer) {
  _composer = composer
}

/**
 * Register an external per-frame callback.
 * Multiple listeners are supported — each receives elapsed time (seconds).
 * @param {function} fn
 */
export function onTick(fn) {
  _tickListeners.push(fn)
}

/**
 * Skip drawing (ticks keep running) while the canvas is fully hidden,
 * e.g. while the opaque gallery section is pinned over it.
 * @param {boolean} paused
 */
export function setRenderPaused(paused) {
  _renderPaused = paused
}

/**
 * Start the render loop.
 */
export function startLoop() {
  const clock = new THREE.Clock()

  function loop() {
    _rafId = requestAnimationFrame(loop)
    const elapsed = clock.getElapsedTime()

    _tickListeners.forEach(fn => fn(elapsed))
    if (_renderPaused) return
    if (_composer) {
      _composer.render()
    } else if (_renderer && _scene && _camera) {
      _renderer.render(_scene, _camera)
    }
  }

  loop()
}

/**
 * Stop the render loop.
 */
export function stopLoop() {
  if (_rafId) cancelAnimationFrame(_rafId)
}

/**
 * Expose the raw renderer (needed by heroScene for material updates).
 */
export function getRenderer() {
  return _renderer
}

// ─── Private ─────────────────────────────────────────────────

function _onResize() {
  if (!_renderer) return

  const w = window.innerWidth
  const h = window.innerHeight

  // Resize even before the camera exists — a resize during loading used to
  // be dropped, leaving the canvas shorter than the window (dark strip)
  _renderer.setSize(w, h, false)
  if (_composer) _composer.setSize(w, h)

  if (_camera?.isPerspectiveCamera) {
    _camera.aspect = w / h
    _camera.updateProjectionMatrix()
  }
}
