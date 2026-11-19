// ─────────────────────────────────────────────────────────────
//  productScene.js — Single animated GLTF scene
//
//  Owns:
//    - The one Three.js scene
//    - AnimationMixer (scrubbed by scroll, NOT autoplayed)
//    - Camera extracted from the GLTF animation
//    - Environment mesh refs for opacity fade
//
//  Public API:
//    initProductScene(glb)        — build scene from loaded GLTF
//    activateProductScene()       — hand scene+camera to the renderer
//    setAnimationTime(t)          — scrub mixer to exact second
//    getAnimationDuration()       — total clip length in seconds
//    setEnvironmentOpacity(value) — fade environment meshes (0–1)
// ─────────────────────────────────────────────────────────────

import * as THREE from 'three'
import { EffectComposer }          from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass }              from 'three/addons/postprocessing/RenderPass.js'
import gsap from 'gsap'
import { CONFIG } from './config.js'
import { setCamera, setThreeScene, setComposer, getRenderer } from './scene.js'
import { initBackground } from './background.js'

// Layer for selective bloom — only bulb mesh is assigned here
const BLOOM_LAYER = 1

// ─── Environment mesh names ───────────────────────────────────
// These are faded out during the first portion of scroll.
// Lamp objects are NOT in this list and stay fully visible.

const ENV_NAMES = ['mesa', 'ajedrez', 'ajedrez_1', 'ajedrez_2', 'ajedrez_3', 'taza', 'pared', 'cuadro_01', 'cuadro_02', 'lapicera']

// Objects that slide in from below when the user presses "Begin experience"
const SLIDE_IN_NAMES = ['lapicera', 'taza', 'ajedrez', 'ajedrez_1', 'ajedrez_2', 'ajedrez_3']
const SLIDE_OFFSET_Y = -3.0   // how far below (world units) they start

// ─── Module state ────────────────────────────────────────────

let _scene      = null
let _mixer      = null
let _clip       = null
let _action     = null
let _camera     = null
let _duration   = 0
let _envMeshes  = []   // environment mesh refs (for opacity fade)
let _nodeMap    = {}   // name → Object3D, built during initProductScene
let _glbLights    = []   // { light: THREE.Light }[] — controllable lights
let _baseSwapped   = false // tracks whether the base swap has fired
let _chapitaShown  = false // tracks whether chapita appeared yet
let _userIntensity    = 1.0   // slider scale (0.05 – 1.0)
let _currentTrunkGlow = 0     // current glow value — read by onBeforeCompile on first render
let _activeBase    = 0     // 0=base1, 1=base2.1, 2=base3.1
let _activeShade   = 0     // 0=shade_01, 1=shade_02

// ─── Public ──────────────────────────────────────────────────

/**
 * Build the single scene from the loaded GLTF.
 * Parks the animation at frame 0 (hero state).
 *
 * @param {{ scene: THREE.Group, cameras: THREE.Camera[], animations: THREE.AnimationClip[] }} glb
 */
export function initProductScene(glb) {
  _scene = new THREE.Scene()
  // No scene.background — the shader plane in background.js fills it.

  // ── Atmospheric background shader ────────────────────────────
  initBackground(_scene)

  // ── Model ───────────────────────────────────────────────────
  if (glb.scene) {
    const allNames = []

    glb.scene.traverse((child) => {
      // Index every named node for tooltip anchoring
      if (child.name) {
        _nodeMap[child.name] = child
        allNames.push(child.name)
      }

      // Collect GLB lights — set min/max range for slider + entrance animation.
      // luz_chapita is animated by the GLB and excluded from the slider system.
      if (child.isLight) {
        // luz_abajo: gated by scroll frame — start at 0, excluded from slider
        if (child.name === 'luz_abajo') {
          child.intensity      = 0
          child.userData._min  = 0
          child.userData._max  = 0.4
          // Not added to _glbLights — controlled only by updateBaseVisibility
          console.log(`[PHOS productScene] GLB light: "${child.name}" type=${child.type}`)
          return
        }
        // luz_chapita: controlled via visibility only (hidden until frame 200).
        // Keep its original intensity — correct when the node becomes visible.
        if (child.name === 'luz_chapita') {
          console.log(`[PHOS productScene] GLB light: "${child.name}" type=${child.type}`)
          return
        }
        // All other GLB lights (including luz_frontal) go into _glbLights
        // so they participate in animateLightsIn() and the intensity slider.
        // Intensity tracks are stripped from the clip — mixer will never zero them.
        const ranges = {
          lamparita_fuerte: { min: 0.2, max: 1.0 },
          luz_frontal:      { min: 0.0, max: child.intensity > 0 ? child.intensity : 1.5 },
        }
        const range = ranges[child.name] ?? { min: 0, max: child.intensity }
        child.intensity      = range.min
        child.userData._min  = range.min
        child.userData._max  = range.max
        _glbLights.push({ light: child })
        console.log(`[PHOS productScene] GLB light: "${child.name}" type=${child.type}`)
        return
      }

      if (!child.isMesh) return

      child.castShadow    = true
      child.receiveShadow = true


      // Collect environment meshes and make them fadeable.
      // Slide-in objects are excluded — they're never opacity-faded by scroll.
      if (ENV_NAMES.includes(child.name) && !SLIDE_IN_NAMES.includes(child.name)) {
        child.material             = child.material.clone()
        child.material.transparent = true
        _envMeshes.push(child)
      }

      // Shade — opaque so the bulb mesh never shows through.
      // High emissive simulates warm light filtering through linen fabric.
      if (child.name === 'shade_01' || child.name === 'shade_02') {
        child.material                   = child.material.clone()
        child.material.side              = THREE.DoubleSide
        child.material.emissive          = new THREE.Color(0xffcc88)
        child.material.emissiveIntensity = 0.5
      }

      // Trunk meshes — inject Y-gradient emissive via shader patch.
      // Bright warm glow at top (where shade rim sits), fades to nothing downward.
      // yTop / yBottom are world-space Y — tune via window.__trunkGlow in console.
      const TRUNK_NAMES = ['base1', 'base11', 'base2', 'base3', 'base2_still', 'base3_still']
      if (TRUNK_NAMES.includes(child.name)) {
        child.material = child.material.clone()
        child.material.onBeforeCompile = (shader) => {
          // Pass world Y from vertex to fragment
          shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
             vPhosWorldY = (modelMatrix * vec4(position, 1.0)).y;`
          )
          shader.vertexShader = 'varying float vPhosWorldY;\n' + shader.vertexShader

          // In fragment: add warm emissive that peaks at yTop and fades to yBottom
          shader.fragmentShader = 'varying float vPhosWorldY;\nuniform float uTrunkGlowStrength;\nuniform float uTrunkYTop;\nuniform float uTrunkYBottom;\n' + shader.fragmentShader
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
             {
               float yFactor = clamp((vPhosWorldY - uTrunkYBottom) / (uTrunkYTop - uTrunkYBottom), 0.0, 1.0);
               yFactor = pow(yFactor, 1.5);
               totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * yFactor * uTrunkGlowStrength;
             }`
          )
          shader.uniforms.uTrunkGlowStrength = { value: _currentTrunkGlow }  // picks up current value when mesh first renders
          shader.uniforms.uTrunkYTop         = { value: window.__trunkGlow?.yTop    ?? 0.82 }
          shader.uniforms.uTrunkYBottom      = { value: window.__trunkGlow?.yBottom ?? 0.2  }

          // Store ref so we can hot-update from console
          child.userData._trunkShader = shader
        }
        child.material.needsUpdate = true
      }

    })

    console.log('[PHOS productScene] All node names:', allNames.join(', '))
    window.__phosNodes   = allNames
    window.__phosNodeMap = _nodeMap

    // Bulb — emissive only, renders normally so shade occludes it correctly
    const bulbNode = _nodeMap['bulb']
    if (bulbNode) {
      bulbNode.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow    = false
        child.receiveShadow = false
        if (child.material.metalness > 0.3) return  // skip socket/ring
        child.material                   = child.material.clone()
        child.material.emissive          = new THREE.Color(0xffeeaa)
        child.material.emissiveIntensity = 2.0
      })

      // PointLight inside bulb — visual glow only, no shadows (shade blocks it)
      const innerLight = new THREE.PointLight(0xffcc66, 0.2, 1.2, 3)
      innerLight.name          = 'bulb_inner'
      innerLight.userData._min = 0.2
      innerLight.userData._max = 0.8
      bulbNode.add(innerLight)
      _glbLights.push({ light: innerLight })
    }

    // chapita (base1) — visible until frame 215, then swaps out
    if (_nodeMap['chapita']) _nodeMap['chapita'].visible = true

    // ── Slide-in objects: shift below frame, animate in on activate ──
    SLIDE_IN_NAMES.forEach((name) => {
      const node = _nodeMap[name]
      if (!node) return
      node.userData._origY = node.position.y
      node.position.y     -= SLIDE_OFFSET_Y * -1  // push down (negative = below)
    })

    _scene.add(glb.scene)

    // ── Mobile: hide props from the start — no desk objects on small screens ──
    if (window.innerWidth <= 768) {
      ;['taza', 'lapicera', 'ajedrez', 'ajedrez_1', 'ajedrez_2', 'ajedrez_3'].forEach(name => {
        if (_nodeMap[name]) _nodeMap[name].visible = false
      })
    }

    // ── Fake contact shadows — gradient disc under taza + lapicera ──
    _nodeMap['_shadow_taza']     = _addContactShadow('taza',     { offsetX: -0.19, offsetY: 0.05, offsetZ: 0.39, opacity: 0.56, scaleX: 0.35, scaleZ: 0.35, rotDeg:  94 })
    _nodeMap['_shadow_lapicera'] = _addContactShadow('lapicera', { offsetX:  0.05, offsetY: -0.04, offsetZ: 0.25, opacity: 0.83, scaleX: 0.05, scaleZ: 0.25, rotDeg: -49 })
  }



  // ── Ambient light ─────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(0xfff0d0, 0.08)
  ambient.name             = 'ambient'
  ambient.userData._min    = 0.0
  ambient.userData._max    = 0.5
  _scene.add(ambient)
  _glbLights.unshift({ light: ambient })   // first in panel

  // ── Top light — subtle fill for shade exterior only, low intensity ─
  const topLight = new THREE.SpotLight(0xffcc66, 1.5)
  topLight.name             = 'top_shade'
  topLight.position.set(0, 2.5, 0)
  topLight.target.position.set(0, 1.2, 0)
  topLight.angle    = Math.PI / 6
  topLight.penumbra = 0.6
  topLight.decay    = 2
  topLight.distance = 2.5
  topLight.userData._min    = 0
  topLight.userData._max    = 15

  _scene.add(topLight)
  _scene.add(topLight.target)
  _glbLights.push({ light: topLight })


  // ── Shade bounce — simulates shade re-emitting light onto base top ─
  // Positioned just below the shade rim, pointing straight down.
  // Short distance + high decay keeps it local to the base top surface only.
  const shadeBouncLight = new THREE.SpotLight(0xffddaa, 0.0)
  shadeBouncLight.name             = 'shade_bounce'
  shadeBouncLight.position.set(0, 0.75, 0)
  shadeBouncLight.target.position.set(0, 0.3, 0)
  shadeBouncLight.angle            = Math.PI / 5
  shadeBouncLight.penumbra         = 0.7
  shadeBouncLight.decay            = 2
  shadeBouncLight.distance         = 0.7
  shadeBouncLight.userData._min    = 0.0
  shadeBouncLight.userData._max    = 1.2
  _scene.add(shadeBouncLight)
  _scene.add(shadeBouncLight.target)
  _glbLights.push({ light: shadeBouncLight })

  // ── Lamp projected shadow — SpotLight at shade opening, pointing down ──
  // bulb_inner is blocked by the shade mesh so can't cast shadows.
  // This SpotLight sits just below the shade opening and projects the
  // lamp's cone of light (and its shadows) onto the desk surface.
  const lampShadow = new THREE.SpotLight(0xffcc88, 0.9)
  lampShadow.name             = 'lamp_shadow'
  lampShadow.position.set(0, 1.74, 0)
  lampShadow.target.position.set(0, -0.5, 0)
  lampShadow.angle            = 1.57
  lampShadow.penumbra         = 0.52
  lampShadow.decay            = 2.2
  lampShadow.distance         = 3.0

  lampShadow.castShadow            = true
  lampShadow.shadow.mapSize.width  = 1024
  lampShadow.shadow.mapSize.height = 1024
  lampShadow.shadow.camera.near    = 0.1
  lampShadow.shadow.camera.far     = 2.2
  lampShadow.shadow.bias           = -0.0045
  lampShadow.shadow.radius         = 3.5

  lampShadow.userData._min = 0
  lampShadow.userData._max = 6.0
  _scene.add(lampShadow)
  _scene.add(lampShadow.target)
  _glbLights.push({ light: lampShadow })

  // ── Scene listeners (base / shade / intensity slider) ────────
  _setupSceneListeners()

  // ── Camera ───────────────────────────────────────────────────
  _camera = _extractCamera(glb)

  // ── Animation mixer ──────────────────────────────────────────
  if (glb.animations && glb.animations.length > 0) {
    _mixer    = new THREE.AnimationMixer(glb.scene)
    _clip     = glb.animations[0]
    _duration = _clip.duration

    // Strip visibility tracks for ALL nodes we control from JS.
    // The mixer re-applies these every setTime() call — we must own them fully.
    const MANAGED_VISIBILITY = [
      'base1', 'base11', 'base2', 'base2_still', 'base3', 'base3_still',
      'shade_01', 'shade_02',
      'chapita', 'chapita1', 'chapita2', 'chapita3',
      'OUT_CHAPITA1', 'OUT_CHAPITA1_1', 'OUT_CHAPITA2', 'OUT_CHAPITA2_1',
      'OUT_CHAPITA3', 'OUT_CHAPITA3_1',
    ]
    _clip.tracks = _clip.tracks.filter(track => {
      // Track names look like "NodeName.visible" or "NodeName_1.visible"
      if (!track.name.endsWith('.visible')) return true
      const nodeName = track.name.replace(/\.visible$/, '')
      return !MANAGED_VISIBILITY.includes(nodeName)
    })

    // Strip ALL light intensity tracks from the clip.
    // The GLB has intensity keyframes that zero out lights in frames 200-300,
    // causing a blackout. We own all intensities — the mixer must never touch them.
    _clip.tracks = _clip.tracks.filter(track => !track.name.endsWith('.intensity'))

    _action = _mixer.clipAction(_clip)
    // LoopOnce + clampWhenFinished: at frame 300 the mixer freezes there
    // instead of looping back to 0 or going off-screen.
    _action.setLoop(THREE.LoopOnce, 1)
    _action.clampWhenFinished = true
    _action.play()

    // Park at frame 0 — hero state
    _mixer.setTime(0)

    // Override GLB visibility keyframes at t=0 with our intended initial state.
    // Must run AFTER setTime(0) or the mixer will overwrite these.
    _applyInitialVisibility()

    console.log(`[PHOS productScene] Clip: "${_clip.name}" | duration: ${_duration.toFixed(3)}s`)
    console.log(`[PHOS productScene] Environment meshes collected:`, _envMeshes.map(m => m.name))
  } else {
    console.warn('[PHOS productScene] No animation clips found in GLTF.')
  }
}

/**
 * Hand the scene and animated camera to the renderer.
 * Also sets up the EffectComposer with bloom.
 * Call once after initProductScene().
 */
export function activateProductScene() {
  setThreeScene(_scene)
  if (_camera) setCamera(_camera)
  _setupComposer()
  // _buildLightDebugPanel()
  // _buildShadowDebugPanel()
}

/**
 * Drive the bulb light intensity (called by scroll.js).
 * @param {number} t — 0 (base) to 1 (peak)
 */
export function setBulbIntensity(_t) {
  // no-op — bulb emissive removed
}

/**
 * Scrub the animation to an exact point in seconds.
 * Called by scroll.js on every ScrollTrigger update.
 *
 * @param {number} t — target time in seconds
 */
export function setAnimationTime(t) {
  if (!_mixer || !_clip || !_action) return
  const clamped = Math.max(0, Math.min(t, _clip.duration))
  // Set time directly on the action — works even after LoopOnce finishes.
  _action.time = clamped
  _action.enabled = true
  _mixer.update(0)
}

/**
 * Return total animation duration in seconds.
 *
 * Intentionally returns 96% of the actual clip duration.
 * The Blender export has broken camera keyframes in the last ~12 frames
 * (the final 4% of a 300-frame clip). Capping here means the scrubber,
 * the gallery rewind, and anything else that reads this value never
 * reaches that broken zone — no code change needed anywhere else.
 */
export function getAnimationDuration() {
  return _duration
}

/**
 * Return the active camera (needed for 3D→2D projection).
 */
export function getCamera() {
  return _camera
}

/**
 * Return a named Object3D from the GLTF scene, or null if not found.
 * @param {string} name
 */
export function getNodeByName(name) {
  return _nodeMap[name] ?? null
}

/**
 * Show/hide the base variants based on current frame.
 * Frame < 192: base1 visible, base11/base2/base3 hidden.
 * Frame >= 192: base11/base2/base3 visible, base1 hidden.
 * Called by scroll.js on every update.
 *
 * @param {number} frame — current animation frame
 */
// Chapitas for the rotating bases (base11/base2/base3) — appear at frame 160.
// 'chapita' (no number, belongs to base1) is permanently hidden separately.
const CHAPITA_NODES = [
  'chapita1', 'chapita2', 'chapita3',
  'OUT_CHAPITA1', 'OUT_CHAPITA1_1',
  'OUT_CHAPITA2', 'OUT_CHAPITA2_1',
  'OUT_CHAPITA3', 'OUT_CHAPITA3_1',
]
const CHAPITA_FRAME = 215
const SWAP_FRAME    = 215

// luz_chapita and luz_abajo both hidden until frame 200
const LUZ_CHAPITA_FRAME = 200
let _luzChapitaOn = false

const LUZ_ABAJO_FRAME = 200
let _luzAbajoEnabled = false

// taza + ajedrez disappear at frame 60
const PROPS_HIDE_FRAME = 100
let _propsHidden = false

// shade_bounce disappears at frame 20
const SHADE_BOUNCE_HIDE_FRAME = 20
let _shadeBounceVisible = true

export function updateBaseVisibility(frame) {
  // ── trunk glow: fades out frames 7→16, back in 16→7 ─────────────
  const GLOW_FADE_START = 7
  const GLOW_FADE_END   = 16
  if (frame <= GLOW_FADE_START) {
    _setTrunkGlow(_userIntensity * 2.2)
  } else if (frame >= GLOW_FADE_END) {
    _setTrunkGlow(0)
  } else {
    const t = (frame - GLOW_FADE_START) / (GLOW_FADE_END - GLOW_FADE_START)
    _setTrunkGlow((1 - t) * _userIntensity * 2.2)
  }

  // ── shade_bounce: hidden from frame 20 onward ────────────────────
  const showBounce = frame < SHADE_BOUNCE_HIDE_FRAME
  if (showBounce !== _shadeBounceVisible) {
    _shadeBounceVisible = showBounce
    const sb = _glbLights.find(({ light }) => light.name === 'shade_bounce')?.light
    if (sb) sb.intensity = showBounce ? (sb.userData._min + _userIntensity * (sb.userData._max - sb.userData._min)) : 0
  }

  // ── taza + ajedrez: visible until frame 100 (desktop only) ─────────
  const hideProps = frame >= PROPS_HIDE_FRAME || window.innerWidth <= 768
  if (hideProps !== _propsHidden) {
    _propsHidden = hideProps
    ;['taza', 'ajedrez', 'ajedrez_1', 'ajedrez_2', 'ajedrez_3'].forEach(name => {
      if (_nodeMap[name]) _nodeMap[name].visible = !hideProps
    })
  }

  // ── luz_abajo: muted until frame 200 ─────────────────────────────
  const luzAbajoOn = frame >= LUZ_ABAJO_FRAME
  if (luzAbajoOn !== _luzAbajoEnabled) {
    _luzAbajoEnabled = luzAbajoOn
    const la = _nodeMap['luz_abajo']
    if (la) {
      if (!luzAbajoOn) {
        la.intensity = 0
      } else {
        // Restore to slider-driven value: lerp between min and max
        la.intensity = la.userData._min + _userIntensity * (la.userData._max - la.userData._min)
      }
    }
  }

  // ── luz_chapita: hidden first half, visible from frame 250 ───────
  const chapitaOn = frame >= LUZ_CHAPITA_FRAME
  if (chapitaOn !== _luzChapitaOn) {
    _luzChapitaOn = chapitaOn
    const lc = _nodeMap['luz_chapita']
    if (lc) lc.visible = chapitaOn
  }

  // ── Chapita swap at frame 160 ─────────────────────────────────
  // Before 160: chapita (base1) visible, rotating-base chapitas hidden
  // From 160:   chapita hidden, rotating-base chapitas visible
  const swapChapita = frame >= CHAPITA_FRAME
  if (swapChapita !== _chapitaShown) {
    _chapitaShown = swapChapita
    if (_nodeMap['chapita']) _nodeMap['chapita'].visible = !swapChapita
    CHAPITA_NODES.forEach(name => {
      if (_nodeMap[name]) _nodeMap[name].visible = swapChapita
    })
  }

  // ── Base swap at frame 215 ────────────────────────────────────
  const showAlts = frame >= SWAP_FRAME
  if (showAlts === _baseSwapped) return
  _baseSwapped = showAlts

  // Still bases
  if (_nodeMap['base1'])       _nodeMap['base1'].visible       = !showAlts
  if (_nodeMap['base2_still']) _nodeMap['base2_still'].visible = false
  if (_nodeMap['base3_still']) _nodeMap['base3_still'].visible = false
  // Rotating bases — all three together (GLB animates them as a group)
  if (_nodeMap['base11']) _nodeMap['base11'].visible = showAlts
  if (_nodeMap['base2'])  _nodeMap['base2'].visible  = showAlts
  if (_nodeMap['base3'])  _nodeMap['base3'].visible  = showAlts
}

/**
 * Set opacity on all environment meshes.
 * Called by scroll.js to fade the desk/environment with scroll.
 *
 * @param {number} value — 0 (invisible) to 1 (fully visible)
 */
export function setEnvironmentOpacity(value) {
  const v = Math.max(0, Math.min(1, value))
  _envMeshes.forEach((mesh) => {
    mesh.material.opacity = v
  })
}

/**
 * Slide the prop objects (lapicera, taza, ajedrez) from below into position.
 * Call this immediately on "Begin experience" click — no event delay.
 */
export function slideInObjects() {
  SLIDE_IN_NAMES.forEach((name, i) => {
    const node = _nodeMap[name]
    if (!node) return
    gsap.to(node.position, {
      y:        node.userData._origY,
      duration: 1.0,
      delay:    i * 0.07,
      ease:     'power3.out',
    })
  })
}

/**
 * Animate all lights from their _min to their _max over 3 seconds.
 * Call immediately on "Begin experience" click.
 */
export function animateLightsIn() {
  _glbLights.forEach(({ light }) => {
    const mx = light.userData._max ?? light.intensity
    gsap.to(light, {
      intensity: mx,
      duration:  3.0,
      ease:      'power2.inOut',
    })
  })
  // Animate trunk glow from 0 → 2.2
  const proxy = { value: 0 }
  gsap.to(proxy, {
    value:    2.2,
    duration: 3.0,
    ease:     'power2.inOut',
    onUpdate: () => _setTrunkGlow(proxy.value),
  })
}

const TRUNK_GLOW_NAMES = ['base1', 'base11', 'base2', 'base3', 'base2_still', 'base3_still']

function _setTrunkGlow(value) {
  _currentTrunkGlow = value
  TRUNK_GLOW_NAMES.forEach(name => {
    const node = _nodeMap[name]
    if (!node) return
    const shader = node.userData._trunkShader
    if (shader) shader.uniforms.uTrunkGlowStrength.value = value
  })
  // Sync debug slider
  const sl = document.getElementById('trunk-glow-slider')
  if (sl) { sl.value = value; const v = document.getElementById('trunk-glow-val'); if (v) v.textContent = value.toFixed(2) }
}

// ─── Private ─────────────────────────────────────────────────

function _addContactShadow(nodeName, { offsetX, offsetY, offsetZ, opacity, scaleX = 1, scaleZ = 1, rotDeg = 0 }) {
  const node = _nodeMap[nodeName]
  if (!node) return

  // Build a radial gradient texture: dark center → transparent edge
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
  grad.addColorStop(0,   `rgba(10,4,1,${opacity})`)
  grad.addColorStop(0.5, `rgba(10,4,1,${opacity * 0.4})`)
  grad.addColorStop(1,   'rgba(10,4,1,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  const tex  = new THREE.CanvasTexture(canvas)
  const geom = new THREE.PlaneGeometry(1, 1)
  const mat  = new THREE.MeshBasicMaterial({
    map:         tex,
    transparent: true,
    depthWrite:  false,
    depthTest:   false,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.rotation.z = rotDeg * (Math.PI / 180)
  mesh.scale.set(scaleX, scaleZ, 1)
  mesh.position.set(offsetX, offsetY, offsetZ)
  mesh.renderOrder = 1
  node.add(mesh)
  return mesh
}

function _buildShadowDebugPanel() {
  const panel = document.createElement('div')
  panel.id = 'shadow-debug'
  panel.style.cssText = 'position:fixed;top:10px;left:300px;z-index:9999;background:rgba(0,0,0,0.75);color:#fff;padding:12px 16px;font-family:monospace;font-size:12px;border-radius:8px;min-width:260px;cursor:grab'

  const defaults = {
    _shadow_taza:     { opacity: 0.56, posX: -0.19, posY: 0.05,  posZ: 0.39, scale: 0.35, scaleX: 0.35, scaleZ: 0.35, rotY: 94  },
    _shadow_lapicera: { opacity: 0.83, posX:  0.05, posY: -0.04, posZ: 0.25, scale: 1.00, scaleX: 0.05, scaleZ: 0.25, rotY: -49 },
  }

  const shadows = [
    { key: '_shadow_taza',     label: 'taza' },
    { key: '_shadow_lapicera', label: 'lapicera' },
  ]

  panel.innerHTML = `<div style="text-align:center;margin-bottom:6px;opacity:0.4;font-size:10px;letter-spacing:0.1em;user-select:none">⠿ drag</div><p style="margin:0 0 8px;font-weight:bold">Contact Shadows</p>` + shadows.map(({ key, label }) => {
    const d = defaults[key]
    return `
    <div style="margin-bottom:10px">
      <b>${label}</b>
      <label style="display:flex;align-items:center;gap:6px;margin:4px 0">visible <input type="checkbox" data-shadow="${key}" data-prop="visible" checked></label>
      <label style="display:flex;align-items:center;gap:6px">opacity <input type="range" data-shadow="${key}" data-prop="opacity" min="0" max="3" step="0.01" value="${d.opacity}" style="width:120px"><span data-shadow-val="${key}-opacity">${d.opacity}</span></label>
      <label style="display:flex;align-items:center;gap:6px">X (←→) <input type="range" data-shadow="${key}" data-prop="posX" min="-0.5" max="0.5" step="0.01" value="${d.posX}" style="width:120px"><span data-shadow-val="${key}-posX">${d.posX}</span></label>
      <label style="display:flex;align-items:center;gap:6px">Y (↑↓) <input type="range" data-shadow="${key}" data-prop="posY" min="-1" max="0.5" step="0.01" value="${d.posY}" style="width:120px"><span data-shadow-val="${key}-posY">${d.posY}</span></label>
      <label style="display:flex;align-items:center;gap:6px">Z (profund) <input type="range" data-shadow="${key}" data-prop="posZ" min="-0.5" max="0.5" step="0.01" value="${d.posZ}" style="width:120px"><span data-shadow-val="${key}-posZ">${d.posZ}</span></label>
      <label style="display:flex;align-items:center;gap:6px">scale <input type="range" data-shadow="${key}" data-prop="scale" min="0.05" max="3" step="0.05" value="${d.scale}" style="width:120px"><span data-shadow-val="${key}-scale">${d.scale}</span></label>
      <label style="display:flex;align-items:center;gap:6px">scaleX <input type="range" data-shadow="${key}" data-prop="scaleX" min="0.05" max="3" step="0.05" value="${d.scaleX}" style="width:120px"><span data-shadow-val="${key}-scaleX">${d.scaleX}</span></label>
      <label style="display:flex;align-items:center;gap:6px">scaleY <input type="range" data-shadow="${key}" data-prop="scaleZ" min="0.05" max="3" step="0.05" value="${d.scaleZ}" style="width:120px"><span data-shadow-val="${key}-scaleZ">${d.scaleZ}</span></label>
      <label style="display:flex;align-items:center;gap:6px">rot ↻ <input type="range" data-shadow="${key}" data-prop="rotY" min="-180" max="180" step="1" value="${d.rotY}" style="width:120px"><span data-shadow-val="${key}-rotY">${d.rotY}°</span></label>
    </div>
  `}).join('')
  document.body.appendChild(panel)

  // Drag to move
  let _dx = 0, _dy = 0, _drag = false
  panel.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'INPUT') return
    _drag = true
    _dx = e.clientX - panel.getBoundingClientRect().left
    _dy = e.clientY - panel.getBoundingClientRect().top
    panel.style.cursor = 'grabbing'
    e.preventDefault()
  })
  window.addEventListener('mousemove', (e) => {
    if (!_drag) return
    panel.style.left = (e.clientX - _dx) + 'px'
    panel.style.top  = (e.clientY - _dy) + 'px'
  })
  window.addEventListener('mouseup', () => { _drag = false; panel.style.cursor = 'grab' })

  panel.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
      const mesh = _nodeMap[input.dataset.shadow]
      if (!mesh) return
      const prop = input.dataset.prop
      const val  = input.type === 'checkbox' ? input.checked : parseFloat(input.value)
      const valEl = panel.querySelector(`[data-shadow-val="${input.dataset.shadow}-${prop}"]`)
      if (valEl) valEl.textContent = typeof val === 'number' ? val.toFixed(2) : ''
      if (prop === 'visible')  mesh.visible = val
      if (prop === 'opacity')  mesh.material.opacity = val
      if (prop === 'posX')     mesh.position.x = val
      if (prop === 'posY')     mesh.position.y = val
      if (prop === 'posZ')     mesh.position.z = val
      if (prop === 'scale')  { mesh.scale.x = val; mesh.scale.y = val }
      if (prop === 'scaleX')   mesh.scale.x = val
      if (prop === 'scaleZ')   mesh.scale.y = val
      if (prop === 'rotY')   { mesh.rotation.z = val * (Math.PI / 180); if (valEl) valEl.textContent = val + '°' }
    })
  })
}

function _applyInitialVisibility() {
  // Still bases: only base1 visible at start
  if (_nodeMap['base1'])       _nodeMap['base1'].visible       = true
  if (_nodeMap['base2_still']) _nodeMap['base2_still'].visible = false
  if (_nodeMap['base3_still']) _nodeMap['base3_still'].visible = false
  // Rotating bases: hidden until frame 215
  if (_nodeMap['base11']) _nodeMap['base11'].visible = false
  if (_nodeMap['base2'])  _nodeMap['base2'].visible  = false
  if (_nodeMap['base3'])  _nodeMap['base3'].visible  = false

  // Shades — shade_01 (green) visible by default
  if (_nodeMap['shade_01']) _nodeMap['shade_01'].visible = true
  if (_nodeMap['shade_02']) _nodeMap['shade_02'].visible = false

  // Chapitas for rotating bases — hidden until frame 215
  CHAPITA_NODES.forEach(name => {
    if (_nodeMap[name]) _nodeMap[name].visible = false
  })

  // luz_chapita — hidden until frame 250
  if (_nodeMap['luz_chapita']) _nodeMap['luz_chapita'].visible = false
}

function _setupSceneListeners() {
  // Intensity slider — lerps each light between its individual _min and _max.
  window.addEventListener('phos:intensity', (e) => {
    _userIntensity = e.detail.normalised
    _glbLights.forEach(({ light }) => {
      const mn = light.userData._min ?? 0
      const mx = light.userData._max ?? light.intensity
      light.intensity = mn + _userIntensity * (mx - mn)
    })
    // Trunk glow follows the same slider: 0 → 2.2
    _setTrunkGlow(_userIntensity * 2.2)
  })

  // Base selector — show only the clicked still base, hide the others.
  // Only applies before frame 215 (while lamp is floating still).
  window.addEventListener('phos:changeBase', (e) => {
    _activeBase = e.detail.index
    const stillBases = ['base1', 'base2_still', 'base3_still']
    stillBases.forEach((name, i) => {
      if (_nodeMap[name]) _nodeMap[name].visible = (i === _activeBase)
    })
  })

  // Shade selector — toggle between shade_01 (green) and shade_02 (white)
  window.addEventListener('phos:changeShade', (e) => {
    _activeShade = e.detail.index
    if (_nodeMap['shade_01']) _nodeMap['shade_01'].visible = (_activeShade === 0)
    if (_nodeMap['shade_02']) _nodeMap['shade_02'].visible = (_activeShade === 1)
  })
}

function _buildLightDebugPanel() {
  const lightRows = _glbLights.map(({ light }) => {
    const maxOverrides = { top_shade: 50 }
    const max = maxOverrides[light.name] ?? Math.max(10, light.intensity * 4)
    return `<label class="ldp-row">${light.name}<input type="range" min="0" max="${max}" step="0.1" value="${light.intensity.toFixed(1)}" data-glb-light="${light.uuid}"><span>${light.intensity.toFixed(1)}</span></label>`
  }).join('')

  const camFovMult = CONFIG.cameraFovMultiplier ?? 0.68

  const panel = document.createElement('div')
  panel.id = 'light-debug'
  panel.style.cursor = 'grab'
  panel.innerHTML = `
    <div id="ldp-drag-handle" style="text-align:center;margin-bottom:6px;opacity:0.4;font-size:10px;letter-spacing:0.1em;user-select:none">⠿ drag</div>`
  panel.innerHTML += `
    <p class="ldp-title">Lights</p>
    ${lightRows || '<p style="opacity:0.5;font-size:10px;margin:4px 0">No lights found</p>'}

    <p class="ldp-title" style="margin-top:10px">Trunk glow</p>
    <label class="ldp-row">strength<input type="range" id="dbg-trunk-strength" min="0" max="3" step="0.05" value="0"><span id="dbg-trunk-strength-val">0.00</span></label>
    <label class="ldp-row">yTop<input type="range" id="dbg-trunk-ytop" min="0" max="3" step="0.01" value="${window.__trunkGlow?.yTop ?? 0.82}"><span id="dbg-trunk-ytop-val">${(window.__trunkGlow?.yTop ?? 0.82).toFixed(2)}</span></label>
    <label class="ldp-row">yBottom<input type="range" id="dbg-trunk-ybot" min="-1" max="2" step="0.01" value="${window.__trunkGlow?.yBottom ?? 0.2}"><span id="dbg-trunk-ybot-val">${(window.__trunkGlow?.yBottom ?? 0.2).toFixed(2)}</span></label>

    <p class="ldp-title" style="margin-top:10px">Shade emissive</p>
    <label class="ldp-row">intensity<input type="range" id="dbg-shade-emit" min="0" max="2" step="0.01" value="0.5"><span id="dbg-shade-emit-val">0.50</span></label>

    <p class="ldp-title" style="margin-top:10px">Camera</p>
    <label class="ldp-row">fovMult<input type="range" id="dbg-cam-fov" min="0.3" max="1.5" step="0.01" value="${camFovMult}"><span id="dbg-cam-fov-val">${camFovMult.toFixed(2)}</span></label>

    <p class="ldp-title" style="margin-top:10px">luz_abajo</p>
    <label class="ldp-row">intensity<input type="range" id="dbg-luz-abajo" min="0" max="2" step="0.01" value="0"><span id="dbg-luz-abajo-val">0.00</span></label>

    <p class="ldp-title" style="margin-top:10px">Shadows (lamp_shadow)</p>
    <label class="ldp-row">posY<input type="range" id="dbg-shadow-posy" min="-0.5" max="2" step="0.01" value="1.74" style="width:110px"><span id="dbg-shadow-posy-val">1.74</span></label>
    <label class="ldp-row">angle<input type="range" id="dbg-shadow-angle" min="0.1" max="1.57" step="0.01" value="1.57" style="width:110px"><span id="dbg-shadow-angle-val">1.57</span></label>
    <label class="ldp-row">penumbra<input type="range" id="dbg-shadow-pen" min="0" max="1" step="0.01" value="0.52" style="width:110px"><span id="dbg-shadow-pen-val">0.52</span></label>
    <label class="ldp-row">bias<input type="range" id="dbg-shadow-bias" min="-0.02" max="0.02" step="0.0005" value="-0.0045" style="width:110px"><span id="dbg-shadow-bias-val">-0.0045</span></label>
    <label class="ldp-row">radius<input type="range" id="dbg-shadow-radius" min="0" max="8" step="0.1" value="3.5" style="width:110px"><span id="dbg-shadow-radius-val">3.5</span></label>
    <label class="ldp-row">far<input type="range" id="dbg-shadow-far" min="0.5" max="6" step="0.1" value="2.2" style="width:110px"><span id="dbg-shadow-far-val">2.2</span></label>
  `
  document.body.appendChild(panel)

  // ── Drag to move ─────────────────────────────────────────────
  let _dragOffX = 0, _dragOffY = 0, _dragging = false
  panel.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'INPUT') return
    _dragging  = true
    _dragOffX  = e.clientX - panel.getBoundingClientRect().left
    _dragOffY  = e.clientY - panel.getBoundingClientRect().top
    panel.style.cursor = 'grabbing'
    e.preventDefault()
  })
  window.addEventListener('mousemove', (e) => {
    if (!_dragging) return
    panel.style.left = (e.clientX - _dragOffX) + 'px'
    panel.style.top  = (e.clientY - _dragOffY) + 'px'
    panel.style.right = 'auto'
  })
  window.addEventListener('mouseup', () => {
    _dragging = false
    panel.style.cursor = 'grab'
  })

  // ── GLB lights ──────────────────────────────────────────────
  const lightByUuid = new Map(_glbLights.map(({ light }) => [light.uuid, light]))
  panel.querySelectorAll('input[data-glb-light]').forEach((slider) => {
    slider.addEventListener('input', () => {
      const val   = parseFloat(slider.value)
      const light = lightByUuid.get(slider.dataset.glbLight)
      slider.nextElementSibling.textContent = val.toFixed(1)
      if (light) { light.intensity = val; light.userData._baseIntensity = val }
    })
  })

  // ── Trunk glow ──────────────────────────────────────────────
  const TRUNK_NAMES = ['base1', 'base11', 'base2', 'base3', 'base2_still', 'base3_still']
  function _updateTrunkUniforms() {
    TRUNK_NAMES.forEach(name => {
      const shader = _nodeMap[name]?.userData._trunkShader
      if (!shader) return
      shader.uniforms.uTrunkGlowStrength.value = parseFloat(panel.querySelector('#dbg-trunk-strength').value)
      shader.uniforms.uTrunkYTop.value         = parseFloat(panel.querySelector('#dbg-trunk-ytop').value)
      shader.uniforms.uTrunkYBottom.value      = parseFloat(panel.querySelector('#dbg-trunk-ybot').value)
    })
  }
  panel.querySelector('#dbg-trunk-strength').addEventListener('input', (e) => {
    panel.querySelector('#dbg-trunk-strength-val').textContent = parseFloat(e.target.value).toFixed(2)
    _updateTrunkUniforms()
  })
  panel.querySelector('#dbg-trunk-ytop').addEventListener('input', (e) => {
    panel.querySelector('#dbg-trunk-ytop-val').textContent = parseFloat(e.target.value).toFixed(2)
    _updateTrunkUniforms()
  })
  panel.querySelector('#dbg-trunk-ybot').addEventListener('input', (e) => {
    panel.querySelector('#dbg-trunk-ybot-val').textContent = parseFloat(e.target.value).toFixed(2)
    _updateTrunkUniforms()
  })

  // ── Shade emissive ──────────────────────────────────────────
  panel.querySelector('#dbg-shade-emit').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value)
    panel.querySelector('#dbg-shade-emit-val').textContent = val.toFixed(2)
    ;['shade_01', 'shade_02'].forEach(name => {
      const mesh = _nodeMap[name]
      if (mesh?.material) mesh.material.emissiveIntensity = val
    })
  })

  // ── Camera FOV ──────────────────────────────────────────────
  panel.querySelector('#dbg-cam-fov').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value)
    panel.querySelector('#dbg-cam-fov-val').textContent = val.toFixed(2)
    if (_camera?.isPerspectiveCamera) {
      _camera.fov = _camera.userData._baseFov * val
      _camera.updateProjectionMatrix()
    }
  })

  // ── luz_abajo ───────────────────────────────────────────────
  panel.querySelector('#dbg-luz-abajo').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value)
    panel.querySelector('#dbg-luz-abajo-val').textContent = val.toFixed(2)
    const luz = _nodeMap['luz_abajo']
    if (luz) luz.intensity = val
  })

  // ── Shadows ─────────────────────────────────────────────────
  const shadowRef = _glbLights.find(({ light }) => light.name === 'lamp_shadow')?.light

  panel.querySelector('#dbg-shadow-posy').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value)
    panel.querySelector('#dbg-shadow-posy-val').textContent = val.toFixed(2)
    if (shadowRef) shadowRef.position.y = val
  })
  panel.querySelector('#dbg-shadow-angle').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value)
    panel.querySelector('#dbg-shadow-angle-val').textContent = val.toFixed(2)
    if (shadowRef) shadowRef.angle = val
  })
  panel.querySelector('#dbg-shadow-pen').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value)
    panel.querySelector('#dbg-shadow-pen-val').textContent = val.toFixed(2)
    if (shadowRef) shadowRef.penumbra = val
  })
  panel.querySelector('#dbg-shadow-bias').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value)
    panel.querySelector('#dbg-shadow-bias-val').textContent = val.toFixed(4)
    if (shadowRef) shadowRef.shadow.bias = val
  })
  panel.querySelector('#dbg-shadow-radius').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value)
    panel.querySelector('#dbg-shadow-radius-val').textContent = val.toFixed(1)
    if (shadowRef) shadowRef.shadow.radius = val
  })
  panel.querySelector('#dbg-shadow-far').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value)
    panel.querySelector('#dbg-shadow-far-val').textContent = val.toFixed(1)
    if (shadowRef) { shadowRef.shadow.camera.far = val; shadowRef.shadow.camera.updateProjectionMatrix() }
  })
}


function _extractCamera(glb) {
  // Priority 1: gltf.cameras array (top-level camera objects)
  if (glb.cameras && glb.cameras.length > 0) {
    const cam = glb.cameras[0]
    _patchCameraAspect(cam)
    console.log('[PHOS productScene] Camera from gltf.cameras:', cam.name || 'unnamed')
    return cam
  }

  // Priority 2: traverse scene node tree
  let found = null
  if (glb.scene) {
    glb.scene.traverse((node) => {
      if (!found && node.isCamera) found = node
    })
  }

  if (found) {
    _patchCameraAspect(found)
    console.log('[PHOS productScene] Camera found by traversal:', found.name || 'unnamed')
    return found
  }

  // Priority 3: config fallback
  console.warn('[PHOS productScene] No camera found — using config fallback.')
  const fb  = CONFIG.cameraFallback
  const cam = new THREE.PerspectiveCamera(
    fb.fov,
    window.innerWidth / window.innerHeight,
    fb.near,
    fb.far
  )
  cam.position.set(fb.position.x, fb.position.y, fb.position.z)
  cam.lookAt(fb.target.x, fb.target.y, fb.target.z)
  return cam
}

function _patchCameraAspect(cam) {
  if (cam.isPerspectiveCamera) {
    const isMobile   = window.innerWidth <= 768
    const multiplier = isMobile
      ? (CONFIG.cameraFovMultiplierMobile ?? 1.1)
      : (CONFIG.cameraFovMultiplier ?? 1.0)
    cam.userData._baseFov = cam.fov   // saved for debug FOV slider
    cam.fov    = cam.fov * multiplier
    cam.aspect = window.innerWidth / window.innerHeight
    cam.updateProjectionMatrix()
  }
}



function _setupComposer() {
  const renderer = getRenderer()
  if (!renderer || !_scene || !_camera) return

  // Plain composer — no bloom post-processing.
  // Bulb glow comes from emissive material + PointLight interior only.
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(_scene, _camera))
  setComposer(composer)
}
