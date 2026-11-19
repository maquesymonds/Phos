// ─────────────────────────────────────────────────────────────
//  fluid.js — Real-time fluid simulation for PHOS hover effect
//
//  Based on PavelDoGreat/WebGL-Fluid-Simulation.
//  Adapted: single warm amber palette, alpha-transparent canvas,
//  composited via mix-blend-mode:screen over the 3D scene.
//
//  The cursor leaves warm amber light trails — like disturbing
//  heated air or light around a lamp.
//
//  Skipped on mobile (performance).
// ─────────────────────────────────────────────────────────────

// ── Warm amber color — only this color, no randoms ───────────
const SPLAT_COLOR = [0.7, 0.26, 0.04]

const CFG = {
  DOWNSAMPLE:           1,
  DENSITY_DISSIPATION:  0.983,
  VELOCITY_DISSIPATION: 0.974,
  PRESSURE_DISSIPATION: 0.8,
  PRESSURE_ITERATIONS:  20,
  CURL:                 22,
  SPLAT_RADIUS:         0.007,
  SPLAT_FORCE:          7.0,
}

let _canvas = null

// Show / hide called by scroll.js when gallery enters/leaves
export function showFluid() {
  if (_canvas) _canvas.style.transition = 'opacity 1s ease'
  if (_canvas) _canvas.style.opacity    = '0.9'
}
export function hideFluid() {
  if (_canvas) _canvas.style.transition = 'opacity 0.6s ease'
  if (_canvas) _canvas.style.opacity    = '0'
}

export function initFluid() {
  if (window.innerWidth <= 768) return

  // ── Create canvas — hidden until gallery section ───────────
  const canvas = document.createElement('canvas')
  _canvas = canvas
  canvas.id = 'fluid-canvas'
  document.body.appendChild(canvas)

  Object.assign(canvas.style, {
    position:      'fixed',
    top:           '0',
    left:          '0',
    width:         '100%',
    height:        '100%',
    pointerEvents: 'none',
    zIndex:        '2',
    mixBlendMode:  'screen',
    opacity:       '0',           // hidden by default
  })

  canvas.width  = canvas.clientWidth
  canvas.height = canvas.clientHeight

  // ── WebGL context (alpha for transparency) ─────────────────
  const params = { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: false }
  let gl = canvas.getContext('webgl2', params)
  const isWebGL2 = !!gl
  if (!isWebGL2) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params)

  let halfFloat, supportLinear
  if (isWebGL2) {
    gl.getExtension('EXT_color_buffer_float')
    supportLinear = gl.getExtension('OES_texture_float_linear')
  } else {
    halfFloat    = gl.getExtension('OES_texture_half_float')
    supportLinear = gl.getExtension('OES_texture_half_float_linear')
  }

  gl.clearColor(0, 0, 0, 0)

  const HF_TYPE = isWebGL2 ? gl.HALF_FLOAT : halfFloat?.HALF_FLOAT_OES
  const fmtRGBA = isWebGL2 ? fmt(gl, gl.RGBA16F, gl.RGBA,  HF_TYPE) : fmt(gl, gl.RGBA, gl.RGBA, HF_TYPE)
  const fmtRG   = isWebGL2 ? fmt(gl, gl.RG16F,   gl.RG,    HF_TYPE) : fmt(gl, gl.RGBA, gl.RGBA, HF_TYPE)
  const fmtR    = isWebGL2 ? fmt(gl, gl.R16F,     gl.RED,   HF_TYPE) : fmt(gl, gl.RGBA, gl.RGBA, HF_TYPE)

  function fmt(gl, internal, format, type) {
    if (!canRender(gl, internal, format, type)) {
      if (internal === gl.R16F)   return fmt(gl, gl.RG16F,   gl.RG,   type)
      if (internal === gl.RG16F)  return fmt(gl, gl.RGBA16F, gl.RGBA, type)
      return null
    }
    return { internal, format }
  }

  function canRender(gl, internal, format, type) {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, type, null)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  }

  // ── Shaders ────────────────────────────────────────────────

  function compile(type, src) {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(s)
    return s
  }

  const baseVert = compile(gl.VERTEX_SHADER, `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform vec2 texelSize;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `)

  // Transparent where no fluid — alpha = density magnitude
  const displayFrag = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    void main() {
      vec3 c = texture2D(uTexture, vUv).rgb;
      float a = min(1.0, length(c) * 4.0);
      gl_FragColor = vec4(c, a);
    }
  `)

  const clearFrag = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTexture; uniform float value;
    void main() { gl_FragColor = value * texture2D(uTexture, vUv); }
  `)

  const splatFrag = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTarget; uniform float aspectRatio;
    uniform vec3 color; uniform vec2 point; uniform float radius;
    void main() {
      vec2 p = vUv - point.xy; p.x *= aspectRatio;
      vec3 splat = exp(-dot(p,p)/radius) * color;
      gl_FragColor = vec4(texture2D(uTarget,vUv).xyz + splat, 1.0);
    }
  `)

  const advFrag = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uVelocity; uniform sampler2D uSource;
    uniform vec2 texelSize; uniform float dt; uniform float dissipation;
    void main() {
      vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
      gl_FragColor = dissipation * texture2D(uSource, coord);
      gl_FragColor.a = 1.0;
    }
  `)

  const advManualFrag = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uVelocity; uniform sampler2D uSource;
    uniform vec2 texelSize; uniform float dt; uniform float dissipation;
    vec4 bilerp(sampler2D s, vec2 p) {
      vec4 st; st.xy = floor(p-0.5)+0.5; st.zw = st.xy+1.0;
      vec4 uv = st * texelSize.xyxy;
      vec4 a=texture2D(s,uv.xy), b=texture2D(s,uv.zy), c=texture2D(s,uv.xw), d=texture2D(s,uv.zw);
      vec2 f = p - st.xy;
      return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
    }
    void main() {
      vec2 coord = gl_FragCoord.xy - dt * texture2D(uVelocity, vUv).xy;
      gl_FragColor = dissipation * bilerp(uSource, coord);
      gl_FragColor.a = 1.0;
    }
  `)

  const divFrag = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform sampler2D uVelocity;
    vec2 sv(vec2 uv) {
      vec2 m=vec2(1.0);
      if(uv.x<0.0){uv.x=0.0;m.x=-1.0;} if(uv.x>1.0){uv.x=1.0;m.x=-1.0;}
      if(uv.y<0.0){uv.y=0.0;m.y=-1.0;} if(uv.y>1.0){uv.y=1.0;m.y=-1.0;}
      return m*texture2D(uVelocity,uv).xy;
    }
    void main() {
      float div = 0.5*(sv(vR).x-sv(vL).x+sv(vT).y-sv(vB).y);
      gl_FragColor = vec4(div,0,0,1);
    }
  `)

  const curlFrag = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform sampler2D uVelocity;
    void main() {
      float L=texture2D(uVelocity,vL).y, R=texture2D(uVelocity,vR).y;
      float T=texture2D(uVelocity,vT).x, B=texture2D(uVelocity,vB).x;
      gl_FragColor = vec4(R-L-T+B,0,0,1);
    }
  `)

  const vorticityFrag = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv; varying vec2 vT; varying vec2 vB;
    uniform sampler2D uVelocity; uniform sampler2D uCurl;
    uniform float curl; uniform float dt;
    void main() {
      float T=texture2D(uCurl,vT).x, B=texture2D(uCurl,vB).x, C=texture2D(uCurl,vUv).x;
      vec2 force = vec2(abs(T)-abs(B),0.0);
      force *= 1.0/length(force+0.00001)*curl*C;
      gl_FragColor = vec4(texture2D(uVelocity,vUv).xy+force*dt,0,1);
    }
  `)

  const pressureFrag = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform sampler2D uPressure; uniform sampler2D uDivergence;
    vec2 bnd(vec2 uv){return min(max(uv,0.0),1.0);}
    void main() {
      float L=texture2D(uPressure,bnd(vL)).x, R=texture2D(uPressure,bnd(vR)).x;
      float T=texture2D(uPressure,bnd(vT)).x, B=texture2D(uPressure,bnd(vB)).x;
      float div=texture2D(uDivergence,vUv).x;
      gl_FragColor = vec4((L+R+B+T-div)*0.25,0,0,1);
    }
  `)

  const gradSubFrag = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform sampler2D uPressure; uniform sampler2D uVelocity;
    vec2 bnd(vec2 uv){return min(max(uv,0.0),1.0);}
    void main() {
      float L=texture2D(uPressure,bnd(vL)).x, R=texture2D(uPressure,bnd(vR)).x;
      float T=texture2D(uPressure,bnd(vT)).x, B=texture2D(uPressure,bnd(vB)).x;
      vec2 vel = texture2D(uVelocity,vUv).xy - vec2(R-L,T-B);
      gl_FragColor = vec4(vel,0,1);
    }
  `)

  // ── Programs ───────────────────────────────────────────────

  function makeProgram(vert, frag) {
    const p = gl.createProgram()
    gl.attachShader(p, vert); gl.attachShader(p, frag); gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw gl.getProgramInfoLog(p)
    const uniforms = {}
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name
      uniforms[name] = gl.getUniformLocation(p, name)
    }
    return { program: p, uniforms, bind() { gl.useProgram(p) } }
  }

  const displayProg    = makeProgram(baseVert, displayFrag)
  const clearProg      = makeProgram(baseVert, clearFrag)
  const splatProg      = makeProgram(baseVert, splatFrag)
  const advProg        = makeProgram(baseVert, supportLinear ? advFrag : advManualFrag)
  const divProg        = makeProgram(baseVert, divFrag)
  const curlProg       = makeProgram(baseVert, curlFrag)
  const vorticityProg  = makeProgram(baseVert, vorticityFrag)
  const pressureProg   = makeProgram(baseVert, pressureFrag)
  const gradSubProg    = makeProgram(baseVert, gradSubFrag)

  // ── Blit quad ──────────────────────────────────────────────

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,-1,1,1,1,1,-1]), gl.STATIC_DRAW)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2,0,2,3]), gl.STATIC_DRAW)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.enableVertexAttribArray(0)

  function blit(dst) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst)
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
  }

  // ── FBOs ───────────────────────────────────────────────────

  let W, H, density, velocity, divergence, curl, pressure

  function initFBOs() {
    W = gl.drawingBufferWidth  >> CFG.DOWNSAMPLE
    H = gl.drawingBufferHeight >> CFG.DOWNSAMPLE
    const filter = supportLinear ? gl.LINEAR : gl.NEAREST
    density    = doubleFBO(2, W, H, fmtRGBA.internal, fmtRGBA.format, HF_TYPE, filter)
    velocity   = doubleFBO(0, W, H, fmtRG.internal,   fmtRG.format,   HF_TYPE, filter)
    divergence = singleFBO(4, W, H, fmtR.internal,    fmtR.format,    HF_TYPE, gl.NEAREST)
    curl       = singleFBO(5, W, H, fmtR.internal,    fmtR.format,    HF_TYPE, gl.NEAREST)
    pressure   = doubleFBO(6, W, H, fmtR.internal,    fmtR.format,    HF_TYPE, gl.NEAREST)
  }

  function singleFBO(id, w, h, internal, format, type, filter) {
    gl.activeTexture(gl.TEXTURE0 + id)
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.viewport(0, 0, w, h)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return [tex, fbo, id]
  }

  function doubleFBO(id, w, h, internal, format, type, filter) {
    let a = singleFBO(id,   w, h, internal, format, type, filter)
    let b = singleFBO(id+1, w, h, internal, format, type, filter)
    return {
      get read()  { return a },
      get write() { return b },
      swap()      { const t=a; a=b; b=t }
    }
  }

  initFBOs()

  // ── Simulation step ────────────────────────────────────────

  let lastTime = Date.now()

  function step() {
    const dt = Math.min((Date.now() - lastTime) / 1000, 0.016)
    lastTime = Date.now()

    gl.viewport(0, 0, W, H)

    // Advect velocity
    advProg.bind()
    gl.uniform2f(advProg.uniforms.texelSize, 1/W, 1/H)
    gl.uniform1i(advProg.uniforms.uVelocity, velocity.read[2])
    gl.uniform1i(advProg.uniforms.uSource,   velocity.read[2])
    gl.uniform1f(advProg.uniforms.dt, dt)
    gl.uniform1f(advProg.uniforms.dissipation, CFG.VELOCITY_DISSIPATION)
    blit(velocity.write[1]); velocity.swap()

    // Advect density
    gl.uniform1i(advProg.uniforms.uVelocity, velocity.read[2])
    gl.uniform1i(advProg.uniforms.uSource,   density.read[2])
    gl.uniform1f(advProg.uniforms.dissipation, CFG.DENSITY_DISSIPATION)
    blit(density.write[1]); density.swap()

    // Apply pending splats
    _drainSplats()

    // Curl
    curlProg.bind()
    gl.uniform2f(curlProg.uniforms.texelSize, 1/W, 1/H)
    gl.uniform1i(curlProg.uniforms.uVelocity, velocity.read[2])
    blit(curl[1])

    // Vorticity confinement
    vorticityProg.bind()
    gl.uniform2f(vorticityProg.uniforms.texelSize, 1/W, 1/H)
    gl.uniform1i(vorticityProg.uniforms.uVelocity, velocity.read[2])
    gl.uniform1i(vorticityProg.uniforms.uCurl, curl[2])
    gl.uniform1f(vorticityProg.uniforms.curl, CFG.CURL)
    gl.uniform1f(vorticityProg.uniforms.dt, dt)
    blit(velocity.write[1]); velocity.swap()

    // Divergence
    divProg.bind()
    gl.uniform2f(divProg.uniforms.texelSize, 1/W, 1/H)
    gl.uniform1i(divProg.uniforms.uVelocity, velocity.read[2])
    blit(divergence[1])

    // Clear + solve pressure
    clearProg.bind()
    gl.activeTexture(gl.TEXTURE0 + pressure.read[2])
    gl.bindTexture(gl.TEXTURE_2D, pressure.read[0])
    gl.uniform1i(clearProg.uniforms.uTexture, pressure.read[2])
    gl.uniform1f(clearProg.uniforms.value, CFG.PRESSURE_DISSIPATION)
    blit(pressure.write[1]); pressure.swap()

    pressureProg.bind()
    gl.uniform2f(pressureProg.uniforms.texelSize, 1/W, 1/H)
    gl.uniform1i(pressureProg.uniforms.uDivergence, divergence[2])
    for (let i = 0; i < CFG.PRESSURE_ITERATIONS; i++) {
      gl.activeTexture(gl.TEXTURE0 + pressure.read[2])
      gl.bindTexture(gl.TEXTURE_2D, pressure.read[0])
      gl.uniform1i(pressureProg.uniforms.uPressure, pressure.read[2])
      blit(pressure.write[1]); pressure.swap()
    }

    // Gradient subtract
    gradSubProg.bind()
    gl.uniform2f(gradSubProg.uniforms.texelSize, 1/W, 1/H)
    gl.uniform1i(gradSubProg.uniforms.uPressure, pressure.read[2])
    gl.uniform1i(gradSubProg.uniforms.uVelocity, velocity.read[2])
    blit(velocity.write[1]); velocity.swap()

    // Display to canvas
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    displayProg.bind()
    gl.uniform1i(displayProg.uniforms.uTexture, density.read[2])
    blit(null)
    gl.disable(gl.BLEND)
  }

  // ── Splat queue ────────────────────────────────────────────

  const _queue = []

  function _drainSplats() {
    while (_queue.length) {
      const { x, y, dx, dy } = _queue.shift()
      _splat(x, y, dx, dy)
    }
  }

  function _splat(x, y, dx, dy) {
    splatProg.bind()
    // Velocity splat
    gl.uniform1i(splatProg.uniforms.uTarget, velocity.read[2])
    gl.uniform1f(splatProg.uniforms.aspectRatio, canvas.width / canvas.height)
    gl.uniform2f(splatProg.uniforms.point, x / canvas.width, 1 - y / canvas.height)
    gl.uniform3f(splatProg.uniforms.color, dx, -dy, 0)
    gl.uniform1f(splatProg.uniforms.radius, CFG.SPLAT_RADIUS)
    blit(velocity.write[1]); velocity.swap()
    // Density splat — fixed warm amber color
    gl.uniform1i(splatProg.uniforms.uTarget, density.read[2])
    gl.uniform3f(splatProg.uniforms.color,
      SPLAT_COLOR[0] * 0.28,
      SPLAT_COLOR[1] * 0.28,
      SPLAT_COLOR[2] * 0.28)
    blit(density.write[1]); density.swap()
  }

  // ── Mouse ──────────────────────────────────────────────────

  let mx = 0, my = 0

  window.addEventListener('mousemove', (e) => {
    const dx = (e.clientX - mx) * CFG.SPLAT_FORCE
    const dy = (e.clientY - my) * CFG.SPLAT_FORCE
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      _queue.push({ x: e.clientX, y: e.clientY, dx, dy })
    }
    mx = e.clientX
    my = e.clientY
  })

  // ── Resize ─────────────────────────────────────────────────

  window.addEventListener('resize', () => {
    canvas.width  = canvas.clientWidth
    canvas.height = canvas.clientHeight
    initFBOs()
  })

  // ── Loop ───────────────────────────────────────────────────

  function loop() {
    step()
    requestAnimationFrame(loop)
  }
  loop()
}
