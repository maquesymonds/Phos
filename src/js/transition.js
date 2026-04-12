// ─────────────────────────────────────────────────────────────
//  transition.js — Noise dissolve shader between gallery and hero
//
//  Renders a fullscreen quad on #transition-canvas.
//  uProgress 0 = fully opaque (dark), 1 = fully dissolved.
//  The dissolve edge glows warm amber — like embers burning through.
// ─────────────────────────────────────────────────────────────

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
  varying vec2  vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i),             hash(i + vec2(1,0)), u.x),
      mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.48; }
    return v;
  }

  void main() {
    // Slightly non-uniform UV to break symmetry
    vec2 uv = vUv + fbm(vUv * 2.2 + uTime * 0.05) * 0.08;

    float n = fbm(uv * 3.8 + uTime * 0.04);

    // Threshold sweeps 0→1 as progress goes 0→1 (slight overshoot for full clear)
    float thr    = uProgress * 1.3 - 0.15;
    float softW  = 0.08;

    // Core alpha — 1 = dark, 0 = transparent
    float alpha  = 1.0 - smoothstep(thr - softW, thr + softW, n);

    // Ember edge — glows at the dissolve boundary
    float edge   = smoothstep(thr - softW * 2.5, thr, n)
                 * (1.0 - smoothstep(thr, thr + softW * 1.2, n));
    edge         = clamp(edge * 2.8, 0.0, 1.0);

    vec3 dark    = vec3(0.04, 0.025, 0.01);
    vec3 ember   = vec3(0.85, 0.38, 0.06);
    vec3 col     = mix(dark, ember, edge);

    gl_FragColor = vec4(col, alpha);
  }
`

let _gl       = null
let _prog     = null
let _uTime    = null
let _uProg    = null
let _progress = 0
let _raf      = null

function _compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  return s
}

export function initTransition() {
  const canvas = document.getElementById('transition-canvas')
  if (!canvas) return

  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight

  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false })
  if (!gl) return
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

  // Fullscreen quad
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1,  1,-1,  -1,1,
     1,-1,  1, 1,  -1,1,
  ]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'aPos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  window.addEventListener('resize', () => {
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
    gl.viewport(0, 0, canvas.width, canvas.height)
  })

  _startLoop()
  console.log('[PHOS transition] Noise dissolve shader ready.')
}

export function setTransitionProgress(p) {
  _progress = Math.max(0, Math.min(1, p))
}

function _startLoop() {
  let start = null
  function loop(ts) {
    _raf = requestAnimationFrame(loop)
    if (!start) start = ts
    const elapsed = (ts - start) * 0.001

    const gl = _gl
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(_prog)
    gl.uniform1f(_uTime, elapsed)
    gl.uniform1f(_uProg, _progress)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
  _raf = requestAnimationFrame(loop)
}
