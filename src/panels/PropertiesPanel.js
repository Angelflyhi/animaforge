/**
 * AnimaForge – PropertiesPanel.js
 * Manages the properties panel on the right sidebar
 */

export class PropertiesPanel {
  constructor(editor, layerManager, timelineEngine, colorPicker, gradientEditor) {
    this.editor = editor;
    this.layerManager = layerManager;
    this.timelineEngine = timelineEngine;
    this.colorPicker = colorPicker;
    this.gradientEditor = gradientEditor;
    this.currentLayers = [];
  }

  updateForSelection(layers) {
    this.currentLayers = layers;
    const title = document.getElementById('properties-title');

    if (layers.length === 0) {
      if (title) title.textContent = 'Properties';
      this._clearAll();
      return;
    }

    if (layers.length === 1) {
      if (title) title.textContent = layers[0].name || 'Layer Properties';
      this.setTransform(layers[0]);
      this.setAppearance(layers[0]);
      this.setFill(layers[0]);
      this.setStroke(layers[0]);
    } else {
      if (title) title.textContent = `${layers.length} Layers Selected`;
    }
  }

  setTransform(layer) {
    const t = layer.transform || {};
    this._setInput('prop-x', Math.round(t.x || 0));
    this._setInput('prop-y', Math.round(t.y || 0));
    this._setInput('prop-w', Math.round(t.w || 0));
    this._setInput('prop-h', Math.round(t.h || 0));
    this._setInput('prop-rotation', Math.round(t.rotation || 0));
    this._setInput('prop-scale-x', Math.round((t.scaleX || 1) * 100));
    this._setInput('prop-scale-y', Math.round((t.scaleY || 1) * 100));
    this._setInput('prop-anchor-x', (t.anchorX || 0).toFixed(2));
    this._setInput('prop-anchor-y', (t.anchorY || 0).toFixed(2));
  }

  setAppearance(layer) {
    const opacity = Math.round((layer.opacity ?? 1) * 100);
    this._setInput('prop-opacity', opacity);
    this._setInput('prop-opacity-slider', opacity);
    this._setSelect('prop-blend-mode', layer.blendMode || 'normal');
    this._setCheckbox('prop-visible', layer.visible !== false);
    this._setCheckbox('prop-locked', layer.locked || false);
  }

  setFill(layer) {
    const fill = layer.fill || { type: 'solid', color: '#7C3AED', opacity: 1 };

    // Update fill type tabs
    document.querySelectorAll('.fill-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.fillType === fill.type);
    });

    // Show/hide solid vs gradient editor
    const solidContent = document.querySelector('.fill-solid-content');
    const gradEditor = document.getElementById('fill-gradient-editor');

    const isGrad = fill.type === 'linear' || fill.type === 'radial';
    if (solidContent) solidContent.style.display = isGrad ? 'none' : '';
    if (gradEditor) gradEditor.classList.toggle('hidden', !isGrad);

    if (fill.type === 'solid' || !fill.type || fill.type === 'none') {
      const color = fill.color || '#7C3AED';
      const swatch = document.getElementById('fill-color-swatch');
      if (swatch) swatch.style.background = color;
      const hexInput = document.getElementById('fill-hex-input');
      if (hexInput) hexInput.value = color.replace('#', '').toUpperCase();
      const opSlider = document.getElementById('fill-opacity-slider');
      const opInput = document.getElementById('fill-opacity-input');
      const fillOpacity = Math.round((fill.opacity ?? 1) * 100);
      if (opSlider) opSlider.value = fillOpacity;
      if (opInput) opInput.value = fillOpacity;
    } else if (isGrad && fill.gradient) {
      if (this.gradientEditor) {
        this.gradientEditor.setGradient(fill.gradient);
        this.gradientEditor.render();
      }
    }
  }

  setStroke(layer) {
    const stroke = layer.stroke || { color: '#ffffff', width: 0, opacity: 1 };
    const swatch = document.getElementById('stroke-color-swatch');
    if (swatch) swatch.style.background = stroke.color || '#ffffff';
    const hexInput = document.getElementById('stroke-hex-input');
    if (hexInput) hexInput.value = (stroke.color || '#ffffff').replace('#', '').toUpperCase();
    const widthSlider = document.getElementById('stroke-width-slider');
    const widthInput = document.getElementById('stroke-width');
    if (widthSlider) widthSlider.value = stroke.width || 0;
    if (widthInput) widthInput.value = stroke.width || 0;
    this._setSelect('stroke-cap', stroke.cap || 'round');
    this._setSelect('stroke-join', stroke.join || 'round');
    const dashInput = document.getElementById('stroke-dash');
    if (dashInput) dashInput.value = (stroke.dash || []).join(', ');
  }

  showSection(id) {
    const header = document.querySelector(`[data-target="${id}"]`);
    const body = document.getElementById(id);
    if (header) header.classList.add('active');
    if (body) body.classList.remove('collapsed');
  }

  hideSection(id) {
    const header = document.querySelector(`[data-target="${id}"]`);
    const body = document.getElementById(id);
    if (header) header.classList.remove('active');
    if (body) body.classList.add('collapsed');
  }

  _clearAll() {
    this._setInput('prop-x', 0);
    this._setInput('prop-y', 0);
    this._setInput('prop-w', 0);
    this._setInput('prop-h', 0);
    this._setInput('prop-rotation', 0);
    this._setInput('prop-scale-x', 100);
    this._setInput('prop-scale-y', 100);
    this._setInput('prop-opacity', 100);
    this._setInput('prop-opacity-slider', 100);
  }

  _setInput(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  _setSelect(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  _setCheckbox(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  }
}
