/**
 * AnimaForge – EditorEngine.js
 * Main editor controller – integrates all subsystems
 */

import { EventEmitter } from './EventEmitter.js';

export class EditorEngine extends EventEmitter {
  constructor({ layerManager, timelineEngine, renderEngine, historyManager }) {
    super();
    this.layerManager = layerManager;
    this.timelineEngine = timelineEngine;
    this.renderEngine = renderEngine;
    this.historyManager = historyManager;

    this.project = null;
    this.activeTool = 'select';
    this.clipboard = null;
    this.zoom = 1;
    this.offset = { x: 0, y: 0 };

    // Drag/resize state
    this._dragState = null;
    this._resizeState = null;
    this._drawState = null;
    this._selectionBoxState = null;

    // Connect render engine to layer and timeline managers
    if (this.renderEngine) {
      this.renderEngine.editor = this;
      if (this.renderEngine.setLayerManager) this.renderEngine.setLayerManager(layerManager);
      if (this.renderEngine.setTimelineEngine) this.renderEngine.setTimelineEngine(timelineEngine);
    }
  }


  // ─── Project Management ─────────────────────────────────────────────────────
  newProject(options = {}) {
    const project = {
      name: options.name || 'Untitled Project',
      width: options.width || 512,
      height: options.height || 512,
      fps: options.fps || 30,
      totalFrames: options.totalFrames || 90,
      backgroundColor: options.backgroundColor || '#1a1a2e',
      transparent: options.transparent || false,
      version: '1.0.0',
      createdAt: new Date().toISOString()
    };
    this.project = project;
    this.layerManager.clear();
    this.timelineEngine.setDuration(project.totalFrames);
    this.timelineEngine.setFps(project.fps);
    this.timelineEngine.setFrame(0);

    if (this.renderEngine) {
      this.renderEngine.resize(project.width, project.height);
      this.renderEngine.setBackground(project.backgroundColor, project.transparent);
    }

    this.historyManager.clear();
    this.emit('projectChange', project);
    this._updateCanvasContainer();
  }

  openProject(data) {
    this.project = {
      name: data.name || 'Project',
      width: data.width || 512,
      height: data.height || 512,
      fps: data.fps || 30,
      totalFrames: data.totalFrames || 90,
      backgroundColor: data.backgroundColor || '#1a1a2e',
      transparent: data.transparent || false,
    };

    this.layerManager.clear();
    if (data.layers && Array.isArray(data.layers)) {
      data.layers.forEach(l => this.layerManager.importLayer(l));
    }

    this.timelineEngine.setDuration(this.project.totalFrames);
    this.timelineEngine.setFps(this.project.fps);
    this.timelineEngine.setFrame(0);

    if (data.keyframes) {
      this.timelineEngine.importKeyframes(data.keyframes);
    }

    if (this.renderEngine) {
      this.renderEngine.resize(this.project.width, this.project.height);
      this.renderEngine.setBackground(this.project.backgroundColor, this.project.transparent);
    }

    this.emit('projectChange', this.project);
    this._updateCanvasContainer();
  }

  saveProject() {
    return {
      name: this.project?.name || 'Untitled',
      width: this.project?.width || 512,
      height: this.project?.height || 512,
      fps: this.project?.fps || 30,
      totalFrames: this.project?.totalFrames || 90,
      backgroundColor: this.project?.backgroundColor || '#1a1a2e',
      transparent: this.project?.transparent || false,
      layers: this.layerManager.getAllLayers(),
      keyframes: this.timelineEngine.exportKeyframes(),
      version: '1.0.0',
      savedAt: new Date().toISOString()
    };
  }

  refresh() {
    this.layerManager.emit('change');
    this.layerManager.emit('select', this.layerManager.getSelectedIds());
    if (this.renderEngine) this.renderEngine.render(this.timelineEngine.currentFrame);
  }

  // ─── Tool Management ──────────────────────────────────────────────────────
  setTool(name) {
    this.activeTool = name;
    this._drawState = null;
  }

  // ─── Selection ────────────────────────────────────────────────────────────
  getSelectedLayers() {
    return this.layerManager.getSelectedLayers();
  }

  selectAll() {
    this.layerManager.selectAll();
  }

  deselectAll() {
    this.layerManager.deselectAll();
  }

  // ─── Layer Operations ─────────────────────────────────────────────────────
  addShape(shapeType, x = 100, y = 100, w = 200, h = 150) {
    const colors = ['#7C3AED','#4F46E5','#06B6D4','#10B981','#F59E0B','#EF4444','#EC4899'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const layer = this.layerManager.addLayer('shape', {
      name: shapeType.charAt(0).toUpperCase() + shapeType.slice(1),
      shape: { type: shapeType, sides: 6, points: 5, innerRadius: 0.5 },
      transform: { x, y, w, h, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0 },
      fill: { type: 'solid', color, opacity: 1 },
      stroke: { color: '#ffffff', width: 0, opacity: 1, cap: 'round', join: 'round', dash: [] }
    });

    this.historyManager.push({
      execute: () => {},
      undo: () => this.layerManager.removeLayer(layer.id)
    });

    this.layerManager.selectLayer(layer.id, false);
    this.layerManager.emit('change');
    return layer;
  }

  addText(text = 'Text', x = 100, y = 100) {
    const layer = this.layerManager.addLayer('text', {
      name: text.substring(0, 20),
      text: { content: text, fontSize: 48, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'left' },
      transform: { x, y, w: 300, h: 80, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0 },
      fill: { type: 'solid', color: '#ffffff', opacity: 1 },
      stroke: { color: '#000000', width: 0, opacity: 1 }
    });
    this.layerManager.selectLayer(layer.id, false);
    this.layerManager.emit('change');
    return layer;
  }

  deleteSelected() {
    const selected = this.layerManager.getSelectedLayers();
    if (selected.length === 0) return;
    const snapshot = selected.map(l => ({ ...l }));
    selected.forEach(l => this.layerManager.removeLayer(l.id));
    this.historyManager.push({
      execute: () => selected.forEach(l => this.layerManager.removeLayer(l.id)),
      undo: () => snapshot.forEach(l => this.layerManager.importLayer(l))
    });
    this.layerManager.emit('change');
  }

  duplicateSelected() {
    const selected = this.layerManager.getSelectedLayers();
    if (selected.length === 0) return;
    selected.forEach(layer => {
      const dup = this.layerManager.duplicateLayer(layer.id);
      if (dup) {
        dup.transform = { ...dup.transform, x: (dup.transform.x || 0) + 20, y: (dup.transform.y || 0) + 20 };
      }
    });
    this.layerManager.emit('change');
  }

  groupSelected() {
    const selected = this.layerManager.getSelectedLayers();
    if (selected.length < 2) return;
    const group = this.layerManager.groupLayers(selected.map(l => l.id));
    if (group) {
      this.layerManager.selectLayer(group.id, false);
      this.layerManager.emit('change');
    }
  }

  ungroupSelected() {
    const selected = this.layerManager.getSelectedLayers();
    selected.forEach(l => {
      if (l.type === 'group') this.layerManager.ungroupLayer(l.id);
    });
    this.layerManager.emit('change');
  }

  bringForward() {
    this.layerManager.getSelectedLayers().forEach(l => this.layerManager.reorderLayer(l.id, 'up'));
    this.layerManager.emit('change');
  }

  sendBackward() {
    this.layerManager.getSelectedLayers().forEach(l => this.layerManager.reorderLayer(l.id, 'down'));
    this.layerManager.emit('change');
  }

  bringToFront() {
    this.layerManager.getSelectedLayers().forEach(l => this.layerManager.reorderLayer(l.id, 'top'));
    this.layerManager.emit('change');
  }

  sendToBack() {
    this.layerManager.getSelectedLayers().forEach(l => this.layerManager.reorderLayer(l.id, 'bottom'));
    this.layerManager.emit('change');
  }

  cut() {
    this.clipboard = this.layerManager.getSelectedLayers().map(l => JSON.parse(JSON.stringify(l)));
    this.deleteSelected();
  }

  copy() {
    this.clipboard = this.layerManager.getSelectedLayers().map(l => JSON.parse(JSON.stringify(l)));
  }

  paste() {
    if (!this.clipboard || this.clipboard.length === 0) return;
    this.layerManager.deselectAll();
    this.clipboard.forEach(layerData => {
      const newId = this._generateId();
      const layer = this.layerManager.importLayer({
        ...layerData,
        id: newId,
        name: layerData.name + ' Copy',
        transform: { ...layerData.transform, x: (layerData.transform?.x||0) + 20, y: (layerData.transform?.y||0) + 20 }
      });
      this.layerManager.selectLayer(layer.id, true);
    });
    this.layerManager.emit('change');
  }

  // ─── Zoom & Pan ────────────────────────────────────────────────────────────
  setZoom(level) {
    this.zoom = Math.max(0.1, Math.min(16, level));
    if (this.renderEngine) this.renderEngine.setZoom(this.zoom);
    const zoomSel = document.getElementById('zoom-select');
    if (zoomSel) {
      const pct = Math.round(this.zoom * 100);
      zoomSel.value = [25,50,75,100,150,200,400].includes(pct) ? pct : 100;
    }
  }

  fitToWindow() {
    if (!this.project || !this.renderEngine) return;
    const container = document.getElementById('canvas-scroll-container');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const scaleX = (rect.width - 80) / this.project.width;
    const scaleY = (rect.height - 80) / this.project.height;
    this.setZoom(Math.min(scaleX, scaleY, 1));
  }

  // ─── Property Updates ──────────────────────────────────────────────────────
  updateLayerProperty(layerId, path, value) {
    const layer = this.layerManager.getLayer(layerId);
    if (!layer) return;

    const oldValue = this._getNestedValue(layer, path);
    this.historyManager.push({
      execute: () => this.layerManager.setLayerProperty(layerId, path, value),
      undo: () => this.layerManager.setLayerProperty(layerId, path, oldValue)
    });

    this.layerManager.setLayerProperty(layerId, path, value);
    if (this.renderEngine) this.renderEngine.render(this.timelineEngine.currentFrame);
  }

  _getNestedValue(obj, path) {
    return path.split('.').reduce((acc, key) => acc && acc[key] !== undefined ? acc[key] : undefined, obj);
  }

  // ─── Mouse Handling ────────────────────────────────────────────────────────
  handleMouseDown(x, y, e) {
    if (!this.project) return;

    const cx = (x - this.renderEngine.offset.x) / this.zoom;
    const cy = (y - this.renderEngine.offset.y) / this.zoom;

    switch (this.activeTool) {
      case 'select': this._handleSelectDown(cx, cy, e); break;
      case 'rect': this._startDraw('rect', cx, cy); break;
      case 'ellipse': this._startDraw('ellipse', cx, cy); break;
      case 'polygon': this._startDraw('polygon', cx, cy); break;
      case 'star': this._startDraw('star', cx, cy); break;
      case 'text': this._handleTextDown(cx, cy); break;
      case 'zoom': this.setZoom(e.shiftKey ? this.zoom / 1.25 : this.zoom * 1.25); break;
    }
  }

  handleMouseMove(x, y, e) {
    if (!this.project) return;
    const cx = (x - this.renderEngine.offset.x) / this.zoom;
    const cy = (y - this.renderEngine.offset.y) / this.zoom;

    if (this._dragState) {
      this._updateDrag(cx, cy);
    } else if (this._resizeState) {
      this._updateResize(cx, cy);
    } else if (this._drawState) {
      this._updateDraw(cx, cy);
    } else if (this._selectionBoxState) {
      this._updateSelectionBox(cx, cy);
    }
  }

  handleMouseUp(x, y, e) {
    if (this._dragState) this._endDrag();
    if (this._resizeState) this._endResize();
    if (this._drawState) this._endDraw();
    if (this._selectionBoxState) this._endSelectionBox();
  }

  handleDblClick(x, y, e) {
    const cx = (x - this.renderEngine.offset.x) / this.zoom;
    const cy = (y - this.renderEngine.offset.y) / this.zoom;
    const layer = this.layerManager.getLayerAt(cx, cy);
    if (layer && layer.type === 'text') {
      this._editText(layer);
    }
  }

  // ─── Private: Selection & Drag ──────────────────────────────────────────────
  _handleSelectDown(x, y, e) {
    // Check resize handles first
    const selected = this.layerManager.getSelectedLayers();
    if (selected.length === 1 && this.renderEngine) {
      const handle = this.renderEngine.hitTestHandle(selected[0], x, y);
      if (handle) {
        this._resizeState = {
          handle, layerId: selected[0].id,
          startX: x, startY: y,
          origTransform: { ...selected[0].transform }
        };
        return;
      }
    }

    // Hit test layers
    const layer = this.layerManager.getLayerAt(x, y);
    if (layer) {
      if (!this.layerManager.isSelected(layer.id)) {
        this.layerManager.selectLayer(layer.id, e.shiftKey);
      }
      this._dragState = {
        layerId: layer.id,
        startX: x, startY: y,
        layers: this.layerManager.getSelectedLayers().map(l => ({
          id: l.id,
          origX: l.transform?.x || 0,
          origY: l.transform?.y || 0
        }))
      };
    } else {
      if (!e.shiftKey) this.layerManager.deselectAll();
      // Start selection box
      this._selectionBoxState = { startX: x, startY: y, x, y, w: 0, h: 0 };
      this._showSelectionBox(x, y, 0, 0);
    }
  }

  _updateDrag(x, y) {
    if (!this._dragState) return;
    const dx = x - this._dragState.startX;
    const dy = y - this._dragState.startY;
    this._dragState.layers.forEach(l => {
      this.layerManager.setLayerProperty(l.id, 'transform.x', l.origX + dx);
      this.layerManager.setLayerProperty(l.id, 'transform.y', l.origY + dy);
    });
    if (this.renderEngine) this.renderEngine.render(this.timelineEngine.currentFrame);
    this._updatePropertiesForMove();
  }

  _endDrag() {
    if (!this._dragState) return;
    const ds = this._dragState;
    this._dragState = null;
    // Record history
    const moved = ds.layers;
    this.historyManager.push({
      execute: () => {},
      undo: () => moved.forEach(l => {
        this.layerManager.setLayerProperty(l.id, 'transform.x', l.origX);
        this.layerManager.setLayerProperty(l.id, 'transform.y', l.origY);
        if (this.renderEngine) this.renderEngine.render(this.timelineEngine.currentFrame);
      })
    });
  }

  _updateResize(x, y) {
    if (!this._resizeState) return;
    const { handle, origTransform, layerId } = this._resizeState;
    const dx = x - this._resizeState.startX;
    const dy = y - this._resizeState.startY;
    const layer = this.layerManager.getLayer(layerId);
    if (!layer) return;

    let newX = origTransform.x, newY = origTransform.y;
    let newW = origTransform.w || 100, newH = origTransform.h || 100;

    switch (handle) {
      case 'se': newW = Math.max(10, (origTransform.w||100) + dx); newH = Math.max(10, (origTransform.h||100) + dy); break;
      case 'sw': newX = origTransform.x + dx; newW = Math.max(10, (origTransform.w||100) - dx); newH = Math.max(10, (origTransform.h||100) + dy); break;
      case 'ne': newW = Math.max(10, (origTransform.w||100) + dx); newY = origTransform.y + dy; newH = Math.max(10, (origTransform.h||100) - dy); break;
      case 'nw': newX = origTransform.x + dx; newY = origTransform.y + dy; newW = Math.max(10, (origTransform.w||100) - dx); newH = Math.max(10, (origTransform.h||100) - dy); break;
      case 'n': newY = origTransform.y + dy; newH = Math.max(10, (origTransform.h||100) - dy); break;
      case 's': newH = Math.max(10, (origTransform.h||100) + dy); break;
      case 'e': newW = Math.max(10, (origTransform.w||100) + dx); break;
      case 'w': newX = origTransform.x + dx; newW = Math.max(10, (origTransform.w||100) - dx); break;
    }

    this.layerManager.setLayerProperty(layerId, 'transform.x', newX);
    this.layerManager.setLayerProperty(layerId, 'transform.y', newY);
    this.layerManager.setLayerProperty(layerId, 'transform.w', newW);
    this.layerManager.setLayerProperty(layerId, 'transform.h', newH);
    if (this.renderEngine) this.renderEngine.render(this.timelineEngine.currentFrame);
    this._updatePropertiesForMove();
  }

  _endResize() { this._resizeState = null; }

  // ─── Private: Drawing ─────────────────────────────────────────────────────
  _startDraw(shapeType, x, y) {
    this._drawState = { shapeType, startX: x, startY: y, currentX: x, currentY: y, layer: null };
  }

  _updateDraw(x, y) {
    if (!this._drawState) return;
    const ds = this._drawState;
    ds.currentX = x; ds.currentY = y;

    const left = Math.min(ds.startX, x);
    const top = Math.min(ds.startY, y);
    const w = Math.abs(x - ds.startX);
    const h = Math.abs(y - ds.startY);

    if (!ds.layer && w > 5) {
      const colors = ['#7C3AED','#4F46E5','#06B6D4','#10B981','#F59E0B','#EF4444'];
      ds.layer = this.layerManager.addLayer('shape', {
        name: ds.shapeType.charAt(0).toUpperCase() + ds.shapeType.slice(1),
        shape: { type: ds.shapeType },
        transform: { x: left, y: top, w, h, rotation: 0, scaleX: 1, scaleY: 1 },
        fill: { type: 'solid', color: colors[Math.floor(Math.random()*colors.length)], opacity: 1 },
        stroke: { color: '#ffffff', width: 0, opacity: 1 }
      });
    } else if (ds.layer) {
      this.layerManager.setLayerProperty(ds.layer.id, 'transform.x', left);
      this.layerManager.setLayerProperty(ds.layer.id, 'transform.y', top);
      this.layerManager.setLayerProperty(ds.layer.id, 'transform.w', Math.max(1, w));
      this.layerManager.setLayerProperty(ds.layer.id, 'transform.h', Math.max(1, h));
    }

    if (this.renderEngine) this.renderEngine.render(this.timelineEngine.currentFrame);
  }

  _endDraw() {
    if (this._drawState?.layer) {
      this.layerManager.selectLayer(this._drawState.layer.id, false);
      this.layerManager.emit('change');
    }
    this._drawState = null;
    this.setTool('select');
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    const selectBtn = document.querySelector('.tool-btn[data-tool="select"]');
    if (selectBtn) selectBtn.classList.add('active');
  }

  // ─── Private: Selection Box ───────────────────────────────────────────────
  _showSelectionBox(x, y, w, h) {
    const box = document.getElementById('selection-box');
    if (!box || !this.renderEngine) return;
    const container = document.getElementById('canvas-container');
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = (x * this.zoom + this.renderEngine.offset.x) + 'px';
    box.style.top = (y * this.zoom + this.renderEngine.offset.y) + 'px';
    box.style.width = (w * this.zoom) + 'px';
    box.style.height = (h * this.zoom) + 'px';
  }

  _updateSelectionBox(x, y) {
    if (!this._selectionBoxState) return;
    const s = this._selectionBoxState;
    const left = Math.min(s.startX, x);
    const top = Math.min(s.startY, y);
    const w = Math.abs(x - s.startX);
    const h = Math.abs(y - s.startY);
    this._showSelectionBox(left, top, w, h);
  }

  _endSelectionBox() {
    if (!this._selectionBoxState) return;
    const s = this._selectionBoxState;
    const box = document.getElementById('selection-box');
    if (box) box.style.display = 'none';

    // Select layers in box
    const left = Math.min(s.startX, s.x);
    const top = Math.min(s.startY, s.y);
    const right = Math.max(s.startX, s.x);
    const bottom = Math.max(s.startY, s.y);

    this.layerManager.deselectAll();
    this.layerManager.getAllLayers().forEach(layer => {
      const t = layer.transform || {};
      const lx = t.x || 0, ly = t.y || 0;
      const lw = t.w || 100, lh = t.h || 100;
      if (lx < right && lx + lw > left && ly < bottom && ly + lh > top) {
        this.layerManager.selectLayer(layer.id, true);
      }
    });

    this._selectionBoxState = null;
    if (this.renderEngine) this.renderEngine.render(this.timelineEngine.currentFrame);
  }

  _handleTextDown(x, y) {
    const existing = this.layerManager.getLayerAt(x, y);
    if (existing && existing.type === 'text') {
      this._editText(existing);
    } else {
      const text = prompt('Enter text:', 'Hello World');
      if (text) this.addText(text, x, y);
    }
  }

  _editText(layer) {
    const text = prompt('Edit text:', layer.text?.content || '');
    if (text !== null) {
      this.updateLayerProperty(layer.id, 'text.content', text);
      this.updateLayerProperty(layer.id, 'name', text.substring(0, 20));
    }
  }

  _updatePropertiesForMove() {
    const selected = this.layerManager.getSelectedLayers();
    if (selected.length !== 1) return;
    const t = selected[0].transform || {};
    const setV = (id, v) => { const el = document.getElementById(id); if (el) el.value = Math.round(v || 0); };
    setV('prop-x', t.x); setV('prop-y', t.y); setV('prop-w', t.w); setV('prop-h', t.h);
    setV('prop-rotation', t.rotation);
  }

  _generateId() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  _updateCanvasContainer() {
    if (!this.project) return;
    const container = document.getElementById('canvas-container');
    const mainCanvas = document.getElementById('main-canvas');
    const overlayCanvas = document.getElementById('overlay-canvas');
    if (!container || !mainCanvas) return;

    mainCanvas.width = this.project.width;
    mainCanvas.height = this.project.height;
    if (overlayCanvas) { overlayCanvas.width = this.project.width; overlayCanvas.height = this.project.height; }
    container.style.width = this.project.width + 'px';
    container.style.height = this.project.height + 'px';

    if (!this.project.transparent) {
      container.style.backgroundColor = this.project.backgroundColor;
    }

    // Draw rulers
    this._drawRulers();
    setTimeout(() => this.fitToWindow(), 100);
  }

  _drawRulers() {
    this._drawHRuler();
    this._drawVRuler();
  }

  _drawHRuler() {
    const canvas = document.getElementById('ruler-canvas-h');
    if (!canvas || !this.project) return;
    const parent = canvas.parentElement;
    canvas.width = parent.offsetWidth;
    canvas.height = 18;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#333355';
    ctx.fillStyle = '#5a5a80';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    const step = 50;
    for (let x = 0; x <= this.project.width; x += step) {
      const px = x * this.zoom;
      ctx.beginPath(); ctx.moveTo(px, 10); ctx.lineTo(px, 18); ctx.stroke();
      ctx.fillText(x, px + 2, 9);
    }
  }

  _drawVRuler() {
    const canvas = document.getElementById('ruler-canvas-v');
    if (!canvas || !this.project) return;
    const parent = canvas.parentElement;
    canvas.width = 18;
    canvas.height = parent.offsetHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#333355';
    ctx.fillStyle = '#5a5a80';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.save(); ctx.rotate(-Math.PI / 2);
    const step = 50;
    for (let y = 0; y <= this.project.height; y += step) {
      const py = y * this.zoom;
      ctx.beginPath(); ctx.moveTo(-py, 10); ctx.lineTo(-py, 18); ctx.stroke();
      ctx.fillText(y, -py - 18, 9);
    }
    ctx.restore();
  }
}
