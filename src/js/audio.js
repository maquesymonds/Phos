// ─────────────────────────────────────────────────────────────
//  audio.js — Ambient sound management
//
//  Desktop : Web Audio API (gain node, fade in/out)
//  Mobile  : HTML5 <audio> element — started on the sound-button
//            tap (guaranteed user gesture), avoids iOS restrictions
// ─────────────────────────────────────────────────────────────

const AUDIO_SRC    = '/sounds/Loop.mp3'
const SNAP_SRC     = '/sounds/snap.mp3'
const ENTRANCE_SRC = '/sounds/entrance.mp3'
const FADE_TIME    = 1.2

const _mobile = () => window.innerWidth <= 768

// ── Desktop state (Web Audio API) ────────────────────────────
let _ctx        = null
let _gain       = null
let _loopEl     = null   // <audio> streamed through Web Audio — no full decode
let _snapBuffer = null
let _started    = false
let _unlocked   = false

// ── Mobile state (HTML5 audio) ────────────────────────────────
let _audioEl    = null
let _fadeTimer  = null

// ── Shared ────────────────────────────────────────────────────
let _muted      = false

// ─── Public ──────────────────────────────────────────────────

export function initAudio() {
  window.addEventListener('phos:activate',    _onActivate,    { once: true })
  window.addEventListener('phos:soundToggle', _onSoundToggle)

  // Desktop: create the AudioContext now (it starts suspended). Creating it
  // initialises the audio device (~250ms) — doing that inside the "Begin"
  // click froze the page; unlockAudio() now only resumes it.
  if (!_mobile()) {
    try { _createContext() } catch (err) { console.warn('[PHOS audio] context init failed:', err) }
  }
}

function _createContext() {
  _ctx  = new AudioContext()
  _gain = _ctx.createGain()
  _gain.gain.setValueAtTime(0, _ctx.currentTime)
  _gain.connect(_ctx.destination)
}

export function unlockAudio() {
  if (_mobile()) {
    // Mobile: start HTML5 audio directly inside "Begin experience" tap
    if (_audioEl) return
    _audioEl        = new Audio(AUDIO_SRC)
    _audioEl.loop   = true
    _audioEl.volume = 0
    _audioEl.play()
      .then(() => _fadeVolume(1))
      .catch(err => console.warn('[PHOS audio] mobile autoplay failed:', err))
    return
  }
  if (_unlocked) return
  _unlocked = true
  try {
    if (!_ctx) _createContext()
    _ctx.resume().catch(() => {})
    // Play a silent 1-sample buffer to fully activate the context on iOS
    const buf = _ctx.createBuffer(1, 1, 22050)
    const src = _ctx.createBufferSource()
    src.buffer = buf
    src.connect(_ctx.destination)
    src.start(0)
  } catch (err) {
    console.warn('[PHOS audio] unlock failed:', err)
  }
}

export function playEntrance() {
  if (_mobile()) return   // skip entrance sound on mobile to save the gesture
  const ctx = _ctx
  if (!ctx) return
  fetch(ENTRANCE_SRC)
    .then(r => r.arrayBuffer())
    .then(b => ctx.decodeAudioData(b))
    .then(buffer => {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      if (ctx.state !== 'running') ctx.resume().then(() => src.start(0)).catch(() => {})
      else src.start(0)
    })
    .catch(() => {})
}

export function playSnap() {
  if (_muted || _mobile()) return
  if (!_ctx || !_snapBuffer) return
  const src  = _ctx.createBufferSource()
  const gain = _ctx.createGain()
  src.buffer = _snapBuffer
  gain.gain.setValueAtTime(0.5, _ctx.currentTime)
  src.connect(gain)
  gain.connect(_ctx.destination)
  src.start(0)
}

// ─── Private ─────────────────────────────────────────────────

async function _onActivate() {
  if (_mobile()) return   // mobile audio starts on sound-button tap, not here

  try {
    if (!_ctx) _createContext()
    await _ctx.resume()

    // The ambient loop is long (~3.5 min): decoding it whole would build
    // ~76 MB of PCM right as scroll unlocks. Stream it instead, routed
    // through the same gain node so fades and mute work as before.
    _loopEl      = new Audio(AUDIO_SRC)
    _loopEl.loop = true
    _ctx.createMediaElementSource(_loopEl).connect(_gain)

    _snapBuffer = await fetch(SNAP_SRC).then(r => r.arrayBuffer()).then(b => _ctx.decodeAudioData(b))
    _play()
  } catch (err) {
    console.warn('[PHOS audio] Failed to load audio:', err)
  }
}

function _play() {
  if (_started || !_loopEl || !_ctx) return
  _started = true
  _loopEl.play().catch(err => console.warn('[PHOS audio] loop play failed:', err))
  if (!_muted) {
    _gain.gain.cancelScheduledValues(_ctx.currentTime)
    _gain.gain.setValueAtTime(0, _ctx.currentTime)
    _gain.gain.linearRampToValueAtTime(1, _ctx.currentTime + FADE_TIME)
  }
}

function _onSoundToggle(e) {
  _muted = e.detail.muted

  // ── Mobile: HTML5 <audio> ─────────────────────────────────
  // audio.play() is called directly inside the tap event handler,
  // which is a valid user gesture — no iOS autoplay issues.
  if (_mobile()) {
    if (!_muted) {
      if (!_audioEl) {
        // First unmute: create element and play inside the user gesture
        _audioEl        = new Audio(AUDIO_SRC)
        _audioEl.loop   = true
        _audioEl.volume = 0
        _audioEl.play()
          .then(() => _fadeVolume(1))
          .catch(err => console.warn('[PHOS audio] mobile play failed:', err))
      } else {
        // Subsequent unmute: resume playback then fade in
        _audioEl.volume = 0
        _audioEl.play()
          .then(() => _fadeVolume(1))
          .catch(err => console.warn('[PHOS audio] mobile resume failed:', err))
      }
    } else {
      // Mute: kill any fade in progress, cut volume and pause immediately
      if (_fadeTimer) { clearInterval(_fadeTimer); _fadeTimer = null }
      if (_audioEl) { _audioEl.volume = 0; _audioEl.pause() }
    }
    return
  }

  // ── Desktop: Web Audio API ────────────────────────────────
  if (!_gain || !_ctx) return
  const apply = () => {
    const now = _ctx.currentTime
    _gain.gain.cancelScheduledValues(now)
    _gain.gain.setValueAtTime(_gain.gain.value, now)
    _gain.gain.linearRampToValueAtTime(_muted ? 0 : 1, now + FADE_TIME)
  }
  if (_ctx.state !== 'running') {
    _ctx.resume().then(apply).catch(() => {})
  } else {
    apply()
  }
}

function _fadeVolume(target, onDone) {
  if (!_audioEl) { onDone?.(); return }
  if (_fadeTimer) clearInterval(_fadeTimer)
  const steps    = FADE_TIME * 20
  const stepSize = (target - _audioEl.volume) / steps
  if (stepSize === 0) { onDone?.(); return }
  _fadeTimer = setInterval(() => {
    const next = _audioEl.volume + stepSize
    if ((stepSize > 0 && next >= target) || (stepSize < 0 && next <= target)) {
      _audioEl.volume = Math.max(0, Math.min(1, target))
      clearInterval(_fadeTimer)
      _fadeTimer = null
      onDone?.()
    } else {
      _audioEl.volume = Math.max(0, Math.min(1, next))
    }
  }, 50)
}
