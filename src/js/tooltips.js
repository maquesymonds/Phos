// ─────────────────────────────────────────────────────────────
//  tooltips.js — 3D-anchored scene tooltips with line + label
//
//  Each tooltip has three parts:
//    · dot    — fixed at the 3D anchor point on the model
//    · line   — SVG line from dot to label
//    · label  — text positioned at dot + cfg.lineOffset (px)
//
//  Public API:
//    initTooltips(animDuration)  — build DOM, register tick
//    setTooltipFrame(frame)      — called by scroll.js on every update
// ─────────────────────────────────────────────────────────────

import * as THREE from 'three'
import { CONFIG }               from './config.js'
import { getCamera, getNodeByName } from './productScene.js'
import { onTick }               from './scene.js'

// ─── Module state ────────────────────────────────────────────

const _tips = []
const _box  = new THREE.Box3()
let _currentFrame = 0
let _debugLogged  = false

// ─── Public ──────────────────────────────────────────────────

export function initTooltips(_animDuration) {
  const cfgs = CONFIG.tooltips
  if (!cfgs || cfgs.length === 0) return

  const container = _getOrCreateContainer()
  const svg       = _getOrCreateSVG()

  cfgs.forEach((cfg) => {
    const node = getNodeByName(cfg.node)
    if (!node) console.warn(`[PHOS tooltips] Node "${cfg.node}" not found for "${cfg.id}".`)

    const { dot, label, line } = _buildElements(cfg, svg, container)

    _tips.push({
      cfg,
      dot,
      label,
      line,
      node,
      worldPos:  new THREE.Vector3(),
      boxCenter: new THREE.Vector3(),
      visible:   false,
    })
  })

  onTick(_tick)
}

export function setTooltipFrame(frame) {
  _currentFrame = frame
  window.__phosFrame = Math.round(frame)
}

// ─── Private ─────────────────────────────────────────────────

function _tick() {
  const camera = getCamera()
  if (!camera) return

  if (!_debugLogged) {
    _debugLogged = true
    _tips.forEach(({ cfg, node }) => {
      if (!node) console.warn(`[PHOS tooltips] ⚠ "${cfg.node}" not found.`)
    })
  }

  _tips.forEach((tip) => {
    const { cfg, dot, label, line, node, worldPos, boxCenter } = tip
    const shouldShow = _currentFrame >= cfg.frameIn && _currentFrame < cfg.frameOut

    // Toggle visibility
    if (shouldShow !== tip.visible) {
      tip.visible = shouldShow
      const opacity = shouldShow ? '1' : '0'
      dot.style.opacity   = opacity
      label.style.opacity = opacity
      // Line only on desktop
      if (window.innerWidth > 768) line.style.opacity = opacity
    }

    if (!shouldShow || !node) return

    // Get world position from bounding box center
    _box.setFromObject(node)
    if (_box.isEmpty()) node.getWorldPosition(worldPos)
    else { _box.getCenter(boxCenter); worldPos.copy(boxCenter) }

    worldPos.x += cfg.offset.x
    worldPos.y += cfg.offset.y
    worldPos.z += cfg.offset.z

    const ndc = worldPos.clone().project(camera)
    if (ndc.z > 1) { dot.style.opacity = '0'; label.style.opacity = '0'; line.style.opacity = '0'; return }

    // Dot screen position
    const dx = ( ndc.x * 0.5 + 0.5) * window.innerWidth
    const dy = (-ndc.y * 0.5 + 0.5) * window.innerHeight

    dot.style.left = `${dx}px`
    dot.style.top  = `${dy}px`

    const isMobile = window.innerWidth <= 768

    if (isMobile) {
      // Mobile: label sits directly next to the dot, no line
      label.style.left      = `${dx + 10}px`
      label.style.top       = `${dy}px`
      label.style.transform = 'translate(0, -50%)'
      line.style.opacity    = '0'   // always hidden on mobile
    } else {
      // Desktop: label at lineOffset, connected by SVG line
      const lo = cfg.lineOffset ?? { x: 160, y: -60 }
      const lx = dx + lo.x
      const ly = dy + lo.y

      label.style.left      = `${lx}px`
      label.style.top       = `${ly}px`
      label.style.transform = lo.x < 0 ? 'translate(-100%, -50%)' : 'translate(0, -50%)'

      line.setAttribute('x1', dx)
      line.setAttribute('y1', dy)
      line.setAttribute('x2', lx)
      line.setAttribute('y2', ly)
    }
  })
}

function _getOrCreateContainer() {
  let el = document.getElementById('scene-tooltip-layer')
  if (!el) {
    el = document.createElement('div')
    el.id = 'scene-tooltip-layer'
    document.body.appendChild(el)
  }
  return el
}

function _getOrCreateSVG() {
  let svg = document.getElementById('scene-tooltip-svg')
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.id = 'scene-tooltip-svg'
    svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:17;overflow:visible'
    document.body.appendChild(svg)
  }
  return svg
}

function _buildElements(cfg, svg, container) {
  // Dot
  const dot = document.createElement('div')
  dot.className = 'scene-tooltip-dot-anchor'
  container.appendChild(dot)

  // Label
  const label = document.createElement('div')
  label.className   = 'scene-tooltip-label'
  label.textContent = cfg.text
  container.appendChild(label)

  // SVG line
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line.setAttribute('stroke', 'rgba(255,244,224,0.5)')
  line.setAttribute('stroke-width', '0.8')
  line.style.opacity    = '0'
  line.style.transition = 'opacity 0.45s ease'
  svg.appendChild(line)

  return { dot, label, line }
}
