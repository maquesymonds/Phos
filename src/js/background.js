// ─────────────────────────────────────────────────────────────
//  background.js — Atmospheric shader background (v3 — ridged FBM)
//
//  Technique: double domain-warped ridged FBM.
//  Ridged noise creates sharp luminous edges (like caustics / light
//  ribbons) in dark space. A second domain-warp pass bends the
//  ribbons into organic non-repeating forms. Mouse position subtly
//  shifts the warp field — the whole atmosphere drifts, not a
//  single object.
//
//  Public API (unchanged from v2):
//    initBackground(scene)       — create mesh + register tick
//    getBackgroundUniforms()     — returns uniforms for Theatre.js
//    setBackgroundOpacity(0–1)   — scroll-based fade
// ─────────────────────────────────────────────────────────────

import * as THREE from 'three'
import { onTick } from './scene.js'
import { backgroundSheet } from './theatreSetup.js'
import { types } from '@theatre/core'

// ─── Module state ─────────────────────────────────────────────

let _material = null
let _mesh     = null

// ─── Mouse tracking ───────────────────────────────────────────

const _mouse = {
  target:  new THREE.Vector2(0, 0),
  current: new THREE.Vector2(0, 0),
  ease:    0.04,
}

window.addEventListener('mousemove', (e) => {
  _mouse.target.set(
     e.clientX / window.innerWidth  - 0.5,
    -e.clientY / window.innerHeight + 0.5,
  )
})

// ─── Shaders ──────────────────────────────────────────────────

const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`

const fragmentShader = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec2  uResolution;
  uniform vec2  uMouse;
  uniform float uMouseInfluence;
  uniform float uBreathSpeed;
  uniform float uGlowIntensity;
  uniform float uDarkFloor;
  uniform float uVeilSharpness;
  uniform float uWarpStrength;
  uniform float uOpacity;
  uniform vec3  uColorAmber;
  uniform vec3  uColorBronze;
  uniform vec3  uColorBase;

  varying vec2 vUv;

  // ─── Noise ─────────────────────────────────────────────────

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float gradientNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = dot(hash2(i + vec2(0,0)), f - vec2(0,0));
    float b = dot(hash2(i + vec2(1,0)), f - vec2(1,0));
    float c = dot(hash2(i + vec2(0,1)), f - vec2(0,1));
    float d = dot(hash2(i + vec2(1,1)), f - vec2(1,1));
    return 0.5 + 0.5 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v   += amp * gradientNoise(p);
      p   *= 2.1;
      amp *= 0.48;
    }
    return v;
  }

  // Ridged FBM — both peaks and valleys become bright edges.
  // Produces the caustic / light ribbon signature.
  float ridgedFBM(vec2 p) {
    float v = 0.0, amp = 0.55;
    for (int i = 0; i < 5; i++) {
      float n     = gradientNoise(p);
      float ridge = 1.0 - abs(n * 2.0 - 1.0);
      v   += amp * (ridge * ridge);
      p   *= 2.05;
      amp *= 0.46;
    }
    return clamp(v, 0.0, 1.0);
  }

  // ─── Main ──────────────────────────────────────────────────

  void main() {
    vec2  uv = vUv;
    float ar = uResolution.x / uResolution.y;
    float t  = uTime * uBreathSpeed;
    vec2  m  = uMouse * uMouseInfluence;

    // Elongation — horizontal ribbon bias
    vec2 q = vec2(uv.x * ar * 0.65, uv.y * 1.5);

    // Domain warp pass 1 — large scale, very slow
    vec2 warp1;
    warp1.x = fbm(q * 0.75 + vec2( t * 0.017,  t * 0.011) + m * 0.18);
    warp1.y = fbm(q * 0.75 + vec2( t * 0.013, -t * 0.019) + vec2(3.7, 8.1) + m * 0.14);

    // Domain warp pass 2 — medium scale, second bend creates organic curvature
    vec2 warp2;
    warp2.x = fbm(q * 1.4 + warp1 * 0.45 + vec2(-t * 0.021,  t * 0.015) + vec2(1.2, 4.5));
    warp2.y = fbm(q * 1.4 + warp1 * 0.45 + vec2( t * 0.018, -t * 0.012) + vec2(6.8, 2.3));

    vec2 r = q + warp1 * (0.60 * uWarpStrength) + warp2 * (0.28 * uWarpStrength);

    // Light structure layers
    float causticA = ridgedFBM(r * 1.1 + t * 0.007);
    causticA = pow(causticA, 3.2 * uVeilSharpness);

    float causticB = ridgedFBM(r * 2.3 + warp1 * 0.35 - t * 0.010 + vec2(2.4, 0.0));
    causticB = pow(causticB, 3.8 * uVeilSharpness);

    float causticC = ridgedFBM(r * 4.5 + warp2 * 0.25 + t * 0.013 + vec2(0.0, 5.1));
    causticC = pow(causticC, 5.5 * uVeilSharpness);

    // Compose
    vec3 col = uColorBase;
    col += uColorAmber                          * causticA * 0.22 * uGlowIntensity;
    col += mix(uColorAmber, uColorBronze, 0.70) * causticB * 0.12 * uGlowIntensity;
    col += uColorAmber                          * causticC * 0.07 * uGlowIntensity;

    // Darkness mask — floor keeps blacks truly black
    float lightPresence = max(causticA, max(causticB * 0.65, causticC * 0.4));
    col *= (uDarkFloor + lightPresence * (1.0 - uDarkFloor));

    // Warm secondary bounce in shadow zones
    float softBounce = causticA * (1.0 - causticA);
    col += uColorBronze * softBounce * 0.03 * uGlowIntensity;

    // Warm vignette — borders fade toward the dark base color, not black.
    // mix() keeps the palette's brown/amber in the shadows instead of going dead.
    vec2  centered  = uv - 0.5;
    float vignette  = pow(clamp(1.0 - dot(centered, centered) * 1.2, 0.0, 1.0), 1.6);
    col = mix(uColorBase * 0.5, col, vignette);

    // Gamma
    col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

    // Opacity — darkens toward black (opaque material, alpha ignored)
    gl_FragColor = vec4(col * uOpacity, 1.0);
  }
`

// ─── Public ───────────────────────────────────────────────────

export function initBackground(scene) {
  _material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime:           { value: 0 },
      uResolution:     { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uMouse:          { value: new THREE.Vector2(0, 0) },
      uMouseInfluence: { value: 1.0 },
      uBreathSpeed:    { value: 1.0 },
      uGlowIntensity:  { value: 1.0 },
      uDarkFloor:      { value: 0.06 },
      uVeilSharpness:  { value: 1.0 },
      uWarpStrength:   { value: 1.0 },
      uOpacity:        { value: 1.0 },

      uColorAmber:     { value: new THREE.Color(0.62, 0.28, 0.05) },
      uColorBronze:    { value: new THREE.Color(0.22, 0.09, 0.02) },
      uColorBase:      { value: new THREE.Color(0.014, 0.008, 0.004) },
    },
    transparent: false,
    depthWrite:  false,
    depthTest:   false,
  })

  _mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), _material)
  _mesh.frustumCulled = false
  _mesh.renderOrder   = -1
  scene.add(_mesh)

  // ── Theatre controls ────────────────────────────────────────
  const theatreObj = backgroundSheet.object('Background Shader', {
    darkFloor:      types.number(0.06, { range: [0.0, 0.4],  label: 'Base Darkness'       }),
    glowIntensity:  types.number(1.0,  { range: [0.0, 3.0],  label: 'Highlight Intensity'  }),
    breathSpeed:    types.number(1.0,  { range: [0.0, 3.0],  label: 'Movement Speed'       }),
    veilSharpness:  types.number(1.0,  { range: [0.2, 4.0],  label: 'Veil Sharpness'       }),
    warpStrength:   types.number(1.0,  { range: [0.0, 3.0],  label: 'Warp / Flow'          }),
    mouseInfluence: types.number(1.0,  { range: [0.0, 3.0],  label: 'Mouse Influence'      }),
    amber_r:        types.number(0.62, { range: [0, 1],      label: 'Amber R'              }),
    amber_g:        types.number(0.28, { range: [0, 1],      label: 'Amber G'              }),
    amber_b:        types.number(0.05, { range: [0, 1],      label: 'Amber B'              }),
    bronze_r:       types.number(0.22, { range: [0, 1],      label: 'Bronze R'             }),
    bronze_g:       types.number(0.09, { range: [0, 1],      label: 'Bronze G'             }),
    bronze_b:       types.number(0.02, { range: [0, 1],      label: 'Bronze B'             }),
    base_r:         types.number(0.014,{ range: [0, 0.2],    label: 'Base R'               }),
    base_g:         types.number(0.008,{ range: [0, 0.2],    label: 'Base G'               }),
    base_b:         types.number(0.004,{ range: [0, 0.2],    label: 'Base B'               }),
  })

  theatreObj.onValuesChange((v) => {
    const u = _material.uniforms
    u.uBreathSpeed.value    = v.breathSpeed
    u.uGlowIntensity.value  = v.glowIntensity
    u.uDarkFloor.value      = v.darkFloor
    u.uVeilSharpness.value  = v.veilSharpness
    u.uWarpStrength.value   = v.warpStrength
    u.uMouseInfluence.value = v.mouseInfluence
    u.uColorAmber.value.setRGB(v.amber_r,  v.amber_g,  v.amber_b)
    u.uColorBronze.value.setRGB(v.bronze_r, v.bronze_g, v.bronze_b)
    u.uColorBase.value.setRGB(v.base_r,   v.base_g,   v.base_b)
  })

  // ── Tick + resize ───────────────────────────────────────────
  onTick((elapsed) => {
    const u = _material.uniforms
    u.uTime.value = elapsed

    // Warp field offset — whole atmosphere drifts with mouse
    _mouse.current.lerp(_mouse.target, _mouse.ease)
    u.uMouse.value.copy(_mouse.current)

  })

  window.addEventListener('resize', () => {
    if (_material) {
      _material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)
    }
  })

  console.log('[PHOS background] v3 — ridged FBM, Theatre wired.')
}

export function getBackgroundUniforms() {
  return _material ? _material.uniforms : null
}

export function setBackgroundOpacity(opacity) {
  if (_material) {
    _material.uniforms.uOpacity.value = Math.max(0, Math.min(1, opacity))
  }
}
