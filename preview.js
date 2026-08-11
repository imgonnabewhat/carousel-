/**
 * 미리보기 HTML 생성 (v4) — 모든 슬라이드를 한 페이지에서 확인
 * 사용법: node preview.js [파일.json]
 */
const fs = require('fs');
const path = require('path');
const { assembleSlides } = require('./free_page');
const { createBuilders } = require('./builders');

const dataFile = process.argv[2] || 'generated_data.json';
const TEMPLATE = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf-8');
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, dataFile), 'utf-8'));

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

const builders = createBuilders(DATA, toDataURL);
const slides = assembleSlides(
  DATA,
  builders,
  { toDataURL, topRowHTML: builders.topRowHTML, footerRowHTML: builders.footerRowHTML }
).map(s => s.html);

const previewWrapper = `
<div style="display:flex;flex-direction:column;gap:30px;padding:30px;background:#E5E5E5;align-items:center;">
  ${slides.map(s => `<div style="transform:scale(0.5);transform-origin:top center;width:1080px;height:1350px;margin-bottom:-680px;box-shadow:0 6px 30px rgba(0,0,0,0.15);">${s}</div>`).join('')}
</div>
`;

// 미리보기 전용: 템플릿의 1080x1350 고정 + overflow:hidden 잠금을 해제해 스크롤 가능하게
const scrollFix = '<style>html,body{width:auto !important;height:auto !important;overflow:auto !important;background:#E5E5E5;}</style>';
// 게시물 강조색: cover.highlightFill이 있으면 강조 방식과 무관하게 전체 액센트로 전파
const hl = DATA.cover || {};
const accent = hl.highlightFill || null;
const accentStyle = accent ? `<style>:root{--accent:${accent};}</style>` : '';

const previewHTML = TEMPLATE
  .replace('</head>', scrollFix + '</head>')
  .replace('<div id="slide-root"></div>', accentStyle + previewWrapper);
fs.writeFileSync(path.join(__dirname, 'preview.html'), previewHTML);
console.log('✅ preview.html 생성 완료. 브라우저로 열어 확인하세요.');
