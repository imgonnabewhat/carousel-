/**
 * image_sources.js — 이미지 검색·다운로드 공통 모듈
 *
 * fetch_images.js(전체 자동 수집)와 replace_photo.js(사진 하나만 교체)가 함께 사용한다.
 * 여기에는 "네트워크로 무엇을 가져오는가"만 담고, JSON의 어느 자리에 넣는지는
 * photo_slots.js가 담당한다.
 *
 * 필요한 환경 변수 (.env):
 *   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET                  (책 표지)
 *   UNSPLASH_ACCESS_KEY, PEXELS_API_KEY, PIXABAY_API_KEY  (사진 — 있는 것만 사용)
 */

try { require('dotenv').config(); } catch (e) { /* 깃허브 액션처럼 .env 없이 환경변수만 있는 경우 */ }
const fs = require('fs');
const path = require('path');
const https = require('https');

const NAVER_ID = process.env.NAVER_CLIENT_ID;
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;
const PEXELS_KEY = process.env.PEXELS_API_KEY;     // https://www.pexels.com/api/
const PIXABAY_KEY = process.env.PIXABAY_API_KEY;   // https://pixabay.com/api/docs/

const PHOTO_PROVIDERS = ['unsplash', 'pexels', 'pixabay'];

function hasNaverKeys() { return Boolean(NAVER_ID && NAVER_SECRET); }
function hasAnyPhotoKey() { return Boolean(UNSPLASH_KEY || PEXELS_KEY || PIXABAY_KEY); }

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
// 네이버 책 검색
// ============================================================
async function searchNaverBook(title, author) {
  if (!hasNaverKeys()) throw new Error('.env에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 필요');
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

/**
 * 네이버 책 검색 결과 목록 (표지 교체용 — 후보를 보고 고를 때 사용).
 * 반환: [{ id, url, thumb, title, author, publisher, source:'네이버책' }]
 */
async function searchNaverBookCandidates(title, author, limit = 10) {
  if (!hasNaverKeys()) throw new Error('.env에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 필요');
  const query = `${title} ${author || ''}`.trim();
  const { data } = await httpsRequest({
    hostname: 'openapi.naver.com',
    path: `/v1/search/book.json?query=${encodeURIComponent(query)}&display=${limit}`,
    method: 'GET',
    headers: {
      'X-Naver-Client-Id': NAVER_ID,
      'X-Naver-Client-Secret': NAVER_SECRET,
    },
  });

  if (data.errorCode) throw new Error(`네이버 API: ${data.errorMessage}`);
  if (!data.items || data.items.length === 0) return [];

  return data.items
    .filter(item => item.image)
    .map(item => ({
      id: `naver:${item.isbn || item.link}`,
      url: item.image,
      thumb: item.image,
      title: stripTags(item.title),
      author: stripTags(item.author).split('|')[0],
      publisher: stripTags(item.publisher),
      source: '네이버책',
    }));
}

/** 네이버에서 표지를 찾아 coversDir/filename.ext 로 저장 */
async function downloadNaverCover(title, author, filename, coversDir) {
  const result = await searchNaverBook(title, author);
  if (!result) return null;
  const ext = path.extname(new URL(result.image).pathname) || '.jpg';
  const dest = path.join(coversDir, filename + ext);
  await downloadImage(result.image, dest);
  return { rel: `covers/${filename}${ext}`, naverTitle: result.title, image: result.image };
}

// ============================================================
// 사진 API 3종 — 모두 같은 모양의 후보 목록을 돌려준다
//   { id, url, thumb, photographer, photographerUrl, source }
// id는 "제외 목록"(같은 사진 다시 안 받기)에 쓰이므로 소스명을 접두어로 붙인다.
// ============================================================
async function searchUnsplash(query, orientation = 'portrait', limit = 10) {
  if (!UNSPLASH_KEY) return [];

  const { data } = await httpsRequest({
    hostname: 'api.unsplash.com',
    path: `/search/photos?query=${encodeURIComponent(query)}&per_page=${limit}&orientation=${orientation}&content_filter=high`,
    method: 'GET',
    headers: {
      'Authorization': `Client-ID ${UNSPLASH_KEY}`,
      'Accept-Version': 'v1',
    },
  });

  if (data.errors) throw new Error(`Unsplash API: ${data.errors.join(', ')}`);
  if (!data.results || data.results.length === 0) return [];

  return data.results.map(p => ({
    id: `unsplash:${p.id}`,
    url: p.urls.regular,
    thumb: p.urls.small,
    photographer: p.user.name,
    photographerUrl: p.user.links.html,
    source: 'Unsplash',
  }));
}

async function searchPexels(query, orientation = 'portrait', limit = 10) {
  if (!PEXELS_KEY) return [];
  // Pexels orientation: landscape | portrait | square
  const ori = orientation === 'squarish' ? 'square' : orientation;

  const { data } = await httpsRequest({
    hostname: 'api.pexels.com',
    path: `/v1/search?query=${encodeURIComponent(query)}&per_page=${limit}&orientation=${ori}`,
    method: 'GET',
    headers: { 'Authorization': PEXELS_KEY },
  });

  if (data.error) throw new Error(`Pexels API: ${data.error}`);
  if (!data.photos || data.photos.length === 0) return [];

  return data.photos.map(p => ({
    id: `pexels:${p.id}`,
    url: p.src.large2x || p.src.large,   // 충분한 해상도
    thumb: p.src.medium,
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
    source: 'Pexels',
  }));
}

async function searchPixabay(query, orientation = 'portrait', limit = 10) {
  if (!PIXABAY_KEY) return [];
  // Pixabay orientation: horizontal | vertical | all
  const ori = orientation === 'landscape' ? 'horizontal'
            : orientation === 'portrait' ? 'vertical' : 'all';

  const { data } = await httpsRequest({
    hostname: 'pixabay.com',
    path: `/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(query)}&image_type=photo&orientation=${ori}&per_page=${limit}&safesearch=true`,
    method: 'GET',
    headers: {},
  });

  if (typeof data === 'string') throw new Error(`Pixabay API: ${data.slice(0, 120)}`);
  if (!data.hits || data.hits.length === 0) return [];

  return data.hits.map(p => ({
    id: `pixabay:${p.id}`,
    url: p.largeImageURL,
    thumb: p.previewURL || p.webformatURL,
    photographer: p.user,
    photographerUrl: `https://pixabay.com/users/${p.user}-${p.user_id}/`,
    source: 'Pixabay',
  }));
}

const PROVIDER_FN = {
  unsplash: searchUnsplash,
  pexels: searchPexels,
  pixabay: searchPixabay,
};

/**
 * 사진 후보 목록.
 * provider: 'photo'|'auto'(키 있는 소스를 순서대로 시도) | 'unsplash' | 'pexels' | 'pixabay'
 * onNote: 소스 하나가 실패했을 때 알려주는 콜백 (로그용, 선택)
 */
async function searchPhotoCandidates(provider, query, orientation = 'portrait', { limit = 10, onNote } = {}) {
  const p = (provider || 'photo').toLowerCase();

  if (p !== 'photo' && p !== 'auto') {
    const fn = PROVIDER_FN[p];
    if (!fn) throw new Error(`알 수 없는 사진 소스: ${provider}`);
    return (await fn(query, orientation, limit)) || [];
  }

  for (const name of PHOTO_PROVIDERS) {
    try {
      const r = await PROVIDER_FN[name](query, orientation, limit);
      if (r && r.length) return r;
    } catch (e) {
      if (onNote) onNote(`(${name} 실패: ${e.message} — 다음 소스 시도)`);
    }
  }
  return [];
}

/**
 * 후보 중 한 장을 고른다.
 *   exclude: 제외할 사진 id 배열 (직전에 쓰던 사진 → 교체 시 같은 게 다시 안 나오게)
 *   pick:    1부터 세는 후보 번호. 주면 무작위 대신 그 번호를 고른다.
 *   pool:    무작위로 고를 상위 후보 수 (기본 5)
 * 반환: 후보 객체 + { index } — 없으면 null
 */
async function pickPhoto(provider, query, orientation, { exclude = [], pick = null, pool = 5, limit = 10, onNote } = {}) {
  const all = await searchPhotoCandidates(provider, query, orientation, { limit, onNote });
  if (!all.length) return null;

  if (pick != null) {
    const chosen = all[pick - 1];
    if (!chosen) throw new Error(`후보 ${pick}번이 없습니다 (현재 ${all.length}장).`);
    return { ...chosen, index: pick };
  }

  const ex = new Set(exclude.filter(Boolean));
  let list = all.filter(p => !ex.has(p.id));
  if (!list.length) list = all;   // 전부 제외되면 어쩔 수 없이 원래 목록에서

  const window = list.slice(0, Math.min(list.length, pool));
  const chosen = window[Math.floor(Math.random() * window.length)];
  return { ...chosen, index: all.indexOf(chosen) + 1 };
}

module.exports = {
  keys: { NAVER_ID, NAVER_SECRET, UNSPLASH_KEY, PEXELS_KEY, PIXABAY_KEY },
  PHOTO_PROVIDERS,
  hasNaverKeys,
  hasAnyPhotoKey,
  httpsRequest,
  downloadImage,
  stripTags,
  sleep,
  searchNaverBook,
  searchNaverBookCandidates,
  downloadNaverCover,
  searchPhotoCandidates,
  pickPhoto,
};
