/**
 * fetch_images.js — 이미지 통합 자동 수집 (fetch_books.js 상위호환)
 *
 * 동작:
 *   1. books[].cover        — 네이버 책 검색으로 표지 다운로드 (기존과 동일)
 *   2. cover.photoKeyword   — Unsplash에서 표지 사진 다운로드 (기존과 동일)
 *   3. freePages[].images   — source 타입별로 자동 해결:
 *        {"type":"bookCover","title":"...","author":"..."} → 네이버 표지
 *        {"type":"photo","keyword":"..."}                  → Unsplash → Pexels → Pixabay 순서로 자동 시도 (추천)
 *        {"type":"unsplash"|"pexels"|"pixabay","keyword":"...","orientation":"portrait|landscape|squarish"} → 특정 소스 지정
 *        {"type":"local","path":"photos/x.jpg"}            → 그대로 사용 (다운로드 없음)
 *
 * 사용법:
 *   node fetch_images.js                 # generated_data.json
 *   node fetch_images.js my_post.json    # 다른 파일
 *
 * 필요한 환경 변수 (.env):
 *   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET  (필수)
 *   UNSPLASH_ACCESS_KEY, PEXELS_API_KEY, PIXABAY_API_KEY  (사진 소스 — 있는 것만 사용)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

const NAVER_ID = process.env.NAVER_CLIENT_ID;
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;
const PEXELS_KEY = process.env.PEXELS_API_KEY;     // https://www.pexels.com/api/ 에서 무료 발급
const PIXABAY_KEY = process.env.PIXABAY_API_KEY;   // https://pixabay.com/api/docs/ 에서 무료 발급

if (!NAVER_ID || !NAVER_SECRET) {
  console.error('❌ .env 파일에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 필요');
  process.exit(1);
}
if (!UNSPLASH_KEY && !PEXELS_KEY && !PIXABAY_KEY) {
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

// ============================================================
// HTTP 유틸
// ============================================================
function httpsRequest(options) {
  return new Promise((resolve, reject) => {
    https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data }); }
      });
    }).on('error', reject).end();
  });
}

function downloadImage(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return downloadImage(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================
// 네이버 책 검색 (fetch_books.js와 동일 로직)
// ============================================================
async function searchNaverBook(title, author) {
  const query = `${title} ${author || ''}`.trim();
  const { data } = await httpsRequest({
    hostname: 'openapi.naver.com',
    path: `/v1/search/book.json?query=${encodeURIComponent(query)}&display=10`,
    method: 'GET',
    headers: {
      'X-Naver-Client-Id': NAVER_ID,
      'X-Naver-Client-Secret': NAVER_SECRET,
    },
  });

  if (data.errorCode) throw new Error(`네이버 API: ${data.errorMessage}`);
  if (!data.items || data.items.length === 0) return null;

  const cleanTitle = (s) => stripTags(s).replace(/\s/g, '');
  const userClean = cleanTitle(title);
  const excludedKeywords = ['리커버', '특별판', '큰글자', '세트', '합본', '개정판', '양장본', 'eBook', '한정판'];

  let match = data.items.find(item => {
    const itemClean = cleanTitle(item.title);
    const hasExcluded = excludedKeywords.some(kw => item.title.includes(kw));
    return itemClean === userClean && !hasExcluded;
  });

  if (!match) {
    const candidates = data.items.filter(item => {
      const itemClean = cleanTitle(item.title);
      const hasExcluded = excludedKeywords.some(kw => item.title.includes(kw));
      return itemClean.startsWith(userClean) && !hasExcluded;
    });
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.title.length - b.title.length);
      match = candidates[0];
    }
  }

  if (!match) {
    match = data.items.find(item =>
      !excludedKeywords.some(kw => item.title.includes(kw))
    );
  }
  if (!match) match = data.items[0];

  return {
    title: stripTags(match.title),
    author: stripTags(match.author).split('|')[0],
    publisher: stripTags(match.publisher),
    image: match.image,
  };
}

async function downloadNaverCover(title, author, filename) {
  const result = await searchNaverBook(title, author);
  if (!result) return null;
  const ext = path.extname(new URL(result.image).pathname) || '.jpg';
  const dest = path.join(COVERS_DIR, filename + ext);
  await downloadImage(result.image, dest);
  return { rel: `covers/${filename}${ext}`, naverTitle: result.title };
}

// ============================================================
// Unsplash 사진 검색
// ============================================================
async function searchUnsplashPhoto(query, orientation = 'portrait') {
  if (!UNSPLASH_KEY) return null;

  const { data } = await httpsRequest({
    hostname: 'api.unsplash.com',
    path: `/search/photos?query=${encodeURIComponent(query)}&per_page=10&orientation=${orientation}&content_filter=high`,
    method: 'GET',
    headers: {
      'Authorization': `Client-ID ${UNSPLASH_KEY}`,
      'Accept-Version': 'v1',
    },
  });

  if (data.errors) throw new Error(`Unsplash API: ${data.errors.join(', ')}`);
  if (!data.results || data.results.length === 0) return null;

  const pool = data.results.slice(0, Math.min(data.results.length, 5));
  const photo = pool[Math.floor(Math.random() * pool.length)];

  return {
    url: photo.urls.regular,
    photographer: photo.user.name,
    photographerUrl: photo.user.links.html,
    source: 'Unsplash',
  };
}

// ============================================================
// Pexels 사진 검색 (무료, 상업 이용 허용)
// ============================================================
async function searchPexelsPhoto(query, orientation = 'portrait') {
  if (!PEXELS_KEY) return null;
  // Pexels orientation: landscape | portrait | square
  const ori = orientation === 'squarish' ? 'square' : orientation;

  const { data } = await httpsRequest({
    hostname: 'api.pexels.com',
    path: `/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=${ori}`,
    method: 'GET',
    headers: { 'Authorization': PEXELS_KEY },
  });

  if (data.error) throw new Error(`Pexels API: ${data.error}`);
  if (!data.photos || data.photos.length === 0) return null;

  const pool = data.photos.slice(0, Math.min(data.photos.length, 5));
  const photo = pool[Math.floor(Math.random() * pool.length)];

  return {
    url: photo.src.large2x || photo.src.large, // 충분한 해상도
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url,
    source: 'Pexels',
  };
}

// ============================================================
// Pixabay 사진 검색 (무료, 상업 이용 허용)
// ============================================================
async function searchPixabayPhoto(query, orientation = 'portrait') {
  if (!PIXABAY_KEY) return null;
  // Pixabay orientation: horizontal | vertical | all
  const ori = orientation === 'landscape' ? 'horizontal'
            : orientation === 'portrait' ? 'vertical' : 'all';

  const { data } = await httpsRequest({
    hostname: 'pixabay.com',
    path: `/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&image_type=photo&orientation=${ori}&per_page=10&safesearch=true`,
    method: 'GET',
    headers: {},
  });

  if (typeof data === 'string') throw new Error(`Pixabay API: ${data.slice(0, 120)}`);
  if (!data.hits || data.hits.length === 0) return null;

  const pool = data.hits.slice(0, Math.min(data.hits.length, 5));
  const photo = pool[Math.floor(Math.random() * pool.length)];

  return {
    url: photo.largeImageURL,
    photographer: photo.user,
    photographerUrl: `https://pixabay.com/users/${photo.user}-${photo.user_id}/`,
    source: 'Pixabay',
  };
}

// ============================================================
// 통합 사진 검색 — 키가 있는 소스를 순서대로 시도
// provider: 'unsplash' | 'pexels' | 'pixabay' | 'photo'(자동 폴백)
// ============================================================
async function searchStockPhoto(provider, query, orientation) {
  const table = {
    unsplash: searchUnsplashPhoto,
    pexels: searchPexelsPhoto,
    pixabay: searchPixabayPhoto,
  };

  if (provider !== 'photo') {
    const fn = table[provider];
    if (!fn) throw new Error(`알 수 없는 사진 소스: ${provider}`);
    return fn(query, orientation);
  }

  // 'photo': Unsplash → Pexels → Pixabay 순서로 결과가 나올 때까지 시도
  for (const name of ['unsplash', 'pexels', 'pixabay']) {
    try {
      const r = await table[name](query, orientation);
      if (r) return r;
    } catch (e) {
      console.log(`\n     (${name} 실패: ${e.message} — 다음 소스 시도)`);
    }
  }
  return null;
}

// ============================================================
// 1) 책 본문용 표지
// ============================================================
async function fetchBookCovers(data) {
  if (!data.books || !data.books.length) return;
  console.log(`\n📚 책 표지 ${data.books.length}권 수집\n`);

  for (let i = 0; i < data.books.length; i++) {
    const book = data.books[i];
    process.stdout.write(`  ${i + 1}. "${book.title}" / ${book.author}... `);
    try {
      const r = await downloadNaverCover(book.title, book.author, `auto_${String(i + 1).padStart(2, '0')}`);
      if (!r) { console.log('⚠️  네이버 결과 없음'); continue; }
      book.cover = r.rel;

      const same = r.naverTitle.replace(/\s/g, '').includes(book.title.replace(/\s/g, ''));
      if (same) console.log(`✓`);
      else {
        console.log(`⚠️`);
        console.log(`     네이버는 "${r.naverTitle}"를 찾았어요. 다른 책일 수 있으니 확인 필요!`);
      }
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    await sleep(200);
  }
}

// ============================================================
// 2) 표지(커버) 사진
// ============================================================
async function fetchCoverPhoto(data) {
  const keyword = data.cover && data.cover.photoKeyword;
  const hasAnyKey = UNSPLASH_KEY || PEXELS_KEY || PIXABAY_KEY;
  if (!keyword || !hasAnyKey) return;

  // 이미 받아둔 표지 사진이 있으면 유지 (바꾸려면 JSON에서 cover.photo 값을 지우고 재실행)
  if (data.cover.photo && fs.existsSync(path.join(__dirname, data.cover.photo))) {
    console.log(`\n🎨 표지 사진: 이미 있음 → ${data.cover.photo} (교체하려면 cover.photo 삭제 후 재실행)`);
    return;
  }

  const variant = ((data.meta && data.meta.coverVariant) || 'A').toUpperCase();
  const orientation = variant === 'B' ? 'landscape' : 'portrait';

  console.log(`\n🎨 표지 사진 수집`);
  process.stdout.write(`  🖼️  "${keyword}" 검색 (${orientation})... `);
  try {
    const result = await searchStockPhoto('photo', keyword, orientation);
    if (!result) { console.log('⚠️  결과 없음'); return; }
    const dest = path.join(COVERS_DIR, 'cover_photo.jpg');
    await downloadImage(result.url, dest);
    data.cover.photo = 'covers/cover_photo.jpg';
    data.cover.photoCredit = {
      photographer: result.photographer,
      photographerUrl: result.photographerUrl,
      source: result.source,
    };
    console.log(`✓ Photo by ${result.photographer} (${result.source})`);
  } catch (e) {
    console.log(`❌ ${e.message}`);
  }
}

// ============================================================
// 2.5) 인트로 타원 사진 + 책별 무드 사진 (v4)
// ============================================================
async function fetchIntroPhoto(data) {
  const intro = data.intro;
  if (!intro || !intro.photoKeyword) return;
  if (intro.photo && fs.existsSync(path.join(__dirname, intro.photo))) return;
  if (!UNSPLASH_KEY && !PEXELS_KEY && !PIXABAY_KEY) return;

  console.log(`\n🥚 인트로 타원 사진 수집`);
  process.stdout.write(`  🖼️  "${intro.photoKeyword}" (portrait)... `);
  try {
    const result = await searchStockPhoto('photo', intro.photoKeyword, 'portrait');
    if (!result) { console.log('⚠️  결과 없음'); return; }
    const dest = path.join(COVERS_DIR, 'intro_photo.jpg');
    await downloadImage(result.url, dest);
    intro.photo = 'covers/intro_photo.jpg';
    intro.photoCredit = { photographer: result.photographer, photographerUrl: result.photographerUrl, source: result.source };
    console.log(`✓ Photo by ${result.photographer} (${result.source})`);
  } catch (e) { console.log(`❌ ${e.message}`); }
}

async function fetchBookMoodPhotos(data) {
  if (!data.books || !data.books.length) return;
  const targets = data.books.filter(b => b.photoKeyword);
  if (!targets.length) return;
  if (!UNSPLASH_KEY && !PEXELS_KEY && !PIXABAY_KEY) return;

  console.log(`\n🌫  책 무드 사진 수집 (photo-bg / inset 구성용)\n`);
  for (let i = 0; i < data.books.length; i++) {
    const book = data.books[i];
    if (!book.photoKeyword) continue;
    if (book.moodPhoto && fs.existsSync(path.join(__dirname, book.moodPhoto))) {
      console.log(`  ${i + 1}. 이미 있음 → ${book.moodPhoto}`);
      continue;
    }
    process.stdout.write(`  ${i + 1}. "${book.photoKeyword}" (portrait)... `);
    try {
      const result = await searchStockPhoto('photo', book.photoKeyword, 'portrait');
      if (!result) { console.log('⚠️  결과 없음'); continue; }
      const file = `covers/mood_${String(i + 1).padStart(2, '0')}.jpg`;
      await downloadImage(result.url, path.join(__dirname, file));
      book.moodPhoto = file;
      book.moodPhotoCredit = { photographer: result.photographer, photographerUrl: result.photographerUrl, source: result.source };
      console.log(`✓ Photo by ${result.photographer} (${result.source})`);
    } catch (e) { console.log(`❌ ${e.message}`); }
  }
}

// ============================================================
// 3) freePages 이미지 자동 해결
// ============================================================
async function fetchFreePageImages(data) {
  if (!data.freePages || !data.freePages.length) return;
  console.log(`\n🧩 자유 배치 페이지 이미지 수집\n`);

  // 이미지 하나(배치 이미지 또는 배경)를 source 타입에 따라 해결
  async function resolveOne(img, fileBase, tag, defaultOrientation) {
    const s = img.source || {};

    if (img.file && fs.existsSync(path.join(__dirname, img.file))) {
      console.log(`${tag} 이미 있음 → ${img.file}`);
      return;
    }

    try {
      if (s.type === 'local') {
        if (s.path && fs.existsSync(path.join(__dirname, s.path))) {
          img.file = s.path;
          console.log(`${tag} 로컬 파일 ✓ ${s.path}`);
        } else {
          console.log(`${tag} ⚠️  로컬 파일 없음: ${s.path} — 파일을 넣고 다시 실행하세요`);
        }
      } else if (s.type === 'bookCover') {
        process.stdout.write(`${tag} 네이버 표지 "${s.title}"... `);
        const r = await downloadNaverCover(s.title, s.author, fileBase);
        if (!r) { console.log('⚠️  결과 없음'); return; }
        img.file = r.rel;
        console.log('✓');
        await sleep(200);
      } else if (s.type === 'unsplash' || s.type === 'pexels' || s.type === 'pixabay' || s.type === 'photo') {
        if (!UNSPLASH_KEY && !PEXELS_KEY && !PIXABAY_KEY) { console.log(`${tag} ⏭️  사진 API 키 없음`); return; }
        const orientation = s.orientation || defaultOrientation;
        const providerLabel = s.type === 'photo' ? '자동' : s.type;
        process.stdout.write(`${tag} 사진(${providerLabel}) "${s.keyword}" (${orientation})... `);
        const result = await searchStockPhoto(s.type, s.keyword, orientation);
        if (!result) { console.log('⚠️  결과 없음'); return; }
        const dest = path.join(COVERS_DIR, `${fileBase}.jpg`);
        await downloadImage(result.url, dest);
        img.file = `covers/${fileBase}.jpg`;
        img.credit = {
          photographer: result.photographer,
          photographerUrl: result.photographerUrl,
          source: result.source,
        };
        console.log(`✓ Photo by ${result.photographer} (${result.source})`);
      } else {
        console.log(`${tag} ⚠️  알 수 없는 source.type: "${s.type}"`);
      }
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
  }

  for (let p = 0; p < data.freePages.length; p++) {
    const page = data.freePages[p];
    const pp = String(p + 1).padStart(2, '0');

    // 배경 사진 — 인스타 4:5에 맞게 기본 세로(portrait)
    if (page.background) {
      await resolveOne(page.background, `free_${pp}_bg`, `  [페이지 ${p + 1} · 배경]`, 'portrait');
    }

    const images = page.images || [];
    for (let j = 0; j < images.length; j++) {
      await resolveOne(images[j], `free_${pp}_${String(j + 1).padStart(2, '0')}`, `  [페이지 ${p + 1} · 이미지 ${j + 1}]`, 'squarish');
    }
  }
}

// ============================================================
// 메인
// ============================================================
(async () => {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

  await fetchBookCovers(data);
  await fetchCoverPhoto(data);
  await fetchIntroPhoto(data);
  await fetchBookMoodPhotos(data);
  await fetchFreePageImages(data);

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`\n💾 ${dataFileName} 업데이트 완료`);
  console.log(`\n📝 다음 단계:`);
  console.log(`   node preview.js     # (선택) 미리보기`);
  console.log(`   node generate.js    # PNG 생성`);
})();
