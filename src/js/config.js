// ─────────────────────────────────────────────────────────────
//  config.js — All tuneable values for the PHOS experience
//  Edit this file to change copy, colors, timing, and 3D values
// ─────────────────────────────────────────────────────────────

export const CONFIG = {

  // ── Copy ────────────────────────────────────────────────────
  copy: {
    brandName:   'PHOS',
    brandSub:    'Lamp',
    tagline:     'Light for slower moments',
    description: 'Designed to bring calm into space',
    ctaLabel:    'Begin experience',
  },

  // ── Navigation labels ────────────────────────────────────────
  nav: ['Overview', 'Design', 'Details', 'Inside', 'Custom', 'Origin'],

  // ── Asset paths ──────────────────────────────────────────────
  assets: {
    model: '/models/Phos_Scroll.glb',
  },

  // ── Lighting ─────────────────────────────────────────────────
  lighting: {
    ambientColor:     0xfff4e0,
    ambientIntensity: 1.8,      // ← warm global fill so the trunk isn't pure black

    warmLightColor:    0xffcf80,
    warmLightIntensity: 1.4,
    warmLightPosition:  { x: 0.5, y: 2.0, z: 0.5 },

    fillLightColor:     0xffd4a0,  // warm fill from the side
    fillLightIntensity: 1.2,       // ← lights the trunk from outside
    fillLightPosition:  { x: -2, y: 1, z: 2 },

    activationIntensityMultiplier: 1.15,

    sliderMin: 0.0,
    sliderMax: 3.0,
  },

  // ── Scene background ─────────────────────────────────────────
  // Warm dark brown that reads as a room, not a void.
  // Tweak this hex until it feels right with the lamp.
  backgroundColor: 0x2a1f14,

  // ── Customization: base materials (hex tints) ────────────────
  bases: [
    { label: 'Brass',       color: 0xC8A97E },
    { label: 'Matte Black', color: 0x2C2C2C },
    { label: 'Chalk',       color: 0xE8E0D5 },
  ],

  // ── Customization: shade materials (hex tints) ───────────────
  shades: [
    { label: 'Linen', color: 0xF5EDD8 },
    { label: 'Noir',  color: 0x1A1A1A },
  ],

  // ── Animation durations (seconds) ────────────────────────────
  animation: {
    loaderFadeOut:      0.6,
    heroOverlayReveal:  1.0,
    brandMarkShrink:    0.8,
    navReveal:          0.5,
    panelReveal:        0.6,
    lightShift:         1.2,
  },

  // ── Bulb light ───────────────────────────────────────────────
  // PointLight placed at the 'bulb' node. Always on, ramps up during
  // the tooltip section (frames rampStart → rampEnd).
  bulbLight: {
    color:         0xffcc66,
    baseIntensity: 2.5,     // bulb is the main light source
    peakIntensity: 5.0,     // reached at rampEnd
    rampFrameStart: 110,
    rampFrameEnd:   140,
    distance:       0.8,    // very short reach — only illuminates shade interior
    decay:          4,      // steep falloff
  },

  // ── Bloom ────────────────────────────────────────────────────
  bloom: {
    strength:  0.5,   // enough for a warm halo around the shade
    radius:    0.6,   // wider spread = softer halo
    threshold: 0.75,  // catches the shade emissive + bulb but not the wood
  },

  // ── Three.js renderer ────────────────────────────────────────
  renderer: {
    antialias: true,
    alpha:     false,
    toneMapping:         'ACESFilmic',
    toneMappingExposure: 0.9,
    shadowMapEnabled:    true,
    // Atmosphere shader resolution, relative to CSS pixels (not device pixels).
    // The fog is soft, so it renders off-screen at this scale and is
    // upscaled — on Retina, 0.5 shades 1/16 of the pixels.
    backgroundScale:     0.5,
  },

  // ── Camera zoom ──────────────────────────────────────────────
  // Multiplies the FOV extracted from the GLB camera.
  // < 1.0 = zoom in (telephoto). 0.7 = 30% tighter, appears much closer.
  // 1.0 = original Blender FOV. Does NOT affect the animation path.
  cameraFovMultiplier:       0.68,  // desktop zoom
  cameraFovMultiplierMobile: 1.1,   // mobile zoom — higher = more zoomed out

  // ── Camera fallback (used only if model has no camera) ───────
  cameraFallback: {
    fov:      45,
    near:     0.1,
    far:      100,
    position: { x: 0, y: 1.4, z: 3.5 },
    target:   { x: 0, y: 0.8, z: 0 },
  },

  // ── Base snap points ─────────────────────────────────────────
  // When scroll is within `radius` frames of `frame`, the animation
  // locks to that exact frame and shows a label with the base name.
  // radius: ← tweak to make the magnetic zone wider or narrower.
  baseSnaps: [
    { frame: 215, label: 'Helios', radius: 14 },
    { frame: 241, label: 'Eos',    radius: 14 },
    { frame: 270, label: 'Apolo',  radius: 14 },
  ],

  // ── Scroll animation ─────────────────────────────────────────
  // Edit totalFrames and scrollVH to adjust timing and scroll length.
  // Edit sections[].startFrame / endFrame to shift when text appears.
  scroll: {
    totalFrames: 300,   // total frames in Phos_Scroll.glb animation
    scrollVH:    700,   // height of the scroll stage in vh units

    // ── Timeline sections ──────────────────────────────────────
    // hasText: true   → text overlay is shown during this range
    // id must match   → <div id="text-{id}"> in the HTML
    sections: [
      { id: 'intro',    startFrame: 0,   endFrame: 25,  hasText: false },
      { id: 'design',   startFrame: 25,  endFrame: 72,  hasText: true  },
      { id: 'material', startFrame: 72,  endFrame: 144, hasText: true  },
      { id: 'details',  startFrame: 144, endFrame: 178, hasText: true  },
      { id: 'custom',   startFrame: 178, endFrame: 240, hasText: true  },
      { id: 'origin',   startFrame: 240, endFrame: 266, hasText: true  },
    ],
  },

  // ── Scroll section copy ───────────────────────────────────────
  // Edit heading and lines here. Section IDs match scroll.sections[].id
  scrollCopy: {
    design: {
      heading: 'Designed with intention',
      lines: [
        'Every proportion is deliberate.',
        'Guided by balance, refined through simplicity.',
        'Nothing is arbitrary.',
      ],
    },
    material: {
      heading: 'Material defines experience',
      lines: [
        'Solid wood.',
        'Natural texture.',
        'A warmth you don\'t just see — you feel.',
      ],
    },
    details: {
      heading: 'Nothing overlooked',
      lines: [
        'Every joint, every connection, every transition',
        'is resolved with care.',
        'Precision is part of the design.',
      ],
    },
    custom: {
      heading: 'Yours to choose',
      lines: [
        'Three bases. Two shades.',
        'Each combination is its own object.',
        'Make it fit the space — and the person.',
      ],
    },
    origin: {
      heading: 'Designed and<br>made in Uruguay',
      lines: [
        'Locally developed.',
        'Carefully produced.',
        'Consistency, quality, and intention',
        'in every piece.',
      ],
    },
  },

  // ── Scene tooltips ────────────────────────────────────────────
  // Tooltips follow real 3D nodes and appear at specific frames.
  // node: name of the Object3D in the GLTF to use as anchor.
  //       Check the browser console on first load for a full node list.
  // frameIn / frameOut: frame range during which the tooltip is visible.
  // text: the label shown (title only, no subtitle).
  // offset: world-space Y offset applied on top of the node's position.
  tooltips: [
    {
      id:        'tip-wood',
      node:      'base1',
      frameIn:   79,
      frameOut:  160,
      text:      'Jequitibá solid wood',
      offset:    { x: 0, y: 0, z: 0 },
      lineOffset: { x: 280, y: 80 },   // ← line goes right-down to label
    },
    {
      id:        'tip-shade',
      node:      'shade_01',
      frameIn:   110,
      frameOut:  160,
      text:      'Translucent shade',
      offset:    { x: 0, y: 0, z: 0 },
      lineOffset: { x: -260, y: -100 }, // ← line goes left-up to label
    },
    {
      id:        'tip-bulb',
      node:      'bulb',
      frameIn:   140,
      frameOut:  160,
      text:      'Warm light core',
      offset:    { x: 0, y: 0, z: 0 },
      lineOffset: { x: 480, y: -80 },  // ← line goes right-up to label
    },
  ],

  // ── Gallery (context section after animation) ─────────────────
  gallery: {
    heading: 'Made for<br>living spaces',
    lines: [
      'From quiet corners',
      'to shared rooms.',
      'From arrival',
      'to rest.',
    ],
    cards: [
      { label: 'Bedroom'     },
      { label: 'Living Room' },
      { label: 'Library'     },
      { label: 'Hallway'     },
      { label: 'Study'       },
    ],
  },
}