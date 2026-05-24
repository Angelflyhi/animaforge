/**
 * AnimaForge - TimelinePanel
 * Manages the timeline UI: ruler, layer rows, track bars, keyframe markers, and playhead.
 */

const DEFAULT_PX_PER_FRAME = 8;
const RULER_HEIGHT = 28;
const TRACK_ROW_HEIGHT = 32;
const LAYER_ROW_HEIGHT = 32;

export class TimelinePanel {
  constructor(editor, timelineEngine, layerManager) {
    this.editor = editor;
    this.timelineEngine = timelineEngine;
    this.layerManager = layerManager;

    this._pxPerFrame = DEFAULT_PX_PER_FRAME;
    this._scrollLeft = 0;
    this._scrollTop = 0;

    // Cached DOM references
    this._rulerCanvas = null;
    this._rulerCtx = null;
    this._layersCol = null;
    this._tracksCol = null;
    this._playhead = null;
    this._tracksScroll = null;

    this._draggingKeyframe = null;

    this._bound = {
      onTrackAreaClick: this._onTrackAreaClick.bind(this),
      onKeyframeMousedown: this._onKeyframeMousedown.bind(this),
      onDocMousemove: this._onDocMousemove.bind(this),
      onDocMouseup: this._onDocMouseup.bind(this),
      onRulerClick: this._onRulerClick.bind(this),
      onTrackScroll: this._onTrackScroll.bind(this),
    };

    document.addEventListener('mousemove', this._bound.onDocMousemove);
    document.addEventListener('mouseup', this._bound.onDocMouseup);
  }

  // ─── Initialization ─────────────────────────────────────────────────────

  /**
   * Bind to the DOM. Call once after the HTML has been injected.
   */
  bindDOM() {
    this._rulerCanvas = document.getElementById('timeline-ruler-canvas');
    this._layersCol = document.getElementById('timeline-layers-col');
    this._tracksCol = document.getElementById('timeline-tracks-col');
    this._playhead = document.getElementById('timeline-playhead');
    this._tracksScroll = document.getElementById('timeline-tracks-scroll');

    if (this._rulerCanvas) {
      this._rulerCtx = this._rulerCanvas.getContext('2d');
      this._rulerCanvas.addEventListener('click', this._bound.onRulerClick);
      this._rulerCanvas.addEventListener('mousedown', this._bound.onRulerClick);
    }

    if (this._tracksScroll) {
      this._tracksScroll.addEventListener('scroll', this._bound.onTrackScroll);
    }

    if (this._tracksCol) {
      this._tracksCol.addEventListener('click', this._bound.onTrackAreaClick);
    }
  }

  // ─── Full Render ────────────────────────────────────────────────────────

  render() {
    this.renderRuler();
    this.renderLayerRows();
    this.renderTrackRows();
    const frame = this.timelineEngine?.currentFrame ?? 0;
    this.renderPlayhead(frame);
  }

  // ─── Ruler ───────────────────────────────────────────────────────────────

  renderRuler() {
    const canvas = this._rulerCanvas;
    if (!canvas) return;

    const totalFrames = this._getTotalFrames();
    const totalWidth = Math.max(totalFrames * this._pxPerFrame + 200, canvas.parentElement?.clientWidth || 800);
    canvas.width = totalWidth;
    canvas.height = RULER_HEIGHT;

    const ctx = this._rulerCtx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Bottom border
    ctx.strokeStyle = '#3a3a50';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT - 0.5);
    ctx.lineTo(canvas.width, RULER_HEIGHT - 0.5);
    ctx.stroke();

    const frameRate = this.timelineEngine?.frameRate ?? 30;
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#888';
    ctx.textBaseline = 'middle';

    // Draw frame ticks
    for (let frame = 0; frame <= totalFrames; frame++) {
      const x = frame * this._pxPerFrame;
      const isSecond = frame % frameRate === 0;
      const isHalf = frame % Math.max(1, Math.round(frameRate / 2)) === 0;

      if (isSecond) {
        ctx.strokeStyle = '#6060a0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, RULER_HEIGHT);
        ctx.stroke();
        ctx.fillStyle = '#aaaacc';
        ctx.fillText(`${frame / frameRate}s`, x + 3, RULER_HEIGHT / 2);
      } else if (this._pxPerFrame >= 6 && isHalf) {
        ctx.strokeStyle = '#3a3a55';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, RULER_HEIGHT - 8);
        ctx.lineTo(x + 0.5, RULER_HEIGHT);
        ctx.stroke();
      }

      if (this._pxPerFrame >= 16 && frame % 5 === 0 && !isSecond) {
        ctx.fillStyle = '#666';
        ctx.fillText(String(frame), x + 2, RULER_HEIGHT / 2);
      }
    }
  }

  // ─── Layer Rows ──────────────────────────────────────────────────────────

  renderLayerRows() {
    const container = this._layersCol;
    if (!container) return;

    container.innerHTML = '';
    const layers = this.layerManager?.getAllLayers() ?? [];
    this._renderLayerList(layers, container, 0);
  }

  _renderLayerList(layers, container, depth) {
    for (const layer of layers) {
      const el = this._createLayerRowEl(layer, depth);
      container.appendChild(el);
      if (layer.expanded && layer.children?.length) {
        this._renderLayerList(layer.children, container, depth + 1);
      }
    }
  }

  _createLayerRowEl(layer, depth) {
    const el = document.createElement('div');
    el.className = `tl-layer-row${layer._selected ? ' selected' : ''}`;
    el.dataset.layerId = layer.id;
    el.style.cssText = `
      display:flex;align-items:center;height:${LAYER_ROW_HEIGHT}px;
      padding-left:${8 + depth * 16}px;padding-right:6px;
      border-bottom:1px solid #1e1e2e;
      background:${layer._selected ? '#252535' : 'transparent'};
      cursor:pointer;user-select:none;flex-shrink:0;
    `;

    const hasChildren = layer.children?.length > 0;
    const expandBtn = document.createElement('span');
    expandBtn.style.cssText = 'width:14px;font-size:9px;color:#888;flex-shrink:0;cursor:pointer;margin-right:2px;';
    expandBtn.textContent = hasChildren ? (layer.expanded ? '▼' : '▶') : '';
    if (hasChildren) expandBtn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleExpand(layer.id); });
    el.appendChild(expandBtn);

    const visBtn = document.createElement('span');
    visBtn.style.cssText = `font-size:11px;margin-right:4px;cursor:pointer;opacity:${layer.visible ? 1 : 0.3};color:#888;`;
    visBtn.textContent = '●';
    visBtn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleVisibility(layer.id); });
    el.appendChild(visBtn);

    const lockBtn = document.createElement('span');
    lockBtn.style.cssText = `font-size:10px;margin-right:6px;cursor:pointer;color:${layer.locked ? '#f5a623' : '#555'};`;
    lockBtn.textContent = layer.locked ? '🔒' : '🔓';
    lockBtn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleLock(layer.id); });
    el.appendChild(lockBtn);

    const typeIcon = document.createElement('span');
    typeIcon.style.cssText = `font-size:10px;margin-right:6px;color:${this._getLayerColor(layer.type)};flex-shrink:0;`;
    typeIcon.textContent = this._getLayerIcon(layer.type);
    el.appendChild(typeIcon);

    const name = document.createElement('span');
    name.className = 'tl-layer-name';
    name.style.cssText = 'flex:1;font-size:11px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    name.textContent = layer.name || 'Layer';
    name.title = layer.name;
    name.addEventListener('dblclick', (e) => { e.stopPropagation(); this._startRename(layer.id, name); });
    el.appendChild(name);

    el.addEventListener('click', () => this._onLayerRowClick(layer.id));
    return el;
  }

  // ─── Track Rows ──────────────────────────────────────────────────────────

  renderTrackRows() {
    const container = this._tracksCol;
    if (!container) return;

    container.innerHTML = '';
    const layers = this.layerManager?.getAllLayers() ?? [];
    this._renderTrackList(layers, container);
  }

  _renderTrackList(layers, container) {
    for (const layer of layers) {
      const trackRow = this._createTrackRowEl(layer);
      container.appendChild(trackRow);
      this.renderKeyframes(layer.id);
      if (layer.expanded && layer.children?.length) {
        this._renderTrackList(layer.children, container);
      }
    }
  }

  _createTrackRowEl(layer) {
    const totalFrames = this._getTotalFrames();
    const totalWidth = Math.max(totalFrames * this._pxPerFrame + 200, 800);
    const inPoint = layer.inPoint ?? 0;
    const outPoint = layer.outPoint ?? totalFrames;
    const barLeft = inPoint * this._pxPerFrame;
    const barWidth = Math.max(4, (outPoint - inPoint) * this._pxPerFrame);

    const row = document.createElement('div');
    row.className = 'tl-track-row';
    row.dataset.layerId = layer.id;
    row.style.cssText = `position:relative;height:${TRACK_ROW_HEIGHT}px;border-bottom:1px solid #1e1e2e;flex-shrink:0;min-width:${totalWidth}px;`;

    const bar = document.createElement('div');
    bar.className = 'tl-track-bar';
    bar.style.cssText = `
      position:absolute;left:${barLeft}px;width:${barWidth}px;
      top:6px;height:20px;border-radius:3px;
      background:${this._getLayerTrackColor(layer.type)};opacity:0.7;
    `;
    row.appendChild(bar);
    return row;
  }

  // ─── Keyframes ───────────────────────────────────────────────────────────

  renderKeyframes(layerId) {
    const container = this._tracksCol;
    if (!container) return;

    const row = container.querySelector(`[data-layer-id="${layerId}"]`);
    if (!row) return;

    row.querySelectorAll('.kf-marker').forEach(m => m.remove());

    const layer = this.layerManager?.getLayer(layerId);
    if (!layer) return;

    const keyframes = this._collectKeyframes(layer);
    for (const frame of keyframes) {
      this._renderKeyframeMarker(row, frame, layer);
    }
  }

  _collectKeyframes(layer) {
    const kfSet = new Set();
    if (this.timelineEngine) {
      const layerKfs = this.timelineEngine.getKeyframesForLayer(layer.id);
      if (layerKfs) {
        Object.values(layerKfs).forEach(kfList => {
          if (Array.isArray(kfList)) {
            kfList.forEach(kf => kfSet.add(kf.frame));
          }
        });
      }
    }
    return Array.from(kfSet).sort((a, b) => a - b);
  }

  _renderKeyframeMarker(row, frame, layer) {
    const x = frame * this._pxPerFrame;
    const marker = document.createElement('div');
    marker.className = 'kf-marker';
    marker.dataset.frame = frame;
    marker.dataset.layerId = layer.id;
    marker.style.cssText = `
      position:absolute;left:${x}px;top:50%;
      transform:translate(-50%,-50%) rotate(45deg);
      width:8px;height:8px;background:#f5c842;
      border:1px solid rgba(0,0,0,0.5);border-radius:1px;
      cursor:pointer;z-index:2;
    `;
    marker.addEventListener('mousedown', (e) => { e.stopPropagation(); this._onKeyframeMousedown(e); });
    row.appendChild(marker);
  }

  // ─── Playhead ────────────────────────────────────────────────────────────

  renderPlayhead(frame) {
    const playhead = this._playhead;
    if (!playhead) return;
    playhead.style.left = (frame * this._pxPerFrame) + 'px';
    playhead.style.display = 'block';
  }

  // ─── Zoom ────────────────────────────────────────────────────────────────

  setZoom(pxPerFrame) {
    this._pxPerFrame = Math.max(1, Math.min(64, pxPerFrame));
    this.render();
  }

  zoomIn() { this.setZoom(this._pxPerFrame * 1.25); }
  zoomOut() { this.setZoom(this._pxPerFrame / 1.25); }

  scrollToFrame(frame) {
    const scroll = this._tracksScroll;
    if (!scroll) return;
    const x = frame * this._pxPerFrame;
    scroll.scrollLeft = Math.max(0, x - (scroll.clientWidth / 2) || 200);
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────

  handleTrackClick(e) { this._onTrackAreaClick(e); }

  _onTrackAreaClick(e) {
    if (e.target.closest('.kf-marker')) return;
    const rect = this._tracksCol?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left + (this._tracksScroll?.scrollLeft ?? 0);
    const frame = Math.max(0, Math.round(x / this._pxPerFrame));
    if (this.timelineEngine) this.timelineEngine.setFrame(frame);
  }

  _onRulerClick(e) {
    const rect = this._rulerCanvas?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left + (this._tracksScroll?.scrollLeft ?? 0);
    const frame = Math.max(0, Math.round(x / this._pxPerFrame));
    if (this.timelineEngine) this.timelineEngine.setFrame(frame);
    this.renderPlayhead(frame);
  }

  handleKeyframeDrag(e) { this._onKeyframeMousedown(e); }

  _onKeyframeMousedown(e) {
    const marker = e.target.closest('.kf-marker');
    if (!marker) return;
    this._draggingKeyframe = {
      frame: parseInt(marker.dataset.frame),
      layerId: marker.dataset.layerId,
      el: marker,
      startX: e.clientX,
    };
  }

  _onDocMousemove(e) {
    if (!this._draggingKeyframe) return;
    const dx = e.clientX - this._draggingKeyframe.startX;
    const frameDelta = Math.round(dx / this._pxPerFrame);
    const newFrame = Math.max(0, this._draggingKeyframe.frame + frameDelta);
    this._draggingKeyframe.el.style.left = (newFrame * this._pxPerFrame) + 'px';
  }

  _onDocMouseup(e) {
    if (!this._draggingKeyframe) return;
    const dx = e.clientX - this._draggingKeyframe.startX;
    const frameDelta = Math.round(dx / this._pxPerFrame);
    const newFrame = Math.max(0, this._draggingKeyframe.frame + frameDelta);
    if (frameDelta !== 0) this._moveKeyframe(this._draggingKeyframe.layerId, this._draggingKeyframe.frame, newFrame);
    this._draggingKeyframe = null;
  }

  _onTrackScroll(e) {
    this._scrollLeft = e.target.scrollLeft;
    if (this._rulerCanvas?.parentElement) this._rulerCanvas.parentElement.scrollLeft = this._scrollLeft;
  }

  _onLayerRowClick(layerId) {
    if (this.layerManager) this.layerManager.selectLayer(layerId, false);
  }

  // ─── Layer Actions ───────────────────────────────────────────────────────

  _toggleVisibility(layerId) {
    const layer = this.layerManager?.getLayer(layerId);
    if (layer) this.layerManager.setLayerProperty(layerId, 'visible', !layer.visible);
  }

  _toggleLock(layerId) {
    const layer = this.layerManager?.getLayer(layerId);
    if (layer) this.layerManager.setLayerProperty(layerId, 'locked', !layer.locked);
  }

  _toggleExpand(layerId) {
    const layer = this.layerManager?.getLayer(layerId);
    if (layer) this.layerManager.setLayerProperty(layerId, 'expanded', !layer.expanded);
  }

  _startRename(layerId, nameEl) {
    const current = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.style.cssText = 'background:#111;border:1px solid #5b6ef5;color:#eee;font-size:11px;padding:1px 4px;border-radius:3px;width:100%;';
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const finish = () => {
      const newName = input.value.trim() || current;
      if (this.layerManager) this.layerManager.setLayerProperty(layerId, 'name', newName);
      nameEl.textContent = newName;
      input.replaceWith(nameEl);
    };
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish();
      if (e.key === 'Escape') { input.value = current; finish(); }
    });
  }

  _moveKeyframe(layerId, fromFrame, toFrame) {
    if (!this.timelineEngine) return;
    const layerKfs = this.timelineEngine.getKeyframesForLayer(layerId);
    if (!layerKfs) return;

    Object.values(layerKfs).forEach(kfList => {
      if (Array.isArray(kfList)) {
        kfList.forEach(kf => {
          if (kf.frame === fromFrame) {
            kf.frame = toFrame;
          }
        });
        kfList.sort((a, b) => a.frame - b.frame);
      }
    });

    this.renderKeyframes(layerId);
    if (this.timelineEngine) this.timelineEngine.emit('keyframeMoved', { layerId, fromFrame, toFrame });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _getTotalFrames() {
    return this.timelineEngine?.totalFrames ?? this.timelineEngine?.outPoint ?? 60;
  }

  _getLayerIcon(type) {
    const icons = { shape: '◇', image: '⬛', text: 'T', composition: '⬡', solid: '■', null: '○', group: '▷' };
    return icons[type] || '·';
  }

  _getLayerColor(type) {
    const colors = { shape: '#5b6ef5', image: '#50c878', text: '#f5a623', composition: '#c370f5', solid: '#888' };
    return colors[type] || '#666';
  }

  _getLayerTrackColor(type) {
    const colors = {
      shape: 'linear-gradient(90deg,#3d4fa0,#5b6ef5)',
      image: 'linear-gradient(90deg,#2a6640,#50c878)',
      text: 'linear-gradient(90deg,#8a5800,#f5a623)',
      composition: 'linear-gradient(90deg,#6a3a90,#c370f5)',
    };
    return colors[type] || 'linear-gradient(90deg,#404050,#6060a0)';
  }

  destroy() {
    document.removeEventListener('mousemove', this._bound.onDocMousemove);
    document.removeEventListener('mouseup', this._bound.onDocMouseup);
  }
}

export default TimelinePanel;
