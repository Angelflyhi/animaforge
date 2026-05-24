/**
 * AnimaForge - RenderEngine
 * High-performance canvas renderer for all layer types.
 * Handles transforms, fills, strokes, blending, gradients, and selection handles.
 */

// ─── Constants ─────────────────────────────────────────────────────────────

const HANDLE_SIZE = 8;
const HANDLE_COLOR = '#4f8ef7';
const SELECTION_COLOR = 'rgba(79, 142, 247, 0.85)';
const SELECTION_FILL = 'rgba(79, 142, 247, 0.08)';
const GRID_COLOR = 'rgba(255,255,255,0.06)';
const CHECKERBOARD_SIZE = 16;

// ─── Utilities ─────────────────────────────────────────────────────────────

function hexToRgba(hex, alpha = 1) {
  if (!hex) return `rgba(0,0,0,${alpha})`;
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function degToRad(deg) { return (deg * Math.PI) / 180; }

// ─── RenderEngine ──────────────────────────────────────────────────────────

export class RenderEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} options
   * @param {number} [options.canvasWidth=1920]
   * @param {number} [options.canvasHeight=1080]
   */
  constructor(canvas, overlayCanvas, layerManager, timelineEngine) {
    // Support both new-style (4 args) and old-style (canvas, options) calls
    if (typeof overlayCanvas === 'object' && !(overlayCanvas instanceof HTMLCanvasElement)) {
      // Called as (canvas, options)
      const opts = overlayCanvas || {};
      overlayCanvas = null;
      layerManager = opts.layerManager || null;
      timelineEngine = opts.timelineEngine || null;
    }
    if (!canvas) throw new Error('RenderEngine: canvas element is required');
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._overlayCanvas = overlayCanvas;
    this._canvasWidth = 512;
    this._canvasHeight = 512;

    // Viewport state
    this._zoom = 1;
    this._offsetX = 0;
    this._offsetY = 0;

    // Display options
    this._gridVisible = false;
    this._showCheckerboard = true;
    this._backgroundColor = '#1a1a2e';
    this._transparent = false;

    // External references
    this._layerManager = layerManager || null;
    this._timelineEngine = timelineEngine || null;

    // Image cache: layerId -> HTMLImageElement
    this._imageCache = new Map();

    // Selection handles cache
    this._selectionHandles = [];

    this._initCheckerboard();
  }

  // ─── Configuration ───────────────────────────────────────────────────────

  setLayerManager(lm)    { this._layerManager = lm; }
  setTimelineEngine(te)  { this._timelineEngine = te; }
  setCanvasSize(w, h)    { this._canvasWidth = w; this._canvasHeight = h; }
  setBackgroundColor(c)  { this._backgroundColor = c; }
  setTransparent(b)      { this._transparent = !!b; }
  setGridVisible(b)      { this._gridVisible = !!b; }

  /** Set background color and transparency - used by EditorEngine */
  setBackground(color, transparent = false) {
    this._backgroundColor = color || '#1a1a2e';
    this._transparent = transparent;
  }

  /** Resize the canvas to new project dimensions */
  resize(w, h) {
    if (w && h) {
      this._canvasWidth = w;
      this._canvasHeight = h;
    }
    const canvas = this._canvas;
    if (canvas) {
      canvas.width = this._canvasWidth;
      canvas.height = this._canvasHeight;
    }
    if (this._overlayCanvas) {
      this._overlayCanvas.width = this._canvasWidth;
      this._overlayCanvas.height = this._canvasHeight;
    }
  }

  setZoom(level) {
    this._zoom = Math.max(0.05, Math.min(level, 20));
  }

  setOffset(x, y) {
    this._offsetX = x;
    this._offsetY = y;
  }

  get zoom()    { return this._zoom; }
  get offsetX() { return this._offsetX; }
  get offsetY() { return this._offsetY; }
  get offset()  { return { x: this._offsetX, y: this._offsetY }; }

  /** Hit-test resize handles for a layer at canvas coordinates */
  hitTestHandle(layer, x, y) {
    for (const h of this._selectionHandles) {
      if (h.layer && h.layer.id === layer.id) {
        const { x: sx, y: sy } = this.canvasToScreen(x, y);
        const dx = sx - h.screenX, dy = sy - h.screenY;
        if (Math.abs(dx) <= HANDLE_SIZE + 2 && Math.abs(dy) <= HANDLE_SIZE + 2) {
          return h.name;
        }
      }
    }
    return null;
  }

  // ─── Coordinate Transforms ───────────────────────────────────────────────

  /** Convert screen coordinates → canvas (project) coordinates. */
  screenToCanvas(sx, sy) {
    return {
      x: (sx - this._offsetX) / this._zoom,
      y: (sy - this._offsetY) / this._zoom,
    };
  }

  /** Convert canvas (project) coordinates → screen coordinates. */
  canvasToScreen(cx, cy) {
    return {
      x: cx * this._zoom + this._offsetX,
      y: cy * this._zoom + this._offsetY,
    };
  }

  // ─── Hit Testing ─────────────────────────────────────────────────────────

  /**
   * Returns the topmost layer hit at screen coordinates (x, y).
   * Uses the selection handles first, then AABB test in canvas space.
   * @returns {{ layer, handle } | null}
   */
  hitTest(sx, sy) {
    // Check selection handles first
    for (const handle of this._selectionHandles) {
      const dx = sx - handle.screenX, dy = sy - handle.screenY;
      if (Math.abs(dx) <= HANDLE_SIZE && Math.abs(dy) <= HANDLE_SIZE) {
        return { handle: handle.name, layer: handle.layer };
      }
    }

    if (!this._layerManager) return null;
    const { x, y } = this.screenToCanvas(sx, sy);
    const hit = this._layerManager.getLayerAt(x, y);
    return hit ? { layer: hit, handle: null } : null;
  }

  // ─── Main Render ─────────────────────────────────────────────────────────

  /**
   * Render the entire scene at a given frame.
   * @param {number} frame
   */
  render(frame) {
    const canvas = this._canvas;
    const ctx = this._ctx;
    const cssW = canvas.width;
    const cssH = canvas.height;

    // Clear
    ctx.clearRect(0, 0, cssW, cssH);

    // Background
    if (this._transparent) {
      if (!this._checkerPattern) {
        this._checkerPattern = ctx.createPattern(this._checkerPatternCanvas, 'repeat');
      }
      ctx.fillStyle = this._checkerPattern || 'transparent';
      ctx.fillRect(0, 0, cssW, cssH);
    } else {
      ctx.fillStyle = '#111118';
      ctx.fillRect(0, 0, cssW, cssH);
    }

    // Apply viewport transform
    ctx.save();
    ctx.translate(this._offsetX, this._offsetY);
    ctx.scale(this._zoom, this._zoom);

    // Draw canvas background / shadow
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 32;
    ctx.fillStyle = this._transparent ? 'transparent' : this._backgroundColor;
    ctx.fillRect(0, 0, this._canvasWidth, this._canvasHeight);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // Grid
    if (this._gridVisible) this._drawGrid(ctx);

    // Render layers (bottom to top – reversed since index 0 is front)
    if (this._layerManager) {
      const layers = [...this._layerManager.getAllLayers()].reverse();
      layers.forEach(layer => this.renderLayer(layer, ctx, frame));
    }

    ctx.restore();

    // Draw selection handles in screen space
    this._selectionHandles = [];
    if (this._layerManager) {
      this._layerManager.getSelectedLayers().forEach(layer => {
        this.drawSelectionHandles(layer, ctx, frame);
      });
    }
  }

  // ─── Layer Rendering ─────────────────────────────────────────────────────

  /**
   * Render a single layer (and its children if it's a group).
   */
  renderLayer(layer, ctx, frame) {
    if (!layer.visible) return;

    ctx.save();

    // Apply global opacity + blend mode
    ctx.globalAlpha = Math.max(0, Math.min(layer.opacity, 1));
    if (layer.blendMode && layer.blendMode !== 'normal') {
      ctx.globalCompositeOperation = layer.blendMode;
    }

    // Apply animated transform
    this.applyTransform(layer, ctx, frame);

    switch (layer.type) {
      case 'shape':
        this.renderShape(layer, ctx, frame);
        break;
      case 'text':
        this.renderText(layer, ctx, frame);
        break;
      case 'image':
        this.renderImage(layer, ctx, frame);
        break;
      case 'solid':
        this._renderSolid(layer, ctx, frame);
        break;
      case 'null':
        if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
          this._renderNullLayer(layer, ctx);
        }
        break;
      case 'group':
        // Render children recursively
        if (layer.children && layer.children.length > 0) {
          [...layer.children].reverse().forEach(child => this.renderLayer(child, ctx, frame));
        }
        break;
      default:
        break;
    }

    ctx.restore();
  }

  // ─── Shape Rendering ─────────────────────────────────────────────────────

  /**
   * Render a shape layer. Reads layer.shape.kind.
   */
  renderShape(layer, ctx, frame) {
    const t = layer.transform;
    const { kind } = layer.shape || { kind: 'rect' };

    ctx.beginPath();

    switch (kind) {
      case 'rect':
        this._pathRect(ctx, t, layer.shape.roundness || 0);
        break;
      case 'ellipse':
        this._pathEllipse(ctx, t);
        break;
      case 'polygon':
        this._pathPolygon(ctx, t, layer.shape.sides || 5);
        break;
      case 'star':
        this._pathStar(ctx, t, layer.shape.sides || 5, layer.shape.innerRadius || 0.5);
        break;
      case 'path':
        this._pathCustom(ctx, t, layer.shape.path || []);
        break;
      default:
        this._pathRect(ctx, t, 0);
        break;
    }

    this.applyFill(layer, ctx, frame);
    this.applyStroke(layer, ctx, frame);
  }

  /** Render a text layer. */
  renderText(layer, ctx, frame) {
    const t = layer.transform;
    const txt = layer.text || {};
    const content = txt.content || '';

    const fillState = this._getAnimatedFill(layer, frame);
    const fontSize = (txt.fontSize || 32);
    const fontWeight = txt.fontWeight || '400';
    const fontStyle = txt.fontStyle || 'normal';
    const fontFamily = txt.fontFamily || 'Inter, sans-serif';

    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = txt.textAlign || 'left';
    ctx.textBaseline = 'top';
    ctx.letterSpacing = `${txt.letterSpacing || 0}px`;

    // Fill
    if (fillState.type !== 'none') {
      const fillStyle = this._buildFillStyle(ctx, fillState, t);
      ctx.fillStyle = fillStyle;
      this._wrapText(ctx, content, t.x, t.y, t.w, (txt.fontSize || 32) * (txt.lineHeight || 1.2));
    }

    // Stroke
    if (layer.stroke.width > 0) {
      ctx.strokeStyle = hexToRgba(layer.stroke.color, layer.stroke.opacity);
      ctx.lineWidth = layer.stroke.width;
      this._wrapText(ctx, content, t.x, t.y, t.w, (txt.fontSize || 32) * (txt.lineHeight || 1.2), true);
    }
  }

  /** Render an image layer. */
  renderImage(layer, ctx, frame) {
    const t = layer.transform;
    const imgData = layer.image || {};

    if (!imgData.src) return;

    // Load and cache image
    let img = this._imageCache.get(layer.id);
    if (!img) {
      img = new Image();
      img.src = imgData.src;
      img.onload = () => { this._imageCache.set(layer.id, img); };
      this._imageCache.set(layer.id, img);
      return; // Will re-render on next frame once loaded
    }
    if (!img.complete) return;

    const fit = imgData.fit || 'contain';
    const { dx, dy, dw, dh } = this._computeImageFit(fit, img.naturalWidth, img.naturalHeight, t.w, t.h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(t.x, t.y, t.w, t.h);
    ctx.clip();
    ctx.drawImage(img, t.x + dx, t.y + dy, dw, dh);
    ctx.restore();
  }

  /** Render a solid layer (full-canvas fill). */
  _renderSolid(layer, ctx, frame) {
    const t = layer.transform;
    const fillState = this._getAnimatedFill(layer, frame);
    const fillStyle = this._buildFillStyle(ctx, fillState, t);
    ctx.fillStyle = fillStyle;
    ctx.fillRect(t.x, t.y, t.w, t.h);
  }

  /** Render a null layer indicator (dev mode only). */
  _renderNullLayer(layer, ctx) {
    const t = layer.transform;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,100,100,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(t.x, t.y, t.w, t.h);
    // Draw crosshair at anchor
    const ax = t.x + t.w * t.anchorX, ay = t.y + t.h * t.anchorY;
    ctx.beginPath();
    ctx.moveTo(ax - 8, ay); ctx.lineTo(ax + 8, ay);
    ctx.moveTo(ax, ay - 8); ctx.lineTo(ax, ay + 8);
    ctx.stroke();
    ctx.restore();
  }

  // ─── Transform Application ───────────────────────────────────────────────

  /**
   * Applies the layer transform (position, rotation, scale) to the context.
   * Reads animated values from TimelineEngine if available.
   */
  applyTransform(layer, ctx, frame) {
    const t = layer.transform;
    let { x, y, rotation, scaleX, scaleY, anchorX, anchorY, w, h } = t;

    // Override with animated values
    if (this._timelineEngine) {
      const state = this._timelineEngine.getAnimatedState(layer.id, frame);
      if (state.position)  { x = state.position.x; y = state.position.y; }
      if (state.scale)     { scaleX = state.scale.x; scaleY = state.scale.y; }
      if (state.rotation)  { rotation = state.rotation; }
    }

    // Compute pivot in canvas space
    const pivotX = x + w * anchorX;
    const pivotY = y + h * anchorY;

    ctx.translate(pivotX, pivotY);
    if (rotation !== 0) ctx.rotate(degToRad(rotation));
    if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
    ctx.translate(-pivotX, -pivotY);
  }

  // ─── Fill & Stroke Application ───────────────────────────────────────────

  applyFill(layer, ctx, frame) {
    const fillState = this._getAnimatedFill(layer, frame);
    if (fillState.type === 'none') return;
    const t = layer.transform;
    ctx.fillStyle = this._buildFillStyle(ctx, fillState, t);
    ctx.fill();
  }

  applyStroke(layer, ctx, frame) {
    const s = layer.stroke;
    if (!s || s.width <= 0) return;
    ctx.strokeStyle = hexToRgba(s.color, s.opacity);
    ctx.lineWidth = s.width;
    ctx.lineCap = s.cap || 'round';
    ctx.lineJoin = s.join || 'round';
    if (s.dash && s.dash.length > 0) ctx.setLineDash(s.dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  getLayerMatrix(layer, frame) {
    let matrix = new DOMMatrix();

    // 1. Get ancestors from top to bottom
    const ancestors = [];
    let parent = this._layerManager ? this._layerManager.getParentLayer(layer.id) : null;
    while (parent) {
      ancestors.unshift(parent);
      parent = this._layerManager ? this._layerManager.getParentLayer(parent.id) : null;
    }

    // 2. Accumulate viewport offset and zoom first
    matrix = matrix.translate(this._offsetX, this._offsetY);
    matrix = matrix.scale(this._zoom, this._zoom);

    // 3. Accumulate ancestor transforms
    ancestors.forEach(anc => {
      const t = anc.transform;
      let { x, y, rotation, scaleX, scaleY, anchorX, anchorY, w, h } = t;
      if (this._timelineEngine) {
        const state = this._timelineEngine.getAnimatedState(anc.id, frame);
        if (state.position)  { x = state.position.x; y = state.position.y; }
        if (state.scale)     { scaleX = state.scale.x; scaleY = state.scale.y; }
        if (state.rotation)  { rotation = state.rotation; }
      }
      const pivotX = x + w * anchorX;
      const pivotY = y + h * anchorY;

      matrix = matrix.translate(pivotX, pivotY);
      if (rotation) matrix = matrix.rotate(rotation);
      if (scaleX !== 1 || scaleY !== 1) matrix = matrix.scale(scaleX, scaleY);
      matrix = matrix.translate(-pivotX, -pivotY);
    });

    // 4. Finally, accumulate the layer's own transform
    const t = layer.transform;
    let { x, y, rotation, scaleX, scaleY, anchorX, anchorY, w, h } = t;
    if (this._timelineEngine) {
      const state = this._timelineEngine.getAnimatedState(layer.id, frame);
      if (state.position)  { x = state.position.x; y = state.position.y; }
      if (state.scale)     { scaleX = state.scale.x; scaleY = state.scale.y; }
      if (state.rotation)  { rotation = state.rotation; }
    }
    const pivotX = x + w * anchorX;
    const pivotY = y + h * anchorY;

    matrix = matrix.translate(pivotX, pivotY);
    if (rotation) matrix = matrix.rotate(rotation);
    if (scaleX !== 1 || scaleY !== 1) matrix = matrix.scale(scaleX, scaleY);
    matrix = matrix.translate(-pivotX, -pivotY);

    return matrix;
  }

  // ─── Selection Handles ───────────────────────────────────────────────────

  /**
   * Draw selection handles for a layer in screen space.
   * Populates this._selectionHandles for hit testing.
   */
  drawSelectionHandles(layer, ctx, frame) {
    const t = layer.transform;
    let { x, y, w, h } = t;

    if (this._timelineEngine) {
      const state = this._timelineEngine.getAnimatedState(layer.id, frame);
      if (state.position) { x = state.position.x; y = state.position.y; }
    }

    const matrix = this.getLayerMatrix(layer, frame);
    const projectPoint = (cx, cy) => {
      const pt = new DOMPoint(cx, cy);
      const res = pt.matrixTransform(matrix);
      return { x: res.x, y: res.y };
    };

    const tl = projectPoint(x, y);
    const tr = projectPoint(x + w, y);
    const br = projectPoint(x + w, y + h);
    const bl = projectPoint(x, y + h);

    // Corner and edge midpoint points
    const corners = [
      { name: 'nw', x: tl.x, y: tl.y },
      { name: 'ne', x: tr.x, y: tr.y },
      { name: 'se', x: br.x, y: br.y },
      { name: 'sw', x: bl.x, y: bl.y },
      // Edge midpoints
      { name: 'n',  ...projectPoint(x + w / 2, y) },
      { name: 'e',  ...projectPoint(x + w,     y + h / 2) },
      { name: 's',  ...projectPoint(x + w / 2, y + h) },
      { name: 'w',  ...projectPoint(x,         y + h / 2) },
    ];

    ctx.save();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.fillStyle = SELECTION_FILL;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);

    // Draw selection polygon
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Handles
    corners.forEach(({ name, x: sx, y: sy }) => {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = HANDLE_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(sx - HANDLE_SIZE / 2, sy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.fill();
      ctx.stroke();

      this._selectionHandles.push({ name, screenX: sx, screenY: sy, layer });
    });

    // Rotation handle (above top-center perpendicular to top edge)
    const rotSrc = projectPoint(x + w / 2, y);
    const dx = tr.x - tl.x;
    const dy = tr.y - tl.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const px = dy / len;
    const py = -dx / len;
    const rotHandle = {
      x: rotSrc.x + px * 24,
      y: rotSrc.y + py * 24
    };

    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rotSrc.x, rotSrc.y);
    ctx.lineTo(rotHandle.x, rotHandle.y);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = HANDLE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(rotHandle.x, rotHandle.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    this._selectionHandles.push({ name: 'rotate', screenX: rotHandle.x, screenY: rotHandle.y, layer });

    ctx.restore();
  }

  // ─── Grid ─────────────────────────────────────────────────────────────────

  _drawGrid(ctx) {
    const W = this._canvasWidth, H = this._canvasHeight;
    const step = 50;
    ctx.save();
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1 / this._zoom;
    ctx.beginPath();
    for (let x = 0; x <= W; x += step) {
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    for (let y = 0; y <= H; y += step) {
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ─── Paths ─────────────────────────────────────────────────────────────────

  _pathRect(ctx, t, roundness = 0) {
    const { x, y, w, h } = t;
    if (roundness > 0) {
      const r = Math.min(roundness, w / 2, h / 2);
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    } else {
      ctx.rect(x, y, w, h);
    }
  }

  _pathEllipse(ctx, t) {
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    ctx.ellipse(cx, cy, t.w / 2, t.h / 2, 0, 0, Math.PI * 2);
  }

  _pathPolygon(ctx, t, sides) {
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    const rx = t.w / 2, ry = t.h / 2;
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const px = cx + rx * Math.cos(angle), py = cy + ry * Math.sin(angle);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  _pathStar(ctx, t, points, innerRatio = 0.5) {
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    const outerR = Math.min(t.w, t.h) / 2;
    const innerR = outerR * innerRatio;
    for (let i = 0; i < points * 2; i++) {
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const px = cx + r * Math.cos(angle), py = cy + r * Math.sin(angle);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  _pathCustom(ctx, t, commands) {
    // commands: [{cmd:'M'|'L'|'C'|'Q'|'Z', args:[...]}]
    // Coordinates are relative to transform (0,0) = (t.x, t.y)
    const ox = t.x, oy = t.y;
    commands.forEach(({ cmd, args = [] }) => {
      switch (cmd) {
        case 'M': ctx.moveTo(ox + args[0], oy + args[1]); break;
        case 'L': ctx.lineTo(ox + args[0], oy + args[1]); break;
        case 'C': ctx.bezierCurveTo(
          ox + args[0], oy + args[1],
          ox + args[2], oy + args[3],
          ox + args[4], oy + args[5]); break;
        case 'Q': ctx.quadraticCurveTo(ox + args[0], oy + args[1], ox + args[2], oy + args[3]); break;
        case 'Z': ctx.closePath(); break;
        default: break;
      }
    });
  }

  // ─── Fill Helpers ─────────────────────────────────────────────────────────

  _getAnimatedFill(layer, frame) {
    let fill = { ...layer.fill };
    if (this._timelineEngine) {
      const state = this._timelineEngine.getAnimatedState(layer.id, frame);
      if (state.fill) {
        fill = { ...fill, color: state.fill.color, opacity: state.fill.opacity };
      }
      if (state.opacity !== undefined) {
        fill.opacity = (fill.opacity || 1) * state.opacity;
      }
    }
    return fill;
  }

  _buildFillStyle(ctx, fill, t) {
    if (!fill || fill.type === 'none') return 'transparent';

    const opacity = fill.opacity ?? 1;

    if (fill.type === 'solid') {
      return hexToRgba(fill.color || '#ffffff', opacity);
    }

    if (fill.type === 'linear') {
      const g = fill.gradient || {};
      const angle = degToRad(g.angle || 0);
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      const len = Math.sqrt(t.w * t.w + t.h * t.h) / 2;
      const x0 = cx - Math.cos(angle) * len, y0 = cy - Math.sin(angle) * len;
      const x1 = cx + Math.cos(angle) * len, y1 = cy + Math.sin(angle) * len;
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      (g.stops || []).forEach(stop => {
        grad.addColorStop(stop.offset, hexToRgba(stop.color, (stop.opacity ?? 1) * opacity));
      });
      return grad;
    }

    if (fill.type === 'radial') {
      const g = fill.gradient || {};
      const cx = t.x + (g.cx ?? 0.5) * t.w;
      const cy = t.y + (g.cy ?? 0.5) * t.h;
      const r  = (g.r ?? 0.5) * Math.max(t.w, t.h);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      (g.stops || []).forEach(stop => {
        grad.addColorStop(stop.offset, hexToRgba(stop.color, (stop.opacity ?? 1) * opacity));
      });
      return grad;
    }

    return 'transparent';
  }

  // ─── Image Fit ────────────────────────────────────────────────────────────

  _computeImageFit(fit, natW, natH, boxW, boxH) {
    if (!natW || !natH) return { dx: 0, dy: 0, dw: boxW, dh: boxH };
    const boxAR = boxW / boxH, natAR = natW / natH;

    let dw, dh;
    switch (fit) {
      case 'cover':
        if (natAR > boxAR) { dh = boxH; dw = dh * natAR; }
        else               { dw = boxW; dh = dw / natAR; }
        break;
      case 'fill':
        dw = boxW; dh = boxH;
        break;
      case 'none':
        dw = natW; dh = natH;
        break;
      case 'contain':
      default:
        if (natAR > boxAR) { dw = boxW; dh = dw / natAR; }
        else               { dh = boxH; dw = dh * natAR; }
        break;
    }
    return { dx: (boxW - dw) / 2, dy: (boxH - dh) / 2, dw, dh };
  }

  // ─── Text Wrapping ────────────────────────────────────────────────────────

  _wrapText(ctx, text, x, y, maxWidth, lineHeight, stroke = false) {
    const lines = text.split('\n');
    let curY = y;
    lines.forEach(line => {
      const words = line.split(' ');
      let currentLine = '';
      words.forEach((word, idx) => {
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const testWidth = ctx.measureText(testLine).width;
        if (testWidth > maxWidth && currentLine) {
          if (stroke) ctx.strokeText(currentLine, x, curY);
          else ctx.fillText(currentLine, x, curY);
          currentLine = word;
          curY += lineHeight;
        } else {
          currentLine = testLine;
        }
      });
      if (stroke) ctx.strokeText(currentLine, x, curY);
      else ctx.fillText(currentLine, x, curY);
      curY += lineHeight;
    });
  }

  // ─── Checkerboard (transparency) ─────────────────────────────────────────

  _initCheckerboard() {
    const size = CHECKERBOARD_SIZE * 2;
    const cb = document.createElement('canvas');
    cb.width = size; cb.height = size;
    const cctx = cb.getContext('2d');
    cctx.fillStyle = '#888';
    cctx.fillRect(0, 0, size, size);
    cctx.fillStyle = '#ccc';
    cctx.fillRect(0, 0, CHECKERBOARD_SIZE, CHECKERBOARD_SIZE);
    cctx.fillRect(CHECKERBOARD_SIZE, CHECKERBOARD_SIZE, CHECKERBOARD_SIZE, CHECKERBOARD_SIZE);
    this._checkerboard = this._canvas.ownerDocument.createElement('canvas');
    this._checkerboard.width = 1;
    this._checkerboard.height = 1;
    // Store pattern as offscreen canvas reference
    this._checkerPatternCanvas = cb;
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  /**
   * Render a single frame and return a data URL.
   * @param {number} frame
   * @param {string} [type='image/png']
   * @param {number} [quality=0.95]
   * @returns {string} data URL
   */
  exportFrame(frame, type = 'image/png', quality = 0.95) {
    // Render to an offscreen canvas at native resolution
    const off = document.createElement('canvas');
    off.width = this._canvasWidth;
    off.height = this._canvasHeight;
    const octx = off.getContext('2d');

    // Temporarily swap context and render
    const prevCtx = this._ctx;
    const prevCanvas = this._canvas;
    const prevZoom = this._zoom;
    const prevOffX = this._offsetX, prevOffY = this._offsetY;

    this._ctx = octx;
    this._canvas = off;
    this._zoom = 1;
    this._offsetX = 0;
    this._offsetY = 0;

    this.render(frame);

    this._ctx = prevCtx;
    this._canvas = prevCanvas;
    this._zoom = prevZoom;
    this._offsetX = prevOffX;
    this._offsetY = prevOffY;

    return off.toDataURL(type, quality);
  }
}

export default RenderEngine;
