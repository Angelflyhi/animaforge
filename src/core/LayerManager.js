/**
 * AnimaForge - LayerManager
 * Manages all layers in the animation project.
 * Supports shape, text, null, solid, group, and image layer types.
 */

// ─── Tiny EventEmitter ─────────────────────────────────────────────────────

class EventEmitter {
  constructor() { this._listeners = {}; }
  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(l => l !== fn);
  }
  emit(event, ...args) {
    (this._listeners[event] || []).forEach(fn => fn(...args));
  }
}

// ─── ID Generator ──────────────────────────────────────────────────────────

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── Layer Defaults ────────────────────────────────────────────────────────

const BLEND_MODES = [
  'normal','multiply','screen','overlay','darken','lighten',
  'color-dodge','color-burn','hard-light','soft-light',
  'difference','exclusion','hue','saturation','color','luminosity',
];

function defaultTransform() {
  return { x: 0, y: 0, w: 100, h: 100, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 };
}

function defaultFill(color = '#4f8ef7') {
  return {
    type: 'solid',          // 'solid' | 'linear' | 'radial' | 'none'
    color,
    opacity: 1,
    gradient: {
      stops: [
        { offset: 0, color: '#4f8ef7', opacity: 1 },
        { offset: 1, color: '#a855f7', opacity: 1 },
      ],
      angle: 90,
      cx: 0.5, cy: 0.5,    // radial gradient center (0-1)
      r: 0.5,               // radial gradient radius (0-1)
    },
  };
}

function defaultStroke() {
  return {
    color: '#ffffff',
    width: 0,
    opacity: 1,
    cap: 'round',           // 'butt' | 'round' | 'square'
    join: 'round',          // 'miter' | 'round' | 'bevel'
    dash: [],               // [] for solid, [n,m] for dashed
  };
}

function defaultKeyframes() {
  return {
    position:   [],   // [{frame, value:{x,y}, easing}]
    scale:      [],   // [{frame, value:{x,y}, easing}]
    rotation:   [],   // [{frame, value, easing}]
    opacity:    [],   // [{frame, value, easing}]
    fill:       [],   // [{frame, value:{color,opacity}, easing}]
  };
}

/**
 * Build a new layer object with sensible defaults.
 */
function createLayerObject(type, options = {}) {
  const id = options.id || generateId();
  const name = options.name || `${type.charAt(0).toUpperCase() + type.slice(1)} Layer`;

  const base = {
    id,
    name,
    type,                             // 'shape'|'text'|'null'|'solid'|'group'|'image'
    visible: true,
    locked: false,
    solo: false,
    opacity: 1,
    blendMode: 'normal',
    transform: { ...defaultTransform(), ...(options.transform || {}) },
    fill: { ...defaultFill(), ...(options.fill || {}) },
    stroke: { ...defaultStroke(), ...(options.stroke || {}) },
    effects: options.effects || [],
    keyframes: defaultKeyframes(),
    children: [],                     // populated for 'group' type
    // Metadata
    createdAt: Date.now(),
    index: options.index ?? 0,
  };

  // Layer-specific defaults
  switch (type) {
    case 'shape':
      base.shape = {
        kind: options.shapeKind || 'rect',  // 'rect'|'ellipse'|'polygon'|'star'|'path'
        sides: options.sides || 5,          // polygon / star
        innerRadius: options.innerRadius || 0.5,  // star inner/outer ratio
        path: options.path || [],           // SVG-like path commands for 'path' kind
        roundness: options.roundness || 0,  // rect corner radius
      };
      break;

    case 'text':
      base.text = {
        content: options.content || 'Text',
        fontFamily: options.fontFamily || 'Inter, sans-serif',
        fontSize: options.fontSize || 32,
        fontWeight: options.fontWeight || '400',
        fontStyle: options.fontStyle || 'normal',
        textAlign: options.textAlign || 'left',
        letterSpacing: options.letterSpacing || 0,
        lineHeight: options.lineHeight || 1.2,
        verticalAlign: options.verticalAlign || 'top',
      };
      // Text layers don't normally have a stroke on the shape; it goes on the text itself
      base.stroke.width = 0;
      break;

    case 'solid':
      base.fill.color = options.color || '#000000';
      base.fill.type = 'solid';
      // Solid layers cover the full canvas by default
      base.transform.x = 0;
      base.transform.y = 0;
      base.transform.w = options.width || 1920;
      base.transform.h = options.height || 1080;
      break;

    case 'null':
      base.visible = false;           // null layers are invisible by default
      base.fill.type = 'none';
      break;

    case 'group':
      base.fill.type = 'none';
      base.stroke.width = 0;
      break;

    case 'image':
      base.image = {
        src: options.src || '',
        naturalWidth: options.naturalWidth || 0,
        naturalHeight: options.naturalHeight || 0,
        fit: options.fit || 'contain',   // 'contain'|'cover'|'fill'|'none'
        element: null,                   // HTMLImageElement, populated at render time
      };
      break;

    default:
      break;
  }

  return base;
}

// ─── LayerManager ──────────────────────────────────────────────────────────

export class LayerManager extends EventEmitter {
  constructor() {
    super();
    this._layers = [];          // flat ordered array (top = index 0)
    this._selected = new Set(); // selected layer ids
    this._map = new Map();      // id -> layer (quick lookup including nested)
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  /**
   * Add a new layer.
   * @param {string} type  - Layer type
   * @param {Object} opts  - Optional overrides
   * @returns {Object}     - The new layer
   */
  addLayer(type, opts = {}) {
    const layer = createLayerObject(type, { ...opts, index: this._layers.length });
    this._layers.unshift(layer); // add at top (front)
    this._reindex();
    this._mapRegister(layer);
    this.emit('add', layer);
    this.emit('change', this._layers);
    return layer;
  }

  /**
   * Remove a layer by id.
   */
  removeLayer(id) {
    const layer = this._map.get(id);
    if (!layer) return false;

    this._layers = this._removeFromList(this._layers, id);
    this._reindex();
    this._mapUnregister(layer);
    this._selected.delete(id);
    this.emit('remove', layer);
    this.emit('change', this._layers);
    return true;
  }

  /**
   * Duplicate a layer (deep clone, new ids).
   */
  duplicateLayer(id) {
    const src = this._map.get(id);
    if (!src) return null;

    const clone = this._deepCloneLayer(src);
    clone.name = src.name + ' Copy';

    const srcIdx = this._layers.findIndex(l => l.id === id);
    this._layers.splice(srcIdx, 0, clone);
    this._reindex();
    this._mapRegister(clone);
    this.emit('add', clone);
    this.emit('change', this._layers);
    return clone;
  }

  /**
   * Get a layer by id (includes nested children).
   */
  getLayer(id) {
    return this._map.get(id) || null;
  }

  /**
   * Get the parent of a layer by its ID.
   */
  getParentLayer(childId) {
    return this._findParent(this._layers, childId);
  }

  _findParent(layers, childId) {
    for (const layer of layers) {
      if (layer.children) {
        if (layer.children.some(c => c.id === childId)) {
          return layer;
        }
        const parent = this._findParent(layer.children, childId);
        if (parent) return parent;
      }
    }
    return null;
  }

  /**
   * Get all top-level layers in order (index 0 = top/front).
   */
  getAllLayers() {
    return [...this._layers];
  }

  /**
   * Get layer order index.
   */
  getLayerIndex(id) {
    return this._layers.findIndex(l => l.id === id);
  }

  // ─── Ordering ────────────────────────────────────────────────────────────

  /**
   * Move a layer to an absolute index position.
   */
  moveLayer(id, newIndex) {
    const idx = this._layers.findIndex(l => l.id === id);
    if (idx === -1) return false;
    const [layer] = this._layers.splice(idx, 1);
    const clampedIdx = Math.max(0, Math.min(newIndex, this._layers.length));
    this._layers.splice(clampedIdx, 0, layer);
    this._reindex();
    this.emit('change', this._layers);
    return true;
  }

  /**
   * Move a layer one step forward (lower index = closer to front).
   */
  reorderLayer(id, direction) {
    const idx = this._layers.findIndex(l => l.id === id);
    if (idx === -1) return false;
    let newIdx = idx;
    if (direction === 'up' || direction === 'forward')   newIdx = idx - 1;
    if (direction === 'down' || direction === 'backward') newIdx = idx + 1;
    if (newIdx < 0 || newIdx >= this._layers.length) return false;
    return this.moveLayer(id, newIdx);
  }

  // ─── Grouping ────────────────────────────────────────────────────────────

  /**
   * Group multiple layers into a new group layer.
   * @param {string[]} ids - Layer ids to group
   * @returns {Object}     - The new group layer
   */
  groupLayers(ids) {
    if (!ids || ids.length < 1) return null;

    const members = ids.map(id => this._map.get(id)).filter(Boolean);
    if (members.length === 0) return null;

    // Compute bounding box of group
    const xs = members.flatMap(l => [l.transform.x, l.transform.x + l.transform.w]);
    const ys = members.flatMap(l => [l.transform.y, l.transform.y + l.transform.h]);
    const x = Math.min(...xs), y = Math.min(...ys);
    const w = Math.max(...xs) - x, h = Math.max(...ys) - y;

    const group = createLayerObject('group', {
      name: 'Group',
      transform: { x, y, w, h, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 },
    });

    // Find the topmost index among selected layers
    const indices = members.map(m => this._layers.findIndex(l => l.id === m.id)).filter(i => i >= 0);
    const insertIdx = Math.min(...indices);

    // Remove members from top-level list, add as children
    members.forEach(m => {
      this._layers = this._removeFromList(this._layers, m.id);
      group.children.push(m);
      this._selected.delete(m.id);
    });

    this._layers.splice(insertIdx, 0, group);
    this._reindex();
    this._mapRegister(group);
    this.emit('add', group);
    this.emit('change', this._layers);
    return group;
  }

  /**
   * Ungroup a group layer, promoting its children back to the top level.
   */
  ungroupLayer(id) {
    const group = this._map.get(id);
    if (!group || group.type !== 'group') return false;

    const idx = this._layers.findIndex(l => l.id === id);
    this._layers.splice(idx, 1);

    const children = [...group.children];
    children.reverse().forEach((child, i) => {
      this._layers.splice(idx, 0, child);
      this._mapRegister(child);
    });

    this._mapUnregister(group);
    this._reindex();
    this.emit('remove', group);
    this.emit('change', this._layers);
    return children;
  }

  // ─── Properties ──────────────────────────────────────────────────────────

  /**
   * Set a nested property on a layer using dot-notation path.
   * e.g. setLayerProperty(id, 'transform.x', 100)
   *      setLayerProperty(id, 'fill.gradient.stops', [...])
   */
  setLayerProperty(id, path, value) {
    const layer = this._map.get(id);
    if (!layer) return false;

    const parts = path.split('.');
    let obj = layer;
    for (let i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] === undefined) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;

    this.emit('change', this._layers);
    return true;
  }

  /**
   * Get a nested property using dot-notation path.
   */
  getLayerProperty(id, path) {
    const layer = this._map.get(id);
    if (!layer) return undefined;
    return path.split('.').reduce((obj, key) => obj && obj[key], layer);
  }

  // ─── Hit Testing ─────────────────────────────────────────────────────────

  /**
   * Returns the topmost visible, unlocked layer at canvas coordinate (x, y).
   * Simple AABB test – the RenderEngine handles precise pixel testing.
   */
  getLayerAt(x, y) {
    return this._findLayerAt(this._layers, x, y);
  }

  _findLayerAt(layers, x, y) {
    for (const layer of layers) {
      if (!layer.visible || layer.locked) continue;

      const t = layer.transform || { x: 0, y: 0, w: 100, h: 100, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 };

      // 1. If it is a group, recursively check children first (higher priority)
      if (layer.type === 'group' && layer.children && layer.children.length > 0) {
        const px = t.x + t.w * (t.anchorX ?? 0.5);
        const py = t.y + t.h * (t.anchorY ?? 0.5);

        // Translate relative to pivot
        const dx = x - px;
        const dy = y - py;

        // Rotate back (inverse rotation)
        const rad = -(t.rotation || 0) * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        let rx = dx * cos - dy * sin;
        let ry = dx * sin + dy * cos;

        // Scale back
        rx /= (t.scaleX || 1);
        ry /= (t.scaleY || 1);

        // Translate back to group local space
        const localX = rx + px;
        const localY = ry + py;

        const hitChild = this._findLayerAt(layer.children, localX, localY);
        if (hitChild) return hitChild;
      }

      // 2. Direct hit test on this layer
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
        return layer;
      }
    }
    return null;
  }

  // ─── Selection ───────────────────────────────────────────────────────────

  /**
   * Select a layer. Pass multi=true to add to selection.
   */
  selectLayer(id, multi = false) {
    if (!multi) this._selected.clear();
    if (id) {
      if (this._selected.has(id)) {
        if (multi) this._selected.delete(id); // toggle
      } else {
        this._selected.add(id);
      }
    }
    this.emit('select', this.getSelectedLayers());
    return this.getSelectedLayers();
  }

  deselectAll() {
    this._selected.clear();
    this.emit('select', []);
  }

  getSelectedLayers() {
    return [...this._selected]
      .map(id => this._map.get(id))
      .filter(Boolean);
  }

  isSelected(id) {
    return this._selected.has(id);
  }

  getSelectedIds() {
    return [...this._selected];
  }

  selectAll() {
    this._layers.forEach(l => this._selected.add(l.id));
    this.emit('select', this.getSelectedLayers());
  }

  clear() {
    this._layers = [];
    this._map.clear();
    this._selected.clear();
    this.emit('change', this._layers);
  }

  /** Import a raw layer object (used when loading projects / pasting) */
  importLayer(data) {
    if (!data || !data.id) {
      data = { ...data, id: generateId() };
    }
    // Remove from map if already exists
    if (this._map.has(data.id)) this.removeLayer(data.id);
    this._layers.unshift(data);
    this._reindex();
    this._mapRegister(data);
    this.emit('add', data);
    this.emit('change', this._layers);
    return data;
  }

  // ─── Serialization ───────────────────────────────────────────────────────

  serialize() {
    return JSON.parse(JSON.stringify(this._layers));
  }

  deserialize(data) {
    this._layers = [];
    this._map.clear();
    this._selected.clear();

    const registerAll = (list) => {
      list.forEach(layer => {
        this._map.set(layer.id, layer);
        if (layer.children && layer.children.length > 0) {
          registerAll(layer.children);
        }
      });
    };

    this._layers = data;
    registerAll(data);
    this._reindex();
    this.emit('change', this._layers);
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  _reindex() {
    this._layers.forEach((l, i) => { l.index = i; });
  }

  _removeFromList(list, id) {
    return list.filter(l => l.id !== id);
  }

  _mapRegister(layer) {
    this._map.set(layer.id, layer);
    if (layer.children) {
      layer.children.forEach(child => this._mapRegister(child));
    }
  }

  _mapUnregister(layer) {
    this._map.delete(layer.id);
    if (layer.children) {
      layer.children.forEach(child => this._mapUnregister(child));
    }
  }

  _deepCloneLayer(layer) {
    const clone = JSON.parse(JSON.stringify(layer));
    // Assign new ids recursively
    const assignIds = (l) => {
      l.id = generateId();
      if (l.children) l.children.forEach(assignIds);
    };
    assignIds(clone);
    return clone;
  }
}

export { createLayerObject, generateId, BLEND_MODES };
export default LayerManager;
