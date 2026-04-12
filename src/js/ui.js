// ─────────────────────────────────────────────────────────────
//  ui.js — All DOM manipulation and user interaction
//
//  Fires custom events on `window` that heroScene.js listens to.
//  No Three.js knowledge here — purely DOM logic.
//
//  Custom events emitted:
//    phos:activate
//    phos:changeBase   detail: { index }
//    phos:changeShade  detail: { index }
//    phos:intensity    detail: { normalised }  (0–1)
//    phos:soundToggle  detail: { muted }
// ─────────────────────────────────────────────────────────────

import gsap from 'gsap'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CONFIG } from './config.js'
import { slideInObjects, animateLightsIn } from './productScene.js'
import { playEntrance }  from './audio.js'

gsap.registerPlugin(ScrollToPlugin, ScrollTrigger)

// ─── State ───────────────────────────────────────────────────

let _activated = false
let _muted     = false

// ─── DOM refs (resolved once in init) ────────────────────────

let $loader, $loaderBar
let $brandMark
let $heroCopy, $beginBtn
let $cornerLogo, $scrollHint
let $mainNav, $menuToggle, $menuItems, $navLinks
let $soundToggle, $waveformPath
let $customPanel
let $baseSwatches, $shadeSwatches
let $lightSlider

// ─── Public ──────────────────────────────────────────────────

/**
 * Cache DOM refs and wire all event listeners.
 * Call once after DOMContentLoaded.
 */
export function initUI() {
  $loader      = document.getElementById('loader')
  $loaderBar   = document.getElementById('loader-bar')
  $brandMark   = document.getElementById('brand-mark')
  $heroCopy    = document.getElementById('hero-copy')
  $beginBtn    = document.getElementById('begin-btn')
  $cornerLogo  = document.getElementById('corner-logo')
  $scrollHint  = document.getElementById('scroll-hint')

  // Lock scroll until the user activates the experience
  document.documentElement.style.overflow = 'hidden'
  $mainNav     = document.getElementById('main-nav')
  $menuToggle  = document.getElementById('menu-toggle')
  $menuItems   = document.getElementById('menu-items')
  $navLinks    = document.querySelectorAll('.nav-link')
  $soundToggle  = document.getElementById('sound-toggle')
  $waveformPath = document.getElementById('waveform-path')
  $customPanel = document.getElementById('custom-panel')
  $baseSwatches  = document.querySelectorAll('.swatch--base')
  $shadeSwatches = document.querySelectorAll('.swatch--shade')
  $lightSlider   = document.getElementById('light-slider')

  // Begin button
  $beginBtn.addEventListener('click', _onBegin)

  // Corner logo — scroll back to top of product stage (customizable section)
  $cornerLogo.addEventListener('click', () => {
    gsap.to(window, {
      scrollTo: { y: '#product-scroll-stage', offsetY: 0 },
      duration: 1.2,
      ease:     'power3.inOut',
    })
  })

  // Menu toggle
  $menuToggle.addEventListener('click', _onMenuToggle)

  // Base swatches
  $baseSwatches.forEach((btn) => {
    btn.addEventListener('click', () => {
      _setActiveBase(parseInt(btn.dataset.base))
    })
  })

  // Shade swatches
  $shadeSwatches.forEach((btn) => {
    btn.addEventListener('click', () => {
      _setActiveShade(parseInt(btn.dataset.shade))
    })
  })

  // Light slider — also drives CSS fill via custom property
  $lightSlider.addEventListener('input', () => {
    const pct        = parseInt($lightSlider.value)
    const normalised = pct / 100
    $lightSlider.style.setProperty('--slider-pct', pct)
    _emit('phos:intensity', { normalised })
  })

  // Set initial slider fill
  $lightSlider.style.setProperty('--slider-pct', $lightSlider.value)

  // Sound toggle
  $soundToggle.addEventListener('click', _onSoundToggle)

  // Nav links → scroll to section frame
  $navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      _scrollToSection(link.dataset.section)
      // Close menu after click
      _menuOpen = true
      _onMenuToggle()
    })
  })
}

/**
 * Update the loader progress bar (0–1).
 */
export function setLoadProgress(ratio) {
  if ($loaderBar) {
    $loaderBar.style.width = `${Math.round(ratio * 100)}%`
  }
}

/**
 * Hide the loader screen with a fade.
 * Returns a promise that resolves after the fade completes.
 */
export function hideLoader() {
  return new Promise((resolve) => {
    gsap.to($loader, {
      opacity:  0,
      duration: CONFIG.animation.loaderFadeOut,
      ease:     'power2.inOut',
      onComplete() {
        $loader.style.display = 'none'
        resolve()
      },
    })
  })
}

/**
 * Reveal the hero overlay (brand mark + copy + button).
 */

export function revealHero() {
  gsap.fromTo(
    [$brandMark, $heroCopy, $beginBtn],
    { opacity: 0, y: 18 },
    {
      opacity:  1,
      y:        0,
      duration: CONFIG.animation.heroOverlayReveal,
      stagger:  0.15,
      ease:     'power3.out',
    }
  )
}

// ─── Private ─────────────────────────────────────────────────

function _onBegin() {
  if (_activated) return
  _activated = true

  // Play entrance sound
  playEntrance()

  // Animate lights from min → max over 3 seconds
  animateLightsIn()

  // Remove canvas blur and dark overlay
  document.getElementById('phos-canvas').classList.add('is-active')
  document.getElementById('hero-dim').classList.add('is-gone')

  // Slide props in immediately on button press
  slideInObjects()

  const dur = CONFIG.animation
  const tl  = gsap.timeline()

  // 1. Fade out entire hero (brand mark + copy + button)
  tl.to([$brandMark, $heroCopy, $beginBtn], {
    opacity:  0,
    duration: 0.5,
    ease:     'power2.in',
    onComplete() {
      $brandMark.style.display = 'none'
      $heroCopy.style.display  = 'none'
      $beginBtn.style.display  = 'none'
    },
  })

  // 2. Fade in corner logo + credits
  tl.fromTo($cornerLogo,
    { opacity: 0, y: -6 },
    { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out', onComplete() { $cornerLogo.classList.add('is-visible') } },
    '-=0.1'
  )
  tl.to(['#credit-studio', '#credit-filamento'], { opacity: 1, duration: 0.6, ease: 'power2.out' }, '-=0.2')

  // 3. Reveal nav
  tl.fromTo(
    $mainNav,
    { opacity: 0, y: -10 },
    {
      opacity:  1,
      y:        0,
      duration: dur.navReveal,
      ease:     'power2.out',
      onStart() { $mainNav.classList.add('is-visible') },
    },
    '-=0.3'
  )

  // 4. Reveal customization panel
  tl.fromTo(
    $customPanel,
    { opacity: 0, x: 20 },
    {
      opacity:  1,
      x:        0,
      duration: dur.panelReveal,
      ease:     'power3.out',
      onStart() { $customPanel.classList.add('is-visible') },
    },
    '-=0.3'
  )

  // Fade in scroll hint
  tl.fromTo($scrollHint,
    { opacity: 0 },
    { opacity: 1, duration: 0.6, ease: 'power2.out' },
    '-=0.2'
  )

  // Unlock scroll
  tl.call(() => {
    window.scrollTo(0, 0)
    document.documentElement.style.overflow = ''
    _emit('phos:activate')
    _startWaveLoop()

  })
}

function _setActiveBase(index) {
  $baseSwatches.forEach(b => b.classList.toggle('active', parseInt(b.dataset.base) === index))
  _emit('phos:changeBase', { index })
}

function _setActiveShade(index) {
  $shadeSwatches.forEach(b => b.classList.toggle('active', parseInt(b.dataset.shade) === index))
  _emit('phos:changeShade', { index })
}

let _menuOpen = false

function _onMenuToggle() {
  _menuOpen = !_menuOpen
  $menuToggle.setAttribute('aria-expanded', _menuOpen)
  $menuItems.classList.toggle('is-open', _menuOpen)
  if (window.innerWidth <= 768) $mainNav.classList.toggle('menu-open', _menuOpen)

  if (_menuOpen) {
    // Animate items in — staggered from top
    gsap.fromTo(
      $navLinks,
      { opacity: 0, x: 16 },
      {
        opacity:  1,
        x:        0,
        duration: 0.45,
        stagger:  0.07,
        ease:     'power2.out',
      }
    )
  } else {
    // Animate items out — all at once, quick
    gsap.to($navLinks, {
      opacity:  0,
      x:        16,
      duration: 0.25,
      ease:     'power2.in',
    })
  }
}

// ── Waveform traveling wave ───────────────────────────────────
// Path spans 3 periods (x=2→50, period=16px).
// Alive: <g> slides left by one period on repeat → seamless travel.
// Calm: travel stops, path flattens back to a line.

const WAVE_FLAT = 'M-14,10 C-11.1,10 -8.9,10 -6,10 C-3.1,10 -0.9,10 2,10 C4.9,10 7.1,10 10,10 C12.9,10 15.1,10 18,10 C20.9,10 23.1,10 26,10 C28.9,10 31.1,10 34,10 C36.9,10 39.1,10 42,10 C44.9,10 47.1,10 50,10'
const WAVE_SINE = 'M-14,10 C-11.1,6 -8.9,6 -6,10 C-3.1,14 -0.9,14 2,10 C4.9,6 7.1,6 10,10 C12.9,14 15.1,14 18,10 C20.9,6 23.1,6 26,10 C28.9,14 31.1,14 34,10 C36.9,6 39.1,6 42,10 C44.9,14 47.1,14 50,10'

let _waveLoopTween = null
let $waveGroup     = null

function _startWaveLoop() {
  if (_waveLoopTween) return
  $waveGroup = $waveGroup || document.getElementById('wave-group')

  // Morph to sine shape
  gsap.to($waveformPath, { duration: 0.7, ease: 'power2.inOut', attr: { d: WAVE_SINE } })

  // Animate SVG transform attribute directly — units are SVG coords (16 = 1 period)
  gsap.set($waveGroup, { attr: { transform: 'translate(0,0)' } })
  _waveLoopTween = gsap.fromTo($waveGroup,
    { attr: { transform: 'translate(0,0)' } },
    { attr: { transform: 'translate(-16,0)' }, duration: 1.4, ease: 'none', repeat: -1 }
  )
}

function _stopWaveLoop() {
  if (_waveLoopTween) { _waveLoopTween.kill(); _waveLoopTween = null }
  $waveGroup = $waveGroup || document.getElementById('wave-group')
  gsap.set($waveGroup, { attr: { transform: 'translate(0,0)' } })
  gsap.to($waveformPath, { attr: { d: WAVE_FLAT }, duration: 1.0, ease: 'power2.inOut' })
}

function _onSoundToggle() {
  _muted = !_muted
  _emit('phos:soundToggle', { muted: _muted })
  if (_muted) _stopWaveLoop()
  else        _startWaveLoop()
}

function _emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

// ── Nav scroll ────────────────────────────────────────────────
// Maps data-section values to the startFrame of each section.
const NAV_FRAMES = {
  overview: 0,
  design:   56,
  details:  132,
  inside:   160,
  custom:   183,
  origin:   253,
}

function _scrollToSection(section) {
  const frame = NAV_FRAMES[section] ?? 0
  const { totalFrames, scrollVH } = CONFIG.scroll

  const stage       = document.getElementById('product-scroll-stage')
  const spacer      = document.getElementById('hero-spacer')
  const spacerH     = spacer ? spacer.offsetHeight : 0
  const stageTop    = spacerH
  const stageHeight = stage ? stage.offsetHeight : (scrollVH * window.innerHeight / 100)

  const targetScroll = stageTop + (frame / totalFrames) * stageHeight

  gsap.to(window, {
    scrollTo: targetScroll,
    duration: 1.2,
    ease:     'power3.inOut',
    onComplete() {
      // Force scroll to exact pixel so scrub lag doesn't leave us off-frame
      window.scrollTo({ top: targetScroll, behavior: 'instant' })
    },
  })
}
