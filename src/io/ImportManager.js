/**
 * AnimaForge - ImportManager
 * Handles importing various file formats into the editor.
 * Supported: Lottie JSON, TGS, GIF, PNG/JPEG, SVG, dotLottie (.lottie)
 */

import { gunzipSync, unzipSync } from 'fflate';

// ─── Lottie Layer Type Constants ────────────────────────────────────────────
const LOTTIE_LAYER = {
  COMPOSITION: 1,
  SOLID: 2,
  IMAGE: 3,
  NULL: 4,
  SHAPE: 5,
  TEXT: 6,
};

const LOTTIE_SHAPE = {
  GROUP: 'gr',
  PATH: 'sh',
  ELLIPSE: 'el',
  RECT: 'rc',
  STAR: 'sr',
  FILL: 'fl',
  STROKE: 'st',
  TRANSFORM: 'tr',
  GRADIENT_FILL: 'gf',
  GRADIENT_STROKE: 'gs',
  MERGE: 'mm',
  TRIM: 'tm',
  REPEATER: 'rp',
};

// ─── GIF Parser ─────────────────────────────────────────────────────────────

class GifParser {
  constructor(buffer) {
    this.data = new Uint8Array(buffer);
    this.pos = 0;
    this.frames = [];
    this.width = 0;
    this.height = 0;
    this.globalColorTable = null;
    this.bgColorIndex = 0;
    this.loopCount = 0;
  }

  readByte() { return this.data[this.pos++]; }
  readWord() {
    const lo = this.data[this.pos++];
    const hi = this.data[this.pos++];
    return lo | (hi << 8);
  }
  readBytes(n) {
    const slice = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  readColorTable(size) {
    const count = 2 ** (size + 1);
    const table = [];
    for (let i = 0; i < count; i++) {
      table.push({ r: this.readByte(), g: this.readByte(), b: this.readByte() });
    }
    return table;
  }

  skipSubBlocks() {
    let size;
    while ((size = this.readByte()) !== 0) {
      this.pos += size;
    }
  }

  readSubBlocks() {
    const blocks = [];
    let size;
    while ((size = this.readByte()) !== 0) {
      for (let i = 0; i < size; i++) blocks.push(this.readByte());
    }
    return new Uint8Array(blocks);
  }

  lzwDecode(minCodeSize, data) {
    const clearCode = 1 << minCodeSize;
    const eofCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let codeMask = (1 << codeSize) - 1;

    // Build initial dictionary
    const initDict = () => {
      const dict = [];
      for (let i = 0; i < clearCode; i++) dict[i] = [i];
      dict[clearCode] = [];
      dict[eofCode] = [];
      return dict;
    };

    let dict = initDict();
    let nextCode = eofCode + 1;
    const pixels = [];

    let bitBuf = 0, bitCount = 0, bytePos = 0;

    const readCode = () => {
      while (bitCount < codeSize) {
        if (bytePos >= data.length) return eofCode;
        bitBuf |= data[bytePos++] << bitCount;
        bitCount += 8;
      }
      const code = bitBuf & codeMask;
      bitBuf >>= codeSize;
      bitCount -= codeSize;
      return code;
    };

    let prevCode = null;
    let code;
    while ((code = readCode()) !== eofCode) {
      if (code === clearCode) {
        dict = initDict();
        nextCode = eofCode + 1;
        codeSize = minCodeSize + 1;
        codeMask = (1 << codeSize) - 1;
        prevCode = null;
        continue;
      }

      let entry;
      if (code < nextCode) {
        entry = dict[code];
      } else if (prevCode !== null && code === nextCode) {
        entry = [...dict[prevCode], dict[prevCode][0]];
      } else {
        break; // corrupted
      }

      pixels.push(...entry);

      if (prevCode !== null && nextCode < 4096) {
        dict[nextCode] = [...dict[prevCode], entry[0]];
        nextCode++;
        if (nextCode > codeMask + 1 && codeSize < 12) {
          codeSize++;
          codeMask = (1 << codeSize) - 1;
        }
      }
      prevCode = code;
    }
    return pixels;
  }

  parse() {
    // Signature
    const sig = String.fromCharCode(...this.readBytes(6));
    if (!sig.startsWith('GIF')) throw new Error('Not a GIF file');

    this.width = this.readWord();
    this.height = this.readWord();

    const packed = this.readByte();
    const hasGCT = (packed >> 7) & 1;
    const gctSize = packed & 0x07;
    this.bgColorIndex = this.readByte();
    this.readByte(); // pixel aspect ratio

    if (hasGCT) {
      this.globalColorTable = this.readColorTable(gctSize);
    }

    let graphicControl = null;

    while (this.pos < this.data.length) {
      const introducer = this.readByte();

      if (introducer === 0x3B) break; // trailer

      if (introducer === 0x21) {
        // Extension
        const label = this.readByte();
        if (label === 0xF9) {
          // Graphic Control Extension
          this.readByte(); // block size (4)
          const gcPacked = this.readByte();
          const delay = this.readWord(); // centiseconds
          const transparentIndex = this.readByte();
          this.readByte(); // block terminator
          graphicControl = {
            disposalMethod: (gcPacked >> 2) & 0x07,
            transparentFlag: gcPacked & 0x01,
            delay: delay * 10, // convert to ms
            transparentIndex,
          };
        } else if (label === 0xFF) {
          // Application Extension (e.g., Netscape looping)
          this.skipSubBlocks();
        } else {
          this.skipSubBlocks();
        }
        continue;
      }

      if (introducer === 0x2C) {
        // Image Descriptor
        const left = this.readWord();
        const top = this.readWord();
        const width = this.readWord();
        const height = this.readWord();
        const imgPacked = this.readByte();
        const hasLCT = (imgPacked >> 7) & 1;
        const interlaced = (imgPacked >> 6) & 1;
        const lctSize = imgPacked & 0x07;

        let colorTable = this.globalColorTable;
        if (hasLCT) {
          colorTable = this.readColorTable(lctSize);
        }

        const minCodeSize = this.readByte();
        const compressedData = this.readSubBlocks();
        const indices = this.lzwDecode(minCodeSize, compressedData);

        // Convert to RGBA
        const rgba = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < indices.length && i < width * height; i++) {
          const colorIdx = indices[i];
          const isTransparent = graphicControl?.transparentFlag && colorIdx === graphicControl.transparentIndex;
          if (colorTable && colorIdx < colorTable.length && !isTransparent) {
            const c = colorTable[colorIdx];
            rgba[i * 4] = c.r;
            rgba[i * 4 + 1] = c.g;
            rgba[i * 4 + 2] = c.b;
            rgba[i * 4 + 3] = 255;
          }
          // transparent pixels stay as 0,0,0,0
        }

        // Deinterlace if needed
        let finalRgba = rgba;
        if (interlaced) {
          finalRgba = this._deinterlace(rgba, width, height);
        }

        this.frames.push({
          left, top, width, height,
          delay: graphicControl?.delay ?? 100,
          imageData: new ImageData(finalRgba, width, height),
          disposalMethod: graphicControl?.disposalMethod ?? 0,
        });
        graphicControl = null;
        continue;
      }
    }

    return { width: this.width, height: this.height, frames: this.frames };
  }

  _deinterlace(data, width, height) {
    const result = new Uint8ClampedArray(data.length);
    const passes = [
      { start: 0, step: 8 },
      { start: 4, step: 8 },
      { start: 2, step: 4 },
      { start: 1, step: 2 },
    ];
    let srcRow = 0;
    for (const pass of passes) {
      for (let row = pass.start; row < height; row += pass.step) {
        const srcOffset = srcRow * width * 4;
        const dstOffset = row * width * 4;
        result.set(data.slice(srcOffset, srcOffset + width * 4), dstOffset);
        srcRow++;
      }
    }
    return result;
  }
}

// ─── SVG Parser ─────────────────────────────────────────────────────────────

class SvgParser {
  parse(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.documentElement;

    const width = parseFloat(svgEl.getAttribute('width') || svgEl.viewBox?.baseVal?.width || 512);
    const height = parseFloat(svgEl.getAttribute('height') || svgEl.viewBox?.baseVal?.height || 512);

    const layers = [];
    this._processNode(svgEl, layers, 0);

    return { width, height, layers };
  }

  _parseFill(el) {
    const fill = el.getAttribute('fill');
    if (!fill || fill === 'none') return null;
    return fill;
  }

  _parseStroke(el) {
    return {
      color: el.getAttribute('stroke') || 'none',
      width: parseFloat(el.getAttribute('stroke-width') || 1),
    };
  }

  _processNode(node, layers, depth) {
    for (const child of node.children) {
      const tag = child.tagName.toLowerCase();

      if (tag === 'g') {
        const groupLayer = {
          id: `svg-group-${layers.length}`,
          type: 'group',
          name: child.getAttribute('id') || `Group ${layers.length + 1}`,
          visible: true,
          locked: false,
          expanded: true,
          children: [],
          transform: this._parseTransform(child.getAttribute('transform') || ''),
        };
        this._processNode(child, groupLayer.children, depth + 1);
        layers.push(groupLayer);
      } else if (tag === 'path') {
        layers.push({
          id: `svg-path-${layers.length}`,
          type: 'shape',
          shapeType: 'path',
          name: child.getAttribute('id') || `Path ${layers.length + 1}`,
          visible: true,
          locked: false,
          d: child.getAttribute('d') || '',
          fill: { type: 'solid', color: this._parseFill(child) || '#000000' },
          stroke: this._parseStroke(child),
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        });
      } else if (tag === 'rect') {
        layers.push({
          id: `svg-rect-${layers.length}`,
          type: 'shape',
          shapeType: 'rect',
          name: child.getAttribute('id') || `Rect ${layers.length + 1}`,
          visible: true,
          locked: false,
          x: parseFloat(child.getAttribute('x') || 0),
          y: parseFloat(child.getAttribute('y') || 0),
          width: parseFloat(child.getAttribute('width') || 100),
          height: parseFloat(child.getAttribute('height') || 100),
          rx: parseFloat(child.getAttribute('rx') || 0),
          ry: parseFloat(child.getAttribute('ry') || 0),
          fill: { type: 'solid', color: this._parseFill(child) || '#000000' },
          stroke: this._parseStroke(child),
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        });
      } else if (tag === 'ellipse' || tag === 'circle') {
        const cx = parseFloat(child.getAttribute('cx') || 0);
        const cy = parseFloat(child.getAttribute('cy') || 0);
        const rx = parseFloat(child.getAttribute('rx') || child.getAttribute('r') || 50);
        const ry = parseFloat(child.getAttribute('ry') || child.getAttribute('r') || 50);
        layers.push({
          id: `svg-ellipse-${layers.length}`,
          type: 'shape',
          shapeType: 'ellipse',
          name: child.getAttribute('id') || `Ellipse ${layers.length + 1}`,
          visible: true,
          locked: false,
          cx, cy, rx, ry,
          fill: { type: 'solid', color: this._parseFill(child) || '#000000' },
          stroke: this._parseStroke(child),
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        });
      } else if (tag === 'line' || tag === 'polyline' || tag === 'polygon') {
        layers.push({
          id: `svg-poly-${layers.length}`,
          type: 'shape',
          shapeType: tag,
          name: child.getAttribute('id') || `${tag} ${layers.length + 1}`,
          visible: true,
          locked: false,
          points: child.getAttribute('points') || '',
          x1: child.getAttribute('x1'), y1: child.getAttribute('y1'),
          x2: child.getAttribute('x2'), y2: child.getAttribute('y2'),
          fill: { type: 'solid', color: this._parseFill(child) || 'none' },
          stroke: this._parseStroke(child),
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        });
      } else if (tag === 'text') {
        layers.push({
          id: `svg-text-${layers.length}`,
          type: 'text',
          name: child.getAttribute('id') || `Text ${layers.length + 1}`,
          visible: true,
          locked: false,
          content: child.textContent,
          x: parseFloat(child.getAttribute('x') || 0),
          y: parseFloat(child.getAttribute('y') || 0),
          fontFamily: child.getAttribute('font-family') || 'sans-serif',
          fontSize: parseFloat(child.getAttribute('font-size') || 16),
          fill: { type: 'solid', color: this._parseFill(child) || '#000000' },
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        });
      }
    }
  }

  _parseTransform(str) {
    const result = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
    if (!str) return result;

    const translate = str.match(/translate\(([^)]+)\)/);
    if (translate) {
      const parts = translate[1].split(/[\s,]+/);
      result.x = parseFloat(parts[0] || 0);
      result.y = parseFloat(parts[1] || 0);
    }

    const rotate = str.match(/rotate\(([^)]+)\)/);
    if (rotate) {
      result.rotation = parseFloat(rotate[1].split(/[\s,]+/)[0]);
    }

    const scale = str.match(/scale\(([^)]+)\)/);
    if (scale) {
      const parts = scale[1].split(/[\s,]+/);
      result.scaleX = parseFloat(parts[0]);
      result.scaleY = parseFloat(parts[1] ?? parts[0]);
    }

    return result;
  }
}

// ─── Lottie Parser ──────────────────────────────────────────────────────────

class LottieParser {
  parse(json) {
    const project = {
      name: json.nm || 'Imported Animation',
      width: json.w || 512,
      height: json.h || 512,
      frameRate: json.fr || 30,
      inPoint: json.ip || 0,
      outPoint: json.op || 60,
      layers: [],
      assets: this._parseAssets(json.assets || []),
    };

    if (Array.isArray(json.layers)) {
      project.layers = json.layers
        .filter(l => l)
        .map((l, i) => this._parseLayer(l, i, project.assets))
        .filter(Boolean);
    }

    return project;
  }

  _parseAssets(assets) {
    return assets.map(asset => ({
      id: asset.id,
      type: asset.layers ? 'composition' : 'image',
      width: asset.w,
      height: asset.h,
      src: asset.u && asset.p ? asset.u + asset.p : asset.p,
      layers: asset.layers ? asset.layers.map((l, i) => this._parseLayer(l, i, [])) : [],
    }));
  }

  _parseLayer(l, index, assets) {
    const base = {
      id: `layer-${l.ind ?? index}-${Date.now()}`,
      lottieid: l.ind,
      name: l.nm || `Layer ${index + 1}`,
      type: this._getLayerType(l.ty),
      visible: !l.hd,
      locked: false,
      expanded: false,
      solo: false,
      inPoint: l.ip ?? 0,
      outPoint: l.op ?? 60,
      startTime: l.st ?? 0,
      blendMode: l.bm ?? 0,
      parent: l.parent,
      is3d: !!l.ddd,
      motionBlur: !!l.mb,
      transform: this._parseTransform(l.ks),
      effects: (l.ef || []).map(e => this._parseEffect(e)),
      masks: (l.masksProperties || []).map(m => this._parseMask(m)),
    };

    if (l.ty === LOTTIE_LAYER.SHAPE) {
      base.shapes = (l.shapes || []).map(s => this._parseShape(s));
    } else if (l.ty === LOTTIE_LAYER.SOLID) {
      base.solidColor = l.sc;
      base.solidWidth = l.sw;
      base.solidHeight = l.sh;
    } else if (l.ty === LOTTIE_LAYER.TEXT) {
      base.textData = this._parseText(l.t);
    } else if (l.ty === LOTTIE_LAYER.IMAGE) {
      base.assetId = l.refId;
      const asset = assets.find(a => a.id === l.refId);
      if (asset) base.imageSrc = asset.src;
    } else if (l.ty === LOTTIE_LAYER.COMPOSITION) {
      base.assetId = l.refId;
      base.timeRemap = l.tm ? this._parseAnimatedValue(l.tm) : null;
    }

    return base;
  }

  _getLayerType(ty) {
    switch (ty) {
      case LOTTIE_LAYER.COMPOSITION: return 'composition';
      case LOTTIE_LAYER.SOLID: return 'solid';
      case LOTTIE_LAYER.IMAGE: return 'image';
      case LOTTIE_LAYER.NULL: return 'null';
      case LOTTIE_LAYER.SHAPE: return 'shape';
      case LOTTIE_LAYER.TEXT: return 'text';
      default: return 'unknown';
    }
  }

  _parseTransform(ks) {
    if (!ks) return { x: { value: 0 }, y: { value: 0 }, rotation: { value: 0 }, scaleX: { value: 100 }, scaleY: { value: 100 }, opacity: { value: 100 }, anchorX: { value: 0 }, anchorY: { value: 0 } };

    const a = ks.a ? this._parseAnimatedValue(ks.a) : { value: [0, 0], animated: false };
    const p = ks.p ? this._parseAnimatedValue(ks.p) : { value: [0, 0], animated: false };
    const s = ks.s ? this._parseAnimatedValue(ks.s) : { value: [100, 100], animated: false };
    const r = ks.r ? this._parseAnimatedValue(ks.r) : { value: 0, animated: false };
    const o = ks.o ? this._parseAnimatedValue(ks.o) : { value: 100, animated: false };

    return {
      anchorX: { value: Array.isArray(a.value) ? a.value[0] : 0, keyframes: a.keyframes, animated: a.animated },
      anchorY: { value: Array.isArray(a.value) ? a.value[1] : 0, keyframes: a.keyframes, animated: a.animated },
      x: { value: Array.isArray(p.value) ? p.value[0] : p.value, keyframes: p.keyframes, animated: p.animated },
      y: { value: Array.isArray(p.value) ? p.value[1] : 0, keyframes: p.keyframes, animated: p.animated },
      rotation: { value: Array.isArray(r.value) ? r.value[0] : r.value, keyframes: r.keyframes, animated: r.animated },
      scaleX: { value: Array.isArray(s.value) ? s.value[0] : s.value, keyframes: s.keyframes, animated: s.animated },
      scaleY: { value: Array.isArray(s.value) ? s.value[1] : s.value, keyframes: s.keyframes, animated: s.animated },
      opacity: { value: Array.isArray(o.value) ? o.value[0] : o.value, keyframes: o.keyframes, animated: o.animated },
    };
  }

  _parseAnimatedValue(prop) {
    if (!prop) return { value: 0, animated: false };

    if (prop.a === 0) {
      return { value: prop.k, animated: false, keyframes: [] };
    }

    if (prop.a === 1 && Array.isArray(prop.k)) {
      const keyframes = prop.k.map(kf => ({
        frame: kf.t,
        value: kf.s,
        easeOut: kf.o ? { x: kf.o.x, y: kf.o.y } : { x: [0.25], y: [0] },
        easeIn: kf.i ? { x: kf.i.x, y: kf.i.y } : { x: [0.75], y: [1] },
        hold: !!kf.h,
      }));
      return {
        animated: true,
        keyframes,
        value: keyframes[0]?.value ?? 0,
      };
    }

    return { value: prop.k ?? prop, animated: false, keyframes: [] };
  }

  _parseShape(s) {
    const base = {
      type: s.ty,
      name: s.nm || s.ty,
      hidden: !!s.hd,
    };

    switch (s.ty) {
      case LOTTIE_SHAPE.GROUP:
        return { ...base, items: (s.it || []).map(i => this._parseShape(i)) };

      case LOTTIE_SHAPE.PATH:
        return { ...base, vertices: this._parseAnimatedValue(s.ks), direction: s.d };

      case LOTTIE_SHAPE.RECT:
        return { ...base, position: this._parseAnimatedValue(s.p), size: this._parseAnimatedValue(s.s), roundness: this._parseAnimatedValue(s.r) };

      case LOTTIE_SHAPE.ELLIPSE:
        return { ...base, position: this._parseAnimatedValue(s.p), size: this._parseAnimatedValue(s.s) };

      case LOTTIE_SHAPE.STAR:
        return { ...base, position: this._parseAnimatedValue(s.p), innerRadius: this._parseAnimatedValue(s.ir), outerRadius: this._parseAnimatedValue(s.or), rotation: this._parseAnimatedValue(s.r), points: this._parseAnimatedValue(s.pt), innerRoundness: this._parseAnimatedValue(s.is), outerRoundness: this._parseAnimatedValue(s.os), starType: s.sy };

      case LOTTIE_SHAPE.FILL:
        return { ...base, color: this._parseAnimatedValue(s.c), opacity: this._parseAnimatedValue(s.o), fillRule: s.r };

      case LOTTIE_SHAPE.STROKE:
        return { ...base, color: this._parseAnimatedValue(s.c), opacity: this._parseAnimatedValue(s.o), width: this._parseAnimatedValue(s.w), lineCap: s.lc, lineJoin: s.lj, miterLimit: s.ml, dashes: s.d };

      case LOTTIE_SHAPE.GRADIENT_FILL:
      case LOTTIE_SHAPE.GRADIENT_STROKE:
        return { ...base, startPoint: this._parseAnimatedValue(s.s), endPoint: this._parseAnimatedValue(s.e), gradientColors: this._parseAnimatedValue(s.g), gradientType: s.t, opacity: this._parseAnimatedValue(s.o) };

      case LOTTIE_SHAPE.TRANSFORM:
        return { ...base, transform: this._parseTransform(s) };

      case LOTTIE_SHAPE.TRIM:
        return { ...base, start: this._parseAnimatedValue(s.s), end: this._parseAnimatedValue(s.e), offset: this._parseAnimatedValue(s.o), multiple: s.m };

      case LOTTIE_SHAPE.REPEATER:
        return { ...base, copies: this._parseAnimatedValue(s.c), offset: this._parseAnimatedValue(s.o), transform: this._parseTransform(s.tr) };

      default:
        return base;
    }
  }

  _parseText(t) {
    if (!t) return null;
    return {
      documentData: t.d ? this._parseAnimatedValue(t.d) : null,
      pathData: t.p || null,
      moreOptions: t.m || null,
      animators: (t.a || []).map(a => ({
        name: a.nm,
        ranges: a.a,
        properties: a.s,
      })),
    };
  }

  _parseEffect(e) {
    return { type: e.ty, name: e.nm, enabled: !e.en, properties: e.ef || [] };
  }

  _parseMask(m) {
    return {
      mode: m.mode,
      inverted: !!m.inv,
      vertices: this._parseAnimatedValue(m.pt),
      opacity: this._parseAnimatedValue(m.o),
      expand: this._parseAnimatedValue(m.x),
    };
  }
}

// ─── AnimaForge Layer Factory ────────────────────────────────────────────────

function createImageLayer(name, dataUrl, width, height) {
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'image',
    name,
    visible: true,
    locked: false,
    expanded: false,
    src: dataUrl,
    width,
    height,
    transform: { x: 0, y: 0, w: width, h: height, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 },
  };
}

// ─── SVG Path Parser ─────────────────────────────────────────────────────────

function parseSVGPath(d) {
  const commands = [];
  const regex = /([MLHVCSQTAZz])([^MLHVCSQTAZz]*)/g;
  let match;
  while ((match = regex.exec(d)) !== null) {
    const cmd = match[1];
    const argsStr = match[2].trim();
    const args = argsStr ? argsStr.split(/[\s,]+/).map(Number).filter(n => !isNaN(n)) : [];

    if (cmd === 'z' || cmd === 'Z') {
      commands.push({ cmd: 'Z', args: [] });
    } else if (['M', 'm', 'L', 'l'].includes(cmd)) {
      const finalCmd = cmd.toUpperCase();
      for (let i = 0; i < args.length; i += 2) {
        if (args[i] !== undefined && args[i+1] !== undefined) {
          commands.push({ cmd: finalCmd, args: [args[i], args[i+1]] });
        }
      }
    } else if (['C', 'c'].includes(cmd)) {
      const finalCmd = 'C';
      for (let i = 0; i < args.length; i += 6) {
        if (args[i+5] !== undefined) {
          commands.push({ cmd: finalCmd, args: args.slice(i, i + 6) });
        }
      }
    } else if (['Q', 'q'].includes(cmd)) {
      const finalCmd = 'Q';
      for (let i = 0; i < args.length; i += 4) {
        if (args[i+3] !== undefined) {
          commands.push({ cmd: finalCmd, args: args.slice(i, i + 4) });
        }
      }
    }
  }
  return commands;
}

// ─── Lottie Shape Mapping Helper ─────────────────────────────────────────────

function mapLottieShapeToLayer(s, name) {
  const layer = {
    id: `lottie-shape-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: s.name || name,
    type: 'shape',
    visible: !s.hidden,
    transform: { x: 0, y: 0, w: 100, h: 100, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 },
  };

  if (s.type === 'rc') {
    layer.shapeType = 'rect';
    const pos = s.position?.value || [0, 0];
    const size = s.size?.value || [100, 100];
    layer.transform.x = pos[0] - size[0] / 2;
    layer.transform.y = pos[1] - size[1] / 2;
    layer.transform.w = size[0];
    layer.transform.h = size[1];
    layer.shape = { kind: 'rect', roundness: s.roundness?.value || 0 };
  } else if (s.type === 'el') {
    layer.shapeType = 'ellipse';
    const pos = s.position?.value || [0, 0];
    const size = s.size?.value || [100, 100];
    layer.transform.x = pos[0] - size[0] / 2;
    layer.transform.y = pos[1] - size[1] / 2;
    layer.transform.w = size[0];
    layer.transform.h = size[1];
    layer.shape = { kind: 'ellipse' };
  } else if (s.type === 'sh') {
    layer.shapeType = 'path';
    layer.shape = { kind: 'path', path: [] };
    const vertices = s.vertices?.value || {};
    if (vertices.v && Array.isArray(vertices.v)) {
      const pathCmds = [];
      const v = vertices.v, inT = vertices.i, outT = vertices.o;
      for (let i = 0; i < v.length; i++) {
        if (i === 0) {
          pathCmds.push({ cmd: 'M', args: [v[0][0], v[0][1]] });
        } else {
          const prevV = v[i - 1];
          const prevOut = outT[i - 1];
          const currIn = inT[i];
          const currV = v[i];
          pathCmds.push({
            cmd: 'C',
            args: [
              prevV[0] + prevOut[0], prevV[1] + prevOut[1],
              currV[0] + currIn[0], currV[1] + currIn[1],
              currV[0], currV[1]
            ]
          });
        }
      }
      if (vertices.c) {
        const prevV = v[v.length - 1];
        const prevOut = outT[v.length - 1];
        const currIn = inT[0];
        const currV = v[0];
        pathCmds.push({
          cmd: 'C',
          args: [
            prevV[0] + prevOut[0], prevV[1] + prevOut[1],
            currV[0] + currIn[0], currV[1] + currIn[1],
            currV[0], currV[1]
          ]
        });
        pathCmds.push({ cmd: 'Z', args: [] });
      }
      layer.shape.path = pathCmds;
    }
  } else {
    return null;
  }

  return layer;
}

// ─── ImportManager ───────────────────────────────────────────────────────────

export class ImportManager {
  constructor(editor) {
    this.editor = editor;
    this._lottieParser = new LottieParser();
    this._svgParser = new SvgParser();
  }

  /**
   * Import a File object into the editor.
   * @param {File} file
   * @returns {Promise<Object>} Normalized project structure
   */
  async importFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const buffer = await file.arrayBuffer();

    let rawProject;
    switch (ext) {
      case 'json':
        rawProject = await this._importLottieJSON(buffer, file.name);
        break;

      case 'tgs':
        rawProject = await this._importTGS(buffer, file.name);
        break;

      case 'lottie':
        rawProject = await this._importDotLottie(buffer, file.name);
        break;

      case 'gif':
        rawProject = await this._importGIF(buffer, file.name);
        break;

      case 'png':
      case 'jpg':
      case 'jpeg':
        rawProject = await this._importRasterImage(buffer, file.name, file.type);
        break;

      case 'svg':
        rawProject = await this._importSVG(buffer, file.name);
        break;

      default:
        throw new Error(`Unsupported file format: .${ext}`);
    }

    return this.normalizeProject(rawProject);
  }

  // ─── Project & Layer Normalizer ──────────────────────────────────────────

  normalizeProject(rawProj) {
    // If it's already a native AnimaForge project structure
    if (rawProj.sourceFormat === 'animaforge') {
      return rawProj;
    }

    const keyframes = {};
    const normalizedLayers = [];

    const width = rawProj.width || 512;
    const height = rawProj.height || 512;

    if (Array.isArray(rawProj.layers)) {
      rawProj.layers.forEach(l => {
        const norm = this._normalizeLayer(l, width, height, keyframes);
        if (norm) normalizedLayers.push(norm);
      });
    }

    return {
      name: rawProj.name || 'Imported Project',
      width,
      height,
      fps: rawProj.frameRate || 30,
      totalFrames: (rawProj.outPoint - rawProj.inPoint) || 90,
      backgroundColor: rawProj.backgroundColor || '#1a1a2e',
      transparent: rawProj.transparent || false,
      layers: normalizedLayers,
      keyframes: keyframes
    };
  }

  _normalizeLayer(l, width, height, keyframesStore) {
    const id = l.id || `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const name = l.name || `${l.type || 'Layer'}`;
    const type = l.type || 'shape';
    const visible = l.visible !== false;
    const locked = !!l.locked;
    const solo = !!l.solo;
    const opacity = typeof l.opacity === 'number' ? l.opacity : 1;
    const blendMode = l.blendMode || 'normal';

    // Normalize transform
    const transform = {
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      anchorX: 0.5,
      anchorY: 0.5,
    };

    if (l.transform) {
      const srcT = l.transform;
      const getVal = (field, dflt) => {
        if (field === undefined || field === null) return dflt;
        if (typeof field === 'object' && field.value !== undefined) {
          return field.value;
        }
        return typeof field === 'number' ? field : dflt;
      };

      transform.x = getVal(srcT.x, 0);
      transform.y = getVal(srcT.y, 0);
      transform.w = typeof srcT.w === 'number' ? srcT.w : (l.width || 100);
      transform.h = typeof srcT.h === 'number' ? srcT.h : (l.height || 100);
      transform.rotation = getVal(srcT.rotation, 0);

      let scaleX = getVal(srcT.scaleX, 100);
      let scaleY = getVal(srcT.scaleY, 100);
      if (scaleX > 5) scaleX /= 100;
      if (scaleY > 5) scaleY /= 100;
      transform.scaleX = scaleX;
      transform.scaleY = scaleY;

      let ax = getVal(srcT.anchorX, 0);
      let ay = getVal(srcT.anchorY, 0);
      if (ax > 1 && transform.w > 0) ax /= transform.w;
      if (ay > 1 && transform.h > 0) ay /= transform.h;
      if (ax < 0 || ax > 1) ax = 0.5;
      if (ay < 0 || ay > 1) ay = 0.5;
      transform.anchorX = ax;
      transform.anchorY = ay;

      // Extract keyframes for standard fields
      if (srcT.x && srcT.x.animated && Array.isArray(srcT.x.keyframes)) {
        if (!keyframesStore[id]) keyframesStore[id] = {};
        keyframesStore[id]['position'] = srcT.x.keyframes.map(kf => {
          const val = kf.value;
          return {
            frame: kf.frame,
            value: {
              x: Array.isArray(val) ? val[0] : val,
              y: Array.isArray(val) ? val[1] ?? val[0] : val,
            },
            easing: kf.hold ? 'hold' : 'ease-in-out'
          };
        });
      }

      if (srcT.scaleX && srcT.scaleX.animated && Array.isArray(srcT.scaleX.keyframes)) {
        if (!keyframesStore[id]) keyframesStore[id] = {};
        keyframesStore[id]['scale'] = srcT.scaleX.keyframes.map(kf => {
          const val = kf.value;
          return {
            frame: kf.frame,
            value: {
              x: (Array.isArray(val) ? val[0] : val) / 100,
              y: (Array.isArray(val) ? val[1] ?? val[0] : val) / 100,
            },
            easing: kf.hold ? 'hold' : 'ease-in-out'
          };
        });
      }

      if (srcT.rotation && srcT.rotation.animated && Array.isArray(srcT.rotation.keyframes)) {
        if (!keyframesStore[id]) keyframesStore[id] = {};
        keyframesStore[id]['rotation'] = srcT.rotation.keyframes.map(kf => {
          const val = kf.value;
          return {
            frame: kf.frame,
            value: Array.isArray(val) ? val[0] : val,
            easing: kf.hold ? 'hold' : 'ease-in-out'
          };
        });
      }

      if (srcT.opacity && srcT.opacity.animated && Array.isArray(srcT.opacity.keyframes)) {
        if (!keyframesStore[id]) keyframesStore[id] = {};
        keyframesStore[id]['opacity'] = srcT.opacity.keyframes.map(kf => {
          const val = kf.value;
          return {
            frame: kf.frame,
            value: (Array.isArray(val) ? val[0] : val) / 100,
            easing: kf.hold ? 'hold' : 'ease-in-out'
          };
        });
      }
    }

    // Normalize Fill
    const fill = { type: 'solid', color: '#4f8ef7', opacity: 1 };
    if (l.fill) {
      fill.type = l.fill.type || 'solid';
      fill.color = l.fill.color || '#4f8ef7';
      fill.opacity = typeof l.fill.opacity === 'number' ? l.fill.opacity : 1;
      if (l.fill.gradient) fill.gradient = l.fill.gradient;
    }

    // Normalize Stroke
    const stroke = { color: '#ffffff', width: 0, opacity: 1, cap: 'round', join: 'round', dash: [] };
    if (l.stroke) {
      stroke.color = l.stroke.color || '#ffffff';
      stroke.width = typeof l.stroke.width === 'number' ? l.stroke.width : 0;
      stroke.opacity = typeof l.stroke.opacity === 'number' ? l.stroke.opacity : 1;
      stroke.cap = l.stroke.cap || 'round';
      stroke.join = l.stroke.join || 'round';
      stroke.dash = Array.isArray(l.stroke.dash) ? l.stroke.dash : [];
    }

    // Shape specifics
    const shape = { kind: l.shapeType || 'rect', sides: 5, innerRadius: 0.5, path: [], roundness: 0 };
    if (l.shape) {
      shape.kind = l.shape.kind || l.shapeType || 'rect';
      shape.sides = l.shape.sides || 5;
      shape.innerRadius = l.shape.innerRadius || 0.5;
      shape.path = l.shape.path || [];
      shape.roundness = l.shape.roundness || 0;
    }
    if (l.d) {
      shape.kind = 'path';
      shape.path = parseSVGPath(l.d);
    }

    // Text specifics
    const text = { content: 'Text', fontFamily: 'Inter, sans-serif', fontSize: 32, fontWeight: '400', textAlign: 'left' };
    if (l.text) {
      text.content = l.text.content || l.content || 'Text';
      text.fontFamily = l.text.fontFamily || 'Inter, sans-serif';
      text.fontSize = l.text.fontSize || 32;
      text.fontWeight = l.text.fontWeight || '400';
      text.textAlign = l.text.textAlign || 'left';
    } else if (l.content) {
      text.content = l.content;
      text.fontSize = l.fontSize || 32;
      text.fontFamily = l.fontFamily || 'sans-serif';
    }

    // Image specifics
    const image = { src: l.src || l.imageSrc || '', fit: 'contain' };
    if (l.image) {
      image.src = l.image.src || l.src || '';
      image.fit = l.image.fit || 'contain';
    }

    const children = [];
    if (Array.isArray(l.children)) {
      l.children.forEach(child => {
        const normChild = this._normalizeLayer(child, width, height, keyframesStore);
        if (normChild) children.push(normChild);
      });
    }

    if (Array.isArray(l.shapes)) {
      let shapeFillColor = '#4f8ef7';
      let shapeFillOpacity = 1;
      let shapeStrokeColor = '#ffffff';
      let shapeStrokeWidth = 0;

      const scanStyles = (items) => {
        items.forEach(item => {
          if (item.type === 'fl' && item.color) {
            const rgb = item.color.value || [0.3, 0.5, 0.9];
            const r = Math.round(rgb[0] * 255);
            const g = Math.round(rgb[1] * 255);
            const b = Math.round(rgb[2] * 255);
            const toHex = n => n.toString(16).padStart(2, '0');
            shapeFillColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            shapeFillOpacity = (item.opacity?.value ?? 100) / 100;
          }
          if (item.type === 'st' && item.color) {
            const rgb = item.color.value || [1, 1, 1];
            const r = Math.round(rgb[0] * 255);
            const g = Math.round(rgb[1] * 255);
            const b = Math.round(rgb[2] * 255);
            const toHex = n => n.toString(16).padStart(2, '0');
            shapeStrokeColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            shapeStrokeWidth = item.width?.value ?? 2;
          }
          if (item.type === 'gr' && Array.isArray(item.items)) {
            scanStyles(item.items);
          }
        });
      };

      scanStyles(l.shapes);

      l.shapes.forEach((s, idx) => {
        if (s.type === 'gr' && Array.isArray(s.items)) {
          s.items.forEach((item, itemIdx) => {
            const shapeLayer = mapLottieShapeToLayer(item, `${name} - Shape ${idx + 1}.${itemIdx + 1}`);
            if (shapeLayer) {
              shapeLayer.fill = { type: 'solid', color: shapeFillColor, opacity: shapeFillOpacity };
              shapeLayer.stroke = { color: shapeStrokeColor, width: shapeStrokeWidth, opacity: 1, cap: 'round', join: 'round', dash: [] };
              const normChild = this._normalizeLayer(shapeLayer, width, height, keyframesStore);
              if (normChild) children.push(normChild);
            }
          });
        } else {
          const shapeLayer = mapLottieShapeToLayer(s, `${name} - Shape ${idx + 1}`);
          if (shapeLayer) {
            shapeLayer.fill = { type: 'solid', color: shapeFillColor, opacity: shapeFillOpacity };
            shapeLayer.stroke = { color: shapeStrokeColor, width: shapeStrokeWidth, opacity: 1, cap: 'round', join: 'round', dash: [] };
            const normChild = this._normalizeLayer(shapeLayer, width, height, keyframesStore);
            if (normChild) children.push(normChild);
          }
        }
      });
    }

    const normalized = {
      id,
      name,
      type: children.length > 0 && type !== 'group' ? 'group' : type,
      visible,
      locked,
      solo,
      opacity,
      blendMode,
      transform,
      fill,
      stroke,
      effects: l.effects || [],
      children,
    };

    if (normalized.type === 'shape') normalized.shape = shape;
    if (normalized.type === 'text') normalized.text = text;
    if (normalized.type === 'image') normalized.image = image;

    return normalized;
  }

  // ─── Private Format Handlers ─────────────────────────────────────────────

  async _importLottieJSON(buffer, filename) {
    const text = new TextDecoder().decode(buffer);
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON in file: ${filename}`);
    }

    // Check if it's an AnimaForge saved project
    if (json.layers && json.keyframes && json.version) {
      return {
        name: json.name || 'Untitled Project',
        width: json.width || 512,
        height: json.height || 512,
        frameRate: json.fps || 30,
        inPoint: 0,
        outPoint: json.totalFrames || 90,
        layers: json.layers,
        keyframes: json.keyframes,
        sourceFormat: 'animaforge',
        sourceFile: filename
      };
    }

    if (!json.v && !json.fr) {
      throw new Error(`File ${filename} does not appear to be a valid Lottie animation`);
    }

    const project = this._lottieParser.parse(json);
    project.sourceFile = filename;
    project.sourceFormat = 'lottie';
    return project;
  }

  async _importTGS(buffer, filename) {
    let decompressed;
    try {
      decompressed = gunzipSync(new Uint8Array(buffer));
    } catch (e) {
      throw new Error(`Failed to decompress TGS file: ${e.message}`);
    }

    const text = new TextDecoder().decode(decompressed);
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`TGS contains invalid JSON: ${e.message}`);
    }

    const project = this._lottieParser.parse(json);
    project.sourceFile = filename;
    project.sourceFormat = 'tgs';
    return project;
  }

  async _importDotLottie(buffer, filename) {
    let files;
    try {
      files = unzipSync(new Uint8Array(buffer));
    } catch (e) {
      throw new Error(`Failed to unzip .lottie file: ${e.message}`);
    }

    let animJson = null;
    let animKey = null;

    if (files['animations/animation.json']) {
      animJson = files['animations/animation.json'];
      animKey = 'animations/animation.json';
    } else {
      for (const key of Object.keys(files)) {
        if (key.startsWith('animations/') && key.endsWith('.json')) {
          animJson = files[key];
          animKey = key;
          break;
        }
      }
    }

    if (!animJson) {
      throw new Error('No animation JSON found in .lottie file');
    }

    const text = new TextDecoder().decode(animJson);
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid animation JSON in .lottie file: ${e.message}`);
    }

    const project = this._lottieParser.parse(json);
    project.sourceFile = filename;
    project.sourceFormat = 'dotlottie';

    if (files['manifest.json']) {
      try {
        project.manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
      } catch (_) { /* ignore */ }
    }

    return project;
  }

  async _importGIF(buffer, filename) {
    const parser = new GifParser(buffer);
    let gifData;
    try {
      gifData = parser.parse();
    } catch (e) {
      throw new Error(`Failed to parse GIF: ${e.message}`);
    }

    const { width, height, frames } = gifData;
    const layers = [];

    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const ctx = offscreen.getContext('2d');

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      ctx.clearRect(0, 0, width, height);
      ctx.putImageData(frame.imageData, frame.left, frame.top);
      const dataUrl = offscreen.toDataURL('image/png');

      layers.push({
        ...createImageLayer(`Frame ${i + 1}`, dataUrl, frame.width, frame.height),
        name: `GIF Frame ${i + 1}`,
        gifFrame: true,
        frameIndex: i,
        frameDelay: frame.delay,
        inPoint: i,
        outPoint: i + 1,
      });
    }

    const totalDuration = frames.reduce((s, f) => s + f.delay, 0);
    const frameRate = frames.length > 0 ? Math.round(1000 / (totalDuration / frames.length)) : 25;

    return {
      name: filename.replace(/\.gif$/i, ''),
      sourceFile: filename,
      sourceFormat: 'gif',
      width,
      height,
      frameRate,
      inPoint: 0,
      outPoint: frames.length,
      layers,
    };
  }

  async _importRasterImage(buffer, filename, mimeType) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL(mimeType);
        URL.revokeObjectURL(url);

        const layer = createImageLayer(
          filename.replace(/\.[^.]+$/, ''),
          dataUrl,
          img.naturalWidth,
          img.naturalHeight
        );

        resolve({
          name: filename.replace(/\.[^.]+$/, ''),
          sourceFile: filename,
          sourceFormat: filename.split('.').pop().toLowerCase(),
          width: img.naturalWidth,
          height: img.naturalHeight,
          frameRate: 30,
          inPoint: 0,
          outPoint: 1,
          layers: [layer],
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to load image: ${filename}`));
      };
      img.src = url;
    });
  }

  async _importSVG(buffer, filename) {
    const text = new TextDecoder().decode(buffer);
    const parsed = this._svgParser.parse(text);

    return {
      name: filename.replace(/\.svg$/i, ''),
      sourceFile: filename,
      sourceFormat: 'svg',
      width: parsed.width,
      height: parsed.height,
      frameRate: 30,
      inPoint: 0,
      outPoint: 1,
      layers: parsed.layers,
      svgSource: text,
    };
  }
}

export default ImportManager;
