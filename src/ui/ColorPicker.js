/**
 * AnimaForge - ColorPicker
 * Full-featured HSV color picker with spectrum, hue, and alpha sliders.
 * Manages the #modal-color-picker DOM element.
 */

// ─── Color Math Utilities ────────────────────────────────────────────────────

export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;

  if (h < 60)      { r = c; g = x; b = 0; }
  else if (h < 120){ r = x; g = c; b = 0; }
  else if (h < 180){ r = 0; g = c; b = x; }
  else if (h < 240){ r = 0; g = x; b = c; }
  else if (h < 300){ r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0, s = 0, v = max;

  if (delta !== 0) {
    s = delta / max;
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  return { h, s, v };
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (hex.length !== 6) return { r: 0, g: 0, b: 0 };
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// ─── ColorPicker Class ───────────────────────────────────────────────────────

export class ColorPicker {
  constructor() {
    this._modal = null;
    this._spectrumCanvas = null;
    this._hueCanvas = null;
    this._alphaCanvas = null;
    this._spectrumCtx = null;
    this._hueCtx = null;
    this._alphaCtx = null;

    this._h = 0;
    this._s = 1;
    this._v = 1;
    this._a = 1;

    this._callback = null;
    this._dragging = null; // 'spectrum' | 'hue' | 'alpha'

    this._spectrumCursor = { x: 0, y: 0 };
    this._hueCursor = 0;
    this._alphaCursor = 0;

    this._mode = 'hex'; // 'hex' | 'rgb' | 'hsl'

    this._init();
  }

  // ─── Initialization ─────────────────────────────────────────────────────

  _init() {
    // Create modal if it doesn't exist
    if (!document.getElementById('modal-color-picker')) {
      this._createModal();
    }
    this._modal = document.getElementById('modal-color-picker');
    this._spectrumCanvas = document.getElementById('color-spectrum-canvas');
    this._hueCanvas = document.getElementById('color-hue-canvas');
    this._alphaCanvas = document.getElementById('color-alpha-canvas');

    if (!this._spectrumCanvas || !this._hueCanvas || !this._alphaCanvas) {
      console.warn('ColorPicker: canvas elements not found, deferring init');
      return;
    }

    this._spectrumCtx = this._spectrumCanvas.getContext('2d');
    this._hueCtx = this._hueCanvas.getContext('2d');
    this._alphaCtx = this._alphaCanvas.getContext('2d');

    this._bindEvents();
    this.drawHueBar();
  }

  _createModal() {
    const modal = document.createElement('div');
    modal.id = 'modal-color-picker';
    modal.className = 'color-picker-modal';
    modal.style.cssText = `
      display: none;
      position: fixed;
      z-index: 10000;
      background: #1e1e2a;
      border: 1px solid #3a3a4a;
      border-radius: 10px;
      padding: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      user-select: none;
      width: 260px;
    `;
    modal.innerHTML = `
      <div class="cp-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:12px;font-weight:600;color:#aaa;letter-spacing:0.05em;">COLOR PICKER</span>
        <button id="cp-close-btn" style="background:none;border:none;color:#888;font-size:16px;cursor:pointer;padding:0 4px;">✕</button>
      </div>

      <div class="cp-spectrum-wrap" style="position:relative;margin-bottom:10px;">
        <canvas id="color-spectrum-canvas" width="228" height="160"
          style="border-radius:6px;cursor:crosshair;display:block;width:228px;height:160px;"></canvas>
        <div id="cp-spectrum-cursor" style="
          position:absolute;width:12px;height:12px;border-radius:50%;
          border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.5);
          transform:translate(-50%,-50%);pointer-events:none;top:0;left:0;"></div>
      </div>

      <div class="cp-sliders" style="display:grid;gap:8px;margin-bottom:12px;">
        <div style="position:relative;height:16px;">
          <canvas id="color-hue-canvas" width="228" height="16"
            style="border-radius:8px;cursor:ew-resize;display:block;width:228px;height:16px;"></canvas>
          <div id="cp-hue-cursor" style="
            position:absolute;width:16px;height:16px;border-radius:50%;
            border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.4);
            transform:translateX(-50%);pointer-events:none;top:0;left:0;"></div>
        </div>
        <div style="position:relative;height:16px;">
          <canvas id="color-alpha-canvas" width="228" height="16"
            style="border-radius:8px;cursor:ew-resize;display:block;width:228px;height:16px;"></canvas>
          <div id="cp-alpha-cursor" style="
            position:absolute;width:16px;height:16px;border-radius:50%;
            border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.4);
            transform:translateX(-50%);pointer-events:none;top:0;left:0;"></div>
        </div>
      </div>

      <div class="cp-preview-row" style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
        <div id="cp-preview-old" style="width:32px;height:32px;border-radius:4px;border:1px solid #444;"></div>
        <div id="cp-preview-new" style="width:32px;height:32px;border-radius:4px;border:1px solid #444;"></div>
        <div style="flex:1;"></div>
        <div class="cp-mode-btns" style="display:flex;gap:2px;">
          <button class="cp-mode-btn active" data-mode="hex" style="padding:3px 8px;font-size:10px;border:1px solid #444;background:#2a2a3a;color:#ccc;border-radius:3px;cursor:pointer;">HEX</button>
          <button class="cp-mode-btn" data-mode="rgb" style="padding:3px 8px;font-size:10px;border:1px solid #333;background:none;color:#888;border-radius:3px;cursor:pointer;">RGB</button>
          <button class="cp-mode-btn" data-mode="hsl" style="padding:3px 8px;font-size:10px;border:1px solid #333;background:none;color:#888;border-radius:3px;cursor:pointer;">HSL</button>
        </div>
      </div>

      <div id="cp-input-hex" class="cp-inputs" style="display:grid;grid-template-columns:1fr;gap:4px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="color:#888;font-size:10px;width:20px;">#</label>
          <input id="cp-hex-input" type="text" maxlength="7"
            style="flex:1;background:#111;border:1px solid #333;color:#eee;padding:4px 6px;border-radius:4px;font-size:12px;font-family:monospace;" />
        </div>
      </div>

      <div id="cp-input-rgb" class="cp-inputs" style="display:none;grid-template-columns:1fr 1fr 1fr;gap:4px;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          <input id="cp-r-input" type="number" min="0" max="255"
            style="width:100%;background:#111;border:1px solid #333;color:#eee;padding:4px;border-radius:4px;font-size:11px;text-align:center;" />
          <label style="color:#888;font-size:9px;">R</label>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          <input id="cp-g-input" type="number" min="0" max="255"
            style="width:100%;background:#111;border:1px solid #333;color:#eee;padding:4px;border-radius:4px;font-size:11px;text-align:center;" />
          <label style="color:#888;font-size:9px;">G</label>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          <input id="cp-b-input" type="number" min="0" max="255"
            style="width:100%;background:#111;border:1px solid #333;color:#eee;padding:4px;border-radius:4px;font-size:11px;text-align:center;" />
          <label style="color:#888;font-size:9px;">B</label>
        </div>
      </div>

      <div id="cp-input-hsl" class="cp-inputs" style="display:none;grid-template-columns:1fr 1fr 1fr;gap:4px;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          <input id="cp-hue-input" type="number" min="0" max="360"
            style="width:100%;background:#111;border:1px solid #333;color:#eee;padding:4px;border-radius:4px;font-size:11px;text-align:center;" />
          <label style="color:#888;font-size:9px;">H°</label>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          <input id="cp-sat-input" type="number" min="0" max="100"
            style="width:100%;background:#111;border:1px solid #333;color:#eee;padding:4px;border-radius:4px;font-size:11px;text-align:center;" />
          <label style="color:#888;font-size:9px;">S%</label>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          <input id="cp-light-input" type="number" min="0" max="100"
            style="width:100%;background:#111;border:1px solid #333;color:#eee;padding:4px;border-radius:4px;font-size:11px;text-align:center;" />
          <label style="color:#888;font-size:9px;">L%</label>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-top:12px;">
        <label style="color:#888;font-size:10px;min-width:24px;">A%</label>
        <input id="cp-alpha-input" type="number" min="0" max="100"
        value="100"
          style="width:56px;background:#111;border:1px solid #333;color:#eee;padding:4px 6px;border-radius:4px;font-size:11px;text-align:center;" />
      </div>

      <div style="display:flex;gap:8px;margin-top:14px;">
        <button id="cp-cancel-btn" style="flex:1;padding:6px;background:#2a2a3a;border:1px solid #444;color:#aaa;border-radius:5px;cursor:pointer;font-size:12px;">Cancel</button>
        <button id="cp-ok-btn" style="flex:1;padding:6px;background:linear-gradient(135deg,#5b6ef5,#7b4fd0);border:none;color:white;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600;">Apply</button>
      </div>
    `;

    document.body.appendChild(modal);

    // Make modal draggable
    const header = modal.querySelector('.cp-header');
    this._makeDraggable(modal, header);
  }

  _makeDraggable(el, handle) {
    let ox = 0, oy = 0, startX = 0, startY = 0;
    const onMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      el.style.left = (ox + clientX - startX) + 'px';
      el.style.top = (oy + clientY - startY) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    handle.addEventListener('mousedown', (e) => {
      ox = el.offsetLeft;
      oy = el.offsetTop;
      startX = e.clientX;
      startY = e.clientY;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _bindEvents() {
    const modal = this._modal;

    // Close buttons
    modal.querySelector('#cp-close-btn')?.addEventListener('click', () => this.close());
    modal.querySelector('#cp-cancel-btn')?.addEventListener('click', () => this.close());
    modal.querySelector('#cp-ok-btn')?.addEventListener('click', () => {
      if (this._callback) this._callback(this.getHex(), this._a);
      this.close();
    });

    // Mode buttons
    modal.querySelectorAll('.cp-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.cp-mode-btn').forEach(b => {
          b.style.background = 'none';
          b.style.color = '#888';
          b.style.border = '1px solid #333';
        });
        btn.style.background = '#2a2a3a';
        btn.style.color = '#ccc';
        btn.style.border = '1px solid #444';
        this._mode = btn.dataset.mode;
        this._showInputMode(this._mode);
        this._updateInputs();
      });
    });

    // Spectrum canvas
    const spectrum = this._spectrumCanvas;
    spectrum.addEventListener('mousedown', (e) => {
      this._dragging = 'spectrum';
      this._onSpectrumMouse(e);
    });

    // Hue canvas
    this._hueCanvas.addEventListener('mousedown', (e) => {
      this._dragging = 'hue';
      this._onHueMouse(e);
    });

    // Alpha canvas
    this._alphaCanvas.addEventListener('mousedown', (e) => {
      this._dragging = 'alpha';
      this._onAlphaMouse(e);
    });

    document.addEventListener('mousemove', (e) => {
      if (this._dragging === 'spectrum') this._onSpectrumMouse(e);
      else if (this._dragging === 'hue') this._onHueMouse(e);
      else if (this._dragging === 'alpha') this._onAlphaMouse(e);
    });

    document.addEventListener('mouseup', () => { this._dragging = null; });

    // HEX input
    modal.querySelector('#cp-hex-input')?.addEventListener('input', (e) => {
      const hex = e.target.value;
      if (/^#?[0-9a-fA-F]{6}$/.test(hex)) {
        this.updateFromHex(hex.startsWith('#') ? hex : '#' + hex);
      }
    });

    // RGB inputs
    ['r', 'g', 'b'].forEach(ch => {
      modal.querySelector(`#cp-${ch}-input`)?.addEventListener('input', () => this._onRgbInput());
    });

    // HSL inputs
    ['hue', 'sat', 'light'].forEach(ch => {
      modal.querySelector(`#cp-${ch}-input`)?.addEventListener('input', () => this._onHslInput());
    });

    // Alpha input
    modal.querySelector('#cp-alpha-input')?.addEventListener('input', (e) => {
      this._a = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) / 100;
      this.drawAlphaBar(hsvToRgb(this._h, this._s, this._v));
      this._updateAlphaCursor();
      this._updatePreview();
    });
  }

  // ─── Canvas Drawing ──────────────────────────────────────────────────────

  drawSpectrum(hue) {
    const ctx = this._spectrumCtx;
    if (!ctx) return;
    const w = this._spectrumCanvas.width;
    const h = this._spectrumCanvas.height;

    // Base hue color
    ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
    ctx.fillRect(0, 0, w, h);

    // White gradient (left to right)
    const whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
    whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
    whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0, 0, w, h);

    // Black gradient (top to bottom)
    const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
    blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
    blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0, 0, w, h);
  }

  drawHueBar() {
    const ctx = this._hueCtx;
    if (!ctx) return;
    const w = this._hueCanvas.width;
    const h = this._hueCanvas.height;

    const grad = ctx.createLinearGradient(0, 0, w, 0);
    const stops = [0, 60, 120, 180, 240, 300, 360];
    stops.forEach(deg => {
      grad.addColorStop(deg / 360, `hsl(${deg}, 100%, 50%)`);
    });
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  drawAlphaBar(rgb) {
    const ctx = this._alphaCtx;
    if (!ctx) return;
    const w = this._alphaCanvas.width;
    const h = this._alphaCanvas.height;

    // Checkerboard pattern
    const size = 8;
    for (let x = 0; x < Math.ceil(w / size); x++) {
      for (let y = 0; y < Math.ceil(h / size); y++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#cccccc' : '#888888';
        ctx.fillRect(x * size, y * size, size, size);
      }
    }

    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},1)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // ─── Cursor Updates ──────────────────────────────────────────────────────

  _updateSpectrumCursor() {
    const cursor = this._modal?.querySelector('#cp-spectrum-cursor');
    if (!cursor) return;
    const w = this._spectrumCanvas.width;
    const h = this._spectrumCanvas.height;
    cursor.style.left = (this._s * w) + 'px';
    cursor.style.top = ((1 - this._v) * h) + 'px';
  }

  _updateHueCursor() {
    const cursor = this._modal?.querySelector('#cp-hue-cursor');
    if (!cursor) return;
    cursor.style.left = (this._h / 360 * this._hueCanvas.width) + 'px';
  }

  _updateAlphaCursor() {
    const cursor = this._modal?.querySelector('#cp-alpha-cursor');
    if (!cursor) return;
    cursor.style.left = (this._a * this._alphaCanvas.width) + 'px';
  }

  _updatePreview() {
    const rgb = hsvToRgb(this._h, this._s, this._v);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    const newBox = this._modal?.querySelector('#cp-preview-new');
    if (newBox) {
      newBox.style.background = `rgba(${rgb.r},${rgb.g},${rgb.b},${this._a})`;
    }
  }

  // ─── Mouse Event Handlers ────────────────────────────────────────────────

  _onSpectrumMouse(e) {
    const rect = this._spectrumCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    this._s = x;
    this._v = 1 - y;
    this.updateFromHSV(this._h, this._s, this._v, this._a);
  }

  _onHueMouse(e) {
    const rect = this._hueCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this._h = Math.round(x * 360);
    this.updateFromHSV(this._h, this._s, this._v, this._a);
    this.drawSpectrum(this._h);
  }

  _onAlphaMouse(e) {
    const rect = this._alphaCanvas.getBoundingClientRect();
    this._a = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.updateFromHSV(this._h, this._s, this._v, this._a);
  }

  // ─── Update Methods ──────────────────────────────────────────────────────

  updateFromHSV(h, s, v, a = this._a) {
    this._h = h;
    this._s = s;
    this._v = v;
    this._a = a;

    this.drawSpectrum(h);
    this.drawAlphaBar(hsvToRgb(h, s, v));
    this._updateSpectrumCursor();
    this._updateHueCursor();
    this._updateAlphaCursor();
    this._updatePreview();
    this._updateInputs();
  }

  updateFromHex(hex) {
    const rgb = hexToRgb(hex);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    this.updateFromHSV(hsv.h, hsv.s, hsv.v, this._a);
  }

  _onRgbInput() {
    const r = parseInt(this._modal?.querySelector('#cp-r-input')?.value || 0);
    const g = parseInt(this._modal?.querySelector('#cp-g-input')?.value || 0);
    const b = parseInt(this._modal?.querySelector('#cp-b-input')?.value || 0);
    const hsv = rgbToHsv(r, g, b);
    this.updateFromHSV(hsv.h, hsv.s, hsv.v, this._a);
  }

  _onHslInput() {
    const h = parseInt(this._modal?.querySelector('#cp-hue-input')?.value || 0);
    const s = parseInt(this._modal?.querySelector('#cp-sat-input')?.value || 0);
    const l = parseInt(this._modal?.querySelector('#cp-light-input')?.value || 0);
    const rgb = hslToRgb(h, s, l);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    this.updateFromHSV(hsv.h, hsv.s, hsv.v, this._a);
  }

  _updateInputs() {
    const rgb = hsvToRgb(this._h, this._s, this._v);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

    const hexInput = this._modal?.querySelector('#cp-hex-input');
    if (hexInput && document.activeElement !== hexInput) hexInput.value = hex;

    const rInput = this._modal?.querySelector('#cp-r-input');
    const gInput = this._modal?.querySelector('#cp-g-input');
    const bInput = this._modal?.querySelector('#cp-b-input');
    if (rInput && document.activeElement !== rInput) rInput.value = rgb.r;
    if (gInput && document.activeElement !== gInput) gInput.value = rgb.g;
    if (bInput && document.activeElement !== bInput) bInput.value = rgb.b;

    const hueInput = this._modal?.querySelector('#cp-hue-input');
    const satInput = this._modal?.querySelector('#cp-sat-input');
    const lightInput = this._modal?.querySelector('#cp-light-input');
    if (hueInput && document.activeElement !== hueInput) hueInput.value = hsl.h;
    if (satInput && document.activeElement !== satInput) satInput.value = hsl.s;
    if (lightInput && document.activeElement !== lightInput) lightInput.value = hsl.l;

    const alphaInput = this._modal?.querySelector('#cp-alpha-input');
    if (alphaInput && document.activeElement !== alphaInput) {
      alphaInput.value = Math.round(this._a * 100);
    }
  }

  _showInputMode(mode) {
    ['hex', 'rgb', 'hsl'].forEach(m => {
      const el = this._modal?.querySelector(`#cp-input-${m}`);
      if (el) el.style.display = m === mode ? (m === 'hex' ? 'grid' : 'grid') : 'none';
    });
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Open the color picker at a position with an initial color.
   * @param {string} currentColor - Hex color string or rgba
   * @param {Function} callback - Called with (hexColor, alpha) when applied
   * @param {Object} [position] - {x, y} screen position
   */
  open(currentColor, callback, position = null) {
    if (!this._modal) this._init();
    if (!this._modal) return;

    this._callback = callback;

    // Parse initial color
    let rgb = { r: 0, g: 0, b: 0 };
    let alpha = 1;
    if (currentColor) {
      if (currentColor.startsWith('#')) {
        rgb = hexToRgb(currentColor);
      } else if (currentColor.startsWith('rgb')) {
        const m = currentColor.match(/[\d.]+/g);
        if (m) { rgb = { r: +m[0], g: +m[1], b: +m[2] }; alpha = m[3] !== undefined ? +m[3] : 1; }
      }
    }

    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    this._a = alpha;

    // Set old preview
    const oldBox = this._modal.querySelector('#cp-preview-old');
    if (oldBox) oldBox.style.background = currentColor || '#000';

    this._modal.style.display = 'block';

    // Position the modal
    if (position) {
      const vpW = window.innerWidth, vpH = window.innerHeight;
      let { x, y } = position;
      x = Math.min(x, vpW - 280);
      y = Math.min(y, vpH - 520);
      this._modal.style.left = Math.max(8, x) + 'px';
      this._modal.style.top = Math.max(8, y) + 'px';
      this._modal.style.position = 'fixed';
    } else {
      this._modal.style.left = '50%';
      this._modal.style.top = '50%';
      this._modal.style.transform = 'translate(-50%, -50%)';
    }

    this.drawHueBar();
    this.updateFromHSV(hsv.h, hsv.s, hsv.v, alpha);
  }

  close() {
    if (this._modal) this._modal.style.display = 'none';
    this._callback = null;
  }

  getHex() {
    const rgb = hsvToRgb(this._h, this._s, this._v);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  getRGB() {
    return hsvToRgb(this._h, this._s, this._v);
  }

  getHSL() {
    const rgb = hsvToRgb(this._h, this._s, this._v);
    return rgbToHsl(rgb.r, rgb.g, rgb.b);
  }

  getAlpha() {
    return this._a;
  }

  getRGBA() {
    const rgb = this.getRGB();
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${this._a})`;
  }
}

export default ColorPicker;
