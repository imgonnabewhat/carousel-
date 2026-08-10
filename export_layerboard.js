/**
 * 레이어보드 내보내기 — 생성된 게시물을 레이어보드(layerboard) 편집기에서
 * 수정할 수 있는 프로젝트 파일(.layerboard.json)로 변환
 *
 * 사용법:
 *   node export_layerboard.js                # generated_data.json
 *   node export_layerboard.js my_post.json
 *
 * 원리: 슬라이드를 렌더링한 뒤
 *   1) 화면에 보이는 텍스트 덩어리를 찾아 위치·크기·색을 측정하고
 *   2) 글자만 투명하게 숨긴 배경을 캡처
 *   → 배경 사진 + 편집 가능한 텍스트 레이어로 분리된 페이지가 된다.
 * 결과물을 레이어보드의 "게시물 불러오기"로 열면 슬라이드별 페이지가 생긴다.
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

/* 브라우저 안에서 실행: 텍스트 블록을 찾아 측정한 뒤 글자만 투명 처리 */
function extractAndHideText() {
  const W = 1080, H = 1350;

  function visible(el) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W;
  }
  const isInline = el => getComputedStyle(el).display === 'inline';

  /* 요소의 "직속 인라인 흐름" 텍스트 노드들.
     블록/inline-block 자식 내부는 제외 — 그 자식이 별도의 추출 단위가 된다.
     (예: 푸터의 핸들은 div 직속 텍스트, 태그라인은 inline-block span) */
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

  const units = [];
  for (const el of document.querySelectorAll('body *')) {
    if (isInline(el) || !visible(el)) continue;
    const nodes = inlineFlowTextNodes(el);
    if (!nodes.some(n => n.textContent.trim())) continue;
    units.push({ el, nodes });
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
        if (!r || r.width === 0) { // 접힌 공백 등
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

  function toHex(cssColor) {
    const m = cssColor.match(/rgba?\(([^)]+)\)/);
    if (!m) return cssColor;
    const p = m[1].split(',').map(v => parseFloat(v));
    if (p.length === 4 && p[3] < 0.99) return cssColor; // 반투명은 rgba 그대로 (캔버스에서 그대로 동작)
    return '#' + p.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  const out = [];
  for (const { el: block, nodes } of units) {
    const lines = renderedLines(nodes);
    if (!lines.length) continue;
    // 글자 스타일은 첫 텍스트 노드를 감싼 요소 기준 (인라인 span의 색·크기 반영)
    const st = getComputedStyle(nodes[0].parentElement || block);
    const fs = parseFloat(st.fontSize);
    let lhPx = parseFloat(st.lineHeight);
    if (!isFinite(lhPx)) lhPx = fs * 1.3; // line-height: normal
    const strokeCssW = parseFloat(st.webkitTextStrokeWidth) || 0;
    const x = Math.min(...lines.map(l => l.left));
    // 레이어보드는 줄 슬롯(fontSize×lh) 안에 글자를 세로 중앙 정렬하므로,
    // 첫 줄 잉크 상단에서 반 행간만큼 올린 지점이 상자의 y가 된다.
    const inkH = lines[0].bottom - lines[0].top;
    const y = lines[0].top - Math.max(0, (lhPx - inkH) / 2);
    out.push({
      type: 'text',
      text: lines.map(l => l.text).join('\n'),
      x: Math.round(x), y: Math.round(y),
      fontSize: Math.round(fs),
      lh: Math.round((lhPx / fs) * 100) / 100,
      color: toHex(st.color),
      bold: parseInt(st.fontWeight, 10) >= 600,
      strokeW: Math.round(strokeCssW / 2), // CSS 스트로크는 중앙 정렬이라 바깥쪽 두께는 절반
      strokeColor: strokeCssW > 0 ? toHex(st.webkitTextStrokeColor) : '#ffffff'
    });
  }
  // 측정이 전부 끝난 뒤에 글자만 투명하게 — 박스·배경·테두리는 배경 캡처에 남긴다
  // (측정 중에 숨기면 자식 단위의 색이 투명으로 읽히므로 반드시 두 번째 단계에서)
  for (const { el: block } of units) {
    for (const el of [block, ...block.querySelectorAll('*')]) {
      el.style.setProperty('color', 'transparent', 'important');
      el.style.setProperty('-webkit-text-stroke-color', 'transparent', 'important');
      el.style.setProperty('text-shadow', 'none', 'important');
      el.style.setProperty('text-decoration-color', 'transparent', 'important');
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

  console.log(`\n🧩 [${baseName}] 레이어보드 프로젝트 내보내기 시작 (${slides.length}장)\n`);

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

      const elements = await page.evaluate(extractAndHideText);
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
      console.log(`  ✓ ${s.name} (텍스트 레이어 ${elements.length}개)`);
    }

    const project = {
      app: 'layerboard',
      kind: 'project',
      version: 1,
      source: 'book_kkurueogi carousel',
      canvas: { w: W, h: H },
      pages
    };
    const outFile = path.join(OUT_DIR, `${baseName}.layerboard.json`);
    fs.writeFileSync(outFile, JSON.stringify(project));
    const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
    console.log(`\n✅ 레이어보드 프로젝트 저장 완료 → ${outFile} (${mb}MB)`);
    console.log(`   레이어보드에서 "게시물 불러오기"로 이 파일을 열면 수정할 수 있어요.\n`);
  } finally {
    await browser.close();
  }
})();
