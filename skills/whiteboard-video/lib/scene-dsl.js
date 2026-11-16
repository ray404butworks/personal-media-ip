// 场景 DSL：定义场景 → 输出 Excalidraw 文件（.excalidraw + Obsidian 插件用的 .excalidraw.md）和 script.json（渲染器用）
// 项目里的 scenes.js 只需 require 这个文件，定义场景，最后 build(__dirname, scenes)。
const fs = require('fs');
const path = require('path');
const { projectPaths, cfg } = require('./paths.cjs');

let OUT = null;

// Excalidraw 调色板
const C = {
  ink: (cfg.brand && cfg.brand.ink) || '#1e1e1e', gray: '#868e96', red: '#e03131', green: '#2f9e44', blue: '#1971c2',
  orange: '#f08c00', purple: '#6741d9',
  fRed: '#ffc9c9', fGreen: '#b2f2bb', fBlue: '#a5d8ff', fYellow: '#ffec99', fPurple: '#d0bfff', fGray: '#e9ecef',
  brand: (cfg.brand && cfg.brand.accent) || '#2f9e44', // 品牌色（config.json brand.accent），标题/点睛用它保持全系列一致
};

let seedCounter = 1000;
const nextSeed = /* 生成可复现的手绘随机种子，使逐帧渲染保持稳定。 */ () => (seedCounter = (seedCounter * 9301 + 49297) % 233280) + 1;
let idCounter = 0;
const nextId = /* 生成场景内唯一元素ID，避免动画元素互相覆盖。 */ () => 'el' + (++idCounter).toString(36).padStart(6, '0');

const isCJK = /* 识别中日韩字符，用于文本测量和绘制节奏。 */ (ch) => /[　-鿿＀-￯]/.test(ch);
/* 按字符类别估算绘图文字宽度，仅用于排版。 */ function measure(text, fs) {
  const lines = text.split('\n');
  let w = 0;
  for (const l of lines) {
    let lw = 0;
    for (const ch of l) lw += isCJK(ch) ? fs : fs * 0.55;
    w = Math.max(w, lw);
  }
  return { width: Math.round(w), height: Math.round(fs * 1.25 * lines.length) };
}

/* 建立带统一手绘参数的基础图形元素。 */ function base(type, x, y, w, h, o = {}) {
  return {
    id: nextId(), type, x, y, width: w, height: h, angle: 0,
    strokeColor: o.stroke || C.ink, backgroundColor: o.fill || 'transparent',
    fillStyle: o.fillStyle || 'hachure', strokeWidth: o.strokeWidth || 2,
    strokeStyle: o.strokeStyle || 'solid', roughness: o.roughness ?? 1, opacity: o.opacity ?? 100,
    groupIds: [], frameId: null, roundness: o.round ? { type: 3 } : null,
    seed: nextSeed(), version: 1, versionNonce: nextSeed(), isDeleted: false,
    boundElements: null, updated: Date.now(), link: null, locked: false,
  };
}

class Scene {
  /* 初始化当前场景的元素、段落和布局状态。 */ constructor(name, narration) {
    this.name = name;
    this.segments = narration.split('|').map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (s) => s.trim()).filter(Boolean);
    this.elements = [];
    this.files = {};
    this.assetsDir = null;
    this.beatOf = []; // element index -> beat index
    this.beat = -1;
  }
  /* 进入下一叙事段落并保持已有元素的身份。 */ nextBeat() { this.beat++; return this; }
  /* 将已构造元素加入当前场景并保留绘制顺序。 */ push(el) {
    if (this.beat < 0) throw new Error('call nextBeat() first');
    this.elements.push(el); this.beatOf.push(this.beat); return el;
  }
  /* 创建矩形手绘元素，样式从当前场景配置继承。 */ rect(x, y, w, h, o = {}) { return this.push(base('rectangle', x, y, w, h, o)); }
  /* 创建椭圆手绘元素，保留当前位置和尺寸。 */ ellipse(x, y, w, h, o = {}) { return this.push(base('ellipse', x, y, w, h, o)); }
  /* 创建菱形元素，供流程或决策关系表达。 */ diamond(x, y, w, h, o = {}) { return this.push(base('diamond', x, y, w, h, o)); }
  /* 创建具有明确位置、字体和颜色的场景文本。 */ text(x, y, str, o = {}) {
    const fs = o.size || 36;
    const m = measure(str, fs);
    let tx = x;
    if (o.align === 'center') tx = x - m.width / 2;
    if (o.align === 'right') tx = x - m.width;
    const el = base('text', tx, y, m.width, m.height, { stroke: o.color || C.ink, roughness: 0 });
    Object.assign(el, {
      text: str, originalText: str, fontSize: fs, fontFamily: o.font || 5,
      textAlign: o.align || 'left', verticalAlign: 'top', containerId: null, autoResize: true, lineHeight: 1.25,
    });
    return this.push(el);
  }
  /* 创建折线或手绘路径，连接关系须来自本期事实。 */ line(points, o = {}) {
    const xs = points.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (p) => p[0]), ys = points.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    const el = base(o.arrow ? 'arrow' : 'line', x, y, Math.max(...xs) - x, Math.max(...ys) - y, o);
    if (o.round) el.roundness = { type: 2 };
    Object.assign(el, {
      points: points.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (p) => [p[0] - x, p[1] - y]), lastCommittedPoint: null,
      startBinding: null, endBinding: null, startArrowhead: o.startHead || null,
      endArrowhead: o.arrow ? 'arrow' : null, elbowed: false,
    });
    return this.push(el);
  }
  /* 创建带箭头的关系线，方向依本期叙事定义。 */ arrow(points, o = {}) { return this.line(points, { ...o, arrow: true }); }
  // 贴纸图片：name 对应 <project>/assets/<name>.png（gen-image.mjs 产物）。给 w 或 h 之一按原图比例算另一个。
  image(x, y, name, o = {}) {
    const file = path.join(projectPaths(module.exports.projectDir).assets, `${name}.png`);
    if (!fs.existsSync(file)) throw new Error(`缺少贴纸 assets/${name}.png，先跑 wb image`);
    return this.imageFile(x, y, file, o);
  }
  // 贴纸原图尺寸（排版前算宽高比用）
  imageSize(name) {
    const buf = fs.readFileSync(path.join(projectPaths(module.exports.projectDir).assets, `${name}.png`));
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // 任意 png 文件（品牌 logo 等）；name 用文件名
  imageFile(x, y, file, o = {}) {
    const name = path.basename(file, '.png');
    const buf = fs.readFileSync(file);
    const iw = buf.readUInt32BE(16), ih = buf.readUInt32BE(20);
    let w = o.w, h = o.h;
    if (w && !h) h = Math.round(w * ih / iw);
    if (h && !w) w = Math.round(h * iw / ih);
    if (!w) { w = iw; h = ih; }
    if (o.align === 'center') x = x - w / 2;
    const fileId = 'img_' + name.replace(/[^a-z0-9]/gi, '_');
    const el = base('image', x, y, w, h, { roughness: 0 });
    Object.assign(el, { fileId, status: 'saved', scale: [1, 1], crop: null });
    this.files[fileId] = { mimeType: 'image/png', id: fileId, dataURL: 'data:image/png;base64,' + buf.toString('base64'), created: Date.now(), name: `${name}.png` };
    return this.push(el);
  }

  // ---- 复合图形 ----
  robot(x, y, s = 1, o = {}) {
    const col = o.color || C.ink;
    this.line([[x + 100 * s, y - 30 * s], [x + 100 * s, y]], { stroke: col });
    this.ellipse(x + 88 * s, y - 54 * s, 24 * s, 24 * s, { stroke: col, fill: o.fill || C.fYellow, fillStyle: 'solid' });
    this.rect(x, y, 200 * s, 150 * s, { stroke: col, round: true, fill: o.fill || C.fBlue });
    this.ellipse(x + 45 * s, y + 45 * s, 36 * s, 36 * s, { stroke: col, fill: '#fff', fillStyle: 'solid' });
    this.ellipse(x + 119 * s, y + 45 * s, 36 * s, 36 * s, { stroke: col, fill: '#fff', fillStyle: 'solid' });
    this.ellipse(x + 57 * s, y + 57 * s, 12 * s, 12 * s, { stroke: col, fill: col, fillStyle: 'solid' });
    this.ellipse(x + 131 * s, y + 57 * s, 12 * s, 12 * s, { stroke: col, fill: col, fillStyle: 'solid' });
    this.line([[x + 60 * s, y + 110 * s], [x + 85 * s, y + 122 * s], [x + 115 * s, y + 122 * s], [x + 140 * s, y + 110 * s]], { stroke: col, round: true });
    if (!o.headOnly) this.rect(x + 30 * s, y + 160 * s, 140 * s, 90 * s, { stroke: col, round: true, fill: C.fGray });
  }
  /* 绘制电脑示意元素，仅作说明图形。 */ laptop(x, y, s = 1, o = {}) {
    this.rect(x, y, 260 * s, 160 * s, { round: true, fill: o.screen || C.fGray, ...o });
    this.rect(x - 20 * s, y + 160 * s, 300 * s, 22 * s, { round: true, fill: C.fGray, fillStyle: 'solid' });
  }
  cloud(cx, cy, w, o = {}) {
    // 椭圆 + 7 个鼓包的闭合曲线
    const h = w * 0.55;
    const pts = [];
    const N = 140;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const f = 1 + 0.13 * Math.abs(Math.sin(3.5 * th));
      pts.push([cx + (w / 2) * Math.cos(th) * f, cy + (h / 2) * Math.sin(th) * f]);
    }
    return this.line(pts, { fill: o.fill || '#fff', fillStyle: 'solid', ...o });
  }
  /* 绘制人物示意元素，避免冒充真实人物证据。 */ person(x, y, s = 1, o = {}) {
    this.ellipse(x, y, 60 * s, 60 * s, { fill: o.fill || C.fYellow, fillStyle: 'solid', ...o });
    this.line([[x + 30 * s, y + 60 * s], [x + 30 * s, y + 140 * s]], o);
    this.line([[x - 20 * s, y + 90 * s], [x + 30 * s, y + 75 * s], [x + 80 * s, y + 90 * s]], o);
    this.line([[x + 0 * s, y + 200 * s], [x + 30 * s, y + 140 * s], [x + 60 * s, y + 200 * s]], o);
  }
  /* 绘制勾选项，表达当前场景已声明的检查状态。 */ checkbox(x, y, label, o = {}) {
    this.rect(x, y, 40, 40, { round: true, fill: o.fill || C.fGreen, fillStyle: 'solid' });
    this.line([[x + 8, y + 20], [x + 17, y + 31], [x + 34, y + 8]], { stroke: C.green, strokeWidth: 3 });
    this.text(x + 60, y - 6, label, { size: o.size || 40 });
  }
  /* 绘制月亮装饰元素，不作调查事实。 */ moon(cx, cy, r) {
    const pts = [];
    for (let k = 0; k <= 24; k++) { const a = Math.PI * 0.35 + (k / 24) * Math.PI * 1.35; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    for (let k = 24; k >= 0; k--) { const a = Math.PI * 0.35 + (k / 24) * Math.PI * 1.35; pts.push([cx + 0.45 * r + Math.cos(a) * r * 0.8, cy - 0.1 * r + Math.sin(a) * r * 0.8]); }
    pts.push(pts[0]);
    return this.line(pts, { fill: C.fYellow, fillStyle: 'solid', stroke: C.orange });
  }
  /* 绘制手绘强调线，保留统一粗细与颜色。 */ squiggle(x1, x2, y, o = {}) {
    const pts = [];
    for (let px = x1; px <= x2; px += 12) pts.push([px, y + Math.sin((px - x1) / 12) * 5]);
    return this.line(pts, { stroke: o.color || C.red, strokeWidth: 3 });
  }

  // 渲染器直接用的文档（不落盘）：片尾品牌卡等虚拟场景用
  toRenderDoc() {
    if (this.beat + 1 !== this.segments.length) throw new Error(`${this.name}: ${this.beat + 1} beats but ${this.segments.length} narration segments`);
    return { elements: this.elements, files: this.files, beatOf: this.beatOf, segments: this.segments };
  }

  // 马克笔高亮：无描边实底、抖动大，放在文字前面 push 就垫在字下
  highlight(x, y, w, h, o = {}) {
    const col = o.color || C.fYellow;
    return this.rect(x, y, w, h, { fill: col, stroke: col, fillStyle: 'solid', roughness: o.roughness ?? 2.2, strokeWidth: 3, opacity: o.opacity ?? 90 });
  }
  // 品牌标：星号 + 手写名 + 品牌色下划线（同水印/片尾母题）。x 为左边，size 字号；返回宽度
  brandMark(x, y, size = 56, o = {}) {
    const b = cfg.brand || {}; const name = o.name || b.name || 'Your Brand'; const accent = o.accent || b.accent || C.green;
    const w = measure(name, size).width;
    const r = size * 0.32, sx = x - r * 0.9, sy = y + r * 0.6;
    const star = [[sx, sy - r], [sx + r * 0.28, sy - r * 0.28], [sx + r, sy], [sx + r * 0.28, sy + r * 0.28], [sx, sy + r], [sx - r * 0.28, sy + r * 0.28], [sx - r, sy], [sx - r * 0.28, sy - r * 0.28], [sx, sy - r]];
    this.line(star, { stroke: accent, fill: accent, fillStyle: 'solid', roughness: 0.8 });
    this.text(x, y, name, { size, color: o.color || b.ink || C.ink });
    this.line([[x, y + size * 1.3], [x + w * 0.55, y + size * 1.3 + size * 0.1], [x + w, y + size * 1.2]], { stroke: accent, strokeWidth: Math.max(4, size * 0.13), roughness: 1.3, round: true });
    return w;
  }
  // 封面版式。opts: { ratio:'16:9'|'3:4', title:'两行\n用换行', accent: 高亮第几行(0 起，默认最后一行), sticker:'贴纸名', tag:'左上标签', sub:'副标', color: 高亮字色 }
  coverLayout(o = {}) {
    const ratio = o.ratio || '4:3';
    const [cw, ch] = coverSize(ratio);
    const portrait = ch > cw;
    const cv = cfg.cover || {};
    const lines = String(o.title || '').split('\n').map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (l) => l.trim()).filter(Boolean);
    const accentIdx = o.accent == null ? lines.length - 1 : o.accent;
    const accentColor = o.color || C.brand, hl = o.highlight || C.fYellow;
    const maxLen = Math.max(...lines.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (l) => [...l].reduce(/* 按当前累计规则汇总集合，避免改变项目顺序。 */ (n, ch) => n + (isCJK(ch) ? 1 : 0.55), 0)));
    if (cv.frame !== false) this.rect(28, 28, cw - 56, ch - 56, { stroke: cv.frameColor || C.ink, strokeWidth: 7, roughness: 1.6, round: true });
    const tag = o.tag === undefined ? cv.seriesTag : o.tag;
    if (portrait) {
      // 竖版：标签 → 标题居中 → 贴纸 → 品牌标
      let y = 110;
      if (tag) { const tw = measure(tag, 40).width + 60; this.rect(cw / 2 - tw / 2, y, tw, 74, { round: true, fill: C.fYellow, fillStyle: 'solid' }); this.text(cw / 2, y + 16, tag, { size: 40, align: 'center' }); y += 130; }
      const size = Math.min(170, Math.floor((cw - 120) / Math.max(4, maxLen)));
      const lh = size * 1.22;
      lines.forEach(/* 逐项执行当前操作，不把部分成功当作全量通过。 */ (l, i) => {
        const w = measure(l, size).width;
        if (i === accentIdx) this.highlight(cw / 2 - w / 2 - 18, y + i * lh + size * 0.42, w + 36, size * 0.62, { color: hl });
        this.text(cw / 2, y + i * lh, l, { size, align: 'center', color: i === accentIdx ? accentColor : C.ink });
      });
      y += lines.length * lh + 20;
      if (o.sub) { this.text(cw / 2, y, o.sub, { size: 44, align: 'center', color: C.gray }); y += 90; }
      const brandY = ch - 150;
      if (o.sticker) {
        // 宽图（如 logos-vs）按高度放会横向溢出，宽度同时限在画布内
        const d = this.imageSize(o.sticker), maxW = cw - 180;
        const room = brandY - 40 - y;
        const hCap = Math.min(640, room), h = Math.min(hCap, Math.round(maxW * d.h / d.w));
        this.image(cw / 2, y + 10 + (hCap - h) / 2, o.sticker, { h, align: 'center' });
      }
      const bw = measure(cfg.brand.name || 'Your Brand', 52).width;
      this.brandMark(cw / 2 - bw / 2, brandY, 52);
    } else if (cw / ch < 1.6) {
      // 4:3 等偏方横版：标题通栏大字 → 副标 → 贴纸右下（尽量大，只避开会撞到的标题行）→ 品牌标左下
      let y = 96;
      if (tag) { const tw = measure(tag, 40).width + 60; this.rect(110, y, tw, 74, { round: true, fill: C.fYellow, fillStyle: 'solid' }); this.text(110 + tw / 2, y + 16, tag, { size: 40, align: 'center' }); y += 130; }
      const size = Math.min(Math.round(ch * 0.15), Math.floor((cw - 220) / Math.max(4, maxLen)));
      const lh = size * 1.2;
      const rows = [];
      lines.forEach(/* 逐项执行当前操作，不把部分成功当作全量通过。 */ (l, i) => {
        const w = measure(l, size).width;
        if (i === accentIdx) this.highlight(110 - 18, y + i * lh + size * 0.42, w + 36, size * 0.62, { color: hl });
        this.text(110, y + i * lh, l, { size, color: i === accentIdx ? accentColor : C.ink });
        rows.push({ right: 110 + w + 36, bottom: y + i * lh + size * 1.05 });
      });
      y += lines.length * lh + 10;
      if (o.sub) { const w = measure(o.sub, 44).width; this.text(114, y, o.sub, { size: 44, color: C.gray }); rows.push({ right: 114 + w, bottom: y + 50 }); y += 80; }
      if (o.sticker) {
        const asp = (/* 处理本步骤的局部数据转换，返回值用于紧邻的调用流程。 */ () => { const d = this.imageSize(o.sticker); return d.w / d.h; })();
        const bottom = ch - 70, right = cw - 100;
        let h = Math.round(ch * 0.55);
        for (; h > ch * 0.25; h -= 10) {
          const top = bottom - h, left = right - h * asp;
          if (!rows.some(/* 检查是否至少有一项满足当前校验条件。 */ (r) => r.right > left && r.bottom > top)) break;
        }
        this.image(right - (h * asp) / 2, bottom - h, o.sticker, { h, align: 'center' });
      }
      this.brandMark(120, ch - 150, 56);
    } else {
      // 16:9 宽横版：左侧标题，右侧贴纸列（宽 36%），左下品牌标
      const stickerCol = o.sticker ? Math.round(cw * 0.36) : 0;
      const leftW = cw - stickerCol - 220;
      let y = 96;
      if (tag) { const tw = measure(tag, 40).width + 60; this.rect(110, y, tw, 74, { round: true, fill: C.fYellow, fillStyle: 'solid' }); this.text(110 + tw / 2, y + 16, tag, { size: 40, align: 'center' }); y += 120; }
      const size = Math.min(Math.round(ch * 0.185), Math.floor(leftW / Math.max(4, maxLen)));
      const lh = size * 1.2;
      const blockH = lines.length * lh + (o.sub ? 90 : 0);
      y = Math.max(y, (ch - 160 - y - blockH) / 2 + y - 20);
      lines.forEach(/* 逐项执行当前操作，不把部分成功当作全量通过。 */ (l, i) => {
        const w = measure(l, size).width;
        if (i === accentIdx) this.highlight(110 - 18, y + i * lh + size * 0.42, w + 36, size * 0.62, { color: hl });
        this.text(110, y + i * lh, l, { size, color: i === accentIdx ? accentColor : C.ink });
      });
      if (o.sub) this.text(114, y + lines.length * lh + 10, o.sub, { size: 48, color: C.gray });
      if (o.sticker) this.image(cw - stickerCol / 2 - 30, 150, o.sticker, { h: Math.min(Math.round(ch * 0.72), ch - 300), align: 'center' });
      this.brandMark(120, ch - 150, 56);
    }
    return this;
  }

  /* 将元数据按UTF8保存，保留中文与可读缩进。 */ save(outDir) {
    OUT = outDir; fs.mkdirSync(OUT, { recursive: true });
    const safe = (cfg.captions && cfg.captions.safeTop) || 960;
    const label = /* 绘制简短标签并匹配本期文字层级。 */ (el) => `${el.type}${el.text ? `「${el.text}」` : ''}`;
    if (!this.isCover) for (const el of this.elements) if (el.y + el.height > safe) console.warn(`  ⚠ ${this.name}: ${label(el)} 底边 ${Math.round(el.y + el.height)} 超过字幕安全线 ${safe}`);
    // 品牌水印占位（config.json brand.watermark）：角上 300×130 别放元素
    const wm = cfg.brand && cfg.brand.watermark;
    if (!this.isCover && wm && wm.enabled !== false && cfg.brand.name) {
      const pos = wm.position || 'top-right', zw = 320, zh = 130;
      const zx = pos.endsWith('left') ? 0 : W - zw, zy = pos.startsWith('bottom') ? safe - zh : 0;
      for (const el of this.elements) if (el.x < zx + zw && el.x + el.width > zx && el.y < zy + zh && el.y + el.height > zy) console.warn(`  ⚠ ${this.name}: ${label(el)} 压到${pos}水印区（x ${zx}~${zx + zw}, y ${zy}~${zy + zh}）`);
    }
    if (this.beat + 1 !== this.segments.length) {
      throw new Error(`${this.name}: ${this.beat + 1} beats but ${this.segments.length} narration segments`);
    }
    const doc = {
      type: 'excalidraw', version: 2, source: 'grok-bot-video', elements: this.elements,
      appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: this.files,
    };
    // 只出 Obsidian 插件格式：图片不内嵌 base64，走 Embedded Files 引用同目录 png
    const embedded = Object.values(this.files).map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (f) => `${f.id}: [[${f.name}]]`).join('\n');
    const mdDoc = { ...doc, files: {} };
    // Obsidian Excalidraw 插件新格式：.excalidraw.md
    const textEls = this.elements.filter(/* 筛出满足当前检查条件的项，排除不适用数据。 */ (e) => e.type === 'text').map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (e) => `${e.text} ^${e.id}`).join('\n\n');
    const md = `---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. For more info check in plugin settings under 'Saving'\n\n\n# Excalidraw Data\n\n## Text Elements\n${textEls}\n\n${embedded ? `## Embedded Files\n${embedded}\n\n` : ''}%%\n## Drawing\n\`\`\`json\n${JSON.stringify(mdDoc)}\n\`\`\`\n%%`;
    fs.writeFileSync(path.join(OUT, `${this.name}.excalidraw.md`), md);
    return { name: this.name, segments: this.segments, beatOf: this.beatOf };
  }
}

const W = 1920, H = 1080, CX = W / 2, CY = H / 2;

// 把所有场景写到 <期目录>/scenes/，生成 script.json 和 旁白稿.md
function build(projectDir, sceneList, extra = {}) {
  const P = projectPaths(projectDir);
  const meta = sceneList.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (s) => s.save(P.scenes));
  fs.writeFileSync(P.script, JSON.stringify(meta, null, 1));
  // 封面：extra.cover = (s, ratio) => { s.coverLayout({...ratio, ...}) }，每个画幅一张，存 scenes/00-cover-<ratio>.excalidraw.md + cover.json
  const covers = [];
  if (extra.cover) {
    for (const ratio of (cfg.cover && cfg.cover.ratios) || ['4:3', '3:4']) {
      const tag = ratio.replace(':', 'x');
      const s = new Scene(`00-cover-${tag}`, '封面'); s.isCover = true; s.nextBeat();
      extra.cover(s, ratio);
      const [w, h] = coverSize(ratio);
      const m = s.save(P.scenes); covers.push({ ...m, ratio, width: w, height: h });
      for (const f of Object.values(s.files)) fs.copyFileSync(path.join(P.assets, f.name), path.join(P.scenes, f.name));
    }
    fs.writeFileSync(path.join(P.scenes, 'cover.json'), JSON.stringify(covers, null, 1));
  } else if (fs.existsSync(path.join(P.scenes, 'cover.json'))) fs.rmSync(path.join(P.scenes, 'cover.json'));
  // 贴纸 png 复制到 scenes/ 旁边，供 .excalidraw.md 的 Embedded Files 引用
  for (const s of sceneList) for (const f of Object.values(s.files)) fs.copyFileSync(path.join(P.assets, f.name), path.join(P.scenes, f.name));
  writeNote(P, meta);
  console.log(meta.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (s) => `${s.name}: ${s.segments.length} beats, ${s.beatOf.length} elements`).concat(covers.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (c) => `${c.name}: 封面 ${c.width}×${c.height}, ${c.beatOf.length} elements`)).join('\n'));
  return meta;
}

// 旁白稿.md：每期自动生成，含旁白分段、场景链接、时长（配音后才有）、成片
function writeNote(P, meta) {
  const L = [`# ${P.name} · 旁白稿`, '', `> 自动生成（\`wb scenes\` / \`wb build\` 会覆盖），别手改；改旁白去 \`scenes.js\`。`, ''];
  if (fs.existsSync(P.final)) L.push(`成片：[final.mp4](file://${encodeURI(P.final)})（在后台目录，视频不放进期目录）`, '');
  let total = 0;
  for (const s of meta) {
    const a = path.join(P.audio, `${s.name}.json`);
    let dur = '';
    if (fs.existsSync(a)) { const d = JSON.parse(fs.readFileSync(a)).duration; total += d; dur = `（${d.toFixed(0)}s）`; }
    L.push(`## ${s.name}${dur}  [[${s.name}.excalidraw]]`, '');
    s.segments.forEach(/* 逐项执行当前操作，不把部分成功当作全量通过。 */ (seg, i) => L.push(`${i + 1}. ${seg}`));
    L.push('');
  }
  if (total) L.splice(4, 0, `全片旁白约 ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}`, '');
  fs.writeFileSync(P.note, L.join('\n'));
}

// 封面画幅
const COVER_SIZES = { '4:3': [1440, 1080], '3:4': [1080, 1440], '16:9': [1920, 1080], '1:1': [1080, 1080] };
const coverSize = /* 依据明确的封面比例返回独立封面画布尺寸。 */ (ratio) => COVER_SIZES[ratio] || COVER_SIZES['4:3'];

// 片尾品牌卡：名字（或 logo）+ 品牌色划线 + slogan + CTA，一个 beat，逐笔画出。由 render.js 在成片末尾追加。
function brandEndCard(brand) {
  const s = new Scene('99-brand', '品牌卡');
  s.nextBeat();
  const accent = brand.accent || C.green, ink = brand.ink || C.ink;
  let nameW, top = 300, bottom;
  const logo = brand.logo && expandHome(brand.logo);
  if (logo && fs.existsSync(logo)) {
    const el = s.imageFile(CX, 230, logo, { h: 280, align: 'center' });
    nameW = el.width; top = el.y; bottom = el.y + el.height;
  } else {
    const size = 150;
    const t = s.text(CX, top, brand.name, { size, align: 'center', color: ink });
    nameW = t.width; bottom = t.y + size * 1.1;
  }
  // 左上角星号（呼应头像）
  const r = 26, sx = CX - nameW / 2 - 40, sy = top + 10;
  const star = [[sx, sy - r], [sx + r * 0.28, sy - r * 0.28], [sx + r, sy], [sx + r * 0.28, sy + r * 0.28], [sx, sy + r], [sx - r * 0.28, sy + r * 0.28], [sx - r, sy], [sx - r * 0.28, sy - r * 0.28], [sx, sy - r]];
  s.line(star, { stroke: accent, fill: accent, fillStyle: 'solid', roughness: 0.8 });
  // 品牌色划线
  s.line([[CX - nameW / 2 - 10, bottom + 22], [CX + nameW * 0.05, bottom + 34], [CX + nameW / 2 + 10, bottom + 12]], { stroke: accent, strokeWidth: 12, roughness: 1.3, round: true });
  if (brand.slogan) s.text(CX, bottom + 90, brand.slogan, { size: 44, align: 'center', color: C.gray });
  if (brand.endCard && brand.endCard.cta) {
    const y = bottom + 220;
    s.rect(CX - 300, y, 600, 96, { round: true, fill: C.fYellow, fillStyle: 'solid', stroke: ink });
    s.text(CX, y + 24, brand.endCard.cta, { size: 38, align: 'center', color: ink });
  }
  return s;
}
const expandHome = /* 展开本机用户路径，不依赖原作者盘符。 */ (p) => { const e = p.replace(/^~/, process.env.HOME); return path.isAbsolute(e) ? e : path.join(__dirname, '..', e); };

module.exports = { Scene, C, W, H, CX, CY, build, writeNote, brandEndCard, projectDir: null };
// 项目 scenes.js 里 require 后先调用 use(__dirname)，image() 才知道贴纸在哪
module.exports.use = /* 绑定当前工程位置，后续本地贴纸按此位置解析。 */ (dir) => { module.exports.projectDir = dir; return module.exports; };
