// ─────────────────────────────────────────────────────────────
//  background.js v4 — Fake Volumetric Light Atmosphere
//
//  Theatre.js controls (9 params that actually matter):
//    Glow       — overall brightness
//    Scatter    — beam width / cone spread
//    Contrast   — dynamic range: bright vs dark zones
//    Speed      — animation velocity
//    Turbulence — warp chaos: smooth vs complex motion
//    Pulse      — rhythmic breathing oscillation
//    Depth      — vertical depth gradient
//    Flow       — directional atmospheric drift
//    Mouse      — hover / cursor interaction strength
//
//  Colors are fixed — tweak via COLOR_* constants below.
//
//  Public API:
//    initBackground(scene)
//    getBackgroundUniforms()
//    setBackgroundOpacity(0–1)
// ─────────────────────────────────────────────────────────────

import * as THREE from 'three'
import { onTick, getRenderer } from './scene.js'
import { CONFIG } from './config.js'

// ─── Fixed color palette ───────────────────────────────────────
// Tune these three values to shift the whole color mood.
// R/G/B are linear (not gamma). Keep ratios warm (R > G > B).

const COLOR_AMBER  = [0.62, 0.28, 0.05]   // primary warm glow
const COLOR_BRONZE = [0.22, 0.09, 0.02]   // secondary deeper tone
const COLOR_BASE   = [0.014, 0.008, 0.004] // near-black warm shadow

// ─── Tuning defaults ──────────────────────────────────────────
// These become the starting values in Theatre.js.

const D = {
  glow:       1.1,   // overall brightness
  scatter:    1.5,   // cone spread (lower = tighter beam)
  contrast:   1.6,   // dynamic range — pull this up for drama
  speed:      1.5,   // animation velocity
  turbulence: 1.0,   // warp complexity (0=smooth, 3=chaotic)
  pulse:      0.40,  // breathing oscillation (0=off, 1=strong)
  depth:      2.0,   // vertical depth falloff
  flow:       0.45,  // directional atmospheric drift
}

// ─── Module state ─────────────────────────────────────────────

let _material = null   // heavy atmosphere shader — renders into _target
let _mesh     = null   // full-screen quad in the main scene showing _target
let _target   = null   // low-res render target (CONFIG.renderer.backgroundScale)
let _bgScene  = null
let _bgCamera = null


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
  uniform float uOpacity;

  // ── The 9 controls ────────────────────────────────────────
  uniform float uGlow;        // overall brightness multiplier
  uniform float uScatter;     // beam cone spread (Gaussian falloff)
  uniform float uContrast;    // power curve on haze — sharpens bright/dark zones
  uniform float uSpeed;       // animation speed
  uniform float uTurbulence;  // warp scale + chaos amount
  uniform float uPulse;       // rhythmic breathing intensity
  uniform float uDepth;       // vertical depth attenuation rate
  uniform float uFlow;        // directional drift speed

  // ── Colors (fixed) ────────────────────────────────────────
  uniform vec3 uColorAmber;
  uniform vec3 uColorBronze;
  uniform vec3 uColorBase;

  varying vec2 vUv;

  // ─── Noise ──────────────────────────────────────────────

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float gn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return 0.5 + 0.5 * mix(
      mix(dot(hash2(i),              f),
          dot(hash2(i + vec2(1,0)), f - vec2(1,0)), u.x),
      mix(dot(hash2(i + vec2(0,1)), f - vec2(0,1)),
          dot(hash2(i + vec2(1,1)), f - vec2(1,1)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * gn(p); p *= 2.1; a *= 0.48; }
    return v;
  }

  // Ridged — sharp luminous edges / curtain folds
  float rfbm(vec2 p) {
    float v = 0.0, a = 0.55;
    for (int i = 0; i < 5; i++) {
      float n = gn(p); float r = 1.0 - abs(n * 2.0 - 1.0);
      v += a * r * r; p *= 2.05; a *= 0.46;
    }
    return clamp(v, 0.0, 1.0);
  }

  void main() {
    vec2  uv = vUv;
    float ar = uResolution.x / uResolution.y;
    float t  = uTime * uSpeed;

    // ── Lamp position (fixed — physical lamp location) ───────
    const vec2 LAMP = vec2(0.5, 0.70);

    // ── Pulse — rhythmic breathing ────────────────────────────
    // Two overlapping sine waves at different frequencies so
    // it never feels like a metronome. uPulse=0 kills it.
    float breathA  = sin(uTime * 0.72 + 0.5) * 0.5 + 0.5;
    float breathB  = sin(uTime * 1.45 + 2.1) * 0.5 + 0.5;
    float breathe  = mix(1.0, breathA * 0.55 + breathB * 0.45, uPulse);

    // ── Flow — directional atmospheric drift ──────────────────
    // Adds global movement in one direction, like a slow air current.
    // Direction: gently diagonal (cinematic, non-repeating feel).
    vec2 flowVec = vec2(0.38, 0.22) * uFlow * 0.025;

    // ── Turbulence — warp frequency and chaos ─────────────────
    // Higher turbulence = finer, more chaotic warp patterns.
    // Also speeds up the warp animation relative to overall speed.
    float turbScale = 0.70 + uTurbulence * 0.38;
    float turbSpeed = 1.0  + uTurbulence * 0.75;

    // ── Domain warp coordinate ────────────────────────────────
    vec2 q = (uv - LAMP) * vec2(ar * 0.72, 1.0)
             + flowVec * uTime;

    // Pass 1 — large-scale organic motion
    vec2 w1;
    w1.x = fbm(q * turbScale + vec2( t * 0.014 * turbSpeed,  t * 0.009 * turbSpeed));
    w1.y = fbm(q * turbScale + vec2( t * 0.010 * turbSpeed, -t * 0.016 * turbSpeed) + vec2(3.8, 7.4));

    // Pass 2 — finer detail, driven by pass 1 (creates folding)
    vec2 w2;
    w2.x = fbm(q * turbScale * 1.9 + w1 * (0.45 + uTurbulence * 0.2)
               + vec2(-t * 0.018 * turbSpeed,  t * 0.011 * turbSpeed) + vec2(1.1, 4.2));
    w2.y = fbm(q * turbScale * 1.9 + w1 * (0.45 + uTurbulence * 0.2)
               + vec2( t * 0.014 * turbSpeed, -t * 0.019 * turbSpeed) + vec2(5.6, 2.8));

    vec2 r = q + w1 * (0.58 + uTurbulence * 0.15) + w2 * (0.24 + uTurbulence * 0.08);

    // ── Haze cone — main inscattering volume ──────────────────
    // Gaussian falloff from lamp. Squashed slightly so it
    // spreads wider than tall (light diffuses sideways in air).
    float d2   = dot(r * vec2(1.0, 0.82), r * vec2(1.0, 0.82));
    float haze = exp(-d2 * uScatter);

    // Organic density variation — denser pockets, thinner zones
    float hazeMod = 0.60 + 0.40 * fbm(r * 2.4 + t * 0.017 * turbSpeed);
    haze *= hazeMod;

    // Pulse breathes the haze in and out
    haze *= breathe;

    // Contrast — power curve sharpens the boundary between
    // bright haze zone and dark surrounding air.
    // contrast=1: soft fog. contrast=2+: dramatic light/shadow split.
    haze = pow(max(0.0, haze), uContrast);

    // ── Light folds — inscattering detail ─────────────────────
    // Ridged FBM within the haze zone = bands of denser/lighter air.
    // Contrast also sharpens folds (at a softer rate).
    float foldMask = exp(-d2 * (uScatter * 0.50));
    float folds    = rfbm(r * 1.55 + w1 * 0.28 + t * 0.005 * turbSpeed);
    folds = pow(folds, max(0.5, uContrast * 0.65)) * foldMask;

    // ── Depth attenuation ─────────────────────────────────────
    // Light falls downward from lamp — faster above (ceiling),
    // slower below (the room it's illuminating).
    float yDiff     = uv.y - 0.70;
    float depthFactor = exp(
      -yDiff * yDiff * (yDiff > 0.0 ? uDepth * 2.2 : uDepth * 0.7)
    );
    depthFactor = clamp(depthFactor, 0.18, 1.0);

    // ── Dust / micro grain ────────────────────────────────────
    float dust = rfbm(r * 5.2 + t * 0.014 * turbSpeed + vec2(2.1, 5.7));
    dust = pow(dust, 5.5 - uContrast * 0.4) * haze * 0.45;

    // ── Base gradient ─────────────────────────────────────────
    float baseLift = exp(-d2 * 2.5) * 0.18;
    vec3  col = uColorBase * (1.0 + baseLift);

    // ── Compose ───────────────────────────────────────────────
    col += uColorAmber                         * haze  * depthFactor * uGlow;
    col += mix(uColorAmber, uColorBronze, 0.55) * folds * depthFactor * uGlow * 0.55;
    col += uColorAmber                         * dust  * uGlow * 0.4;

    // Warm secondary fill — keeps shadows alive
    col += uColorBronze * haze * (1.0 - haze) * 0.04 * uGlow;

    // ── Vignette ──────────────────────────────────────────────
    vec2  vig  = uv - 0.5;
    float vign = pow(clamp(1.0 - dot(vig, vig) * 1.25, 0.0, 1.0), 1.5);
    col = mix(uColorBase * 0.45, col, vign);

    // ── Gamma + opacity ───────────────────────────────────────
    col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
    gl_FragColor = vec4(col, 1.0);   // opacity is applied in the display pass
  }
`

// Display pass: upscales the low-res atmosphere. Output is already
// gamma-encoded by the atmosphere shader, so it is copied untouched.
const displayFragmentShader = /* glsl */`
  uniform sampler2D tAtmosphere;
  uniform float     uOpacity;
  varying vec2      vUv;
  void main() {
    gl_FragColor = vec4(texture2D(tAtmosphere, vUv).rgb * uOpacity, 1.0);
  }
`

function _targetSize() {
  const scale = CONFIG.renderer.backgroundScale ?? 0.5
  return [
    Math.max(1, Math.round(window.innerWidth  * scale)),
    Math.max(1, Math.round(window.innerHeight * scale)),
  ]
}

// ─── Public ────────────────────────────────────────────────────

export function initBackground(scene) {
  _material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime:          { value: 0 },
      uResolution:    { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uOpacity:       { value: 1.0 },

      uGlow:          { value: D.glow        },
      uScatter:       { value: D.scatter     },
      uContrast:      { value: D.contrast    },
      uSpeed:         { value: D.speed       },
      uTurbulence:    { value: D.turbulence  },
      uPulse:         { value: D.pulse       },
      uDepth:         { value: D.depth       },
      uFlow:          { value: D.flow        },

      uColorAmber:    { value: new THREE.Color(...COLOR_AMBER)  },
      uColorBronze:   { value: new THREE.Color(...COLOR_BRONZE) },
      uColorBase:     { value: new THREE.Color(...COLOR_BASE)   },
    },
    transparent: false,
    depthWrite:  false,
    depthTest:   false,
  })

  // Off-screen pass: atmosphere shader → low-res target
  const quad = new THREE.PlaneGeometry(2, 2)
  _target   = new THREE.WebGLRenderTarget(..._targetSize(), { depthBuffer: false })
  _bgScene  = new THREE.Scene()
  _bgCamera = new THREE.Camera()
  const bgMesh = new THREE.Mesh(quad, _material)
  bgMesh.frustumCulled = false
  _bgScene.add(bgMesh)

  // On-screen pass: cheap quad in the main scene, behind everything
  const displayMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: displayFragmentShader,
    uniforms: {
      tAtmosphere: { value: _target.texture },
      uOpacity:    _material.uniforms.uOpacity,   // shared — setBackgroundOpacity drives both
    },
    depthWrite: false,
    depthTest:  false,
  })
  _mesh = new THREE.Mesh(quad, displayMaterial)
  _mesh.frustumCulled = false
  _mesh.renderOrder   = -1
  scene.add(_mesh)


  // ── Tick ───────────────────────────────────────────────────
  // Runs before the main render each frame (scene.js loop order).
  onTick((elapsed) => {
    const u = _material.uniforms
    u.uTime.value = elapsed
    if (!_mesh.visible || u.uOpacity.value <= 0) return

    const renderer = getRenderer()
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(_target)
    renderer.render(_bgScene, _bgCamera)
    renderer.setRenderTarget(prev)
  })

  window.addEventListener('resize', () => {
    if (!_material) return
    _material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)
    _target.setSize(..._targetSize())
  })

}

export function getBackgroundUniforms() {
  return _material ? _material.uniforms : null
}

export function setBackgroundOpacity(opacity) {
  if (_material) _material.uniforms.uOpacity.value = Math.max(0, Math.min(1, opacity))
}
