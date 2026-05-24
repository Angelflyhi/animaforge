/**
 * AnimaForge - Professional Animation Studio
 * Main Entry Point
 */

import './styles/main.css';
import { EditorEngine } from './core/EditorEngine.js';
import { LayerManager } from './core/LayerManager.js';
import { TimelineEngine } from './core/TimelineEngine.js';
import { RenderEngine } from './core/RenderEngine.js';
import { HistoryManager } from './core/HistoryManager.js';
import { ImportManager } from './io/ImportManager.js';
import { ExportManager } from './io/ExportManager.js';
import { ColorPicker } from './ui/ColorPicker.js';
import { GradientEditor } from './ui/GradientEditor.js';
import { LayersPanel } from './panels/LayersPanel.js';
import { PropertiesPanel } from './panels/PropertiesPanel.js';
import { TimelinePanel } from './panels/TimelinePanel.js';

// ─── Global State ───────────────────────────────────────────────────────────
let editor, layerManager, timelineEngine, renderEngine, historyManager;
let importManager, exportManager;
let colorPicker, gradientEditor;
let layersPanel, propertiesPanel, timelinePanel;

// ─── Splash Screen ───────────────────────────────────────────────────────────
async function initApp() {
  const splash = document.getElementById('splash-screen');
  const statusEl = document.getElementById('splash-status');
  const layout = document.getElementById('editor-layout');

  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

  try {
    setStatus('Initializing engine...');
    await sleep(300);

    setStatus('Loading layer system...');
    layerManager = new LayerManager();
    historyManager = new HistoryManager();
    await sleep(200);

    setStatus('Setting up timeline...');
    timelineEngine = new TimelineEngine();
    await sleep(200);

    setStatus('Initializing canvas renderer...');
    const mainCanvas = document.getElementById('main-canvas');
    const overlayCanvas = document.getElementById('overlay-canvas');
    renderEngine = new RenderEngine(mainCanvas, overlayCanvas, layerManager, timelineEngine);
    await sleep(200);

    setStatus('Starting editor engine...');
    editor = new EditorEngine({
      layerManager,
      timelineEngine,
      renderEngine,
      historyManager
    });
    await sleep(150);

    setStatus('Loading I/O modules...');
    importManager = new ImportManager(editor);
    exportManager = new ExportManager(editor);
    await sleep(150);

    setStatus('Building UI...');
    colorPicker = new ColorPicker();
    gradientEditor = new GradientEditor();
    layersPanel = new LayersPanel(editor, layerManager);
    layersPanel.bindDOM('layers-list');
    propertiesPanel = new PropertiesPanel(editor, layerManager, timelineEngine, colorPicker, gradientEditor);
    timelinePanel = new TimelinePanel(editor, timelineEngine, layerManager);
    timelinePanel.bindDOM();
    await sleep(150);

    setStatus('Initializing default project...');
    editor.newProject({ width: 512, height: 512, fps: 30, totalFrames: 90, backgroundColor: '#1a1a2e' });
    await sleep(100);

    setStatus('Binding events...');
    bindAllEvents();
    await sleep(100);

    setStatus('Ready!');
    await sleep(300);

    // Show editor
    splash.style.animation = 'splashFadeIn 0.4s ease reverse forwards';
    await sleep(400);
    splash.style.display = 'none';
    layout.classList.remove('hidden');

    // Initial render
    renderEngine.render(0);
    timelinePanel.render();
    layersPanel.render();
    setupColorPresets();

    showToast('Welcome to AnimaForge! 🎬', 'info', 4000);

  } catch (err) {
    console.error('Init error:', err);
    setStatus(`Error: ${err.message}`);
    showToast(`Initialization error: ${err.message}`, 'error');
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Event Binding ────────────────────────────────────────────────────────────
function bindAllEvents() {
  bindMenuEvents();
  bindToolbarEvents();
  bindTransportEvents();
  bindCanvasEvents();
  bindLayerPanelEvents();
  bindPropertiesPanelEvents();
  bindModalEvents();
  bindKeyboardShortcuts();
  bindDragDrop();
  bindEditorListeners();
  bindTimelineEvents();
  bindColorPresetEvents();
}

// ─── Menu Events ─────────────────────────────────────────────────────────────
function bindMenuEvents() {
  // Dropdown open/close
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.menu-item.open').forEach(i => i.classList.remove('open'));
      if (!wasOpen) item.classList.add('open');
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.menu-item.open').forEach(i => i.classList.remove('open'));
  });

  // File
  $on('btn-new-project', () => openModal('modal-new-project'));
  $on('btn-open-project', () => { triggerFileImport('.json,.lottie,.tgs'); });
  $on('btn-import-file', () => triggerFileImport('.json,.lottie,.tgs,.gif,.png,.jpg,.jpeg,.svg,.zip'));
  $on('btn-import-lottie', () => triggerFileImport('.json,.lottie'));
  $on('btn-import-tgs', () => triggerFileImport('.tgs'));
  $on('btn-import-gif', () => triggerFileImport('.gif'));
  $on('btn-import-image', () => triggerFileImport('.png,.jpg,.jpeg,.svg'));
  $on('btn-save', () => saveProject());
  $on('btn-save-as', () => saveProjectAs());

  // Export quick
  $on('btn-export-quick', () => openModal('modal-export'));
  $on('btn-export-menu', () => openModal('modal-export'));

  // Export format from File menu
  ['lottie','dotlottie','tgs','gif','png-seq','png','jpeg','svg','mp4','webm'].forEach(fmt => {
    const el = document.getElementById('export-' + fmt);
    if (el) el.addEventListener('click', () => { openModal('modal-export'); selectExportFormat(fmt); });
  });

  // Edit
  $on('btn-undo', () => { historyManager.undo(); editor.refresh(); showToast('Undo', 'info', 1500); });
  $on('btn-redo', () => { historyManager.redo(); editor.refresh(); showToast('Redo', 'info', 1500); });
  $on('btn-cut', () => editor.cut());
  $on('btn-copy', () => editor.copy());
  $on('btn-paste', () => editor.paste());
  $on('btn-duplicate', () => editor.duplicateSelected());
  $on('btn-select-all', () => editor.selectAll());
  $on('btn-deselect', () => editor.deselectAll());

  // Layer menu
  $on('btn-new-shape-layer', () => editor.addShape('rect', 100, 100, 200, 150));
  $on('btn-new-text-layer', () => editor.addText('Text Layer', 100, 100));
  $on('btn-new-null-layer', () => layerManager.addLayer('null', { name: 'Null Layer' }));
  $on('btn-new-solid-layer', () => { layerManager.addLayer('solid', { name: 'Solid Layer', fill: { type:'solid', color:'#3a3a5c' } }); layerManager.emit('change'); });
  $on('btn-new-group', () => editor.groupSelected());
  $on('btn-layer-duplicate', () => editor.duplicateSelected());
  $on('btn-layer-delete', () => editor.deleteSelected());
  $on('btn-bring-forward', () => editor.bringForward());
  $on('btn-send-backward', () => editor.sendBackward());
  $on('btn-bring-to-front', () => editor.bringToFront());
  $on('btn-send-to-back', () => editor.sendToBack());

  // View
  $on('btn-zoom-in', () => editor.setZoom(editor.zoom * 1.25));
  $on('btn-zoom-out', () => editor.setZoom(editor.zoom / 1.25));
  $on('btn-zoom-fit', () => editor.fitToWindow());
  $on('btn-toggle-grid', () => toggleGrid());
  $on('btn-toggle-rulers', () => toggleRulers());
  $on('btn-toggle-grid-canvas', () => toggleGrid());
  $on('btn-toggle-transparent-bg', () => toggleTransparentBg());

  // Themes
  ['dark','darker','light','midnight','forest','rose'].forEach(t => {
    const el = document.getElementById('theme-' + t);
    if (el) el.addEventListener('click', () => setTheme(t));
  });

  // Animation
  $on('btn-add-keyframe', () => addKeyframeForSelected());
  $on('btn-ease-in', () => setKeyframeEasing('ease-in'));
  $on('btn-ease-out', () => setKeyframeEasing('ease-out'));
  $on('btn-ease-inout', () => setKeyframeEasing('ease-in-out'));
  $on('btn-linear', () => setKeyframeEasing('linear'));

  // Help
  $on('btn-shortcuts', () => openModal('modal-shortcuts'));
  $on('btn-about', () => showToast('AnimaForge v1.0.0 — Professional Animation Studio', 'info', 4000));
}

// ─── Toolbar Events ──────────────────────────────────────────────────────────
function bindToolbarEvents() {
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      editor.setTool(btn.dataset.tool);
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateCanvasCursor(btn.dataset.tool);
    });
  });

  $on('btn-swap-colors', () => swapFillStroke());
  $on('btn-default-colors', () => resetDefaultColors());

  // Fill/Stroke well click → open color picker
  const fillWell = document.getElementById('fill-well');
  const strokeWell = document.getElementById('stroke-well');
  if (fillWell) fillWell.addEventListener('click', () => {
    colorPicker.open(fillWell.style.background, (color) => {
      fillWell.style.background = color;
      applyFillColorToSelected(color);
    });
  });
  if (strokeWell) strokeWell.addEventListener('click', () => {
    colorPicker.open(strokeWell.style.background, (color) => {
      strokeWell.style.background = color;
      applyStrokeColorToSelected(color);
    });
  });

  // Canvas toolbar
  const zoomSel = document.getElementById('zoom-select');
  if (zoomSel) zoomSel.addEventListener('change', () => {
    const v = zoomSel.value;
    if (v === 'fit') editor.fitToWindow();
    else editor.setZoom(parseInt(v) / 100);
  });

  $on('btn-canvas-zoom-in', () => editor.setZoom(editor.zoom * 1.25));
  $on('btn-canvas-zoom-out', () => editor.setZoom(editor.zoom / 1.25));
}

// ─── Transport Events ─────────────────────────────────────────────────────────
function bindTransportEvents() {
  $on('btn-play-pause', () => togglePlayback());
  $on('btn-go-start', () => { timelineEngine.setFrame(0); });
  $on('btn-go-end', () => { timelineEngine.setFrame(timelineEngine.totalFrames - 1); });
  $on('btn-step-back', () => timelineEngine.prevFrame());
  $on('btn-step-forward', () => timelineEngine.nextFrame());
  $on('btn-loop', () => {
    timelineEngine.isLooping = !timelineEngine.isLooping;
    document.getElementById('btn-loop')?.classList.toggle('active', timelineEngine.isLooping);
  });

  // Time input
  const timeInput = document.getElementById('current-time-input');
  if (timeInput) {
    timeInput.addEventListener('change', () => {
      const frame = parseTimeToFrame(timeInput.value, timelineEngine.fps);
      timelineEngine.setFrame(frame);
    });
  }

  // Preview button
  $on('btn-preview', () => {
    if (timelineEngine.isPlaying) timelineEngine.pause();
    else timelineEngine.play();
  });
}

// ─── Canvas Events ───────────────────────────────────────────────────────────
function bindCanvasEvents() {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;

  let isPanning = false, panStart = {x:0, y:0}, panOrigin = {x:0, y:0};

  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const {x,y} = getCanvasPos(e);

    if (e.button === 1 || (e.button === 0 && editor.activeTool === 'hand')) {
      isPanning = true;
      panStart = {x: e.clientX, y: e.clientY};
      panOrigin = {...renderEngine.offset};
      canvas.style.cursor = 'grabbing';
      return;
    }

    editor.handleMouseDown(x, y, e);
  });

  canvas.addEventListener('mousemove', (e) => {
    if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      renderEngine.setOffset(panOrigin.x + dx, panOrigin.y + dy);
      renderEngine.render(timelineEngine.currentFrame);
      return;
    }
    const {x,y} = getCanvasPos(e);
    editor.handleMouseMove(x, y, e);
    updateRulerCursor(e);
  });

  canvas.addEventListener('mouseup', (e) => {
    if (isPanning) {
      isPanning = false;
      updateCanvasCursor(editor.activeTool);
      return;
    }
    const {x,y} = getCanvasPos(e);
    editor.handleMouseUp(x, y, e);
  });

  canvas.addEventListener('mouseleave', (e) => {
    if (isPanning) { isPanning = false; updateCanvasCursor(editor.activeTool); }
    editor.handleMouseUp(0, 0, e);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      editor.setZoom(editor.zoom * factor);
    } else {
      renderEngine.setOffset(
        renderEngine.offset.x - e.deltaX,
        renderEngine.offset.y - e.deltaY
      );
      renderEngine.render(timelineEngine.currentFrame);
    }
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    const {x,y} = getCanvasPos(e);
    editor.handleDblClick(x, y, e);
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });
}

// ─── Layer Panel Events ──────────────────────────────────────────────────────
function bindLayerPanelEvents() {
  $on('btn-add-layer', () => {
    const layer = layerManager.addLayer('shape', {
      name: 'Shape Layer',
      shape: { type: 'rect' },
      transform: { x: 156, y: 156, w: 200, h: 200 },
      fill: { type: 'solid', color: randomColor() }
    });
    layerManager.selectLayer(layer.id, false);
    layerManager.emit('change');
    showToast('Layer added', 'success', 1500);
  });

  $on('btn-add-group', () => editor.groupSelected());
  $on('btn-delete-layer', () => editor.deleteSelected());
}

// ─── Properties Panel Events ─────────────────────────────────────────────────
function bindPropertiesPanelEvents() {
  // Collapsible sections
  document.querySelectorAll('.prop-section-header.collapsible').forEach(header => {
    header.addEventListener('click', () => {
      const target = document.getElementById(header.dataset.target);
      if (!target) return;
      const isCollapsed = target.classList.contains('collapsed');
      target.classList.toggle('collapsed', !isCollapsed);
      header.classList.toggle('active', isCollapsed);
    });
  });

  // Fill type tabs
  document.querySelectorAll('.fill-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.fill-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const fillType = tab.dataset.fillType;
      toggleFillEditor(fillType);
      applyFillTypeToSelected(fillType);
    });
  });

  // Fill color swatch click
  const fillSwatch = document.getElementById('fill-color-swatch');
  if (fillSwatch) {
    fillSwatch.addEventListener('click', () => {
      colorPicker.open(fillSwatch.style.background, (color) => {
        fillSwatch.style.background = color;
        const hex = color.replace('#', '');
        const hexInput = document.getElementById('fill-hex-input');
        if (hexInput) hexInput.value = hex.toUpperCase();
        applyFillColorToSelected(color);
      });
    });
  }

  // Fill hex input
  const fillHex = document.getElementById('fill-hex-input');
  if (fillHex) {
    fillHex.addEventListener('input', () => {
      const hex = '#' + fillHex.value.replace('#','');
      if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        document.getElementById('fill-color-swatch').style.background = hex;
        applyFillColorToSelected(hex);
      }
    });
  }

  // Fill opacity
  const fillOpSlider = document.getElementById('fill-opacity-slider');
  const fillOpInput = document.getElementById('fill-opacity-input');
  syncSliderInput(fillOpSlider, fillOpInput, (v) => {
    editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'fill.opacity', v/100));
  });

  // Stroke color
  const strokeHex = document.getElementById('stroke-hex-input');
  const strokeSwatch = document.getElementById('stroke-color-swatch');
  if (strokeHex) {
    strokeHex.addEventListener('input', () => {
      const hex = '#' + strokeHex.value.replace('#','');
      if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        strokeSwatch.style.background = hex;
        applyStrokeColorToSelected(hex);
      }
    });
  }
  if (strokeSwatch) {
    strokeSwatch.addEventListener('click', () => {
      colorPicker.open(strokeSwatch.style.background, (color) => {
        strokeSwatch.style.background = color;
        strokeHex.value = color.replace('#','').toUpperCase();
        applyStrokeColorToSelected(color);
      });
    });
  }

  // Stroke width
  const strokeWidthSlider = document.getElementById('stroke-width-slider');
  const strokeWidthInput = document.getElementById('stroke-width');
  syncSliderInput(strokeWidthSlider, strokeWidthInput, (v) => {
    editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'stroke.width', v));
  });

  // Transform inputs
  ['x','y','w','h','rotation','scale-x','scale-y','anchor-x','anchor-y'].forEach(prop => {
    const input = document.getElementById('prop-' + prop);
    if (!input) return;
    input.addEventListener('change', () => {
      const val = parseFloat(input.value) || 0;
      const propMap = {
        'x': 'transform.x', 'y': 'transform.y',
        'w': 'transform.w', 'h': 'transform.h',
        'rotation': 'transform.rotation',
        'scale-x': 'transform.scaleX', 'scale-y': 'transform.scaleY',
        'anchor-x': 'transform.anchorX', 'anchor-y': 'transform.anchorY'
      };
      editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, propMap[prop], val));
    });
  });

  // Opacity
  const opSlider = document.getElementById('prop-opacity-slider');
  const opInput = document.getElementById('prop-opacity');
  syncSliderInput(opSlider, opInput, (v) => {
    editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'opacity', v/100));
  });

  // Blend mode
  const blendSel = document.getElementById('prop-blend-mode');
  if (blendSel) blendSel.addEventListener('change', () => {
    editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'blendMode', blendSel.value));
  });

  // Visibility/Lock
  $onChange('prop-visible', (e) => {
    editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'visible', e.target.checked));
  });
  $onChange('prop-locked', (e) => {
    editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'locked', e.target.checked));
  });

  // Keyframe diamonds
  document.querySelectorAll('.keyframe-diamond').forEach(btn => {
    btn.addEventListener('click', () => {
      const propMap = {
        'kf-position': 'position', 'kf-scale': 'scale',
        'kf-rotation': 'rotation', 'kf-opacity': 'opacity', 'kf-fill': 'fill'
      };
      const prop = propMap[btn.id];
      if (prop) addKeyframeForProperty(prop);
    });
  });

  // Add effect
  $on('btn-add-effect', () => showEffectsMenu());

  // Stroke cap/join/dash
  const capSel = document.getElementById('stroke-cap');
  if (capSel) capSel.addEventListener('change', () => {
    editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'stroke.cap', capSel.value));
  });
  const joinSel = document.getElementById('stroke-join');
  if (joinSel) joinSel.addEventListener('change', () => {
    editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'stroke.join', joinSel.value));
  });
  const dashInput = document.getElementById('stroke-dash');
  if (dashInput) dashInput.addEventListener('change', () => {
    const dash = dashInput.value.split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
    editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'stroke.dash', dash));
  });
}

// ─── Modal Events ─────────────────────────────────────────────────────────────
function bindModalEvents() {
  // Close overlay on background click
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeAllModals();
  });

  // Close buttons
  ['close-modal-new','close-modal-export','close-modal-shortcuts','close-modal-color'].forEach(id => {
    $on(id, () => closeAllModals());
  });

  // New project
  $on('btn-cancel-new-project', () => closeAllModals());
  $on('btn-create-project', () => createNewProject());

  // Project templates
  document.querySelectorAll('.project-template').forEach(tmpl => {
    tmpl.addEventListener('click', () => {
      document.querySelectorAll('.project-template').forEach(t => t.classList.remove('selected'));
      tmpl.classList.add('selected');
      document.getElementById('new-proj-w').value = tmpl.dataset.w;
      document.getElementById('new-proj-h').value = tmpl.dataset.h;
      document.getElementById('new-proj-fps').value = tmpl.dataset.fps;
      document.getElementById('new-proj-dur').value = tmpl.dataset.dur;
    });
  });

  // Export modal
  $on('btn-cancel-export', () => closeAllModals());
  $on('btn-do-export', () => doExport());

  document.querySelectorAll('.export-format-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.export-format-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const fmt = card.dataset.format;
      const gifOpts = document.getElementById('export-gif-options');
      if (gifOpts) gifOpts.style.display = fmt === 'gif' ? 'flex' : 'none';
    });
  });

  // Export quality slider
  const qualSlider = document.getElementById('export-quality');
  const qualDisplay = document.getElementById('export-quality-display');
  if (qualSlider && qualDisplay) {
    qualSlider.addEventListener('input', () => {
      qualDisplay.textContent = Math.round(parseFloat(qualSlider.value) * 100) + '%';
    });
  }

  // Color picker modal
  $on('btn-apply-color', () => {
    colorPicker.applyAndClose();
  });
  $on('btn-cancel-color', () => {
    colorPicker.cancelAndClose();
  });

  // Color mode tabs
  document.querySelectorAll('.color-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.color-mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      colorPicker.setMode(tab.dataset.mode);
    });
  });
}

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs
    const tag = e.target.tagName;
    if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return;

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl) {
      switch (e.key.toLowerCase()) {
        case 'z': e.preventDefault(); historyManager.undo(); editor.refresh(); break;
        case 'y': e.preventDefault(); historyManager.redo(); editor.refresh(); break;
        case 'c': e.preventDefault(); editor.copy(); break;
        case 'x': e.preventDefault(); editor.cut(); break;
        case 'v': e.preventDefault(); editor.paste(); break;
        case 'd': e.preventDefault(); editor.duplicateSelected(); break;
        case 'a': e.preventDefault(); editor.selectAll(); break;
        case 'g': e.preventDefault(); e.shiftKey ? editor.ungroupSelected() : editor.groupSelected(); break;
        case 'e': e.preventDefault(); openModal('modal-export'); break;
        case 'n': e.preventDefault(); openModal('modal-new-project'); break;
        case '=': case '+': e.preventDefault(); editor.setZoom(editor.zoom * 1.25); break;
        case '-': e.preventDefault(); editor.setZoom(editor.zoom / 1.25); break;
        case '0': e.preventDefault(); editor.fitToWindow(); break;
        case 's': e.preventDefault(); e.shiftKey ? saveProjectAs() : saveProject(); break;
      }
      return;
    }

    switch (e.key) {
      case 'v': case 'V': activateTool('select'); break;
      case 'a': case 'A': activateTool('direct-select'); break;
      case 'r': case 'R': activateTool('rect'); break;
      case 'e': case 'E': activateTool('ellipse'); break;
      case 'p': case 'P': activateTool('path'); break;
      case 't': case 'T': activateTool('text'); break;
      case 'h': case 'H': activateTool('hand'); break;
      case 'z': case 'Z': activateTool('zoom'); break;
      case ' ': e.preventDefault(); togglePlayback(); break;
      case 'Home': timelineEngine.setFrame(0); break;
      case 'End': timelineEngine.setFrame(timelineEngine.totalFrames - 1); break;
      case ',': timelineEngine.prevFrame(); break;
      case '.': timelineEngine.nextFrame(); break;
      case 'k': case 'K': addKeyframeForSelected(); break;
      case 'Delete': case 'Backspace': editor.deleteSelected(); break;
      case 'x': case 'X': swapFillStroke(); break;
      case 'd': case 'D': resetDefaultColors(); break;
      case ']': editor.bringForward(); break;
      case '[': editor.sendBackward(); break;
      case 'Escape': editor.deselectAll(); closeContextMenu(); closeAllModals(); break;
    }
  });
}

// ─── Drag & Drop ──────────────────────────────────────────────────────────────
function bindDragDrop() {
  const canvasArea = document.getElementById('canvas-area');
  if (!canvasArea) return;

  canvasArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    canvasArea.classList.add('drag-over-canvas');
  });

  canvasArea.addEventListener('dragleave', () => {
    canvasArea.classList.remove('drag-over-canvas');
  });

  canvasArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    canvasArea.classList.remove('drag-over-canvas');
    const files = [...e.dataTransfer.files];
    for (const file of files) {
      await handleImportFile(file);
    }
  });

  // File import input
  const fileInput = document.getElementById('file-import-input');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const files = [...fileInput.files];
      for (const file of files) {
        await handleImportFile(file);
      }
      fileInput.value = '';
    });
  }
}

// ─── Editor Listeners ──────────────────────────────────────────────────────────
function bindEditorListeners() {
  if (!layerManager) return;

  layerManager.on('change', () => {
    layersPanel.render();
    renderEngine.render(timelineEngine.currentFrame);
    timelinePanel.render();
  });

  layerManager.on('select', (selectedIds) => {
    layersPanel.updateSelection(selectedIds);
    const selectedLayers = selectedIds.map(id => layerManager.getLayer(id)).filter(Boolean);
    propertiesPanel.updateForSelection(selectedLayers);
    renderEngine.render(timelineEngine.currentFrame);
  });

  timelineEngine.on('frame', (frame) => {
    updateTimeDisplay(frame);
    renderEngine.render(frame);
    timelinePanel.renderPlayhead(frame);
  });

  timelineEngine.on('play', () => {
    const btn = document.getElementById('btn-play-pause');
    if (btn) { btn.textContent = '⏸'; btn.classList.add('playing'); }
  });

  timelineEngine.on('pause', () => {
    const btn = document.getElementById('btn-play-pause');
    if (btn) { btn.textContent = '▶'; btn.classList.remove('playing'); }
  });

  editor.on('projectChange', () => {
    updateProjectInfo();
    renderEngine.render(timelineEngine.currentFrame);
    timelinePanel.render();
    layersPanel.render();
  });
}

// ─── Timeline Events ──────────────────────────────────────────────────────────
function bindTimelineEvents() {
  const tracksCol = document.getElementById('timeline-tracks-col');
  if (!tracksCol) return;

  tracksCol.addEventListener('click', (e) => {
    const rect = tracksCol.getBoundingClientRect();
    const x = e.clientX - rect.left + tracksCol.scrollLeft;
    const frame = Math.floor(x / timelinePanel.pxPerFrame);
    timelineEngine.setFrame(Math.max(0, Math.min(frame, timelineEngine.totalFrames - 1)));
  });

  // Ruler click to seek
  const rulerCanvas = document.getElementById('timeline-ruler-canvas');
  if (rulerCanvas) {
    rulerCanvas.addEventListener('click', (e) => {
      const rect = rulerCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = Math.floor(x / timelinePanel.pxPerFrame);
      timelineEngine.setFrame(Math.max(0, Math.min(frame, timelineEngine.totalFrames - 1)));
    });
  }
}

// ─── Color Presets ────────────────────────────────────────────────────────────
function bindColorPresetEvents() {
  document.querySelectorAll('.preset-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.preset-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.preset-tab-content').forEach(c => c.classList.add('hidden'));
      const target = document.getElementById(tab.dataset.presetTab + '-content');
      if (target) target.classList.remove('hidden');
    });
  });

  $on('btn-add-color-preset', () => {
    const layers = editor.getSelectedLayers();
    if (layers.length > 0 && layers[0].fill) {
      addColorSwatch(layers[0].fill.color || '#7C3AED');
    }
  });
}

function setupColorPresets() {
  // Default color swatches
  const defaultSwatches = [
    '#7C3AED','#4F46E5','#06B6D4','#10B981','#F59E0B','#EF4444','#F97316',
    '#EC4899','#8B5CF6','#3B82F6','#14B8A6','#22C55E','#EAB308','#F43F5E',
    '#ffffff','#e0e0f0','#9090b8','#5a5a80','#2a2a45','#1a1a2e','#0d0d14','#000000',
    '#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F',
  ];

  const swatchesGrid = document.createElement('div');
  swatchesGrid.className = 'swatches-grid';
  defaultSwatches.forEach(color => {
    const swatch = createColorSwatch(color);
    swatchesGrid.appendChild(swatch);
  });

  const swatchesContent = document.getElementById('swatches-content');
  if (swatchesContent) swatchesContent.appendChild(swatchesGrid);

  // Default gradients
  const defaultGradients = [
    'linear-gradient(135deg, #7C3AED, #06B6D4)',
    'linear-gradient(135deg, #EF4444, #F97316)',
    'linear-gradient(135deg, #10B981, #06B6D4)',
    'linear-gradient(135deg, #EC4899, #8B5CF6)',
    'linear-gradient(135deg, #F59E0B, #EF4444)',
    'linear-gradient(135deg, #3B82F6, #8B5CF6)',
    'linear-gradient(135deg, #1a1a2e, #4F46E5)',
    'linear-gradient(135deg, #0d0d14, #7C3AED, #06B6D4)',
  ];

  const gradientsContent = document.getElementById('gradients-content');
  if (gradientsContent) {
    defaultGradients.forEach(grad => {
      const div = document.createElement('div');
      div.className = 'gradient-preset';
      div.style.background = grad;
      div.addEventListener('click', () => {
        applyGradientPresetToSelected(grad);
      });
      gradientsContent.appendChild(div);
    });
  }

  // Color themes
  const colorThemes = [
    { name: 'Midnight', colors: ['#0d0d14','#1a1a2e','#4F46E5','#7C3AED','#06B6D4'] },
    { name: 'Sunset', colors: ['#1a0a00','#F97316','#EF4444','#EC4899','#fff'] },
    { name: 'Ocean', colors: ['#001a2e','#0a3d62','#0d79b2','#06B6D4','#a8edff'] },
    { name: 'Forest', colors: ['#0a1f0f','#1a3d1f','#2d6a2d','#4caf50','#c8e6c9'] },
    { name: 'Rose', colors: ['#1a0010','#6b003a','#c2185b','#f48fb1','#fff'] },
    { name: 'Gold', colors: ['#1a1000','#4d3800','#c79100','#F59E0B','#fff8e1'] },
  ];

  const themesContent = document.getElementById('themes-content');
  if (themesContent) {
    colorThemes.forEach(theme => {
      const row = document.createElement('div');
      row.className = 'theme-preset';
      row.title = theme.name;
      theme.colors.forEach(color => {
        const seg = document.createElement('div');
        seg.className = 'theme-color';
        seg.style.background = color;
        row.appendChild(seg);
      });
      row.addEventListener('click', () => applyColorTheme(theme.colors));
      themesContent.appendChild(row);
    });
  }
}

function createColorSwatch(color) {
  const swatch = document.createElement('div');
  swatch.className = 'color-swatch';
  swatch.style.background = color;
  swatch.title = color;
  swatch.addEventListener('click', () => {
    applyFillColorToSelected(color);
    document.getElementById('fill-color-swatch').style.background = color;
    document.getElementById('fill-hex-input').value = color.replace('#','').toUpperCase();
    document.getElementById('fill-well').style.background = color;
  });
  return swatch;
}

function addColorSwatch(color) {
  const swatchesContent = document.getElementById('swatches-content');
  const grid = swatchesContent?.querySelector('.swatches-grid');
  if (grid) {
    grid.insertBefore(createColorSwatch(color), grid.firstChild);
  }
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
function showContextMenu(x, y) {
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.remove('hidden');

  // Context menu actions
  const actions = {
    'ctx-cut': () => editor.cut(),
    'ctx-copy': () => editor.copy(),
    'ctx-paste': () => editor.paste(),
    'ctx-duplicate': () => editor.duplicateSelected(),
    'ctx-delete': () => editor.deleteSelected(),
    'ctx-bring-forward': () => editor.bringForward(),
    'ctx-send-backward': () => editor.sendBackward(),
    'ctx-group': () => editor.groupSelected(),
    'ctx-ungroup': () => editor.ungroupSelected(),
    'ctx-add-keyframe': () => addKeyframeForSelected(),
  };

  Object.entries(actions).forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) {
      el.onclick = () => { fn(); closeContextMenu(); };
    }
  });
}

function closeContextMenu() {
  document.getElementById('context-menu')?.classList.add('hidden');
}

document.addEventListener('click', () => closeContextMenu());

// ─── Helper Functions ─────────────────────────────────────────────────────────
function $on(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

function $onChange(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', fn);
}

function openModal(id) {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById(id);
  if (overlay && modal) {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    overlay.classList.remove('hidden');
    modal.classList.remove('hidden');
  }
}

function closeAllModals() {
  document.getElementById('modal-overlay')?.classList.add('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

function togglePlayback() {
  if (timelineEngine.isPlaying) timelineEngine.pause();
  else timelineEngine.play();
}

function activateTool(toolName) {
  editor.setTool(toolName);
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.tool-btn[data-tool="${toolName}"]`);
  if (btn) btn.classList.add('active');
  updateCanvasCursor(toolName);
}

function updateCanvasCursor(tool) {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;
  const cursors = {
    'select': 'default', 'direct-select': 'crosshair', 'rect': 'crosshair',
    'ellipse': 'crosshair', 'polygon': 'crosshair', 'star': 'crosshair',
    'path': 'crosshair', 'text': 'text', 'hand': 'grab', 'zoom': 'zoom-in'
  };
  canvas.style.cursor = cursors[tool] || 'default';
}

function getCanvasPos(e) {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return {x:0,y:0};
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function updateTimeDisplay(frame) {
  const fps = timelineEngine.fps;
  const totalSeconds = frame / fps;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const timeStr = `${String(hours).padStart(1,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  const timeInput = document.getElementById('current-time-input');
  if (timeInput) timeInput.value = timeStr;
}

function parseTimeToFrame(timeStr, fps) {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) return Math.round((parts[0]*3600 + parts[1]*60 + parts[2]) * fps);
  if (parts.length === 2) return Math.round((parts[0]*60 + parts[1]) * fps);
  return Math.round((parts[0] || 0) * fps);
}

function updateProjectInfo() {
  const proj = editor.project;
  if (!proj) return;
  const fps = document.getElementById('fps-display');
  if (fps) fps.textContent = proj.fps + 'fps';
  const sizeLabel = document.getElementById('canvas-size-label');
  if (sizeLabel) sizeLabel.textContent = `${proj.width} × ${proj.height}`;
  const totalDur = document.getElementById('total-duration');
  if (totalDur) {
    const totalSec = proj.totalFrames / proj.fps;
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    totalDur.textContent = `${m}:${String(s).padStart(2,'0')}:00`;
  }
}

function createNewProject() {
  const w = parseInt(document.getElementById('new-proj-w')?.value || 512);
  const h = parseInt(document.getElementById('new-proj-h')?.value || 512);
  const fps = parseInt(document.getElementById('new-proj-fps')?.value || 30);
  const dur = parseInt(document.getElementById('new-proj-dur')?.value || 90);
  const bg = document.getElementById('new-proj-bg')?.value || '#1a1a2e';
  const transparent = document.getElementById('new-proj-transparent')?.checked || false;

  editor.newProject({ width: w, height: h, fps, totalFrames: dur, backgroundColor: bg, transparent });
  closeAllModals();
  showToast('New project created!', 'success', 2000);
}

async function handleImportFile(file) {
  try {
    showToast(`Importing ${file.name}...`, 'info', 2000);
    const imported = await importManager.importFile(file);
    if (!imported) {
      throw new Error('No data imported');
    }

    const isCurrentProjectEmpty = layerManager.getAllLayers().length === 0;

    if (isCurrentProjectEmpty) {
      // If project is currently empty, adjust settings to match the imported file
      editor.project.width = imported.width || 512;
      editor.project.height = imported.height || 512;
      editor.project.fps = imported.fps || 30;
      editor.project.totalFrames = imported.totalFrames || 90;
      editor.project.backgroundColor = imported.backgroundColor || '#1a1a2e';
      editor.project.transparent = imported.transparent || false;

      timelineEngine.setDuration(editor.project.totalFrames);
      timelineEngine.setFps(editor.project.fps);
      timelineEngine.setFrame(0);

      if (renderEngine) {
        renderEngine.resize(editor.project.width, editor.project.height);
        renderEngine.setBackground(editor.project.backgroundColor, editor.project.transparent);
      }
      editor._updateCanvasContainer();
    }

    // ALWAYS import all layers from the file into the existing project
    if (imported.layers && Array.isArray(imported.layers)) {
      imported.layers.forEach(layer => {
        layerManager.importLayer(layer);
      });
    }

    // Merge keyframes
    if (imported.keyframes) {
      Object.entries(imported.keyframes).forEach(([layerId, propKfs]) => {
        Object.entries(propKfs).forEach(([propName, kfs]) => {
          kfs.forEach(kf => {
            timelineEngine.addKeyframe(layerId, propName, kf.frame, kf.value, kf.easing);
          });
        });
      });
    }

    editor.refresh();
    showToast(`${file.name} imported successfully!`, 'success', 3000);

  } catch (err) {
    console.error('Import error:', err);
    showToast(`Import failed: ${err.message}`, 'error', 4000);
  }
}

async function doExport() {
  const activeCard = document.querySelector('.export-format-card.active');
  if (!activeCard) return;
  const format = activeCard.dataset.format;
  const scale = parseFloat(document.getElementById('export-scale')?.value || 1);
  const quality = parseFloat(document.getElementById('export-quality')?.value || 0.92);

  const progressBar = document.getElementById('export-progress-bar');
  const progressLabel = document.getElementById('export-progress-label');
  const progressDiv = document.getElementById('export-progress');

  if (progressDiv) progressDiv.classList.remove('hidden');
  if (progressBar) progressBar.style.width = '10%';
  if (progressLabel) progressLabel.textContent = 'Exporting...';

  try {
    const onProgress = (pct) => {
      if (progressBar) progressBar.style.width = pct + '%';
      if (progressLabel) progressLabel.textContent = `Exporting... ${pct}%`;
    };

    const blob = await exportManager.exportAs(format, { scale, quality, onProgress });
    if (progressBar) progressBar.style.width = '100%';
    if (progressLabel) progressLabel.textContent = 'Done!';

    const extMap = { lottie:'json', dotlottie:'lottie', tgs:'tgs', gif:'gif', png:'png', 'png-seq':'zip', jpeg:'jpg', svg:'svg', webm:'webm', mp4:'mp4' };
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `animation.${extMap[format] || format}`;
    a.click();
    URL.revokeObjectURL(url);

    setTimeout(() => {
      closeAllModals();
      if (progressDiv) progressDiv.classList.add('hidden');
      if (progressBar) progressBar.style.width = '0%';
      showToast(`Exported as ${format.toUpperCase()}!`, 'success', 3000);
    }, 800);
  } catch (err) {
    console.error('Export error:', err);
    if (progressLabel) progressLabel.textContent = 'Export failed!';
    showToast(`Export failed: ${err.message}`, 'error', 4000);
  }
}

function saveProject() {
  const data = editor.saveProject();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.name || 'project'}.animaforge.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Project saved!', 'success', 2000);
}

function saveProjectAs() {
  const name = prompt('Project name:', editor.project?.name || 'My Animation');
  if (name !== null) {
    if (editor.project) editor.project.name = name;
    saveProject();
  }
}

function selectExportFormat(fmt) {
  document.querySelectorAll('.export-format-card').forEach(c => {
    c.classList.toggle('active', c.dataset.format === fmt);
  });
}

function triggerFileImport(accept) {
  const input = document.getElementById('file-import-input');
  if (input) { input.accept = accept; input.click(); }
}

function toggleGrid() {
  const container = document.getElementById('canvas-container');
  if (container) container.classList.toggle('canvas-grid');
  const btn = document.getElementById('btn-toggle-grid-canvas');
  if (btn) btn.classList.toggle('active');
}

function toggleRulers() {
  const rulerH = document.getElementById('ruler-h');
  const rulerV = document.getElementById('ruler-v');
  const corner = document.getElementById('canvas-ruler-corner');
  [rulerH, rulerV, corner].forEach(el => {
    if (el) el.style.visibility = el.style.visibility === 'hidden' ? '' : 'hidden';
  });
}

function toggleTransparentBg() {
  const container = document.getElementById('canvas-container');
  if (!container) return;
  const isTransparent = container.style.backgroundImage !== '';
  if (isTransparent) {
    container.style.backgroundImage = '';
    container.style.backgroundColor = editor.project?.backgroundColor || '#1a1a2e';
  } else {
    container.style.backgroundImage = 'linear-gradient(45deg, #555 25%, transparent 25%), linear-gradient(-45deg, #555 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #555 75%), linear-gradient(-45deg, transparent 75%, #555 75%)';
    container.style.backgroundSize = '20px 20px';
    container.style.backgroundPosition = '0 0, 0 10px, 10px -10px, -10px 0px';
    container.style.backgroundColor = '#888';
  }
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? '' : theme);
  showToast(`Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`, 'info', 1500);
}

function swapFillStroke() {
  const fillWell = document.getElementById('fill-well');
  const strokeWell = document.getElementById('stroke-well');
  if (fillWell && strokeWell) {
    const tmp = fillWell.style.background;
    fillWell.style.background = strokeWell.style.background;
    strokeWell.style.background = tmp;
  }
}

function resetDefaultColors() {
  const fillWell = document.getElementById('fill-well');
  const strokeWell = document.getElementById('stroke-well');
  if (fillWell) fillWell.style.background = '#7C3AED';
  if (strokeWell) strokeWell.style.background = '#ffffff';
}

function applyFillColorToSelected(color) {
  editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'fill.color', color));
}

function applyStrokeColorToSelected(color) {
  editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'stroke.color', color));
}

function applyFillTypeToSelected(type) {
  editor.getSelectedLayers().forEach(l => editor.updateLayerProperty(l.id, 'fill.type', type));
  const gradEditor = document.getElementById('fill-gradient-editor');
  const solidContent = document.querySelector('.fill-solid-content');
  if (gradEditor && solidContent) {
    const isGrad = type === 'linear' || type === 'radial';
    gradEditor.classList.toggle('hidden', !isGrad);
    solidContent.style.display = type === 'solid' ? '' : 'none';
  }
}

function toggleFillEditor(type) {
  const gradEditor = document.getElementById('fill-gradient-editor');
  const solidContent = document.querySelector('.fill-solid-content');
  if (gradEditor && solidContent) {
    const isGrad = type === 'linear' || type === 'radial';
    gradEditor.classList.toggle('hidden', !isGrad);
    solidContent.style.display = type === 'solid' ? '' : 'none';
    if (isGrad) gradientEditor.render();
  }
}

function applyGradientPresetToSelected(cssGradient) {
  // Parse gradient string and apply
  const stops = parseGradientCSS(cssGradient);
  editor.getSelectedLayers().forEach(l => {
    editor.updateLayerProperty(l.id, 'fill.type', 'linear');
    editor.updateLayerProperty(l.id, 'fill.gradient', { stops, angle: 135 });
  });
}

function parseGradientCSS(css) {
  const colors = css.match(/#[0-9A-Fa-f]{6}/g) || ['#7C3AED', '#06B6D4'];
  return colors.map((c, i) => ({ color: c, position: i / (colors.length - 1), alpha: 1 }));
}

function applyColorTheme(colors) {
  // Apply first color as fill, second as stroke
  if (colors[2]) applyFillColorToSelected(colors[2]);
  if (colors[4] || colors[3]) applyStrokeColorToSelected(colors[4] || colors[3]);
  showToast('Color theme applied!', 'success', 1500);
}

function addKeyframeForSelected() {
  const layers = editor.getSelectedLayers();
  if (layers.length === 0) { showToast('Select a layer first', 'warning', 2000); return; }
  const frame = timelineEngine.currentFrame;
  layers.forEach(layer => {
    const state = timelineEngine.getAnimatedState(layer.id, frame);
    timelineEngine.addKeyframe(layer.id, 'position', frame, { x: state.x, y: state.y }, 'ease-in-out');
    timelineEngine.addKeyframe(layer.id, 'opacity', frame, state.opacity ?? 1, 'ease-in-out');
  });
  timelinePanel.render();
  showToast(`Keyframe added at frame ${frame}`, 'success', 1500);
}

function addKeyframeForProperty(prop) {
  const layers = editor.getSelectedLayers();
  if (layers.length === 0) return;
  const frame = timelineEngine.currentFrame;
  layers.forEach(layer => {
    const state = timelineEngine.getAnimatedState(layer.id, frame);
    let value;
    switch (prop) {
      case 'position': value = { x: state.x ?? layer.transform.x, y: state.y ?? layer.transform.y }; break;
      case 'scale': value = { x: state.scaleX ?? 1, y: state.scaleY ?? 1 }; break;
      case 'rotation': value = state.rotation ?? layer.transform.rotation ?? 0; break;
      case 'opacity': value = state.opacity ?? layer.opacity ?? 1; break;
      case 'fill': value = layer.fill?.color ?? '#7C3AED'; break;
    }
    timelineEngine.addKeyframe(layer.id, prop, frame, value, 'ease-in-out');
  });
  timelinePanel.render();
  showToast(`Keyframe added: ${prop} @ frame ${frame}`, 'success', 1500);
}

function setKeyframeEasing(easing) {
  showToast(`Easing: ${easing}`, 'info', 1500);
}

function showEffectsMenu() {
  const effectTypes = ['Drop Shadow', 'Inner Shadow', 'Outer Glow', 'Inner Glow', 'Blur', 'Motion Blur'];
  const selected = prompt(`Add Effect:\n${effectTypes.map((e,i) => `${i+1}. ${e}`).join('\n')}\nEnter number:`, '1');
  const idx = parseInt(selected) - 1;
  if (idx >= 0 && idx < effectTypes.length) {
    const layers = editor.getSelectedLayers();
    layers.forEach(l => {
      const effects = [...(l.effects || [])];
      effects.push({ type: effectTypes[idx].toLowerCase().replace(' ', '-'), enabled: true });
      editor.updateLayerProperty(l.id, 'effects', effects);
    });
    showToast(`Effect added: ${effectTypes[idx]}`, 'success', 2000);
  }
}

function syncSliderInput(slider, input, onChange) {
  if (!slider || !input) return;
  slider.addEventListener('input', () => {
    input.value = slider.value;
    onChange(parseFloat(slider.value));
  });
  input.addEventListener('change', () => {
    slider.value = input.value;
    onChange(parseFloat(input.value));
  });
}

function updateRulerCursor(e) {
  // Ruler position indicators (simplified)
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  // Could draw ruler cursor lines here
}

function randomColor() {
  const colors = ['#7C3AED','#4F46E5','#06B6D4','#10B981','#F59E0B','#EF4444','#EC4899','#8B5CF6'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ─── Toast System ─────────────────────────────────────────────────────────────
export function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span class="toast-icon">${icons[type] || '💬'}</span><span class="toast-msg">${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── Initialize ───────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', initApp);

// Handle window resize
window.addEventListener('resize', () => {
  if (renderEngine) renderEngine.resize();
  if (timelinePanel) timelinePanel.renderRuler();
});
