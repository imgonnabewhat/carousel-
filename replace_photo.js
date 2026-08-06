/**
 * replace_photo.js — 이미 들어간 사진을 다른 사진으로 교체
 *
 * fetch_images.js는 "비어 있는 자리"만 채운다(이미 받은 사진은 건너뜀).
 * 이 스크립트는 그 반대로, 이미 채워진 자리를 골라서 다른 사진으로 바꾼다.
 *
 * 사용법
 *   node replace_photo.js                        사진 자리 목록 보기
 *   node replace_photo.js cover                  표지 사진을 같은 키워드로 다른 사진으로 (직전 사진 제외)
 *   node replace_photo.js book2 --keyword "rain window"   새 키워드로 교체
 *   node replace_photo.js intro --candidates      후보 10장 뽑기 → candidates.html 열어보기
 *   node replace_photo.js intro --pick 4          후보 4번으로 확정
 *   node replace_photo.js book3 --file photos/IMG_1234.jpg   내 사진으로 교체
 *   node replace_photo.js cover --url https://...jpg        이미지 주소로 교체
 *   node replace_photo.js book1.cover --candidates           책 표지 판본 고르기
 *
 * 옵션
 *   --data <파일.json>   대상 JSON (기본 generated_data.json)
 *   --keyword "..."      새 검색 키워드 (영어 권장)
 *   --source unsplash|pexels|pixabay|auto        사진 소스 지정 (기본 auto)
 *   --orientation portrait|landscape|squarish    사진 방향 (기본: 자리에 맞는 값)
 *   --file <경로>        내 사진 파일로 교체
 *   --url <주소>         인터넷 이미지 주소로 교체
 *   --candidates [N]     후보 N장(기본 10) 목록만 뽑기 + candidates.html 생성
 *   --pick N             후보 N번으로 교체
 *   --book "제목" --author "저자"    책 표지 자리에서 다시 검색할 때
 */

const fs = require('fs');
const path = require('path');
const S = require('./image_sources');
const slotsApi = require('./photo_slots');

const ROOT = __dirname;
const COVERS_DIR = path.join(ROOT, 'covers');
const PHOTOS_DIR = path.join(ROOT, 'photos');
const CACHE_FILE = path.join(ROOT, '.photo_candidates.json');
const CANDIDATES_HTML = path.join(ROOT, 'candidates.html');

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];

// ============================================================
// 인자 파싱
// ============================================================
function parseArgs(argv) {
  const opts = { _: [] };
  const withValue = new Set(['data', 'keyword', 'source', 'orientation', 'file', 'url', 'pick', 'book', 'author']);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }

    const [rawName, inlineValue] = a.slice(2).split(/=(.*)/s);
    const name = rawName.toLowerCase();
    const next = () => (inlineValue !== undefined ? inlineValue : argv[++i]);

    if (withValue.has(name)) {
      const v = next();
      if (v === undefined) fail(`--${name} 값이 필요합니다.`);
      opts[name] = v;
    } else if (name === 'candidates') {
      const peek = inlineValue !== undefined ? inlineValue : argv[i + 1];
      if (peek !== undefined && /^\d+$/.test(peek)) { opts.candidates = Number(peek); if (inlineValue === undefined) i++; }
      else opts.candidates = 10;
    } else if (name === 'help' || name === 'h') {
      opts.help = true;
    } else {
      fail(`알 수 없는 옵션: --${rawName}`);
    }
  }
  return opts;
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

// ============================================================
// 목록 출력
// ============================================================
function printSlots(data, dataFile) {
  const slots = slotsApi.listSlots(data);
  if (!slots.length) {
    console.log(`\n${dataFile} 에 사진 자리가 없습니다.\n`);
    return;
  }

  console.log(`\n📂 ${dataFile} 의 사진 자리 ${slots.length}개\n`);
  const idWidth = Math.max(...slots.map(s => s.id.length), 6);

  for (const slot of slots) {
    const file = slotsApi.getFile(slot);
    const exists = slotsApi.hasFile(slot, ROOT);
    const mark = !file ? '⬜ 비어 있음' : exists ? '🖼  ' + file : '⚠️  파일 없음: ' + file;
    const keyword = slotsApi.getKeyword(slot);
    const credit = slotsApi.getCredit(slot);
    const extra = [];
    if (keyword) extra.push(`키워드 "${keyword}"`);
    if (slot.kind === 'bookCover' && slot.book) extra.push(`책 "${slot.book.title || ''}"`);
    if (credit && credit.photographer) extra.push(`${credit.photographer} / ${credit.source}`);

    console.log(`  ${slot.id.padEnd(idWidth)}  ${slot.label}`);
    console.log(`  ${' '.repeat(idWidth)}  ${mark}`);
    if (extra.length) console.log(`  ${' '.repeat(idWidth)}  ${extra.join(' · ')}`);
    console.log('');
  }

  const d = dataFile !== 'generated_data.json' ? ` --data ${dataFile}` : '';
  console.log('교체하려면:');
  console.log(`  node replace_photo.js <자리>${d}                     같은 키워드로 다른 사진`);
  console.log(`  node replace_photo.js <자리> --keyword "new words"${d}`);
  console.log(`  node replace_photo.js <자리> --candidates${d}        후보 10장 보고 고르기`);
  console.log(`  node replace_photo.js <자리> --file photos/내사진.jpg${d}\n`);
}

// ============================================================
// 후보 목록 → candidates.html
// ============================================================
function writeCandidatesHTML(slot, query, items, dataFile) {
  const cards = items.map((p, i) => `
    <figure>
      <div class="num">${i + 1}</div>
      <img src="${p.thumb || p.url}" alt="">
      <figcaption>${escapeHTML(p.photographer || p.title || '')}${p.source ? ` · ${escapeHTML(p.source)}` : ''}</figcaption>
    </figure>`).join('');

  const cmd = pickCommand(slot, dataFile);

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>사진 후보 — ${escapeHTML(slot.label)}</title>
<style>
  body { font-family: -apple-system, "Noto Sans KR", sans-serif; background:#f4f4f2; margin:0; padding:32px; color:#0E0E0E; }
  h1 { font-size:20px; margin:0 0 6px; }
  p.sub { color:#6B6B66; font-size:14px; margin:0 0 8px; }
  code { background:#0E0E0E; color:#DAF100; padding:6px 12px; border-radius:6px; display:inline-block; font-size:14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:20px; margin-top:24px; }
  figure { margin:0; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 2px 10px rgba(0,0,0,.08); position:relative; }
  figure img { width:100%; height:260px; object-fit:cover; display:block; background:#ddd; }
  .num { position:absolute; top:10px; left:10px; background:#DAF100; color:#0E0E0E; font-weight:700;
         width:32px; height:32px; border-radius:16px; display:flex; align-items:center; justify-content:center; font-size:15px; }
  figcaption { padding:10px 12px; font-size:13px; color:#6B6B66; }
</style></head>
<body>
  <h1>${escapeHTML(slot.label)} — 후보 ${items.length}장</h1>
  <p class="sub">검색어: <b>${escapeHTML(query)}</b></p>
  <p class="sub">마음에 드는 번호를 확인한 뒤 터미널에서:</p>
  <code>${escapeHTML(cmd)}</code>
  <div class="grid">${cards}</div>
</body></html>`;

  fs.writeFileSync(CANDIDATES_HTML, html);
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 다른 JSON을 쓰고 있으면 안내 명령에도 --data 를 붙여준다 */
function pickCommand(slot, dataFile) {
  return `node replace_photo.js ${slot.id} --pick <번호>` +
    (dataFile !== 'generated_data.json' ? ` --data ${dataFile}` : '');
}

function saveCache(payload) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));
}

function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); } catch (e) { return null; }
}

function printCandidates(items) {
  items.forEach((p, i) => {
    const who = p.photographer || p.title || '';
    const extra = p.publisher ? ` / ${p.publisher}` : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${who}${extra}  (${p.source})`);
  });
}

// ============================================================
// 교체 동작들
// ============================================================
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function toRel(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

/** 내 사진 파일로 교체 */
function replaceWithLocalFile(slot, given) {
  const tries = [path.resolve(process.cwd(), given), path.resolve(ROOT, given)];
  const src = tries.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!src) fail(`파일을 찾을 수 없습니다: ${given}`);

  const ext = path.extname(src).toLowerCase();
  if (!IMAGE_EXT.includes(ext)) {
    console.log(`⚠️  ${ext} 는 렌더링에서 지원하지 않는 형식입니다 (지원: ${IMAGE_EXT.join(', ')}).`);
    console.log('   아이폰 HEIC 사진이라면 JPG로 변환해서 다시 시도하세요.');
    process.exit(1);
  }

  let rel;
  if (!path.relative(ROOT, src).startsWith('..')) {
    rel = toRel(src);                       // 이미 프로젝트 안 → 그대로 사용
  } else {
    ensureDir(PHOTOS_DIR);                  // 밖에 있는 파일 → photos/로 복사
    // 한글 파일명은 살리고, 경로에서 문제되는 문자만 밑줄로
    let base = path.basename(src, ext).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^[._]+/, '');
    if (!base) base = slot.fileBase;
    let dest = path.join(PHOTOS_DIR, base + ext);
    let n = 1;
    while (fs.existsSync(dest)) dest = path.join(PHOTOS_DIR, `${base}_${n++}${ext}`);
    fs.copyFileSync(src, dest);
    rel = toRel(dest);
    console.log(`  📥 photos/ 로 복사: ${rel}`);
  }

  slotsApi.setFile(slot, rel);
  slotsApi.setCredit(slot, null);
  if (slot.nested) {
    slot.obj[slot.nested] = { type: 'local', path: rel };   // 자유 페이지는 source도 맞춰준다
  }
  return { rel, note: '내 사진' };
}

/** 이미지 주소(URL)로 교체 */
async function replaceWithURL(slot, url) {
  let ext = '.jpg';
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') fail(`https 주소만 받을 수 있습니다: ${url}`);
    const e = path.extname(u.pathname).toLowerCase();
    if (IMAGE_EXT.includes(e)) ext = e;
  } catch (e) {
    if (e.code === 'ERR_INVALID_URL') fail(`올바른 이미지 주소가 아닙니다: ${url}`);
    throw e;
  }

  ensureDir(COVERS_DIR);
  const dest = path.join(COVERS_DIR, `${slot.fileBase}${ext}`);
  process.stdout.write(`  ⬇️  내려받는 중... `);
  await S.downloadImage(url, dest);
  console.log('✓');

  const rel = `covers/${slot.fileBase}${ext}`;
  slotsApi.setFile(slot, rel);
  slotsApi.setCredit(slot, { source: 'URL', photographerUrl: url });
  return { rel, note: url };
}

/** 스톡 사진(Unsplash/Pexels/Pixabay)으로 교체 */
async function replaceWithStockPhoto(slot, opts, dataFile) {
  if (!S.hasAnyPhotoKey()) {
    fail('사진 API 키가 없습니다. .env에 UNSPLASH_ACCESS_KEY / PEXELS_API_KEY / PIXABAY_API_KEY 중 하나 이상을 넣어주세요.');
  }

  const keyword = opts.keyword || slotsApi.getKeyword(slot);
  if (!keyword) {
    fail(`이 자리에는 저장된 키워드가 없습니다. --keyword "영어 검색어" 를 함께 주세요.\n   예: node replace_photo.js ${slot.id} --keyword "rainy window night"`);
  }

  const provider = (opts.source || (['unsplash', 'pexels', 'pixabay'].includes(slot.provider) ? slot.provider : 'photo')).toLowerCase();
  const orientation = opts.orientation || slot.orientation || 'portrait';
  const onNote = (m) => console.log(`     ${m}`);

  // 1) 후보만 뽑기
  if (opts.candidates) {
    console.log(`\n🔎 "${keyword}" 후보 ${opts.candidates}장 (${orientation}, ${provider})\n`);
    const items = await S.searchPhotoCandidates(provider, keyword, orientation, { limit: opts.candidates, onNote });
    if (!items.length) fail('검색 결과가 없습니다. 키워드를 바꿔보세요.');
    printCandidates(items);
    writeCandidatesHTML(slot, keyword, items, dataFile);
    saveCache({ dataFile, slotId: slot.id, keyword, provider, orientation, items });
    console.log(`\n🖼  candidates.html 을 브라우저로 열면 사진을 눈으로 볼 수 있습니다.`);
    console.log(`   마음에 드는 번호로 확정: ${pickCommand(slot, dataFile)}\n`);
    return null;   // JSON 저장 안 함
  }

  // 2) 후보 번호로 확정
  let photo;
  if (opts.pick != null) {
    const n = Number(opts.pick);
    if (!Number.isInteger(n) || n < 1) fail('--pick 은 1 이상의 정수여야 합니다.');

    const cache = loadCache();
    const sameSearch = cache && cache.slotId === slot.id && cache.keyword === keyword
      && cache.provider === provider && cache.orientation === orientation && cache.dataFile === dataFile;

    if (sameSearch) {
      photo = cache.items[n - 1];
      if (!photo) fail(`후보 ${n}번이 없습니다 (저장된 후보 ${cache.items.length}장).`);
      photo = { ...photo, index: n };
    } else {
      process.stdout.write(`  🔎 "${keyword}" 재검색 후 ${n}번 선택... `);
      photo = await S.pickPhoto(provider, keyword, orientation, { pick: n, onNote });
      if (!photo) fail('검색 결과가 없습니다.');
      console.log('✓');
    }
  } else {
    // 3) 기본: 같은 키워드로 다른 사진 (직전 사진 제외)
    const exclude = [slotsApi.getPhotoId(slot)];
    process.stdout.write(`  🔎 "${keyword}" (${orientation}, ${provider})... `);
    photo = await S.pickPhoto(provider, keyword, orientation, { exclude, pool: 8, onNote });
    if (!photo) fail('검색 결과가 없습니다. 키워드를 바꿔보세요.');
    console.log('✓');
  }

  ensureDir(COVERS_DIR);
  const rel = `covers/${slot.fileBase}.jpg`;
  process.stdout.write(`  ⬇️  내려받는 중... `);
  await S.downloadImage(photo.url, path.join(ROOT, rel));
  console.log('✓');

  slotsApi.setFile(slot, rel);
  slotsApi.setKeyword(slot, keyword);
  slotsApi.setCredit(slot, slotsApi.makeCredit(photo, keyword));
  if (slot.nested) {
    const src = slot.obj[slot.nested];
    if (src && src.type === 'local') src.type = 'photo';
    if (src && opts.orientation) src.orientation = orientation;
  }
  return { rel, note: `후보 ${photo.index}번 · Photo by ${photo.photographer} (${photo.source})` };
}

/** 책 표지 교체 (네이버 책 검색) */
async function replaceBookCover(slot, opts, dataFile) {
  if (!S.hasNaverKeys()) fail('.env에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 필요합니다.');

  const title = opts.book || (slot.book && slot.book.title);
  const author = opts.author || (slot.book && slot.book.author);
  if (!title) fail(`검색할 책 제목이 없습니다. --book "제목" 을 함께 주세요.`);

  ensureDir(COVERS_DIR);

  // 후보 보기
  if (opts.candidates) {
    console.log(`\n🔎 "${title}" 표지 후보 (네이버책)\n`);
    const items = await S.searchNaverBookCandidates(title, author, opts.candidates);
    if (!items.length) fail('검색 결과가 없습니다.');
    printCandidates(items);
    writeCandidatesHTML(slot, `${title} ${author || ''}`.trim(), items, dataFile);
    saveCache({ dataFile, slotId: slot.id, keyword: `${title}|${author || ''}`, provider: 'bookCover', orientation: 'portrait', items });
    console.log(`\n🖼  candidates.html 을 브라우저로 열어 판본을 확인하세요.`);
    console.log(`   확정: ${pickCommand(slot, dataFile)}\n`);
    return null;
  }

  // 번호로 확정
  if (opts.pick != null) {
    const n = Number(opts.pick);
    const cache = loadCache();
    const sameSearch = cache && cache.slotId === slot.id && cache.provider === 'bookCover' && cache.dataFile === dataFile;
    const items = sameSearch ? cache.items : await S.searchNaverBookCandidates(title, author, Math.max(n, 10));
    const chosen = items[n - 1];
    if (!chosen) fail(`후보 ${n}번이 없습니다 (${items.length}장).`);

    const ext = path.extname(new URL(chosen.url).pathname) || '.jpg';
    const rel = `covers/${slot.fileBase}${ext}`;
    process.stdout.write(`  ⬇️  "${chosen.title}" 표지 내려받는 중... `);
    await S.downloadImage(chosen.url, path.join(ROOT, rel));
    console.log('✓');
    slotsApi.setFile(slot, rel);
    return { rel, note: `${chosen.title} / ${chosen.publisher || ''}` };
  }

  // 기본: 가장 잘 맞는 판본 다시 받기
  process.stdout.write(`  🔎 "${title}" 네이버 표지 다시 받기... `);
  const r = await S.downloadNaverCover(title, author, slot.fileBase, COVERS_DIR);
  if (!r) fail('네이버 검색 결과가 없습니다.');
  console.log('✓');
  slotsApi.setFile(slot, r.rel);
  console.log(`     네이버가 찾은 책: "${r.naverTitle}"`);
  console.log(`     다른 판본을 쓰려면: node replace_photo.js ${slot.id} --candidates`);
  return { rel: r.rel, note: r.naverTitle };
}

// ============================================================
// 메인
// ============================================================
function printHelp() {
  console.log(fs.readFileSync(__filename, 'utf-8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ ?\* ?/gm, ''));
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return printHelp();

  const dataFile = opts.data || 'generated_data.json';
  const DATA_PATH = path.join(ROOT, dataFile);
  if (!fs.existsSync(DATA_PATH)) fail(`${dataFile} 파일이 없습니다.`);

  let data;
  try { data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')); }
  catch (e) { fail(`${dataFile} JSON 문법 오류: ${e.message}`); }

  const target = opts._[0];
  if (!target || target.toLowerCase() === 'list') return printSlots(data, dataFile);

  const slot = slotsApi.findSlot(data, target);
  if (!slot) {
    console.error(`\n❌ "${target}" 라는 사진 자리가 없습니다.`);
    printSlots(data, dataFile);
    process.exit(1);
  }

  console.log(`\n🔁 ${slot.label} (${slot.id}) 교체`);
  const before = slotsApi.getFile(slot);
  console.log(`   지금: ${before || '(비어 있음)'}`);

  let result;
  if (opts.file) {
    result = replaceWithLocalFile(slot, opts.file);
  } else if (opts.url) {
    result = await replaceWithURL(slot, opts.url);
  } else if (slot.kind === 'bookCover' && !opts.keyword) {
    result = await replaceBookCover(slot, opts, dataFile);
  } else {
    result = await replaceWithStockPhoto(slot, opts, dataFile);
  }

  if (!result) return;   // --candidates 는 JSON을 건드리지 않는다

  // 책 표지 자리는 "이 제목으로 받아둔 표지"라고 표시해서, 다음 fetch_images 실행이 덮어쓰지 않게 한다
  if (slot.queryField) slotsApi.markQuery(slot);

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log(`\n✅ 교체 완료 → ${result.rel}`);
  if (result.note) console.log(`   ${result.note}`);
  console.log(`💾 ${dataFile} 저장됨`);
  console.log(`\n📝 다음 단계:`);
  console.log(`   node preview.js     # (선택) 미리보기`);
  console.log(`   node generate.js    # PNG 다시 생성\n`);
})().catch(e => {
  console.error(`\n❌ ${e.message}\n`);
  process.exit(1);
});
