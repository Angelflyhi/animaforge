/**
 * AnimaForge - ExportManager
 * Exports projects to various file formats.
 * Supported: lottie, tgs, dotlottie, gif, png, jpeg, svg, png-seq, webm
 */

import { gzipSync, zipSync } from 'fflate';

// ─── Color Utilities ─────────────────────────────────────────────────────────

function hexToRgbArray(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

// ─── Lottie Exporter ─────────────────────────────────────────────────────────

class LottieExporter {
  constructor() {}

  export(project) {
    const lottie = {
      v: '5.9.0',
      fr: project.frameRate || 30,
      ip: project.inPoint || 0,
      op: project.outPoint || 60,
      w: project.width || 512,
      h: project.height || 512,
      nm: project.name || 'AnimaForge Export',
      ddd: 0,
      assets: [],
      layers: [],
    };

    if (project.layers) {
      lottie.layers = project.layers.map((l, i) => this._exportLayer(l, i)).filter(Boolean);
    }

    return lottie;
  }

  _exportLayer(layer, index) {
    const base = {
      ty: this._getLayerTy(layer.type),
      nm: layer.name || `Layer ${index + 1}`,
      ind: index + 1,
      ip: layer.inPoint ?? 0,
      op: layer.outPoint ?? 60,
      st: layer.startTime ?? 0,
      bm: layer.blendMode ?? 0,
      hd: !layer.visible,
      ks: this._exportTransform(layer.transform),
    };

    if (layer.parent) base.parent = layer.parent;

    if (layer.type === 'shape') {
      base.shapes = (layer.shapes || []).map(s => this._exportShape(s)).filter(Boolean);
    } else if (layer.type === 'solid') {
      base.sc = layer.solidColor || '#000000';
      base.sw = layer.solidWidth || 512;
      base.sh = layer.solidHeight || 512;
    } else if (layer.type === 'image') {
      base.refId = layer.assetId || '';
    } else if (layer.type === 'composition') {
      base.refId = layer.assetId || '';
    }

    return base;
  }

  _getLayerTy(type) {
    switch (type) {
      case 'composition': return 1;
      case 'solid': return 2;
      case 'image': return 3;
      case 'null': return 4;
      case 'shape': return 5;
      case 'text': return 6;
      default: return 4;
    }
  }

  _exportTransform(t) {
    if (!t) {
      return {
        a: { a: 0, k: [0, 0] },
        p: { a: 0, k: [0, 0] },
        s: { a: 0, k: [100, 100] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: 100 },
      };
    }

    return {
      a: this._exportAnimatedValue([t.anchorX?.value ?? 0, t.anchorY?.value ?? 0], t.anchorX?.keyframes),
      p: this._exportAnimatedValue([t.x?.value ?? 0, t.y?.value ?? 0], t.x?.keyframes),
      s: this._exportAnimatedValue([t.scaleX?.value ?? 100, t.scaleY?.value ?? 100], t.scaleX?.keyframes),
      r: this._exportAnimatedValue(t.rotation?.value ?? 0, t.rotation?.keyframes),
      o: this._exportAnimatedValue(t.opacity?.value ?? 100, t.opacity?.keyframes),
    };
  }

  _exportAnimatedValue(staticValue, keyframes) {
    if (!keyframes || keyframes.length === 0) {
      return { a: 0, k: staticValue };
    }

    return {
      a: 1,
      k: keyframes.map((kf, i) => ({
        t: kf.frame,
        s: Array.isArray(kf.value) ? kf.value : [kf.value],
        e: keyframes[i + 1] ? (Array.isArray(keyframes[i + 1].value) ? keyframes[i + 1].value : [keyframes[i + 1].value]) : undefined,
        o: { x: kf.easeOut?.x ?? [0.25], y: kf.easeOut?.y ?? [0] },
        i: { x: kf.easeIn?.x ?? [0.75], y: kf.easeIn?.y ?? [1] },
      })).filter(kf => kf.e !== undefined || keyframes.length === 1),
    };
  }

  _exportShape(shape) {
    if (!shape) return null;

    const base = { ty: shape.type, nm: shape.name || shape.type, hd: !!shape.hidden };

    switch (shape.type) {
      case 'gr':
        return { ...base, it: (shape.items || []).map(i => this._exportShape(i)).filter(Boolean), np: (shape.items || []).length };

      case 'sh':
        return { ...base, ks: this._exportAnimatedValue(shape.vertices?.value, shape.vertices?.keyframes), d: shape.direction };

      case 'rc':
        return { ...base, p: this._exportAnimatedValue(shape.position?.value, shape.position?.keyframes), s: this._exportAnimatedValue(shape.size?.value, shape.size?.keyframes), r: this._exportAnimatedValue(shape.roundness?.value, shape.roundness?.keyframes) };

      case 'el':
        return { ...base, p: this._exportAnimatedValue(shape.position?.value, shape.position?.keyframes), s: this._exportAnimatedValue(shape.size?.value, shape.size?.keyframes) };

      case 'fl':
        return { ...base, c: this._exportAnimatedValue(shape.color?.value, shape.color?.keyframes), o: this._exportAnimatedValue(shape.opacity?.value, shape.opacity?.keyframes), r: shape.fillRule ?? 1 };

      case 'st':
        return { ...base, c: this._exportAnimatedValue(shape.color?.value, shape.color?.keyframes), o: this._exportAnimatedValue(shape.opacity?.value, shape.opacity?.keyframes), w: this._exportAnimatedValue(shape.width?.value, shape.width?.keyframes), lc: shape.lineCap ?? 2, lj: shape.lineJoin ?? 2, ml: shape.miterLimit ?? 4 };

      case 'tr':
        return { ...base, ...this._exportTransform(shape.transform) };

      case 'tm':
        return { ...base, s: this._exportAnimatedValue(shape.start?.value, shape.start?.keyframes), e: this._exportAnimatedValue(shape.end?.value, shape.end?.keyframes), o: this._exportAnimatedValue(shape.offset?.value, shape.offset?.keyframes), m: shape.multiple };

      default:
        return base;
    }
  }
}

// ─── Canvas Renderer ─────────────────────────────────────────────────────────

class CanvasRenderer {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  renderFrame(project, frame) {
    this.clear();
    const { frameRate = 30, inPoint = 0 } = project;
    const timeSeconds = (frame - inPoint) / frameRate;

    if (!project.layers) return;

    // Render layers bottom-to-top
    const sortedLayers = [...project.layers].reverse();
    for (const layer of sortedLayers) {
      if (!layer.visible) continue;
      if (frame < (layer.inPoint ?? 0) || frame >= (layer.outPoint ?? Infinity)) continue;
      this._renderLayer(layer, frame, timeSeconds);
    }
  }

  _renderLayer(layer, frame, time) {
    const ctx = this.ctx;
    ctx.save();

    const t = layer.transform || {};
    const x = this._getValue(t.x, frame) ?? 0;
    const y = this._getValue(t.y, frame) ?? 0;
    const rotation = this._getValue(t.rotation, frame) ?? 0;
    const scaleX = (this._getValue(t.scaleX, frame) ?? 100) / 100;
    const scaleY = (this._getValue(t.scaleY, frame) ?? 100) / 100;
    const opacity = (this._getValue(t.opacity, frame) ?? 100) / 100;
    const anchorX = this._getValue(t.anchorX, frame) ?? 0;
    const anchorY = this._getValue(t.anchorY, frame) ?? 0;

    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
    ctx.translate(x, y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scaleX, scaleY);
    ctx.translate(-anchorX, -anchorY);

    if (layer.type === 'shape') {
      this._renderShapeLayer(layer, frame);
    } else if (layer.type === 'image' && layer.src) {
      this._renderImageLayer(layer);
    } else if (layer.type === 'solid') {
      ctx.fillStyle = layer.solidColor || '#000000';
      ctx.fillRect(0, 0, layer.solidWidth || this.width, layer.solidHeight || this.height);
    }

    ctx.restore();
  }

  _getValue(prop, frame) {
    if (!prop) return null;
    if (!prop.animated || !prop.keyframes?.length) return Array.isArray(prop.value) ? prop.value[0] : prop.value;

    const kfs = prop.keyframes;
    if (frame <= kfs[0].frame) return Array.isArray(kfs[0].value) ? kfs[0].value[0] : kfs[0].value;
    if (frame >= kfs[kfs.length - 1].frame) {
      const last = kfs[kfs.length - 1].value;
      return Array.isArray(last) ? last[0] : last;
    }

    for (let i = 0; i < kfs.length - 1; i++) {
      if (frame >= kfs[i].frame && frame < kfs[i + 1].frame) {
        const t = (frame - kfs[i].frame) / (kfs[i + 1].frame - kfs[i].frame);
        const v1 = Array.isArray(kfs[i].value) ? kfs[i].value[0] : kfs[i].value;
        const v2 = Array.isArray(kfs[i + 1].value) ? kfs[i + 1].value[0] : kfs[i + 1].value;
        return v1 + (v2 - v1) * t;
      }
    }
    return null;
  }

  _renderShapeLayer(layer, frame) {
    if (!layer.shapes) return;
    for (const shape of layer.shapes) {
      this._renderShape(shape, frame);
    }
  }

  _renderShape(shape, frame) {
    if (!shape || shape.hidden) return;
    const ctx = this.ctx;

    if (shape.type === 'gr') {
      ctx.save();
      (shape.items || []).forEach(item => this._renderShape(item, frame));
      ctx.restore();
    } else if (shape.type === 'rc') {
      const pos = this._getVec2(shape.position, frame) || [0, 0];
      const size = this._getVec2(shape.size, frame) || [100, 100];
      const r = this._getValue(shape.roundness, frame) || 0;
      this._drawRect(pos[0] - size[0] / 2, pos[1] - size[1] / 2, size[0], size[1], r);
    } else if (shape.type === 'el') {
      const pos = this._getVec2(shape.position, frame) || [0, 0];
      const size = this._getVec2(shape.size, frame) || [100, 100];
      ctx.beginPath();
      ctx.ellipse(pos[0], pos[1], size[0] / 2, size[1] / 2, 0, 0, Math.PI * 2);
    } else if (shape.type === 'fl') {
      const colorArr = this._getVec4(shape.color, frame) || [0, 0, 0, 1];
      const opacity = this._getValue(shape.opacity, frame) ?? 100;
      ctx.fillStyle = `rgba(${Math.round(colorArr[0] * 255)},${Math.round(colorArr[1] * 255)},${Math.round(colorArr[2] * 255)},${(colorArr[3] ?? 1) * opacity / 100})`;
      ctx.fill();
    } else if (shape.type === 'st') {
      const colorArr = this._getVec4(shape.color, frame) || [0, 0, 0, 1];
      const opacity = this._getValue(shape.opacity, frame) ?? 100;
      const width = this._getValue(shape.width, frame) ?? 2;
      ctx.strokeStyle = `rgba(${Math.round(colorArr[0] * 255)},${Math.round(colorArr[1] * 255)},${Math.round(colorArr[2] * 255)},${(colorArr[3] ?? 1) * opacity / 100})`;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }

  _drawRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (r > 0) {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    } else {
      ctx.rect(x, y, w, h);
    }
  }

  _getVec2(prop, frame) {
    if (!prop) return null;
    if (!prop.animated) return Array.isArray(prop.value) ? prop.value : [prop.value, prop.value];
    const kfs = prop.keyframes;
    if (!kfs || !kfs.length) return Array.isArray(prop.value) ? prop.value : [prop.value, prop.value];

    if (frame <= kfs[0].frame) return Array.isArray(kfs[0].value) ? kfs[0].value : [kfs[0].value, kfs[0].value];
    if (frame >= kfs[kfs.length - 1].frame) {
      const v = kfs[kfs.length - 1].value;
      return Array.isArray(v) ? v : [v, v];
    }

    for (let i = 0; i < kfs.length - 1; i++) {
      if (frame >= kfs[i].frame && frame < kfs[i + 1].frame) {
        const t = (frame - kfs[i].frame) / (kfs[i + 1].frame - kfs[i].frame);
        const v1 = Array.isArray(kfs[i].value) ? kfs[i].value : [kfs[i].value, kfs[i].value];
        const v2 = Array.isArray(kfs[i + 1].value) ? kfs[i + 1].value : [kfs[i + 1].value, kfs[i + 1].value];
        return [v1[0] + (v2[0] - v1[0]) * t, v1[1] + (v2[1] - v1[1]) * t];
      }
    }
    return null;
  }

  _getVec4(prop, frame) {
    if (!prop) return null;
    if (!prop.animated) return Array.isArray(prop.value) ? prop.value : null;
    const kfs = prop.keyframes;
    if (!kfs || !kfs.length) return Array.isArray(prop.value) ? prop.value : null;
    if (frame <= kfs[0].frame) return kfs[0].value;
    if (frame >= kfs[kfs.length - 1].frame) return kfs[kfs.length - 1].value;
    for (let i = 0; i < kfs.length - 1; i++) {
      if (frame >= kfs[i].frame && frame < kfs[i + 1].frame) {
        const t = (frame - kfs[i].frame) / (kfs[i + 1].frame - kfs[i].frame);
        const v1 = kfs[i].value, v2 = kfs[i + 1].value;
        if (!Array.isArray(v1) || !Array.isArray(v2)) return v1;
        return v1.map((c, idx) => c + (v2[idx] - c) * t);
      }
    }
    return null;
  }

  _renderImageLayer(layer) {
    // Images are rendered via the editor's image cache in production
    // Here we attempt to draw if src is a data URL
    if (!layer._cachedImage && layer.src) {
      const img = new Image();
      img.src = layer.src;
      layer._cachedImage = img;
    }
    if (layer._cachedImage?.complete) {
      this.ctx.drawImage(layer._cachedImage, 0, 0);
    }
  }

  getImageData() {
    return this.ctx.getImageData(0, 0, this.width, this.height);
  }

  toBlob(type = 'image/png', quality = 0.95) {
    return new Promise(resolve => this.canvas.toBlob(resolve, type, quality));
  }

  toDataURL(type = 'image/png', quality = 0.95) {
    return this.canvas.toDataURL(type, quality);
  }
}

// ─── GIF Encoder ─────────────────────────────────────────────────────────────

class GifEncoder {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.frames = [];
    this.repeat = 0; // 0 = loop forever
    this.quality = 10;
  }

  addFrame(imageData, delay = 100) {
    this.frames.push({ imageData, delay });
  }

  /** NeuQuant color quantization (simplified to median cut) */
  _quantize(pixels, maxColors) {
    // Build palette using median cut algorithm
    const palette = [];
    const cubes = [{ pixels: pixels.slice(), min: [0, 0, 0], max: [255, 255, 255] }];

    while (palette.length < maxColors && cubes.length > 0) {
      // Find cube with largest range
      let bestIdx = 0;
      let bestRange = 0;
      for (let i = 0; i < cubes.length; i++) {
        const cube = cubes[i];
        const range = Math.max(
          cube.max[0] - cube.min[0],
          cube.max[1] - cube.min[1],
          cube.max[2] - cube.min[2]
        );
        if (range > bestRange) { bestRange = range; bestIdx = i; }
      }

      if (bestRange === 0) break;

      const cube = cubes.splice(bestIdx, 1)[0];
      const channel = [
        cube.max[0] - cube.min[0],
        cube.max[1] - cube.min[1],
        cube.max[2] - cube.min[2]
      ].indexOf(Math.max(cube.max[0] - cube.min[0], cube.max[1] - cube.min[1], cube.max[2] - cube.min[2]));

      cube.pixels.sort((a, b) => a[channel] - b[channel]);
      const mid = Math.floor(cube.pixels.length / 2);

      const calc = (c) => {
        if (!c.pixels.length) return { min: [0, 0, 0], max: [0, 0, 0] };
        return {
          min: [
            Math.min(...c.pixels.map(p => p[0])),
            Math.min(...c.pixels.map(p => p[1])),
            Math.min(...c.pixels.map(p => p[2]))
          ],
          max: [
            Math.max(...c.pixels.map(p => p[0])),
            Math.max(...c.pixels.map(p => p[1])),
            Math.max(...c.pixels.map(p => p[2]))
          ],
        };
      };

      const left = { pixels: cube.pixels.slice(0, mid) };
      const right = { pixels: cube.pixels.slice(mid) };
      Object.assign(left, calc(left));
      Object.assign(right, calc(right));

      cubes.push(left, right);
    }

    // Add representative color from each cube
    for (const cube of cubes) {
      if (!cube.pixels.length) continue;
      const avg = cube.pixels.reduce(
        (a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]
      ).map(v => Math.round(v / cube.pixels.length));
      palette.push(avg);
    }

    while (palette.length < maxColors) palette.push([0, 0, 0]);
    return palette.slice(0, maxColors);
  }

  _closestPaletteIndex(r, g, b, palette) {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const dr = r - palette[i][0], dg = g - palette[i][1], db = b - palette[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  _lzwEncode(indices, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const eofCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = eofCode + 1;

    const dict = new Map();
    const initDict = () => {
      dict.clear();
      for (let i = 0; i < clearCode; i++) dict.set(String(i), i);
    };
    initDict();

    const output = [];
    let bitBuf = 0, bitCount = 0;

    const writeBit = (code) => {
      bitBuf |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        output.push(bitBuf & 0xFF);
        bitBuf >>= 8;
        bitCount -= 8;
      }
    };

    writeBit(clearCode);

    let prefix = '';
    for (let i = 0; i < indices.length; i++) {
      const key = prefix ? `${prefix},${indices[i]}` : String(indices[i]);
      if (dict.has(key)) {
        prefix = key;
      } else {
        writeBit(dict.get(prefix));
        if (nextCode < 4096) {
          dict.set(key, nextCode++);
          if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
        } else {
          writeBit(clearCode);
          initDict();
          nextCode = eofCode + 1;
          codeSize = minCodeSize + 1;
        }
        prefix = String(indices[i]);
      }
    }
    if (prefix) writeBit(dict.get(prefix) ?? 0);
    writeBit(eofCode);
    if (bitCount > 0) output.push(bitBuf & 0xFF);

    return new Uint8Array(output);
  }

  _writeSubBlocks(data) {
    const result = [];
    let i = 0;
    while (i < data.length) {
      const chunk = Math.min(255, data.length - i);
      result.push(chunk);
      for (let j = 0; j < chunk; j++) result.push(data[i + j]);
      i += chunk;
    }
    result.push(0); // block terminator
    return result;
  }

  encode() {
    const bytes = [];
    const w = this.width, h = this.height;

    const writeWord = (n) => { bytes.push(n & 0xFF, (n >> 8) & 0xFF); };
    const writeByte = (n) => bytes.push(n & 0xFF);
    const writeStr = (s) => { for (let i = 0; i < s.length; i++) writeByte(s.charCodeAt(i)); };

    // --- GIF Header ---
    writeStr('GIF89a');
    writeWord(w);
    writeWord(h);

    // Global color table flag: we'll set one with 256 colors
    const gctSizePow = 7; // 2^(7+1) = 256 colors
    writeByte(0x80 | (gctSizePow << 4) | gctSizePow); // packed: GCT present, color res 7, GCT size 7
    writeByte(0); // background color index
    writeByte(0); // pixel aspect ratio

    // Build global palette from first frame
    const firstPixels = [];
    const firstData = this.frames[0]?.imageData?.data;
    if (firstData) {
      for (let i = 0; i < firstData.length; i += 4) {
        firstPixels.push([firstData[i], firstData[i + 1], firstData[i + 2]]);
      }
    }
    const palette = this._quantize(firstPixels, 256);

    // Write GCT
    for (let i = 0; i < 256; i++) {
      const c = palette[i] || [0, 0, 0];
      writeByte(c[0]); writeByte(c[1]); writeByte(c[2]);
    }

    // Netscape application extension (looping)
    writeByte(0x21); writeByte(0xFF); writeByte(11);
    writeStr('NETSCAPE2.0');
    writeByte(3); writeByte(1);
    writeWord(this.repeat);
    writeByte(0);

    // --- Frames ---
    for (const frame of this.frames) {
      const { imageData, delay } = frame;
      const data = imageData.data;

      // Graphic Control Extension
      writeByte(0x21); writeByte(0xF9); writeByte(4);
      writeByte(0x00); // disposal method = 0
      writeWord(Math.round(delay / 10)); // delay in centiseconds
      writeByte(0); // transparent color index (none)
      writeByte(0); // block terminator

      // Image Descriptor
      writeByte(0x2C);
      writeWord(0); writeWord(0); // left, top
      writeWord(w); writeWord(h);
      writeByte(0x00); // no local CT, not interlaced

      // Quantize pixels to palette indices
      const indices = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        indices[i] = this._closestPaletteIndex(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], palette);
      }

      // LZW encode
      const minCodeSize = 8;
      writeByte(minCodeSize);
      const compressed = this._lzwEncode(indices, minCodeSize);
      bytes.push(...this._writeSubBlocks(compressed));
    }

    // Trailer
    writeByte(0x3B);
    return new Uint8Array(bytes);
  }
}

// ─── SVG Exporter ────────────────────────────────────────────────────────────

class SvgExporter {
  exportFrame(project, frame) {
    const { width = 512, height = 512, layers = [] } = project;

    const children = layers
      .filter(l => l.visible && frame >= (l.inPoint ?? 0) && frame < (l.outPoint ?? Infinity))
      .reverse()
      .map(l => this._exportLayer(l, frame))
      .filter(Boolean)
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${children}
</svg>`;
  }

  _exportLayer(layer, frame) {
    if (layer.type === 'shape') {
      return this._exportShapeLayer(layer);
    } else if (layer.type === 'solid') {
      return `<rect x="0" y="0" width="${layer.solidWidth || 512}" height="${layer.solidHeight || 512}" fill="${layer.solidColor || '#000'}" />`;
    } else if (layer.type === 'image' && layer.src) {
      return `<image href="${layer.src}" width="${layer.width || 0}" height="${layer.height || 0}" />`;
    }
    return '';
  }

  _exportShapeLayer(layer) {
    const shapes = (layer.shapes || []).map(s => this._exportShape(s, 0)).join('\n');
    return `<g id="${layer.id}">${shapes}</g>`;
  }

  _exportShape(shape, frame) {
    if (!shape || shape.hidden) return '';
    switch (shape.type) {
      case 'gr':
        return `<g>${(shape.items || []).map(i => this._exportShape(i, frame)).join('')}</g>`;
      case 'rc': {
        const pos = shape.position?.value || [0, 0];
        const size = shape.size?.value || [100, 100];
        const r = shape.roundness?.value || 0;
        return `<rect x="${pos[0] - size[0] / 2}" y="${pos[1] - size[1] / 2}" width="${size[0]}" height="${size[1]}" rx="${r}" />`;
      }
      case 'el': {
        const pos = shape.position?.value || [0, 0];
        const size = shape.size?.value || [100, 100];
        return `<ellipse cx="${pos[0]}" cy="${pos[1]}" rx="${size[0] / 2}" ry="${size[1] / 2}" />`;
      }
      case 'fl': {
        const c = shape.color?.value || [0, 0, 0, 1];
        const op = (shape.opacity?.value ?? 100) / 100;
        return `<!-- fill: rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${op}) -->`;
      }
      default: return '';
    }
  }
}

// ─── ExportManager ───────────────────────────────────────────────────────────

export class ExportManager {
  constructor(editor) {
    this.editor = editor;
    this._lottieExporter = new LottieExporter();
    this._svgExporter = new SvgExporter();
  }

  /**
   * Export the current project in the given format.
   * @param {string} format - One of: lottie, tgs, dotlottie, gif, png, jpeg, svg, png-seq, webm
   * @param {Object} options
   * @returns {Promise<Blob>}
   */
  async exportAs(format, options = {}) {
    const project = this._getProject();

    switch (format.toLowerCase()) {
      case 'lottie':
        return this._exportLottie(project, options);
      case 'tgs':
        return this._exportTGS(project, options);
      case 'dotlottie':
        return this._exportDotLottie(project, options);
      case 'gif':
        return this._exportGIF(project, options);
      case 'png':
        return this._exportPNG(project, options);
      case 'jpeg':
      case 'jpg':
        return this._exportJPEG(project, options);
      case 'svg':
        return this._exportSVG(project, options);
      case 'png-seq':
        return this._exportPNGSequence(project, options);
      case 'webm':
        return this._exportWebM(project, options);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  _getProject() {
    if (this.editor && typeof this.editor.getProject === 'function') {
      return this.editor.getProject();
    }
    // Fallback: access common editor properties
    return {
      name: this.editor?.project?.name || 'AnimaForge',
      width: this.editor?.project?.width || this.editor?.width || 512,
      height: this.editor?.project?.height || this.editor?.height || 512,
      frameRate: this.editor?.project?.frameRate || this.editor?.frameRate || 30,
      inPoint: this.editor?.project?.inPoint || 0,
      outPoint: this.editor?.project?.outPoint || 60,
      layers: this.editor?.project?.layers || this.editor?.layerManager?.getAllLayers() || [],
    };
  }

  _getCurrentFrame() {
    return this.editor?.timelineEngine?.currentFrame ?? this.editor?.currentFrame ?? 0;
  }

  // ─── Format Handlers ─────────────────────────────────────────────────────

  async _exportLottie(project, options) {
    const lottieJson = this._lottieExporter.export(project);
    const jsonStr = JSON.stringify(lottieJson, null, options.pretty ? 2 : 0);
    return new Blob([jsonStr], { type: 'application/json' });
  }

  async _exportTGS(project, options) {
    const lottieJson = this._lottieExporter.export(project);
    const jsonStr = JSON.stringify(lottieJson);
    const uint8 = new TextEncoder().encode(jsonStr);
    const compressed = gzipSync(uint8, { level: 9 });

    // TGS size warning
    if (compressed.byteLength > 64 * 1024) {
      console.warn(`TGS export: file size ${compressed.byteLength} bytes exceeds Telegram's 64KB limit. Consider simplifying the animation.`);
    }

    return new Blob([compressed], { type: 'application/gzip' });
  }

  async _exportDotLottie(project, options) {
    const lottieJson = this._lottieExporter.export(project);
    const jsonStr = JSON.stringify(lottieJson);
    const jsonBytes = new TextEncoder().encode(jsonStr);

    const manifest = {
      version: '1.0',
      generator: 'AnimaForge',
      animations: [{ id: 'animation', loop: true, autoplay: true, speed: 1 }],
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

    const zipFiles = {
      'animations/animation.json': jsonBytes,
      'manifest.json': manifestBytes,
    };

    const zipped = zipSync(zipFiles, { level: 6 });
    return new Blob([zipped], { type: 'application/zip' });
  }

  async _exportGIF(project, options) {
    const { frameRate = 30, inPoint = 0, outPoint = 60, width = 512, height = 512 } = project;
    const delay = Math.round(1000 / frameRate);
    const encoder = new GifEncoder(width, height);
    const renderer = new CanvasRenderer(width, height);

    for (let frame = inPoint; frame < outPoint; frame++) {
      renderer.renderFrame(project, frame);
      const imageData = renderer.getImageData();
      encoder.addFrame(imageData, delay);
    }

    const gifData = encoder.encode();
    return new Blob([gifData], { type: 'image/gif' });
  }

  async _exportPNG(project, options) {
    const { width = 512, height = 512 } = project;
    const frame = options.frame ?? this._getCurrentFrame();
    const renderer = new CanvasRenderer(width, height);
    renderer.renderFrame(project, frame);
    return renderer.toBlob('image/png');
  }

  async _exportJPEG(project, options) {
    const { width = 512, height = 512 } = project;
    const frame = options.frame ?? this._getCurrentFrame();
    const quality = options.quality ?? 0.92;
    const renderer = new CanvasRenderer(width, height);
    renderer.renderFrame(project, frame);
    return renderer.toBlob('image/jpeg', quality);
  }

  async _exportSVG(project, options) {
    const frame = options.frame ?? this._getCurrentFrame();
    const svgStr = this._svgExporter.exportFrame(project, frame);
    return new Blob([svgStr], { type: 'image/svg+xml' });
  }

  async _exportPNGSequence(project, options) {
    const { frameRate = 30, inPoint = 0, outPoint = 60, width = 512, height = 512 } = project;
    const renderer = new CanvasRenderer(width, height);
    const files = {};

    for (let frame = inPoint; frame < outPoint; frame++) {
      renderer.renderFrame(project, frame);
      const dataUrl = renderer.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const paddedFrame = String(frame - inPoint).padStart(5, '0');
      files[`frame_${paddedFrame}.png`] = bytes;
    }

    const zipped = zipSync(files, { level: 1 }); // low compression for speed
    return new Blob([zipped], { type: 'application/zip' });
  }

  async _exportWebM(project, options) {
    const { frameRate = 30, inPoint = 0, outPoint = 60, width = 512, height = 512 } = project;

    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const stream = canvas.captureStream(frameRate);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: options.bitrate || 2500000,
      });

      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      recorder.onerror = reject;

      recorder.start();

      const renderer = new CanvasRenderer(width, height);
      const ctx = canvas.getContext('2d');
      const totalFrames = outPoint - inPoint;
      const msPerFrame = 1000 / frameRate;

      let frameIdx = 0;
      const renderNextFrame = () => {
        if (frameIdx >= totalFrames) {
          recorder.stop();
          return;
        }
        renderer.renderFrame(project, inPoint + frameIdx);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(renderer.canvas, 0, 0);
        frameIdx++;
        setTimeout(renderNextFrame, msPerFrame);
      };

      renderNextFrame();
    });
  }
}

export default ExportManager;
