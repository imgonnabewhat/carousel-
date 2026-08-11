/**
 * 레이어보드 내보내기 v2 — 생성된 게시물을 레이어보드(layerboard) 편집기에서
 * 수정할 수 있는 프로젝트 파일(.layerboard.json)로 변환
 *
 * 사용법:
 *   node export_layerboard.js                # generated_data.json
 *   node export_layerboard.js my_post.json
 *
 * 원리: 슬라이드를 렌더링한 뒤 화면의 구성 요소를 종류별로 분해한다.
 *   - 사진(<img>, background-image) → 사진 레이어 (위치·자르기·테두리 유지)
 *   - 색 박스·오버레이·뱃지        → 도형 레이어 (채움색·테두리·둥근 모서리)
 *   - 글자                          → 텍스트 레이어 (크기·색·행간·외곽선)
 *   - 남는 것(구분선·그라데이션 등) → 배경 이미지로 캡처
 * 결과물을 레이어보드가 자동으로 불러오면 요소 하나하나를 옮기고 고칠 수 있다.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { assembleSlides } = require('./free_page');
const { createBuilders } = require('./builders');

const dataFile = process.argv[2] || 'generated_data.json';
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, dataFile), 'utf-8'));
const TEMPLATE = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf-8');

const baseName = path.basename(dataFile, '.json');
const OUT_DIR = path.join(__dirname, 'output', baseName);
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const W = 1080, H = 1350;

function toDataURL(rel) {
  if (!rel) return null;
  const fullPath = path.resolve(__dirname, rel);
  if (!fs.existsSync(fullPath)) return null;
  const ext = path.extname(rel).toLowerCase().slice(1);
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp' };
  const mime = mimeMap[ext] || 'image/jpeg';
  const b64 = fs.readFileSync(fullPath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

/* 브라우저 안에서 실행: 사진·도형·텍스트를 측정해 레이어로 분해하고 숨긴다 */
async function extractAndHide() {
  const W = 1080, H = 1350;
  const SLIDE_AREA = W * H;

  function visible(el) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W;
  }
  const isInline = el => getComputedStyle(el).display === 'inline';

  function parseColor(css) {
    const m = (css || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return { r: 0, g: 0, b: 0, a: 0 };
    const p = m[1].split(',').map(v => parseFloat(v));
    return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p.length === 4 ? p[3] : 1 };
  }
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  function toHexOrRgba(css) {
    const c = parseColor(css);
    return c.a < 0.99 ? css : hex(c);
  }

  /* 회전·배율을 풀어낸 기하: 중심 좌표 + 회전 전 크기 + 회전각 */
  function geom(el) {
    const r = el.getBoundingClientRect();
    let rot = 0, sx = 1, sy = 1;
    const t = getComputedStyle(el).transform;
    if (t && t !== 'none') {
      try {
        const m = new DOMMatrix(t);
        rot = Math.atan2(m.b, m.a) * 180 / Math.PI;
        sx = Math.hypot(m.a, m.b) || 1;
        sy = Math.hypot(m.c, m.d) || 1;
      } catch (e) { /* 지원 안 하면 회전 없음으로 */ }
    }
    const w = (el.offsetWidth || r.width) * sx;
    const h = (el.offsetHeight || r.height) * sy;
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w, h, rot: Math.round(rot * 10) / 10 };
  }

  function radiusOf(st, w, h) {
    const raw = st.borderTopLeftRadius || '0px';
    if (raw.includes('%')) return (parseFloat(raw) / 100) * Math.min(w, h);
    return parseFloat(raw) || 0;
  }

  /* 요소의 "직속 인라인 흐름" 텍스트 노드들 (블록/inline-block 자식 내부는 제외) */
  function inlineFlowTextNodes(el) {
    const out = [];
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out.push(c);
        else if (c.nodeType === 1 && isInline(c)) walk(c);
      }
    })(el);
    return out;
  }

  // 글자 단위로 렌더링된 줄을 복원 (자동 줄바꿈 위치까지 정확히)
  function renderedLines(nodes) {
    const range = document.createRange();
    const lines = [];
    let curLine = null;
    for (const node of nodes) {
      const s = node.textContent;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '\n' || ch === '\r') continue;
        range.setStart(node, i); range.setEnd(node, i + 1);
        const r = range.getClientRects()[0];
        if (!r || r.width === 0) {
          if (curLine && !/\s/.test(ch)) curLine.text += ch;
          continue;
        }
        const isNewLine = !curLine || (r.top - curLine.top) > (curLine.h * 0.6);
        if (isNewLine) {
          if (curLine) lines.push(curLine);
          if (/\s/.test(ch)) { curLine = { text: '', top: r.top, left: r.right, right: r.right, bottom: r.bottom, h: r.height }; continue; }
          curLine = { text: ch, top: r.top, left: r.left, right: r.right, bottom: r.bottom, h: r.height };
        } else {
          curLine.text += ch;
          curLine.left = Math.min(curLine.left, r.left);
          curLine.right = Math.max(curLine.right, r.right);
          curLine.top = Math.min(curLine.top, r.top);
          curLine.bottom = Math.max(curLine.bottom, r.bottom);
          curLine.h = Math.max(curLine.h, r.height);
        }
      }
    }
    if (curLine) lines.push(curLine);
    return lines.map(l => ({ ...l, text: l.text.replace(/\s+$/, '') })).filter(l => l.text.trim());
  }

  /* 1) 분류 — 문서 순서 = 레이어 순서 (앞 요소가 아래) */
  const units = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const st = getComputedStyle(el);

    // 사진: <img> 또는 background-image(data URL)
    let photoSrc = null;
    if (el.tagName === 'IMG' && el.currentSrc && el.currentSrc.startsWith('data:')) {
      photoSrc = el.currentSrc;
    } else {
      const bg = st.backgroundImage || '';
      if (!bg.includes('gradient')) {
        const m = bg.match(/url\("?(data:[^")]+)"?\)/);
        if (m) photoSrc = m[1];
      }
    }
    if (photoSrc) { units.push({ kind: 'image', el, src: photoSrc }); continue; }

    if (isInline(el)) continue; // 인라인 조각은 텍스트 흐름/배경에서 처리

    // 도형: 채움색 또는 4면 테두리. 그라데이션은 배경 캡처에 남긴다.
    const grad = (st.backgroundImage || '').includes('gradient');
    const fill = parseColor(st.backgroundColor);
    const sideNames = ['Top', 'Right', 'Bottom', 'Left'];
    const sides = {};
    for (const sd of sideNames) {
      const w = parseFloat(st['border' + sd + 'Width']) || 0;
      const c = parseColor(st['border' + sd + 'Color']);
      if (w > 0.5 && st['border' + sd + 'Style'] !== 'none' && c.a > 0.01) sides[sd.toLowerCase()] = { w, c };
    }
    const all4 = Object.keys(sides).length === 4;
    const hasFill = fill.a > 0.01;
    if (!grad && (hasFill || all4)) {
      const r = el.getBoundingClientRect();
      const fullBleed = r.width * r.height >= SLIDE_AREA * 0.92;
      // 슬라이드 전체를 덮는 불투명 배경은 페이지 배경으로 두고,
      // 반투명 풀사이즈(어둡게 깔개 등)는 도형 레이어로 꺼낸다
      if (!fullBleed || (hasFill && fill.a < 0.98)) {
        units.push({ kind: 'rect', el, fill, hasFill, hasBorder: all4 });
      }
    }
    // 부분 테두리(구분선 등): 면마다 얇은 도형으로 꺼낸다 (전면 사진에 가려지지 않도록)
    if (!all4 && Object.keys(sides).length) {
      units.push({ kind: 'borders', el, sides });
    }

    // 텍스트 (도형이더라도 직속 텍스트가 있으면 별도 레이어)
    const nodes = inlineFlowTextNodes(el);
    if (nodes.some(n => n.textContent.trim())) units.push({ kind: 'text', el, nodes });
  }

  /* 2) 측정 */
  const out = [];
  for (const u of units) {
    const st = getComputedStyle(u.el);
    if (u.kind === 'image') {
      const nat = await new Promise(res => {
        if (u.el.tagName === 'IMG' && u.el.naturalWidth) return res({ w: u.el.naturalWidth, h: u.el.naturalHeight });
        const im = new Image();
        im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => res(null);
        im.src = u.src;
      });
      if (!nat) { u.skip = true; continue; }
      const g = geom(u.el);
      // cover 기준 자르기 계산 (가운데 정렬)
      const fit = u.el.tagName === 'IMG' ? (st.objectFit || 'fill') : (st.backgroundSize || 'auto');
      let crop = null, scale;
      if (fit === 'cover') {
        const s = Math.max(g.w / nat.w, g.h / nat.h);
        const cw = g.w / s, ch = g.h / s;
        crop = { cx: Math.max(0, (nat.w - cw) / 2), cy: Math.max(0, (nat.h - ch) / 2), cw, ch };
        scale = g.w / cw;
      } else {
        scale = g.w / nat.w;
      }
      const rad = radiusOf(st, g.w, g.h);
      const bw = Math.round((parseFloat(st.borderTopWidth) || 0));
      out.push({
        type: 'image', name: '사진', src: u.src,
        x: Math.round(g.cx - g.w / 2), y: Math.round(g.cy - g.h / 2), rot: g.rot,
        scale, crop,
        shape: rad >= Math.min(g.w, g.h) / 2 - 1 ? 'circle' : 'rect',
        borderW: bw, borderColor: bw > 0 ? toHexOrRgba(st.borderTopColor) : '#111111',
        opacity: parseFloat(st.opacity) || 1
      });
    } else if (u.kind === 'rect') {
      const g = geom(u.el);
      const rad = radiusOf(st, g.w, g.h);
      const bw = u.hasBorder ? Math.round(parseFloat(st.borderTopWidth) || 0) : 0;
      out.push({
        type: 'rect', name: '도형',
        x: Math.round(g.cx - g.w / 2), y: Math.round(g.cy - g.h / 2), rot: g.rot,
        w: Math.round(g.w), h: Math.round(g.h), scale: 1,
        fill: u.hasFill ? hex(u.fill) : 'none',
        radius: Math.round(rad),
        borderColor: bw > 0 ? toHexOrRgba(st.borderTopColor) : '#111111', borderW: bw,
        opacity: Math.round((u.hasFill ? u.fill.a : 1) * (parseFloat(st.opacity) || 1) * 100) / 100
      });
    } else if (u.kind === 'borders') {
      const r = u.el.getBoundingClientRect();
      for (const [side, sd] of Object.entries(u.sides)) {
        let x = r.left, y = r.top, w = r.width, h = r.height;
        if (side === 'top') h = sd.w;
        else if (side === 'bottom') { y = r.bottom - sd.w; h = sd.w; }
        else if (side === 'left') w = sd.w;
        else { x = r.right - sd.w; w = sd.w; }
        out.push({
          type: 'rect', name: '선',
          x: Math.round(x), y: Math.round(y),
          w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), scale: 1,
          fill: hex(sd.c), radius: 0, borderColor: '#111111', borderW: 0,
          opacity: Math.round(sd.c.a * (parseFloat(st.opacity) || 1) * 100) / 100, rot: 0
        });
      }
    } else { // text
      const lines = renderedLines(u.nodes);
      if (!lines.length) { u.skip = true; continue; }
      // 줄 하이라이트: 인라인 span의 배경색을 줄 단위 도형으로 (글자 뒤에 깔림)
      u.bgSpans = [];
      for (const sp of u.el.querySelectorAll('*')) {
        if (!isInline(sp)) continue;
        const sst = getComputedStyle(sp);
        const bg = parseColor(sst.backgroundColor);
        if (bg.a <= 0.01) continue;
        for (const r of sp.getClientRects()) {
          if (r.width < 1 || r.height < 1) continue;
          out.push({
            type: 'rect', name: '글자 배경',
            x: Math.round(r.left), y: Math.round(r.top),
            w: Math.round(r.width), h: Math.round(r.height), scale: 1,
            fill: hex(bg), radius: Math.round(radiusOf(sst, r.width, r.height)),
            borderColor: '#111111', borderW: 0,
            opacity: Math.round(bg.a * (parseFloat(sst.opacity) || 1) * 100) / 100, rot: 0
          });
        }
        u.bgSpans.push(sp);
      }
      const tst = getComputedStyle(u.nodes[0].parentElement || u.el);
      const fs = parseFloat(tst.fontSize);
      let lhPx = parseFloat(tst.lineHeight);
      if (!isFinite(lhPx)) lhPx = fs * 1.3;
      const strokeCssW = parseFloat(tst.webkitTextStrokeWidth) || 0;
      const x = Math.min(...lines.map(l => l.left));
      const inkH = lines[0].bottom - lines[0].top;
      const y = lines[0].top - Math.max(0, (lhPx - inkH) / 2);
      out.push({
        type: 'text',
        text: lines.map(l => l.text).join('\n'),
        x: Math.round(x), y: Math.round(y),
        fontSize: Math.round(fs),
        lh: Math.round((lhPx / fs) * 100) / 100,
        color: toHexOrRgba(tst.color),
        bold: parseInt(tst.fontWeight, 10) >= 600,
        strokeW: Math.round(strokeCssW / 2),
        strokeColor: strokeCssW > 0 ? toHexOrRgba(tst.webkitTextStrokeColor) : '#ffffff'
      });
    }
  }

  /* 3) 측정이 전부 끝난 뒤에 숨긴다 — 남는 것이 배경 캡처가 된다 */
  for (const u of units) {
    if (u.skip) continue;
    if (u.kind === 'text') {
      for (const el of [u.el, ...u.el.querySelectorAll('*')]) {
        el.style.setProperty('color', 'transparent', 'important');
        el.style.setProperty('-webkit-text-stroke-color', 'transparent', 'important');
        el.style.setProperty('text-shadow', 'none', 'important');
        el.style.setProperty('text-decoration-color', 'transparent', 'important');
      }
      (u.bgSpans || []).forEach(sp => sp.style.setProperty('background-color', 'transparent', 'important'));
    } else if (u.kind === 'borders') {
      for (const side of Object.keys(u.sides)) {
        u.el.style.setProperty('border-' + side + '-color', 'transparent', 'important');
      }
    } else {
      u.el.style.setProperty('visibility', 'hidden', 'important');
    }
  }
  return out;
}

(async () => {
  const builders = createBuilders(DATA, toDataURL);
  const slides = assembleSlides(
    DATA,
    builders,
    { toDataURL, topRowHTML: builders.topRowHTML, footerRowHTML: builders.footerRowHTML }
  );

  console.log(`\n🧩 [${baseName}] 레이어보드 프로젝트 내보내기 v2 시작 (${slides.length}장)\n`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

    const hl = DATA.cover || {};
    const accent = String(hl.highlightStyle || '').toLowerCase() === 'outline' && hl.highlightFill ? hl.highlightFill : null;
    const accentStyle = accent ? `<style>:root{--accent:${accent};}</style>` : '';

    const pages = [];
    for (const s of slides) {
      const fullHTML = TEMPLATE.replace('<div id="slide-root"></div>', accentStyle + s.html);
      await page.setContent(fullHTML, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.evaluateHandle('document.fonts.ready');
      await new Promise(r => setTimeout(r, 1500));

      const elements = await page.evaluate(extractAndHide);
      const bg = await page.screenshot({
        type: 'jpeg', quality: 88,
        clip: { x: 0, y: 0, width: W, height: H },
        encoding: 'base64'
      });

      pages.push({
        name: s.name,
        bgColor: '#ffffff',
        bgImage: `data:image/jpeg;base64,${bg}`,
        elements
      });
      const n = { image: 0, rect: 0, text: 0 };
      elements.forEach(e => n[e.type]++);
      console.log(`  ✓ ${s.name} (사진 ${n.image} · 도형 ${n.rect} · 텍스트 ${n.text})`);
    }

    const project = {
      app: 'layerboard',
      kind: 'project',
      version: 2,
      source: 'book_kkurueogi carousel',
      canvas: { w: W, h: H },
      pages
    };
    const outFile = path.join(OUT_DIR, `${baseName}.layerboard.json`);
    fs.writeFileSync(outFile, JSON.stringify(project));
    const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
    console.log(`\n✅ 레이어보드 프로젝트 저장 완료 → ${outFile} (${mb}MB)`);
    console.log(`   레이어보드를 열면 자동으로 불러와져요. 사진·도형·글자를 각각 수정할 수 있습니다.\n`);
  } finally {
    await browser.close();
  }
})();
