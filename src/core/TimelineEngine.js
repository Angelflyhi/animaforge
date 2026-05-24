/**
 * AnimaForge - TimelineEngine
 * Frame-based animation timeline with keyframe interpolation.
 * Uses cubic-bezier easing and requestAnimationFrame for playback.
 */

// ─── Tiny EventEmitter ─────────────────────────────────────────────────────

class EventEmitter {
  constructor() { this._listeners = {}; }
  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(l => l !== fn);
    }
  }
  emit(event, ...args) {
    (this._listeners[event] || []).forEach(fn => fn(...args));
  }
}

// ─── Easing Functions ──────────────────────────────────────────────────────

/**
 * Cubic bezier solver (same as CSS cubic-bezier).
 * Uses Newton-Raphson iteration.
 */
function cubicBezier(x1, y1, x2, y2) {
  const NEWTON_ITERATIONS = 4;
  const NEWTON_MIN_SLOPE = 0.001;
  const SUBDIVISION_PRECISION = 1e-7;
  const SUBDIVISION_MAX_ITER = 10;
  const kSplineTableSize = 11;
  const kSampleStepSize = 1.0 / (kSplineTableSize - 1);

  function A(a1, a2) { return 1.0 - 3.0 * a2 + 3.0 * a1; }
  function B(a1, a2) { return 3.0 * a2 - 6.0 * a1; }
  function C(a1)     { return 3.0 * a1; }

  function calcBezier(t, a1, a2) {
    return ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  }

  function getSlope(t, a1, a2) {
    return 3.0 * A(a1, a2) * t * t + 2.0 * B(a1, a2) * t + C(a1);
  }

  // Precompute sample table
  const sampleValues = new Float32Array(kSplineTableSize);
  if (x1 !== y1 || x2 !== y2) {
    for (let i = 0; i < kSplineTableSize; i++) {
      sampleValues[i] = calcBezier(i * kSampleStepSize, x1, x2);
    }
  }

  function getTForX(aX) {
    let intervalStart = 0.0;
    let currentSample = 1;
    const lastSample = kSplineTableSize - 1;

    for (; currentSample !== lastSample && sampleValues[currentSample] <= aX; currentSample++) {
      intervalStart += kSampleStepSize;
    }
    currentSample--;

    const dist = (aX - sampleValues[currentSample]) / (sampleValues[currentSample + 1] - sampleValues[currentSample]);
    let guessForT = intervalStart + dist * kSampleStepSize;

    const initialSlope = getSlope(guessForT, x1, x2);
    if (initialSlope >= NEWTON_MIN_SLOPE) {
      for (let i = 0; i < NEWTON_ITERATIONS; i++) {
        const currentSlope = getSlope(guessForT, x1, x2);
        if (currentSlope === 0.0) break;
        guessForT -= (calcBezier(guessForT, x1, x2) - aX) / currentSlope;
      }
      return guessForT;
    } else if (initialSlope === 0.0) {
      return guessForT;
    } else {
      // Binary subdivision
      let aA = intervalStart, aB = intervalStart + kSampleStepSize, currentT;
      let i = 0;
      do {
        currentT = aA + (aB - aA) / 2.0;
        const xEst = calcBezier(currentT, x1, x2) - aX;
        if (xEst > 0.0) aB = currentT;
        else aA = currentT;
      } while (Math.abs(calcBezier(currentT, x1, x2) - aX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITER);
      return currentT;
    }
  }

  if (x1 === y1 && x2 === y2) return t => t; // linear shortcut
  return t => {
    if (t === 0 || t === 1) return t;
    return calcBezier(getTForX(t), y1, y2);
  };
}

// Named easing presets → [x1, y1, x2, y2]
const EASING_PRESETS = {
  'linear':       [0.00, 0.00, 1.00, 1.00],
  'ease':         [0.25, 0.10, 0.25, 1.00],
  'ease-in':      [0.42, 0.00, 1.00, 1.00],
  'ease-out':     [0.00, 0.00, 0.58, 1.00],
  'ease-in-out':  [0.42, 0.00, 0.58, 1.00],
  'bounce':       [0.36, 0.07, 0.19, 0.97],
  'elastic':      [0.68,-0.55, 0.27, 1.55],
};

/**
 * Resolve an easing specifier to an easing function (t => t).
 * @param {string|number[]|null} easing
 */
function resolveEasing(easing) {
  if (!easing || easing === 'linear') return t => t;
  if (typeof easing === 'string' && EASING_PRESETS[easing]) {
    const [x1, y1, x2, y2] = EASING_PRESETS[easing];
    return cubicBezier(x1, y1, x2, y2);
  }
  if (Array.isArray(easing) && easing.length === 4) {
    return cubicBezier(...easing);
  }
  return t => t;
}

// ─── Keyframe Interpolation ────────────────────────────────────────────────

/**
 * Interpolate a scalar value between keyframes at a given frame.
 * @param {Array}  keyframes - [{frame, value, easing}] sorted by frame
 * @param {number} frame
 * @returns {*} interpolated value
 */
function interpolateScalar(keyframes, frame) {
  if (!keyframes || keyframes.length === 0) return undefined;
  if (keyframes.length === 1) return keyframes[0].value;

  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  // Before first keyframe
  if (frame <= sorted[0].frame) return sorted[0].value;
  // After last keyframe
  if (frame >= sorted[sorted.length - 1].frame) return sorted[sorted.length - 1].value;

  // Find surrounding keyframes
  let prev = sorted[0], next = sorted[1];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].frame > frame) {
      prev = sorted[i - 1];
      next = sorted[i];
      break;
    }
  }

  const range = next.frame - prev.frame;
  if (range === 0) return next.value;
  const rawT = (frame - prev.frame) / range;
  const easeFn = resolveEasing(next.easing || 'linear');
  const t = easeFn(rawT);

  // Scalar interpolation
  if (typeof prev.value === 'number' && typeof next.value === 'number') {
    return prev.value + (next.value - prev.value) * t;
  }

  // Object interpolation (e.g., {x, y})
  if (typeof prev.value === 'object' && prev.value !== null) {
    const result = {};
    for (const key of Object.keys(prev.value)) {
      const a = prev.value[key], b = next.value[key];
      result[key] = typeof a === 'number' ? a + (b - a) * t : b;
    }
    return result;
  }

  // Fallback: step interpolation
  return rawT < 1 ? prev.value : next.value;
}

/**
 * Interpolate a color string (#rrggbb) between two keyframes.
 */
function interpolateColor(keyframes, frame) {
  if (!keyframes || keyframes.length === 0) return undefined;
  if (keyframes.length === 1) return keyframes[0].value;

  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return sorted[0].value;
  if (frame >= sorted[sorted.length - 1].frame) return sorted[sorted.length - 1].value;

  let prev = sorted[0], next = sorted[1];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].frame > frame) {
      prev = sorted[i - 1]; next = sorted[i]; break;
    }
  }

  const range = next.frame - prev.frame;
  const rawT = range === 0 ? 1 : (frame - prev.frame) / range;
  const easeFn = resolveEasing(next.easing || 'linear');
  const t = easeFn(rawT);

  const hexToRgb = hex => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  };

  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const [r1, g1, b1] = hexToRgb(prev.value.color || '#ffffff');
  const [r2, g2, b2] = hexToRgb(next.value.color || '#ffffff');
  const r = lerp(r1, r2, t), g = lerp(g1, g2, t), b = lerp(b1, b2, t);
  const toHex = n => n.toString(16).padStart(2, '0');
  const opacity = prev.value.opacity + (next.value.opacity - prev.value.opacity) * t;
  return { color: `#${toHex(r)}${toHex(g)}${toHex(b)}`, opacity };
}

// ─── TimelineEngine ────────────────────────────────────────────────────────

export class TimelineEngine extends EventEmitter {
  /**
   * @param {Object} options
   * @param {number} [options.fps=30]
   * @param {number} [options.totalFrames=300]
   */
  constructor({ fps = 30, totalFrames = 300 } = {}) {
    super();

    this._fps = fps;
    this._totalFrames = totalFrames;
    this._currentFrame = 0;
    this._isPlaying = false;
    this._isLooping = true;

    // Playback internals
    this._rafId = null;
    this._lastTimestamp = null;
    this._frameAccumulator = 0; // fractional frames accumulated

    // Keyframe store: { layerId: { propName: [{frame, value, easing}] } }
    this._keyframes = new Map();
  }

  // ─── Properties ──────────────────────────────────────────────────────────

  get currentFrame() { return this._currentFrame; }
  get totalFrames()  { return this._totalFrames; }
  get fps()          { return this._fps; }
  get isPlaying()    { return this._isPlaying; }
  get isLooping()    { return this._isLooping; }
  set isLooping(v)   { this._isLooping = !!v; }

  get currentTime()  { return this._currentFrame / this._fps; }
  get duration()     { return this._totalFrames / this._fps; }

  // ─── Playback Control ─────────────────────────────────────────────────────

  play() {
    if (this._isPlaying) return;
    this._isPlaying = true;
    this._lastTimestamp = null;
    this._frameAccumulator = 0;
    this._rafId = requestAnimationFrame(this._tick.bind(this));
    this.emit('play', this._currentFrame);
  }

  pause() {
    if (!this._isPlaying) return;
    this._isPlaying = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.emit('pause', this._currentFrame);
  }

  stop() {
    this.pause();
    this._currentFrame = 0;
    this._frameAccumulator = 0;
    this.emit('stop', 0);
    this.emit('frame', 0);
  }

  togglePlay() {
    if (this._isPlaying) this.pause();
    else this.play();
  }

  // ─── Frame Navigation ─────────────────────────────────────────────────────
  setFrame(n) {
    if (n === undefined || n === null || isNaN(n)) return;
    const clamped = Math.max(0, Math.min(Math.floor(n), this._totalFrames - 1));
    if (clamped !== this._currentFrame) {
      this._currentFrame = clamped;
      this.emit('frame', clamped);
    }
  }

  nextFrame() { this.setFrame(this._currentFrame + 1); }
  prevFrame() { this.setFrame(this._currentFrame - 1); }

  // ─── Settings ─────────────────────────────────────────────────────────────

  setFps(n) {
    if (n <= 0) throw new Error('FPS must be > 0');
    this._fps = n;
    this.emit('settings', { fps: n });
  }

  setDuration(frames) {
    if (frames <= 0) throw new Error('Duration must be > 0 frames');
    this._totalFrames = Math.floor(frames);
    if (this._currentFrame >= this._totalFrames) {
      this.setFrame(this._totalFrames - 1);
    }
    this.emit('settings', { totalFrames: this._totalFrames });
  }

  // ─── Keyframes ────────────────────────────────────────────────────────────

  /**
   * Add or update a keyframe.
   * @param {string} layerId
   * @param {string} prop      - 'position' | 'scale' | 'rotation' | 'opacity' | 'fill'
   * @param {number} frame
   * @param {*}      value
   * @param {string|number[]} easing - preset name or [x1,y1,x2,y2]
   */
  addKeyframe(layerId, prop, frame, value, easing = 'linear') {
    if (!this._keyframes.has(layerId)) {
      this._keyframes.set(layerId, {});
    }
    const layerKf = this._keyframes.get(layerId);
    if (!layerKf[prop]) layerKf[prop] = [];

    // Remove existing keyframe at same frame
    layerKf[prop] = layerKf[prop].filter(kf => kf.frame !== frame);
    layerKf[prop].push({ frame, value, easing });
    layerKf[prop].sort((a, b) => a.frame - b.frame);

    this.emit('keyframeAdded', { layerId, prop, frame, value, easing });
    return true;
  }

  removeKeyframe(layerId, prop, frame) {
    const layerKf = this._keyframes.get(layerId);
    if (!layerKf || !layerKf[prop]) return false;
    const before = layerKf[prop].length;
    layerKf[prop] = layerKf[prop].filter(kf => kf.frame !== frame);
    if (layerKf[prop].length !== before) {
      this.emit('keyframeRemoved', { layerId, prop, frame });
      return true;
    }
    return false;
  }

  /**
   * Get all keyframes for a layer.
   * @returns {Object|null} { position:[], scale:[], rotation:[], opacity:[], fill:[] }
   */
  getKeyframesForLayer(layerId) {
    return this._keyframes.get(layerId) || null;
  }

  /**
   * Get all keyframe data (for serialization).
   */
  getAllKeyframes() {
    const result = {};
    this._keyframes.forEach((kf, layerId) => {
      result[layerId] = JSON.parse(JSON.stringify(kf));
    });
    return result;
  }

  /**
   * Restore keyframe data (for deserialization).
   */
  loadKeyframes(data) {
    this._keyframes.clear();
    Object.entries(data).forEach(([layerId, kf]) => {
      this._keyframes.set(layerId, kf);
    });
  }

  // ─── Interpolation ────────────────────────────────────────────────────────

  /**
   * Interpolate a single property for a layer at a given frame.
   * @param {string} layerId
   * @param {string} prop    - 'position' | 'scale' | 'rotation' | 'opacity' | 'fill'
   * @param {number} frame
   * @returns {*} interpolated value, or undefined if no keyframes
   */
  interpolateValue(layerId, prop, frame) {
    const layerKf = this._keyframes.get(layerId);
    if (!layerKf || !layerKf[prop] || layerKf[prop].length === 0) return undefined;

    if (prop === 'fill') {
      return interpolateColor(layerKf[prop], frame);
    }
    return interpolateScalar(layerKf[prop], frame);
  }

  /**
   * Get all interpolated values for a layer at a given frame.
   * Returns an object with position, scale, rotation, opacity, and fill
   * only for properties that have keyframes.
   * @param {string} layerId
   * @param {number} frame
   * @returns {Object}
   */
  getAnimatedState(layerId, frame) {
    const layerKf = this._keyframes.get(layerId);
    if (!layerKf) return {};

    const state = {};
    const props = ['position', 'scale', 'rotation', 'opacity', 'fill'];
    props.forEach(prop => {
      if (layerKf[prop] && layerKf[prop].length > 0) {
        const val = this.interpolateValue(layerId, prop, frame);
        if (val !== undefined) state[prop] = val;
      }
    });
    return state;
  }

  /**
   * Returns true if any animated prop differs at two frames.
   * Used to detect animated layers for timeline indicators.
   */
  isLayerAnimated(layerId) {
    const layerKf = this._keyframes.get(layerId);
    if (!layerKf) return false;
    return Object.values(layerKf).some(arr => arr.length > 1);
  }

  /**
   * Get all frames that have at least one keyframe for a layer.
   * @returns {number[]} sorted list of frame numbers
   */
  getKeyframedFrames(layerId) {
    const layerKf = this._keyframes.get(layerId);
    if (!layerKf) return [];
    const frames = new Set();
    Object.values(layerKf).forEach(arr => arr.forEach(kf => frames.add(kf.frame)));
    return [...frames].sort((a, b) => a - b);
  }

  // ─── Serialization ────────────────────────────────────────────────────────

  serialize() {
    return {
      fps: this._fps,
      totalFrames: this._totalFrames,
      currentFrame: this._currentFrame,
      isLooping: this._isLooping,
      keyframes: this.getAllKeyframes(),
    };
  }

  deserialize(data) {
    this._fps = data.fps ?? 30;
    this._totalFrames = data.totalFrames ?? 300;
    this._currentFrame = data.currentFrame ?? 0;
    this._isLooping = data.isLooping ?? true;
    if (data.keyframes) this.loadKeyframes(data.keyframes);
    this.emit('frame', this._currentFrame);
  }

  /** Alias for getAllKeyframes - for project save */
  exportKeyframes() { return this.getAllKeyframes(); }

  /** Alias for loadKeyframes - for project load */
  importKeyframes(data) { this.loadKeyframes(data); }

  // ─── Animation Loop ───────────────────────────────────────────────────────

  _tick(timestamp) {
    if (!this._isPlaying) return;

    if (this._lastTimestamp === null) {
      this._lastTimestamp = timestamp;
    }

    const elapsed = timestamp - this._lastTimestamp;
    this._lastTimestamp = timestamp;

    // Accumulate fractional frames
    this._frameAccumulator += (elapsed / 1000) * this._fps;

    while (this._frameAccumulator >= 1) {
      this._frameAccumulator -= 1;
      let nextFrame = this._currentFrame + 1;

      if (nextFrame >= this._totalFrames) {
        if (this._isLooping) {
          nextFrame = 0;
        } else {
          this.pause();
          this._currentFrame = this._totalFrames - 1;
          this.emit('frame', this._currentFrame);
          return;
        }
      }

      this._currentFrame = nextFrame;
      this.emit('frame', nextFrame);
    }

    this._rafId = requestAnimationFrame(this._tick.bind(this));
  }
}

export { resolveEasing, interpolateScalar, interpolateColor, cubicBezier, EASING_PRESETS };
export default TimelineEngine;
