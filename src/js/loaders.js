// ─────────────────────────────────────────────────────────────
//  loaders.js — Asset loading utilities
//  Wraps GLTFLoader in a clean promise interface.
//  onProgress(ratio: 0–1) is optional.
// ─────────────────────────────────────────────────────────────

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'

// Shared loader instances (created once, reused)
let _gltfLoader = null

function getGLTFLoader() {
  if (_gltfLoader) return _gltfLoader

  const draco = new DRACOLoader()
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')

  _gltfLoader = new GLTFLoader()
  _gltfLoader.setDRACOLoader(draco)

  return _gltfLoader
}

/**
 * Load a GLB/GLTF file.
 *
 * @param {string} path — public asset path e.g. '/models/Escena_placeholder.glb'
 * @param {function} [onProgress] — called with ratio (0–1) as file loads
 * @returns {Promise<{ scene: THREE.Group, cameras: THREE.Camera[], animations: THREE.AnimationClip[] }>}
 */
export function loadGLB(path, onProgress) {
  return new Promise((resolve, reject) => {
    const loader = getGLTFLoader()

    loader.load(
      path,

      // onLoad
      (gltf) => {
        resolve({
          scene:      gltf.scene,
          cameras:    gltf.cameras,
          animations: gltf.animations,
        })
      },

      // onProgress
      (event) => {
        if (onProgress && event.lengthComputable) {
          const ratio = event.loaded / event.total
          onProgress(Math.min(ratio, 1))
        }
      },

      // onError
      (error) => {
        console.error('[PHOS loaders] Failed to load GLB:', path, error)
        reject(error)
      }
    )
  })
}
