/**
 * fetch_images.js — 이미지 통합 자동 수집 (fetch_books.js 상위호환)
 *
 * 동작:
 *   1. books[].cover        — 네이버 책 검색으로 표지 다운로드
 *   2. cover.photoKeyword   — 사진 API에서 표지 사진 다운로드
 *   3. intro.photoKeyword   — 인트로 타원 사진
 *   4. books[].photoKeyword — 책별 무드 사진
 *   5. freePages[].images   — source 타입별로 자동 해결:
 *        {"type":"bookCover","title":"...","author":"..."} → 네이버 표지
 *        {"type":"photo","keyword":"..."}                  → Unsplash → Pexels → Pixabay 순서로 자동 시도 (추천)
 *        {"type":"unsplash"|"pexels"|"pixabay","keyword":"...","orientation":"portrait|landscape|squarish"} → 특정 소스 지정
 *        {"type":"local","path":"photos/x.jpg"}            → 그대로 사용 (다운로드 없음)
 *
 * 이미 받아둔 사진은 건너뛴다. 다시 받게 하려면 셋 중 하나:
 *   - 그 자리에 "replace": true 를 넣는다      (아이패드/깃허브에서 JSON만 고칠 때)
 *       cover / intro / books[]  → "photoReplace": true   (책 표지는 "coverReplace": true)
 *       freePages 이미지·배경     → "replace": true
 *     ※ 한 번 실행되면 이 플래그는 자동으로 지워진다.
 *   - 키워드(photoKeyword / source.keyword)를 바꾼다 → 바뀐 걸 감지해 새로 받는다
 *   - node replace_photo.js <자리> 로 골라서 교체한다 (후보 보고 고르기·내 사진 넣기 가능)
 *
 * 사용법:
 *   node fetch_images.js                 # generated_data.json
 *   node fetch_images.js my_post.json    # 다른 파일
 *
 * 필요한 환경 변수 (.env):
 *   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET  (필수)
 *   UNSPLASH_ACCESS_KEY, PEXELS_API_KEY, PIXABAY_API_KEY  (사진 소스 — 있는 것만 사용)
 */

const fs = require('fs');
const path = require('path');
const S = require('./image_sources');
const slotsApi = require('./photo_slots');

if (!S.hasNaverKeys()) {
  console.error('❌ .env 파일에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 필요');
  process.exit(1);
}
if (!S.hasAnyPhotoKey()) {
  console.warn('⚠️  사진 API 키가 하나도 없습니다 (UNSPLASH_ACCESS_KEY / PEXELS_API_KEY / PIXABAY_API_KEY). 분위기 사진은 건너뜁니다.');
}

const dataFileName = process.argv[2] || 'generated_data.json';
const DATA_FILE = path.join(__dirname, dataFileName);
const COVERS_DIR = path.join(__dirname, 'covers');
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

if (!fs.existsSync(DATA_FILE)) {
  console.error(`❌ ${DATA_FILE} 파일이 없습니다.`);
  process.exit(1);
}

const onNote = (m) => console.log(`\n     ${m}`);
const dataArg = dataFileName === 'generated_data.json' ? '' : ` --data ${dataFileName}`;

/** 교체(재수집)일 때는 직전에 쓰던 사진을 제외해서 같은 사진이 다시 나오지 않게 한다 */
function excludeList(slot, reason) {
  return reason === 'keep' || reason === 'missing' ? [] : [slotsApi.getPhotoId(slot)];
}

/** 사진 한 장을 받아 슬롯에 기록 */
async function fetchPhotoInto(slot, keyword, orientation, provider, reason) {
  const result = await S.pickPhoto(provider || 'photo', keyword, orientation, {
    exclude: excludeList(slot, reason),
    onNote,
  });
  if (!result) { console.log('⚠️  결과 없음'); return false; }

  const rel = `covers/${slot.fileBase}.jpg`;
  await S.downloadImage(result.url, path.join(__dirname, rel));
  slotsApi.setFile(slot, rel);
  slotsApi.setCredit(slot, slotsApi.makeCredit(result, keyword));
  console.log(`✓ Photo by ${result.photographer} (${result.source})`);
  return true;
}

// ============================================================
// 1) 책 본문용 표지
// ============================================================
async function fetchBookCovers(data, slots) {
  const targets = slots.filter(s => s.group === 'bookCover');
  if (!targets.length) return;
  console.log(`\n📚 책 표지 ${targets.length}권 수집\n`);

  for (let i = 0; i < targets.length; i++) {
    const slot = targets[i];
    const book = slot.obj;
    const { fetch: need, reason } = slotsApi.shouldFetch(slot, __dirname);

    if (!need) {
      console.log(`  ${i + 1}. "${book.title}" — 이미 있음 → ${slotsApi.getFile(slot)}`);
      continue;
    }

    process.stdout.write(`  ${i + 1}. "${book.title}" / ${book.author}${reason === 'replace' ? ' (교체 요청)' : ''}... `);
    try {
      const r = await S.downloadNaverCover(book.title, book.author, slot.fileBase, COVERS_DIR);
      if (!r) { console.log('⚠️  네이버 결과 없음'); continue; }
      slotsApi.setFile(slot, r.rel);
      slotsApi.markQuery(slot);

      const same = r.naverTitle.replace(/\s/g, '').includes(String(book.title).replace(/\s/g, ''));
      if (same) console.log(`✓`);
      else {
        console.log(`⚠️`);
        console.log(`     네이버는 "${r.naverTitle}"를 찾았어요. 다른 책일 수 있으니 확인 필요!`);
        console.log(`     다른 판본으로 바꾸려면: node replace_photo.js ${slot.id} --candidates${dataArg}`);
      }
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    await S.sleep(200);
  }
}

// ============================================================
// 2) 표지(커버) 사진
// ============================================================
async function fetchCoverPhoto(data, slots) {
  const slot = slots.find(s => s.group === 'cover');
  if (!slot) return;
  const keyword = slotsApi.getKeyword(slot);
  if (!keyword || !S.hasAnyPhotoKey()) return;

  const { fetch: need, reason } = slotsApi.shouldFetch(slot, __dirname);
  if (!need) {
    console.log(`\n🎨 표지 사진: 이미 있음 → ${slotsApi.getFile(slot)}`);
    console.log(`   (교체하려면 cover에 "photoReplace": true 를 넣거나 node replace_photo.js cover)`);
    return;
  }

  console.log(`\n🎨 표지 사진 수집${reason === 'replace' ? ' (교체 요청)' : ''}`);
  process.stdout.write(`  🖼️  "${keyword}" 검색 (${slot.orientation})... `);
  try {
    await fetchPhotoInto(slot, keyword, slot.orientation, 'photo', reason);
  } catch (e) {
    console.log(`❌ ${e.message}`);
  }
}

// ============================================================
// 3) 인트로 타원 사진
// ============================================================
async function fetchIntroPhoto(data, slots) {
  const slot = slots.find(s => s.group === 'intro');
  if (!slot) return;
  const keyword = slotsApi.getKeyword(slot);
  if (!keyword || !S.hasAnyPhotoKey()) return;

  const { fetch: need, reason } = slotsApi.shouldFetch(slot, __dirname);
  if (!need) return;

  console.log(`\n🥚 인트로 타원 사진 수집${reason === 'replace' ? ' (교체 요청)' : ''}`);
  process.stdout.write(`  🖼️  "${keyword}" (${slot.orientation})... `);
  try {
    await fetchPhotoInto(slot, keyword, slot.orientation, 'photo', reason);
  } catch (e) { console.log(`❌ ${e.message}`); }
}

// ============================================================
// 4) 책별 무드 사진
// ============================================================
async function fetchBookMoodPhotos(data, slots) {
  const targets = slots.filter(s => s.group === 'mood' && slotsApi.getKeyword(s));
  if (!targets.length || !S.hasAnyPhotoKey()) return;

  console.log(`\n🌫  책 무드 사진 수집 (photo-bg / inset 구성용)\n`);
  for (let i = 0; i < targets.length; i++) {
    const slot = targets[i];
    const keyword = slotsApi.getKeyword(slot);
    const { fetch: need, reason } = slotsApi.shouldFetch(slot, __dirname);

    if (!need) {
      console.log(`  ${i + 1}. 이미 있음 → ${slotsApi.getFile(slot)}`);
      continue;
    }

    process.stdout.write(`  ${i + 1}. "${keyword}" (${slot.orientation})${reason === 'replace' ? ' (교체 요청)' : ''}... `);
    try {
      await fetchPhotoInto(slot, keyword, slot.orientation, 'photo', reason);
    } catch (e) { console.log(`❌ ${e.message}`); }
  }
}

// ============================================================
// 5) freePages 이미지 자동 해결
// ============================================================
async function fetchFreePageImages(data, slots) {
  const targets = slots.filter(s => s.group === 'free');
  if (!targets.length) return;
  console.log(`\n🧩 자유 배치 페이지 이미지 수집\n`);

  for (const slot of targets) {
    const tag = `  [${slot.label}]`;
    const src = slot.obj.source || {};
    const type = src.type || 'photo';
    const { fetch: need, reason } = slotsApi.shouldFetch(slot, __dirname);

    if (!need) {
      console.log(`${tag} 이미 있음 → ${slotsApi.getFile(slot)}`);
      continue;
    }
    const mark = reason === 'replace' ? ' (교체 요청)' : reason === 'keyword' ? ' (키워드 변경)' : '';

    try {
      if (type === 'local') {
        if (src.path && fs.existsSync(path.join(__dirname, src.path))) {
          slotsApi.setFile(slot, src.path);
          console.log(`${tag} 로컬 파일 ✓ ${src.path}`);
        } else {
          console.log(`${tag} ⚠️  로컬 파일 없음: ${src.path} — 파일을 넣고 다시 실행하세요`);
        }
      } else if (type === 'bookCover') {
        process.stdout.write(`${tag} 네이버 표지 "${src.title}"${mark}... `);
        const r = await S.downloadNaverCover(src.title, src.author, slot.fileBase, COVERS_DIR);
        if (!r) { console.log('⚠️  결과 없음'); continue; }
        slotsApi.setFile(slot, r.rel);
        console.log('✓');
        await S.sleep(200);
      } else if (type === 'unsplash' || type === 'pexels' || type === 'pixabay' || type === 'photo') {
        if (!S.hasAnyPhotoKey()) { console.log(`${tag} ⏭️  사진 API 키 없음`); continue; }
        const keyword = src.keyword;
        if (!keyword) { console.log(`${tag} ⚠️  source.keyword 가 없습니다`); continue; }
        const providerLabel = type === 'photo' ? '자동' : type;
        process.stdout.write(`${tag} 사진(${providerLabel}) "${keyword}" (${slot.orientation})${mark}... `);
        await fetchPhotoInto(slot, keyword, slot.orientation, type, reason);
      } else {
        console.log(`${tag} ⚠️  알 수 없는 source.type: "${type}"`);
      }
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
  }
}

// ============================================================
// 메인
// ============================================================
(async () => {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const slots = slotsApi.listSlots(data);   // 슬롯은 원본 객체를 참조하므로 값을 바꾸면 data에 반영된다

  await fetchBookCovers(data, slots);
  await fetchCoverPhoto(data, slots);
  await fetchIntroPhoto(data, slots);
  await fetchBookMoodPhotos(data, slots);
  await fetchFreePageImages(data, slots);

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`\n💾 ${dataFileName} 업데이트 완료`);
  console.log(`\n📝 다음 단계:`);
  console.log(`   node preview.js         # (선택) 미리보기`);
  console.log(`   node generate.js        # PNG 생성`);
  console.log(`   node replace_photo.js   # 마음에 안 드는 사진만 골라 교체`);
})();
