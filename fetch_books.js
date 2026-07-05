/**
 * 네이버 책 검색 API + Unsplash 사진 API 통합
 *
 * 동작:
 *   1. 책 표지 자동 다운로드 (네이버) → covers/auto_NN.jpg
 *   2. 표지(커버) 사진 자동 다운로드 (Unsplash) → covers/cover_photo.jpg
 *
 * 사용법:
 *   node fetch_books.js
 *
 * 필요한 환경 변수 (.env):
 *   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
 *   UNSPLASH_ACCESS_KEY
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

const NAVER_ID = process.env.NAVER_CLIENT_ID;
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;

if (!NAVER_ID || !NAVER_SECRET) {
  console.error('❌ .env 파일에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 필요');
  process.exit(1);
}

if (!UNSPLASH_KEY) {
  console.warn('⚠️  .env 파일에 UNSPLASH_ACCESS_KEY가 없습니다. 표지 사진은 건너뜁니다.');
}

const DATA_FILE = path.join(__dirname, 'generated_data.json');
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

// ============================================================
// 네이버 책 검색
// ============================================================
async function searchNaverBook(title, author) {
  const query = `${title} ${author}`.trim();
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

  // 검색 결과 상위 5개 중 무작위 선택 (매번 다른 사진을 위해)
  const pool = data.results.slice(0, Math.min(data.results.length, 5));
  const photo = pool[Math.floor(Math.random() * pool.length)];

  return {
    url: photo.urls.regular, // 1080px 너비, 충분한 화질
    photographer: photo.user.name,
    photographerUrl: photo.user.links.html,
    description: photo.alt_description || photo.description || query,
  };
}

// ============================================================
// 표지 사진 다운로드 (커버 시안에 따라 가로/세로 결정)
// ============================================================
async function fetchCoverPhoto(data) {
  if (!UNSPLASH_KEY) {
    console.log('  ⏭️  UNSPLASH_ACCESS_KEY 없음, 표지 사진 건너뜀');
    return;
  }

  const keyword = data.cover.photoKeyword;
  if (!keyword) {
    console.log('  ⏭️  cover.photoKeyword 없음, 표지 사진 건너뜀');
    return;
  }

  const variant = (data.meta.coverVariant || 'A').toUpperCase();
  // 커버 A: 우측 세로 영역 → portrait
  // 커버 B: 상단 가로 영역 → landscape
  // 커버 C: 풀블리드 → portrait (세로형이 인스타 4:5 비율에 잘 맞음)
  const orientation = variant === 'B' ? 'landscape' : 'portrait';

  process.stdout.write(`  🖼️  Unsplash에서 "${keyword}" 검색 (${orientation})... `);

  try {
    const result = await searchUnsplashPhoto(keyword, orientation);
    if (!result) {
      console.log('⚠️  결과 없음');
      return;
    }

    const dest = path.join(COVERS_DIR, 'cover_photo.jpg');
    await downloadImage(result.url, dest);

    data.cover.photo = 'covers/cover_photo.jpg';
    data.cover.photoCredit = {
      photographer: result.photographer,
      photographerUrl: result.photographerUrl,
      source: 'Unsplash',
    };

    console.log(`✓ Photo by ${result.photographer}`);
  } catch (e) {
    console.log(`❌ ${e.message}`);
  }
}

// ============================================================
// 메인
// ============================================================
(async () => {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

  if (!data.books || !Array.isArray(data.books)) {
    console.error('❌ generated_data.json에 books 배열이 없습니다.');
    process.exit(1);
  }

  console.log(`\n📚 ${data.books.length}권의 책 표지 자동 수집 시작\n`);

  for (let i = 0; i < data.books.length; i++) {
    const book = data.books[i];
    process.stdout.write(`  ${i + 1}. "${book.title}" / ${book.author}... `);

    try {
      const result = await searchNaverBook(book.title, book.author);
      if (!result) {
        console.log(`⚠️  네이버 결과 없음`);
        continue;
      }

      const ext = path.extname(new URL(result.image).pathname) || '.jpg';
      const filename = `auto_${String(i + 1).padStart(2, '0')}${ext}`;
      const dest = path.join(COVERS_DIR, filename);
      await downloadImage(result.image, dest);
      book.cover = `covers/${filename}`;

      const naverTitle = result.title;
      const userTitle = book.title;
      const isProbablySameBook = naverTitle.replace(/\s/g, '').includes(userTitle.replace(/\s/g, ''));

      if (isProbablySameBook) {
        console.log(`✓ ${userTitle}`);
      } else {
        console.log(`⚠️  ${userTitle}`);
        console.log(`     네이버는 "${naverTitle}"를 찾았어요. 다른 책일 수 있으니 확인 필요!`);
      }
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  // 표지 사진 다운로드
  console.log(`\n🎨 표지 사진 자동 수집\n`);
  await fetchCoverPhoto(data);

  // 업데이트된 JSON 저장
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`\n💾 ${DATA_FILE} 업데이트 완료`);
  console.log(`\n📝 다음 단계:`);
  console.log(`   node generate.js`);
})();
