// ─────────────────────────────────────────────────────────────
//  scroll.js — GSAP ScrollTrigger: animation scrubbing + text sync
//
//  Responsibilities:
//    - Map scroll progress → animation time via setAnimationTime()
//    - Fade environment meshes out in the first 15% of scroll
//    - Fade text overlays in/out at the right frame ranges
//    - Drive the horizontal gallery pin after the animation ends
//
//  Frame ranges are defined in CONFIG.scroll.sections.
//  Text copy is defined in CONFIG.scrollCopy.
//
//  Waits for BOTH 'phos:productReady' AND 'phos:activate' before
//  wiring any ScrollTrigger.
// ─────────────────────────────────────────────────────────────

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { CONFIG } from './config.js'
import { playSnap } from './audio.js'
import { setAnimationTime, getAnimationDuration, setEnvironmentOpacity, setBulbIntensity, updateBaseVisibility } from './productScene.js'
import { setBackgroundOpacity } from './background.js'
import { setTooltipFrame } from './tooltips.js'

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin)

// ─── Public ──────────────────────────────────────────────────

let _productReady = false
let _activated    = false

/**
 * Set up scroll triggers.
 * Waits for BOTH the GLTF to load AND the user to click
 * "Begin experience" before wiring any ScrollTrigger.
 */
export function initScroll() {
  window.addEventListener('phos:productReady', () => {
    _productReady = true
    _trySetup()
  }, { once: true })

  window.addEventListener('phos:activate', () => {
    _activated = true
    _trySetup()
  }, { once: true })
}

function _trySetup() {
  if (_productReady && _activated) _setup()
}

export function refreshScroll() {
  ScrollTrigger.refresh()
}

// ─── Private ─────────────────────────────────────────────────

function _setup() {
  // Ensure environment meshes are fully visible before first scroll
  setEnvironmentOpacity(1)
  _buildTextOverlays()
  _setupMainScrubber()
  _setupTextTriggers()
  _setupCustomPanel()
  _setupScrollHint()
  _setupMobileHeaderVeil()
  _setupGallery()
  _setupReturnTransition()
  console.log('[PHOS scroll] ScrollTrigger ready. Duration:', getAnimationDuration().toFixed(3) + 's')
}

// ── Main animation scrubber ───────────────────────────────────
//
// Maps scroll progress through #product-scroll-stage to:
//   1. GLTF animation time (full range)
//   2. Environment opacity (fades out in first 15% of scroll)
//
// scrub: 0.8 adds a small lag for a cinematic feel.

// ── Bulb scroll lock ──────────────────────────────────────────
// When the animation enters the bulb zone, scroll input is
// suppressed for BULB_LOCK_MS ms so the user sees all 3 tooltips.


// ── Base snap label ───────────────────────────────────────────

let _snapLabelEl   = null
let _activeSnap    = null

function _initSnapLabel() {
  const el = document.createElement('div')
  el.id = 'phos-snap-label'
  const isMobile = window.innerWidth <= 768
  Object.assign(el.style, {
    position:      'fixed',
    bottom:        isMobile ? 'auto' : '60px',
    top:           isMobile ? '15vh' : 'auto',
    left:          '50%',
    transform:     'translateX(-50%)',
    zIndex:        '9998',
    fontFamily:    'Aeonik, Helvetica Neue, sans-serif',
    fontSize:      isMobile ? '20px' : '26px',
    fontWeight:    '200',
    letterSpacing: '0.04em',
    textTransform: 'none',
    color:         '#fff',
    opacity:       '0',
    pointerEvents: 'none',
  })
  document.body.appendChild(el)
  return el
}

function _showSnapLabel(label) {
  if (!_snapLabelEl) return
  _snapLabelEl.textContent = label
  gsap.killTweensOf(_snapLabelEl)
  gsap.to(_snapLabelEl, { opacity: 1, duration: 0.3, ease: 'power2.out' })
}

function _hideSnapLabel() {
  if (!_snapLabelEl) return
  gsap.killTweensOf(_snapLabelEl)
  gsap.to(_snapLabelEl, { opacity: 0, duration: 0.25, ease: 'power2.in' })
}

// ── Debug frame overlay ───────────────────────────────────────
// Shows current frame in the top-right corner while scrolling.
// Remove this function and its call when no longer needed.

function _initFrameDebug() {
  const el = document.createElement('div')
  el.id = 'phos-frame-debug'
  Object.assign(el.style, {
    position:   'fixed',
    bottom:     '16px',
    left:       '16px',
    zIndex:     '9999',
    fontFamily: 'monospace',
    fontSize:   '13px',
    color:      '#fff',
    background: 'rgba(0,0,0,0.55)',
    padding:    '4px 10px',
    borderRadius: '4px',
    pointerEvents: 'none',
  })
  document.body.appendChild(el)
  return el
}

function _setupMainScrubber() {
  const debugEl      = _initFrameDebug()
  _snapLabelEl       = _initSnapLabel()
  const snaps        = CONFIG.baseSnaps ?? []
  const { totalFrames }  = CONFIG.scroll
  const { rampFrameStart, rampFrameEnd } = CONFIG.bulbLight

  // ── Snap on scroll stop ──────────────────────────────────────
  // Direction-aware: only snaps if you're scrolling toward the snap
  // point, so scrolling backward never gets caught by a forward snap.
  let _snapIdleTimer = null
  let _lastScrollY   = window.scrollY
  let _scrollDir     = 0   // +1 = forward, -1 = backward

  window.addEventListener('scroll', () => {
    const currentY = window.scrollY
    _scrollDir = currentY >= _lastScrollY ? 1 : -1
    _lastScrollY = currentY

    clearTimeout(_snapIdleTimer)
    _snapIdleTimer = setTimeout(() => {
      const st = ScrollTrigger.getById('main-scrubber')
      if (!st) return

      const currentFrame = st.progress * totalFrames

      for (const snap of snaps) {
        if (Math.abs(currentFrame - snap.frame) <= snap.radius) {
          if (_activeSnap === snap) break

          // Only snap if moving toward this point
          const goingToward = _scrollDir >= 0
            ? currentFrame <= snap.frame   // forward: haven't passed it yet
            : currentFrame >= snap.frame   // backward: haven't gone below it yet
          if (!goingToward) break

          const targetProgress = snap.frame / totalFrames
          const targetScroll   = st.start + targetProgress * (st.end - st.start)

          _activeSnap = snap
          playSnap()

          gsap.to(window, {
            scrollTo:  targetScroll,
            duration:  0.6,
            ease:      'power3.out',
            onStart()    { _showSnapLabel(snap.label) },
            onComplete() { _showSnapLabel(snap.label) },
          })
          break
        } else if (_activeSnap === snap) {
          _activeSnap = null
          _hideSnapLabel()
        }
      }
    }, 120)
  }, { passive: true })

  ScrollTrigger.create({
    id:      'main-scrubber',
    trigger: '#product-scroll-stage',
    start:   'top top',
    end:     'bottom bottom',
    scrub:   0.8,

    onUpdate(self) {
      const progress     = self.progress
      const currentFrame = progress * totalFrames

      // Scrub animation
      setAnimationTime(progress * getAnimationDuration())

      // Sync tooltip frame
      setTooltipFrame(currentFrame)

      // Fade environment out during first 15% of scroll
      const FADE_END = 0.15
      const t = Math.min(progress / FADE_END, 1)
      setEnvironmentOpacity(1 - t)

      // Debug overlay
      debugEl.textContent = `frame: ${Math.round(currentFrame)}`


      // Base swap at frame 192
      updateBaseVisibility(currentFrame)

      // Bulb intensity ramp (0→1 from rampFrameStart to rampFrameEnd)
      const rampT = Math.max(0, Math.min(1,
        (currentFrame - rampFrameStart) / (rampFrameEnd - rampFrameStart)
      ))
      setBulbIntensity(rampT)

    },
  })
}

// ── Text overlay triggers ─────────────────────────────────────

function _setupTextTriggers() {
  const { totalFrames, sections } = CONFIG.scroll
  const BUFFER = 2

  sections.forEach((section) => {
    if (!section.hasText) return

    const el = document.getElementById(`text-${section.id}`)
    if (!el) return

    const startPct = (section.startFrame / totalFrames) * 100
    const endPct   = (section.endFrame   / totalFrames) * 100

    ScrollTrigger.create({
      trigger:   '#product-scroll-stage',
      start:     `top+=${startPct + BUFFER}% top`,
      end:       `top+=${endPct   - BUFFER}% top`,

      onEnter()     { _showText(el) },
      onLeave()     { _hideText(el) },
      onEnterBack() { _showText(el) },
      onLeaveBack() { _hideText(el) },
    })
  })
}

function _showText(el) {
  gsap.killTweensOf(el)
  gsap.to(el, { opacity: 1, y: 0,   duration: 0.75, ease: 'power2.out' })
}

function _hideText(el) {
  gsap.killTweensOf(el)
  gsap.to(el, { opacity: 0, y: -16, duration: 0.55, ease: 'power2.in' })
}

// ── Scroll hint visibility ────────────────────────────────────

function _setupMobileHeaderVeil() {
  if (window.innerWidth > 768) return
  const veil = document.getElementById('mobile-header-veil')
  if (!veil) return

  const { totalFrames } = CONFIG.scroll
  const HIDE_FRAME = 20
  const hidePct = (HIDE_FRAME / totalFrames) * 100

  ScrollTrigger.create({
    trigger: '#product-scroll-stage',
    start:   `top+=${hidePct}% top`,
    onEnter()     { veil.classList.add('hidden') },
    onLeaveBack() { veil.classList.remove('hidden') },
  })
}

function _setupScrollHint() {
  const hint = document.getElementById('scroll-hint')
  if (!hint) return

  const { totalFrames } = CONFIG.scroll
  const HIDE_FRAME = 10
  const hidePct = (HIDE_FRAME / totalFrames) * 100

  ScrollTrigger.create({
    trigger: '#product-scroll-stage',
    start:   `top+=${hidePct}% top`,

    onEnter() {
      gsap.to(hint, { opacity: 0, duration: 1.2, ease: 'power2.out', onComplete() {
        hint.style.pointerEvents = 'none'
      }})
    },
    onLeaveBack() {
      hint.style.pointerEvents = 'none'
      gsap.to(hint, { opacity: 1, duration: 0.6, ease: 'power2.out' })
    },
  })
}

// ── Customization panel visibility ───────────────────────────
//
// Panel is visible only during the intro section (frames 0–25).
// Fades out when scroll passes the intro end and stays hidden.

function _setupCustomPanel() {
  const panel = document.getElementById('custom-panel')
  if (!panel) return

  const { totalFrames } = CONFIG.scroll
  const HIDE_FRAME = 10
  const endPct = (HIDE_FRAME / totalFrames) * 100

  ScrollTrigger.create({
    trigger: '#product-scroll-stage',
    start:   `top+=${endPct}% top`,

    onEnter() {
      // scrolled past intro — hide panel
      gsap.to(panel, { opacity: 0, duration: 0.5, ease: 'power2.in', onComplete() {
        panel.style.pointerEvents = 'none'
      }})
    },
    onLeaveBack() {
      // scrolled back into intro — show panel
      panel.style.pointerEvents = 'all'
      gsap.to(panel, { opacity: 1, duration: 0.5, ease: 'power2.out' })
    },
  })
}

// ── Gallery horizontal scroll ─────────────────────────────────

// ── Gallery + loop ────────────────────────────────────────────
//
// A single pinned ScrollTrigger drives two phases:
//
//   Phase 1 — horizontal track slide (travel pixels of scroll)
//     The gallery track translates left until the loop card
//     is centered in the viewport.
//
//   Phase 2 — loop card scale-up (scaleRoom pixels of scroll)
//     The loop card scales from gallery-card size to fullscreen.
//     Simultaneously the 3D animation rewinds to frame 0 and
//     the environment fades back in.
//
//   onLeave — invisible reset
//     When Phase 2 completes the loop card covers the viewport.
//     At that exact moment a scroll-to-top + transform reset
//     executes so the experience loops from the beginning.
//
// ← tweak: SCALE_VH controls scroll room for the scale phase.
// ← tweak: scrub value on the ScrollTrigger controls lag feel.

let _isLooping = false

function _setupGallery() {
  const section = document.getElementById('gallery-section')
  const track   = document.getElementById('gallery-track')
  if (!section || !track) return

  requestAnimationFrame(() => {
    section.classList.add('gallery-ready')

    const travel = Math.max(0, track.scrollWidth - window.innerWidth)

    gsap.timeline({
      scrollTrigger: {
        trigger:       '#gallery-section',
        start:         'top top',
        end:           `+=${travel}`,
        pin:           true,
        scrub:         1,
        anticipatePin: 1,

        onUpdate(self) {
          const bgOpacity = Math.max(0, 1 - self.progress * 2)
          const textLayer = document.getElementById('scroll-text-layer')
          setBackgroundOpacity(bgOpacity)
          if (textLayer) textLayer.style.opacity = bgOpacity

          // Trigger loop while still pinned — before pin can release
          if (self.progress >= 0.995 && !_isLooping) {
            _isLooping = true

            // Freeze track at its final position
            gsap.set(track, { x: -travel })

            // Block all scrolling immediately
            document.documentElement.style.overflow = 'hidden'
            document.body.style.overflow            = 'hidden'

            // Start fade while section is still pinned and frozen
            _doLoopReset(track)
          }
        },

        onLeave() {},
      },
    }).to(track, { x: -travel, ease: 'none', duration: travel })
  })
}

function _doLoopReset(track) {
  const veil      = document.getElementById('scene-veil')
  const textLayer = document.getElementById('scroll-text-layer')

  // Phase 1: fade to black while gallery is still pinned and frozen
  gsap.to(veil, {
    opacity:  1,
    duration: 0.8,
    ease:     'power2.inOut',
    onComplete() {
      // Phase 2: reset all state while screen is black
      setAnimationTime(0)
      setEnvironmentOpacity(1)
      setBackgroundOpacity(1)
      setTooltipFrame(0)
      updateBaseVisibility(0)
      if (textLayer) textLayer.style.opacity = '1'

      // Reset gallery track
      gsap.set(track, { x: 0 })

      // Jump to top instantly — veil covers everything
      window.scrollTo({ top: 0, behavior: 'instant' })

      // Two frames for layout to settle
      requestAnimationFrame(() => requestAnimationFrame(() => {
        // Restore scrolling
        document.documentElement.style.overflow = ''
        document.body.style.overflow            = ''
        ScrollTrigger.refresh()

        // Phase 3: fade back in
        gsap.to(veil, {
          opacity:  0,
          duration: 0.8,
          ease:     'power2.inOut',
          onComplete() { _isLooping = false },
        })
      }))
    },
  })
}

function _setupReturnTransition() {
  // no-op — loop handled by _doLoopReset inside gallery onUpdate
}

// ── Text overlay builder ──────────────────────────────────────

function _buildTextOverlays() {
  const layer = document.getElementById('scroll-text-layer')
  if (!layer) return

  const { sections } = CONFIG.scroll
  const { scrollCopy } = CONFIG

  sections.forEach((section) => {
    if (!section.hasText) return
    const copy = scrollCopy[section.id]
    if (!copy) return

    const div = document.createElement('div')
    div.id        = `text-${section.id}`
    div.className = 'scroll-text-block'

    const h = document.createElement('h2')
    h.className   = 'scroll-text-heading'
    h.innerHTML   = copy.heading
    div.appendChild(h)

    copy.lines.forEach((line) => {
      const p = document.createElement('p')
      p.className   = 'scroll-text-line'
      p.textContent = line
      div.appendChild(p)
    })

    layer.appendChild(div)
  })
}

