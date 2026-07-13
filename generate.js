/**
 * 북꾸러기 인스타그램 캐러셀 생성기 v4
 *
 * 사용법:
 *   node generate.js                # generated_data.json
 *   node generate.js my_post.json
 *
 * meta.coverVariant = "A" | "B" | "C"
 * meta.bodyVariant  = "mix"(기본, 3구성 순환) | "1" | "2" | "3"(구 시안)
 * 인트로에 photo/photoKeyword가 있으면 타원 사진 레이아웃
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

(async () => {
  const builders = createBuilders(DATA, toDataURL);
  const slides = assembleSlides(
    DATA,
    builders,
    { toDataURL, topRowHTML: builders.topRowHTML, footerRowHTML: builders.footerRowHTML }
  );
  const totalPages = slides.length;
  const freeCount = (DATA.freePages || []).length;

  console.log(`\n🚀 [${baseName}] 캐러셀 생성 시작 (v4)`);
  console.log(`   커버: ${DATA.meta.coverVariant || 'A'} / 본문: ${DATA.meta.bodyVariant || 'mix'}${DATA.intro ? ' / 인트로 포함' : ''}${freeCount ? ` / 자유 페이지 ${freeCount}` : ''}`);
  console.log(`   총 ${totalPages}장\n`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });

    // 게시물 강조색: 표지가 outline 방식이고 채움색이 있으면 본문 액센트로 전파
    const hl = DATA.cover || {};
    const accent = String(hl.highlightStyle || '').toLowerCase() === 'outline' && hl.highlightFill ? hl.highlightFill : null;
    const accentStyle = accent ? `<style>:root{--accent:${accent};}</style>` : '';

    for (const s of slides) {
      const fullHTML = TEMPLATE.replace('<div id="slide-root"></div>', accentStyle + s.html);
      await page.setContent(fullHTML, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.evaluateHandle('document.fonts.ready');
      await new Promise(r => setTimeout(r, 1500));

      const filename = `${s.name}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, filename), clip: { x: 0, y: 0, width: 1080, height: 1350 } });
      console.log(`  ✓ ${filename}`);
    }
    console.log(`\n✅ ${slides.length}장 생성 완료 → ${OUT_DIR}\n`);
  } finally {
    await browser.close();
  }
})();
