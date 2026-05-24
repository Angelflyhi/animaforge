/**
 * AnimaForge – GradientEditor.js
 * Manages the gradient editor in the properties panel
 */

export class GradientEditor {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.gradient = {
      type: 'linear',
      stops: [
        { position: 0, color: '#7C3AED', alpha: 1 },
        { position: 1, color: '#06B6D4', alpha: 1 }
      ],
      angle: 135
    };
    this.selectedStopIndex = 0;
    this._setupEvents();
  }

  setGradient(gradient) {
    if (!gradient) return;
    this.gradient = {
      type: gradient.type || 'linear',
      stops: (gradient.stops || []).map(s => ({ ...s })),
      angle: gradient.angle || 0
    };
    if (this.gradient.stops.length < 2) {
      this.gradient.stops = [
        { position: 0, color: '#7C3AED', alpha: 1 },
        { position: 1, color: '#06B6D4', alpha: 1 }
      ];
    }
    this.render();
  }

  getGradient() {
    return JSON.parse(JSON.stringify(this.gradient));
  }

  render() {
    this._renderPreview();
    this._renderStops();
    this._updateStopProps();
  }

  _renderPreview() {
    const canvas = document.getElementById('gradient-preview-canvas');
    if (!canvas) return;
    canvas.width = canvas.offsetWidth || 220;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');

    let grad;
    if (this.gradient.type === 'linear') {
      const angle = (this.gradient.angle || 0) * Math.PI / 180;
      const cx = canvas.width / 2, cy = canvas.height / 2;
      const r = Math.sqrt(cx * cx + cy * cy);
      grad = ctx.createLinearGradient(
        cx - Math.cos(angle) * r, cy - Math.sin(angle) * r,
        cx + Math.cos(angle) * r, cy + Math.sin(angle) * r
      );
    } else {
      grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 0, canvas.width/2, canvas.height/2, canvas.width/2);
    }

    this.gradient.stops.forEach(stop => {
      const { r, g, b } = this._hexToRgb(stop.color || '#7C3AED');
      grad.addColorStop(
        Math.max(0, Math.min(1, stop.position)),
        `rgba(${r},${g},${b},${stop.alpha ?? 1})`
      );
    });

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  _renderStops() {
    const track = document.getElementById('gradient-track');
    if (!track) return;
    track.innerHTML = '';

    this.gradient.stops.forEach((stop, i) => {
      const stopEl = document.createElement('div');
      stopEl.className = 'gradient-stop' + (i === this.selectedStopIndex ? ' selected' : '');
      stopEl.style.left = (stop.position * 100) + '%';

      const marker = document.createElement('div');
      marker.className = 'gradient-stop-marker';
      marker.style.background = stop.color || '#7C3AED';
      stopEl.appendChild(marker);

      stopEl.addEventListener('click', (e) => { e.stopPropagation(); this.selectStop(i); });

      // Drag to move
      stopEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const track = document.getElementById('gradient-track');
        if (!track) return;
        const onMove = (me) => {
          const rect = track.getBoundingClientRect();
          const pos = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
          this.gradient.stops[i].position = pos;
          this._sortStops();
          this.render();
          this.onChange(this.getGradient());
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      track.appendChild(stopEl);
    });

    // Click on track to add stop
    track.addEventListener('click', (e) => {
      if (e.target !== track) return;
      const rect = track.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      const color = this._interpolateColor(pos);
      this.addStop(pos, color);
    });
  }

  _updateStopProps() {
    const stop = this.gradient.stops[this.selectedStopIndex];
    if (!stop) return;
    const colorInput = document.getElementById('gradient-stop-color');
    if (colorInput) colorInput.value = stop.color || '#7C3AED';
    const posInput = document.getElementById('gradient-stop-pos');
    if (posInput) posInput.value = Math.round((stop.position || 0) * 100);
    const angleInput = document.getElementById('gradient-angle');
    if (angleInput) angleInput.value = this.gradient.angle || 0;
  }

  addStop(position, color = '#ffffff') {
    this.gradient.stops.push({ position, color, alpha: 1 });
    this._sortStops();
    this.selectedStopIndex = this.gradient.stops.findIndex(s => s.position === position);
    this.render();
    this.onChange(this.getGradient());
  }

  removeStop(index) {
    if (this.gradient.stops.length <= 2) return;
    this.gradient.stops.splice(index, 1);
    if (this.selectedStopIndex >= this.gradient.stops.length) {
      this.selectedStopIndex = this.gradient.stops.length - 1;
    }
    this.render();
    this.onChange(this.getGradient());
  }

  selectStop(index) {
    this.selectedStopIndex = index;
    this._renderStops();
    this._updateStopProps();
  }

  updateStop(index, props) {
    if (!this.gradient.stops[index]) return;
    Object.assign(this.gradient.stops[index], props);
    this._sortStops();
    this.render();
    this.onChange(this.getGradient());
  }

  _sortStops() {
    this.gradient.stops.sort((a, b) => a.position - b.position);
  }

  _interpolateColor(pos) {
    const stops = this.gradient.stops;
    if (stops.length === 0) return '#7C3AED';
    if (pos <= stops[0].position) return stops[0].color;
    if (pos >= stops[stops.length - 1].position) return stops[stops.length - 1].color;

    for (let i = 0; i < stops.length - 1; i++) {
      if (pos >= stops[i].position && pos <= stops[i + 1].position) {
        const t = (pos - stops[i].position) / (stops[i + 1].position - stops[i].position);
        return this._lerpColor(stops[i].color, stops[i + 1].color, t);
      }
    }
    return '#7C3AED';
  }

  _lerpColor(c1, c2, t) {
    const a = this._hexToRgb(c1), b = this._hexToRgb(c2);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bl = Math.round(a.b + (b.b - a.b) * t);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${bl.toString(16).padStart(2,'0')}`;
  }

  _hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    return {
      r: parseInt(hex.substring(0, 2), 16) || 0,
      g: parseInt(hex.substring(2, 4), 16) || 0,
      b: parseInt(hex.substring(4, 6), 16) || 0
    };
  }

  _setupEvents() {
    const bind = () => {
      const stopColorInput = document.getElementById('gradient-stop-color');
      if (stopColorInput) {
        stopColorInput.addEventListener('input', () => {
          const idx = this.selectedStopIndex;
          if (this.gradient.stops[idx]) {
            this.gradient.stops[idx].color = stopColorInput.value;
            this.render();
            this.onChange(this.getGradient());
          }
        });
      }

      const stopPosInput = document.getElementById('gradient-stop-pos');
      if (stopPosInput) {
        stopPosInput.addEventListener('change', () => {
          const idx = this.selectedStopIndex;
          if (this.gradient.stops[idx]) {
            this.gradient.stops[idx].position = parseInt(stopPosInput.value) / 100;
            this._sortStops();
            this.render();
            this.onChange(this.getGradient());
          }
        });
      }

      const angleInput = document.getElementById('gradient-angle');
      if (angleInput) {
        angleInput.addEventListener('change', () => {
          this.gradient.angle = parseInt(angleInput.value) || 0;
          this.render();
          this.onChange(this.getGradient());
        });
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bind);
    } else {
      bind();
    }
  }
}
