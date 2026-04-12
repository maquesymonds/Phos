// ─────────────────────────────────────────────────────────────
//  audio.js — Ambient sound management
//
//  - Loads /sounds/Loop.mp3 as a looping ambient track
//  - Starts playing when 'phos:activate' fires
//  - Responds to 'phos:soundToggle' to mute / unmute
//  - Uses Web Audio API gain node for smooth fade in/out
// ─────────────────────────────────────────────────────────────

const AUDIO_SRC    = '/sounds/Loop.mp3'
const SNAP_SRC     = '/sounds/snap.mp3'
const ENTRANCE_SRC = '/sounds/entrance.mp3'
const FADE_TIME    = 1.2   // seconds for fade in/out

let _ctx           = null
let _source        = null
let _gain          = null
let _buffer        = null
let _snapBuffer    = null
let _started       = false
let _muted         = false

// ─── Public ──────────────────────────────────────────────────

export function initAudio() {
  window.addEventListener('phos:activate',     _onActivate,    { once: true })
  window.addEventListener('phos:soundToggle',  _onSoundToggle)
}

// ─── Private ─────────────────────────────────────────────────

async function _onActivate() {
  try {
    _ctx    = new AudioContext()
    _gain   = _ctx.createGain()
    _gain.gain.setValueAtTime(0, _ctx.currentTime)
    _gain.connect(_ctx.destination)

    // Load ambient loop, snap, and entrance sounds in parallel
    const [loopBuf, snapBuf] = await Promise.all([
      fetch(AUDIO_SRC).then(r => r.arrayBuffer()).then(b => _ctx.decodeAudioData(b)),
      fetch(SNAP_SRC).then(r => r.arrayBuffer()).then(b => _ctx.decodeAudioData(b)),
    ])
    _buffer     = loopBuf
    _snapBuffer = snapBuf

    _play()
  } catch (err) {
    console.warn('[PHOS audio] Failed to load audio:', err)
  }
}

/**
 * Play the entrance sound immediately on "Begin experience" click.
 * Creates its own AudioContext so it doesn't wait for phos:activate.
 */
export function playEntrance() {
  try {
    const ctx = new AudioContext()
    fetch(ENTRANCE_SRC)
      .then(r => r.arrayBuffer())
      .then(b => ctx.decodeAudioData(b))
      .then(buffer => {
        const src  = ctx.createBufferSource()
        src.buffer = buffer
        src.connect(ctx.destination)
        src.start(0)
      })
      .catch(err => console.warn('[PHOS audio] entrance failed:', err))
  } catch (err) {
    console.warn('[PHOS audio] AudioContext failed:', err)
  }
}

/**
 * Play the snap sound once at low volume.
 * Safe to call even if audio hasn't loaded yet.
 */
export function playSnap() {
  if (!_ctx || !_snapBuffer || _muted) return
  const src = _ctx.createBufferSource()
  src.buffer = _snapBuffer
  const gain = _ctx.createGain()
  gain.gain.setValueAtTime(0.5, _ctx.currentTime)
  src.connect(gain)
  gain.connect(_ctx.destination)
  src.start(0)
}

function _play() {
  if (_started || !_buffer || !_ctx) return
  _started = true

  _source          = _ctx.createBufferSource()
  _source.buffer   = _buffer
  _source.loop     = true
  _source.connect(_gain)
  _source.start(0)

  // Fade in
  _gain.gain.cancelScheduledValues(_ctx.currentTime)
  _gain.gain.setValueAtTime(0, _ctx.currentTime)
  _gain.gain.linearRampToValueAtTime(1, _ctx.currentTime + FADE_TIME)
}

function _onSoundToggle(e) {
  _muted = e.detail.muted
  if (!_gain || !_ctx) return

  const now = _ctx.currentTime
  _gain.gain.cancelScheduledValues(now)
  _gain.gain.setValueAtTime(_gain.gain.value, now)

  if (_muted) {
    _gain.gain.linearRampToValueAtTime(0, now + FADE_TIME)
  } else {
    _gain.gain.linearRampToValueAtTime(1, now + FADE_TIME)
  }
}
