/**
 * AnimaForge - LayersPanel
 * Manages the layers panel UI: layer items, visibility, lock, expand, rename, drag-and-drop.
 */

export class LayersPanel {
  constructor(editor, layerManager) {
    this.editor = editor;
    this.layerManager = layerManager;

    this._container = null;
    this._draggingId = null;
    this._dragOverId = null;
    this._expandedIds = new Set();

    this._bound = {
      onDocMouseup: this._onDocMouseup.bind(this),
      onDocMousemove: this._onDocMousemove.bind(this),
    };

    document.addEventListener('mouseup', this._bound.onDocMouseup);
    document.addEventListener('mousemove', this._bound.onDocMousemove);
  }

  // ─── Initialization ─────────────────────────────────────────────────────

  bindDOM(containerOrId) {
    if (typeof containerOrId === 'string') {
      this._container = document.getElementById(containerOrId);
    } else {
      this._container = containerOrId;
    }

    if (!this._container) {
      console.warn('LayersPanel: container not found');
      return;
    }

    this._container.addEventListener('click', this._handleContainerClick.bind(this));
    this._container.addEventListener('dblclick', this._handleContainerDblclick.bind(this));
    this._container.addEventListener('dragstart', this._handleContainerDragstart.bind(this));
    this._container.addEventListener('dragover', this._handleContainerDragover.bind(this));
    this._container.addEventListener('drop', this._handleContainerDrop.bind(this));
    this._container.addEventListener('dragleave', this._handleContainerDragleave.bind(this));
    this._container.addEventListener('dragend', this._handleContainerDragend.bind(this));
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  render() {
    if (!this._container) return;

    this._container.innerHTML = '';

    const layers = this.layerManager?.getAllLayers() ?? [];
    if (layers.length === 0) {
      this._container.innerHTML = `
        <div style="padding:24px;text-align:center;color:#555;font-size:12px;">
          <div style="font-size:24px;margin-bottom:8px;">📋</div>
          No layers yet.<br>Import a file or add a shape.
        </div>
      `;
      return;
    }

    const selectedIds = new Set(this.layerManager?.getSelectedIds?.() ?? []);
    this._renderLayerList(layers, this._container, 0, selectedIds);
  }

  _renderLayerList(layers, container, depth, selectedIds) {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const el = this.renderLayer(layer, depth, selectedIds);
      container.appendChild(el);

      if ((layer.expanded || this._expandedIds.has(layer.id)) && layer.children?.length) {
        this._renderLayerList(layer.children, container, depth + 1, selectedIds);
      }
    }
  }

  renderLayer(layer, depth = 0, selectedIds = new Set()) {
    const isSelected = selectedIds.has(layer.id);
    const hasChildren = layer.children?.length > 0;
    const isExpanded = layer.expanded || this._expandedIds.has(layer.id);

    const el = document.createElement('div');
    el.className = `layer-item${isSelected ? ' layer-item--selected' : ''}`;
    el.dataset.layerId = layer.id;
    el.draggable = true;
    el.style.cssText = `
      display:flex;align-items:center;height:32px;
      padding-left:${8 + depth * 16}px;padding-right:6px;
      border-bottom:1px solid rgba(255,255,255,0.04);
      background:${isSelected ? 'rgba(91,110,245,0.15)' : 'transparent'};
      cursor:pointer;user-select:none;position:relative;
    `;

    if (isSelected) {
      const accent = document.createElement('div');
      accent.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:2px;background:#5b6ef5;border-radius:0 1px 1px 0;';
      el.appendChild(accent);
    }

    // Expand toggle
    const expandBtn = document.createElement('span');
    expandBtn.className = 'lp-expand-btn';
    expandBtn.dataset.action = 'expand';
    expandBtn.dataset.layerId = layer.id;
    expandBtn.style.cssText = 'width:14px;flex-shrink:0;font-size:8px;color:#666;cursor:pointer;text-align:center;margin-right:2px;';
    expandBtn.textContent = hasChildren ? (isExpanded ? '▼' : '▶') : '';
    el.appendChild(expandBtn);

    // Visibility
    const visBtn = document.createElement('span');
    visBtn.className = 'lp-vis-btn';
    visBtn.dataset.action = 'visibility';
    visBtn.dataset.layerId = layer.id;
    visBtn.title = layer.visible ? 'Hide' : 'Show';
    visBtn.style.cssText = `flex-shrink:0;width:18px;text-align:center;font-size:12px;cursor:pointer;margin-right:2px;opacity:${layer.visible ? 1 : 0.25};color:#888;`;
    visBtn.textContent = '👁';
    el.appendChild(visBtn);

    // Lock
    const lockBtn = document.createElement('span');
    lockBtn.className = 'lp-lock-btn';
    lockBtn.dataset.action = 'lock';
    lockBtn.dataset.layerId = layer.id;
    lockBtn.title = layer.locked ? 'Unlock' : 'Lock';
    lockBtn.style.cssText = `flex-shrink:0;width:16px;text-align:center;font-size:10px;cursor:pointer;margin-right:6px;color:${layer.locked ? '#f5a623' : '#444'};`;
    lockBtn.textContent = layer.locked ? '🔒' : '🔓';
    el.appendChild(lockBtn);

    // Type icon
    const typeIcon = document.createElement('span');
    typeIcon.style.cssText = `flex-shrink:0;width:14px;text-align:center;font-size:10px;margin-right:6px;color:${this._getLayerColor(layer.type)};`;
    typeIcon.textContent = this._getLayerIcon(layer.type);
    el.appendChild(typeIcon);

    // Thumbnail
    const thumb = document.createElement('div');
    thumb.style.cssText = `flex-shrink:0;width:18px;height:18px;border-radius:2px;background:${this._getLayerThumbBg(layer)};margin-right:6px;border:1px solid rgba(255,255,255,0.08);`;
    el.appendChild(thumb);

    // Name
    const nameEl = document.createElement('span');
    nameEl.className = 'lp-layer-name';
    nameEl.dataset.layerId = layer.id;
    nameEl.style.cssText = `flex:1;font-size:11px;color:${isSelected ? '#dde' : '#aaa'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    nameEl.textContent = layer.name || 'Layer';
    nameEl.title = layer.name;
    el.appendChild(nameEl);

    return el;
  }

  updateSelection(selectedIds) {
    if (!this._container) return;
    const idSet = new Set(selectedIds);
    this._container.querySelectorAll('.layer-item').forEach(el => {
      const id = el.dataset.layerId;
      const selected = idSet.has(id);
      el.classList.toggle('layer-item--selected', selected);
      el.style.background = selected ? 'rgba(91,110,245,0.15)' : 'transparent';
    });
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────

  _handleContainerClick(e) {
    const actionEl = e.target.closest('[data-action]');
    const action = actionEl?.dataset.action;
    const layerEl = e.target.closest('[data-layer-id]');
    const layerId = layerEl?.dataset.layerId;
    if (!layerId) return;

    if (action === 'visibility') { this.toggleVisibility(layerId); return; }
    if (action === 'lock') { this.toggleLock(layerId); return; }
    if (action === 'expand') { this.toggleExpand(layerId); return; }

    this.handleLayerClick(layerId, e);
  }

  _handleContainerDblclick(e) {
    const nameEl = e.target.closest('.lp-layer-name');
    if (nameEl) this.renameLayer(nameEl.dataset.layerId);
  }

  _handleContainerDragstart(e) {
    const item = e.target.closest('.layer-item');
    if (!item) return;
    this._draggingId = item.dataset.layerId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this._draggingId);
    setTimeout(() => { if (item) item.style.opacity = '0.5'; }, 0);
  }

  _handleContainerDragover(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const item = e.target.closest('.layer-item');
    if (item && item.dataset.layerId !== this._draggingId) {
      if (this._dragOverId !== item.dataset.layerId) {
        this._clearDragOver();
        this._dragOverId = item.dataset.layerId;
        item.style.borderTop = '2px solid #5b6ef5';
      }
    }
  }

  _handleContainerDrop(e) {
    e.preventDefault();
    const targetItem = e.target.closest('.layer-item');
    const targetId = targetItem?.dataset.layerId;
    if (targetId && targetId !== this._draggingId) {
      this.handleLayerDrop(targetId, e);
    }
    this._clearDragOver();
  }

  _handleContainerDragleave(e) {
    if (!this._container?.contains(e.relatedTarget)) this._clearDragOver();
  }

  _handleContainerDragend(e) {
    const item = e.target.closest('.layer-item');
    if (item) item.style.opacity = '';
    this._clearDragOver();
    this._draggingId = null;
    this._dragOverId = null;
  }

  _clearDragOver() {
    if (this._dragOverId) {
      const el = this._container?.querySelector(`[data-layer-id="${this._dragOverId}"]`);
      if (el) el.style.borderTop = '';
    }
    this._dragOverId = null;
  }

  _onDocMouseup() {}
  _onDocMousemove() {}

  // ─── Public Layer Actions ────────────────────────────────────────────────

  handleLayerClick(id, e) {
    if (!this.layerManager) return;
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    this.layerManager.selectLayer(id, multi);
  }

  handleLayerDragStart(id, e) {
    this._draggingId = id;
  }

  handleLayerDrop(targetId, e) {
    if (!this.layerManager || !this._draggingId) return;
    if (typeof this.layerManager.moveLayer === 'function') {
      this.layerManager.moveLayer(this._draggingId, targetId);
      this.render();
    }
    this._draggingId = null;
  }

  renameLayer(id) {
    const nameEl = this._container?.querySelector(`.lp-layer-name[data-layer-id="${id}"]`);
    if (!nameEl) return;

    const current = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.style.cssText = 'background:#0d0d1a;border:1px solid #5b6ef5;color:#eee;font-size:11px;padding:1px 5px;border-radius:3px;width:100%;box-sizing:border-box;';
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = () => {
      const newName = input.value.trim() || current;
      if (this.layerManager && newName !== current) {
        this.layerManager.setLayerProperty(id, 'name', newName);
      }
      nameEl.textContent = newName;
      input.replaceWith(nameEl);
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(); }
      if (e.key === 'Escape') { input.value = current; input.blur(); }
    });
  }

  toggleVisibility(id) {
    const layer = this.layerManager?.getLayer(id);
    if (!layer) return;
    this.layerManager.setLayerProperty(id, 'visible', !layer.visible);
    this.render();
  }

  toggleLock(id) {
    const layer = this.layerManager?.getLayer(id);
    if (!layer) return;
    this.layerManager.setLayerProperty(id, 'locked', !layer.locked);
    this.render();
  }

  toggleExpand(id) {
    const layer = this.layerManager?.getLayer(id);
    if (!layer) return;
    const newVal = !layer.expanded;
    if (this.layerManager && typeof this.layerManager.setLayerProperty === 'function') {
      this.layerManager.setLayerProperty(id, 'expanded', newVal);
    } else {
      if (newVal) this._expandedIds.add(id);
      else this._expandedIds.delete(id);
    }
    this.render();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _getLayerIcon(type) {
    const icons = { shape: '◇', image: '⬛', text: 'T', composition: '⬡', solid: '■', null: '○', group: '▷' };
    return icons[type] || '·';
  }

  _getLayerColor(type) {
    const colors = { shape: '#5b6ef5', image: '#50c878', text: '#f5a623', composition: '#c370f5', solid: '#888' };
    return colors[type] || '#666';
  }

  _getLayerThumbBg(layer) {
    if (layer.type === 'solid') return layer.solidColor || '#333';
    if (layer.shapes?.length) {
      const fill = this._findFill(layer.shapes);
      if (fill) return fill;
    }
    const colors = {
      shape: 'linear-gradient(135deg,#3d4fa0,#5b6ef5)',
      image: 'linear-gradient(135deg,#2a6640,#50c878)',
      text: 'linear-gradient(135deg,#8a5800,#f5a623)',
      composition: 'linear-gradient(135deg,#6a3a90,#c370f5)',
    };
    return colors[layer.type] || '#333';
  }

  _findFill(shapes) {
    for (const s of shapes || []) {
      if (s.type === 'fl' && s.color?.value) {
        const c = s.color.value;
        if (Array.isArray(c) && c.length >= 3) {
          return `rgb(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)})`;
        }
      }
      if (s.items) { const found = this._findFill(s.items); if (found) return found; }
    }
    return null;
  }

  destroy() {
    document.removeEventListener('mouseup', this._bound.onDocMouseup);
    document.removeEventListener('mousemove', this._bound.onDocMousemove);
  }
}

export default LayersPanel;
