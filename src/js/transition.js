// ─────────────────────────────────────────────────────────────
//  transition.js — Ink-splash loop transition
//
//  Radial FBM ink expansion from the lamp position.
//  Inspired by the ink-splash shader pattern:
//  edges splash outward as the ink expands (dynamic noise amplitude),
//  and blur as they travel (dynamic softness). Warm amber rim glow
//  peaks at mid-transition.
//
//  API:
//    initTransition()          — call once on startup
//    transitionIn(onComplete)  — cover screen, call cb when covered
//    transitionOut(onComplete) — reveal screen, call cb when clear
//
//  Falls back to #scene-veil CSS opacity when WebGL is unavailable.
// ─────────────────────────────────────────────────────────────

import gsap from 'gsap'

const VS = /* glsl */`
  attribute vec2 aPos;
  varying   vec2 vUv;
  void main() {
    vUv         = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`

const FS = /* glsl */`
  precision mediump float;

  uniform float uProgress;
  uniform float uTime;
  uniform vec2  uResolution;
  varying vec2  vUv;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i),                  hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8775, 0.4794, -0.4794, 0.8775);
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p  = r * p * 2.1 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    float ar = uResolution.x / uResolution.y;

    // Ink origin — lamp position
    vec2  origin  = vec2(0.5, 0.70);
    vec2  toPixel = (vUv - origin) * vec2(ar, 1.0);
    float dist    = length(toPixel);

    // FBM noise — slow drift, aspect-corrected
    float t     = uTime * 0.3;
    float noise = fbm(vUv * vec2(ar * 0.8, 1.0) * 4.0 + vec2(t, t * 0.6));

    // Expansion radius driven by scroll progress.
    // 3.2 is enough to reach every corner from lamp position.
    float radius = uProgress * 3.2;

    // Dynamic noise amplitude: at rest the ink breathes quietly,
    // as it expands the edges splash outward (ink in real life).
    float dynamicNoise = noise * (0.55 + uProgress * 1.8);
    float edge         = dist + dynamicNoise;

    // Dynamic softness: crisp edge at start, blurs as it spreads —
    // fast-moving things blur, still things sharpen.
    float softness = 0.03 + uProgress * 0.16;
    float mask     = 1.0 - smoothstep(radius - softness, radius + softness, edge);

    vec3  col   = vec3(0.09, 0.052, 0.020);
    float alpha = mask;

    gl_FragColor = vec4(col, alpha);
  }
`

// ── State ─────────────────────────────────────────────────────

let _gl       = null
let _prog     = null
let _uTime    = null
let _uProg    = null
let _uRes     = null
let _canvas   = null
let _progress = 0
let _active   = false
let _raf      = null
let _startTs  = null

// ── Helpers ───────────────────────────────────────────────────

function _compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  return s
}

function _webGLAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext &&
      (c.getContext('webgl') || c.getContext('experimental-webgl')))
  } catch { return false }
}

function _veilFade(to, onComplete) {
  const veil = document.getElementById('scene-veil')
  if (!veil) { onComplete?.(); return }
  gsap.to(veil, { opacity: to, duration: 0.8, ease: 'power2.inOut', onComplete })
}

// ── Render loop ───────────────────────────────────────────────

function _tick(ts) {
  if (!_active) return
  if (!_startTs) _startTs = ts
  const elapsed = (ts - _startTs) * 0.001

  const gl = _gl
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.useProgram(_prog)
  gl.uniform1f(_uTime, elapsed)
  gl.uniform1f(_uProg, _progress)
  gl.uniform2f(_uRes,  gl.canvas.width, gl.canvas.height)
  gl.drawArrays(gl.TRIANGLES, 0, 6)

  _raf = requestAnimationFrame(_tick)
}

function _startLoop() {
  if (_active) return
  _active  = true
  _startTs = null
  _raf     = requestAnimationFrame(_tick)
}

function _stopLoop() {
  _active = false
  if (_raf) { cancelAnimationFrame(_raf); _raf = null }
}

// ── Public API ────────────────────────────────────────────────

export function initTransition() {
  if (!_webGLAvailable()) return

  _canvas        = document.createElement('canvas')
  _canvas.width  = window.innerWidth
  _canvas.height = window.innerHeight
  Object.assign(_canvas.style, {
    position:      'fixed',
    top:           '0',
    left:          '0',
    width:         '100%',
    height:        '100%',
    zIndex:        '10000',
    pointerEvents: 'none',
  })
  document.body.appendChild(_canvas)

  const gl = _canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false })
  if (!gl) { _canvas.remove(); _canvas = null; return }
  _gl = gl

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  const prog = gl.createProgram()
  gl.attachShader(prog, _compile(gl, gl.VERTEX_SHADER,   VS))
  gl.attachShader(prog, _compile(gl, gl.FRAGMENT_SHADER, FS))
  gl.linkProgram(prog)
  _prog = prog

  _uTime = gl.getUniformLocation(prog, 'uTime')
  _uProg = gl.getUniformLocation(prog, 'uProgress')
  _uRes  = gl.getUniformLocation(prog, 'uResolution')

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1,  1,-1, -1, 1,
     1,-1,  1, 1, -1, 1,
  ]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'aPos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  window.addEventListener('resize', () => {
    _canvas.width  = window.innerWidth
    _canvas.height = window.innerHeight
  })
}

// Cover the screen — ink expands from lamp outward
export function transitionIn(onComplete) {
  if (!_canvas) { _veilFade(1, onComplete); return }

  _progress = 0
  _startLoop()

  const obj = { p: 0 }
  gsap.to(obj, {
    p:        1,
    duration: 1.4,
    ease:     'power2.in',
    onUpdate()  { _progress = obj.p },
    onComplete() {
      _progress = 1
      if (onComplete) onComplete()
    },
  })
}

// Reveal the screen — ink contracts back to lamp
export function transitionOut(onComplete) {
  if (!_canvas) { _veilFade(0, onComplete); return }

  const obj = { p: 1 }
  gsap.to(obj, {
    p:        0,
    duration: 2.4,
    ease:     'power3.out',
    onUpdate()  { _progress = obj.p },
    onComplete() {
      _progress = 0
      _stopLoop()
      if (_gl) {
        _gl.clearColor(0, 0, 0, 0)
        _gl.clear(_gl.COLOR_BUFFER_BIT)
      }
      if (onComplete) onComplete()
    },
  })
}
