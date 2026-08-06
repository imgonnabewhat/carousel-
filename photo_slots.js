/**
 * photo_slots.js — 게시물 JSON 안의 "사진 자리(슬롯)" 목록화
 *
 * 사진이 들어가는 자리마다 JSON 필드 이름이 조금씩 다르다
 * (cover.photo / intro.photo / books[].moodPhoto / books[].cover / freePages[].images[].file).
 * 이 모듈이 그 차이를 한 겹 덮어서, 다른 파일들은 슬롯 id 하나로 사진을 다룰 수 있게 한다.
 *
 * 슬롯 id
 *   cover            표지(1장) 배경 사진
 *   intro            인트로 타원 사진
 *   book1, book2…    책 N번의 무드 사진        (별칭: mood1, book1.photo, book1.mood)
 *   book1.cover…     책 N번의 책 표지          (별칭: bookcover1)
 *   free1.bg         자유 페이지 N의 배경 사진 (별칭: free1.background)
 *   free1.1, free1.2 자유 페이지 N의 배치 이미지
 */

const fs = require('fs');
const path = require('path');

const pad2 = (n) => String(n).padStart(2, '0');

/** 표지 사진 방향: coverVariant B는 가로, 나머지는 세로 */
function coverOrientation(data) {
  const variant = String((data.meta && data.meta.coverVariant) || 'A').toUpperCase();
  return variant === 'B' ? 'landscape' : 'portrait';
}

/** 무드 사진 방향: 본문 스타일 7(매거진 분할)만 가로, 나머지는 세로 */
function moodOrientation(data) {
  const style = String((data.meta && data.meta.bodyStyle) || '').trim();
  return style === '7' ? 'landscape' : 'portrait';
}

function shortTitle(s, n = 14) {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * 데이터 안의 모든 사진 슬롯을 순서대로 반환.
 * 슬롯은 원본 객체(obj)를 그대로 들고 있으므로, 값을 바꾸면 data에 반영된다.
 */
function listSlots(data) {
  const slots = [];

  if (data.cover) {
    slots.push({
      id: 'cover',
      aliases: ['coverphoto', 'cover.photo'],
      label: '표지 사진',
      kind: 'photo',
      group: 'cover',
      obj: data.cover,
      fileField: 'photo',
      keywordField: 'photoKeyword',
      creditField: 'photoCredit',
      replaceField: 'photoReplace',
      fileBase: 'cover_photo',
      orientation: coverOrientation(data),
      provider: 'photo',
    });
  }

  if (data.intro) {
    slots.push({
      id: 'intro',
      aliases: ['intro.photo', 'introphoto'],
      label: '인트로 타원 사진',
      kind: 'photo',
      group: 'intro',
      obj: data.intro,
      fileField: 'photo',
      keywordField: 'photoKeyword',
      creditField: 'photoCredit',
      replaceField: 'photoReplace',
      fileBase: 'intro_photo',
      orientation: 'portrait',
      provider: 'photo',
    });
  }

  (data.books || []).forEach((book, i) => {
    const n = i + 1;
    const name = shortTitle(book.title);

    slots.push({
      id: `book${n}`,
      aliases: [`mood${n}`, `book${n}.photo`, `book${n}.mood`, `book${n}.moodphoto`],
      label: `책 ${n} 무드 사진${name ? ` — ${name}` : ''}`,
      kind: 'photo',
      group: 'mood',
      obj: book,
      fileField: 'moodPhoto',
      keywordField: 'photoKeyword',
      creditField: 'moodPhotoCredit',
      replaceField: 'photoReplace',
      fileBase: `mood_${pad2(n)}`,
      orientation: moodOrientation(data),
      provider: 'photo',
    });

    slots.push({
      id: `book${n}.cover`,
      aliases: [`bookcover${n}`, `cover${n}`],
      label: `책 ${n} 표지${name ? ` — ${name}` : ''}`,
      kind: 'bookCover',
      group: 'bookCover',
      obj: book,
      fileField: 'cover',
      keywordField: null,
      creditField: null,
      replaceField: 'coverReplace',
      queryField: 'coverQuery',   // 어떤 제목/저자로 받아둔 표지인지 (제목이 바뀌면 다시 받는다)
      fileBase: `auto_${pad2(n)}`,
      orientation: 'portrait',
      provider: 'bookCover',
      book: { title: book.title, author: book.author },
    });
  });

  (data.freePages || []).forEach((page, p) => {
    const pn = p + 1;

    if (page.background) {
      slots.push({
        id: `free${pn}.bg`,
        aliases: [`free${pn}.background`, `freepage${pn}.bg`],
        label: `자유 페이지 ${pn} 배경`,
        kind: sourceKind(page.background),
        group: 'free',
        obj: page.background,
        fileField: 'file',
        nested: 'source',
        keywordField: 'keyword',
        creditField: 'credit',
        replaceField: 'replace',
        fileBase: `free_${pad2(pn)}_bg`,
        orientation: (page.background.source && page.background.source.orientation) || 'portrait',
        provider: (page.background.source && page.background.source.type) || 'photo',
        book: bookOf(page.background),
      });
    }

    (page.images || []).forEach((img, j) => {
      const jn = j + 1;
      slots.push({
        id: `free${pn}.${jn}`,
        aliases: [`freepage${pn}.${jn}`, `free${pn}.img${jn}`],
        label: `자유 페이지 ${pn} 이미지 ${jn}`,
        kind: sourceKind(img),
        group: 'free',
        obj: img,
        fileField: 'file',
        nested: 'source',
        keywordField: 'keyword',
        creditField: 'credit',
        replaceField: 'replace',
        fileBase: `free_${pad2(pn)}_${pad2(jn)}`,
        orientation: (img.source && img.source.orientation) || 'squarish',
        provider: (img.source && img.source.type) || 'photo',
        book: bookOf(img),
      });
    });
  });

  return slots;
}

function sourceKind(img) {
  const t = (img.source && img.source.type) || 'photo';
  if (t === 'bookCover') return 'bookCover';
  if (t === 'local') return 'local';
  return 'photo';
}

function bookOf(img) {
  const s = img.source || {};
  return s.type === 'bookCover' ? { title: s.title, author: s.author } : null;
}

/** id 또는 별칭으로 슬롯 찾기 (대소문자·공백 무시) */
function findSlot(data, id) {
  const want = String(id || '').trim().toLowerCase();
  if (!want) return null;
  return listSlots(data).find(s =>
    s.id.toLowerCase() === want || (s.aliases || []).some(a => a.toLowerCase() === want)
  ) || null;
}

// ============================================================
// 슬롯 값 읽기/쓰기
// ============================================================
function holder(slot, create = false) {
  if (!slot.nested) return slot.obj;
  if (!slot.obj[slot.nested] && create) slot.obj[slot.nested] = {};
  return slot.obj[slot.nested] || {};
}

function getFile(slot) { return slot.obj[slot.fileField] || null; }
function setFile(slot, rel) { slot.obj[slot.fileField] = rel; }

function getKeyword(slot) {
  if (!slot.keywordField) return null;
  return holder(slot)[slot.keywordField] || null;
}

function setKeyword(slot, keyword) {
  if (!slot.keywordField) return;
  const h = holder(slot, true);
  h[slot.keywordField] = keyword;
  // 자유 페이지 이미지는 source.type이 있어야 fetch_images.js가 인식한다
  if (slot.nested && !h.type) h.type = 'photo';
}

function getCredit(slot) {
  if (!slot.creditField) return null;
  return slot.obj[slot.creditField] || null;
}

function setCredit(slot, credit) {
  if (!slot.creditField) return;
  if (credit) slot.obj[slot.creditField] = credit;
  else delete slot.obj[slot.creditField];
}

/** 현재 쓰고 있는 사진의 id (같은 사진 다시 받지 않도록 제외 목록에 쓴다) */
function getPhotoId(slot) {
  const c = getCredit(slot);
  return (c && c.id) || null;
}

/** 크레딧 만들기 — 어떤 키워드로 받았는지도 같이 남긴다 */
function makeCredit(photo, keyword) {
  const c = {
    photographer: photo.photographer,
    photographerUrl: photo.photographerUrl,
    source: photo.source,
  };
  if (photo.id) c.id = photo.id;
  if (keyword) c.keyword = keyword;
  return c;
}

/** 파일 필드가 채워져 있고 실제로 그 파일이 있는가 */
function hasFile(slot, rootDir) {
  const f = getFile(slot);
  return Boolean(f && fs.existsSync(path.join(rootDir, f)));
}

/** replace 플래그가 켜져 있으면 true를 돌려주고 플래그를 지운다(한 번만 동작) */
function takeReplaceFlag(slot) {
  const on = slot.obj[slot.replaceField] === true || slot.obj[slot.replaceField] === 'true';
  if (slot.obj[slot.replaceField] !== undefined) delete slot.obj[slot.replaceField];
  return on;
}

/** 사진을 받아둔 뒤 키워드를 바꿨는가 (크레딧에 기록된 keyword와 비교) */
function keywordChanged(slot) {
  const c = getCredit(slot);
  const now = getKeyword(slot);
  if (!c || !c.keyword || !now) return false;
  return String(c.keyword).trim() !== String(now).trim();
}

/** 책 표지 슬롯: 지금 제목/저자 조합 */
function currentQuery(slot) {
  if (!slot.queryField) return null;
  const b = slot.book || {};
  return `${String(b.title || '').trim()}|${String(b.author || '').trim()}`;
}

/** 받아둔 표지가 지금 제목/저자와 다른 책의 것인가 */
function queryChanged(slot) {
  if (!slot.queryField) return false;
  const saved = slot.obj[slot.queryField];
  if (!saved) return true;              // 기록이 없는 예전 JSON → 한 번 다시 받아 기록을 남긴다
  return String(saved) !== currentQuery(slot);
}

/** "이 제목/저자로 받아둔 표지"라고 기록 — 교체한 표지가 덮어써지지 않게 한다 */
function markQuery(slot) {
  if (!slot.queryField) return;
  slot.obj[slot.queryField] = currentQuery(slot);
}

/**
 * 지금 이 슬롯을 (다시) 받아와야 하는가.
 * 반환: { fetch: boolean, reason: 'missing'|'replace'|'keyword'|'book'|'keep' }
 * 주의: replace 플래그는 여기서 소비(삭제)된다.
 */
function shouldFetch(slot, rootDir) {
  const replace = takeReplaceFlag(slot);
  if (replace) return { fetch: true, reason: 'replace' };
  if (!hasFile(slot, rootDir)) return { fetch: true, reason: 'missing' };
  if (keywordChanged(slot)) return { fetch: true, reason: 'keyword' };
  if (queryChanged(slot)) return { fetch: true, reason: 'book' };
  rememberKeyword(slot);
  return { fetch: false, reason: 'keep' };
}

/**
 * 그대로 두는 사진에는 "이 키워드로 받은 사진"이라고 표시해둔다.
 * 예전 JSON(키워드 기록이 없는)도 한 번 실행하면 기록이 생기고,
 * 그 다음부터 키워드를 고치면 사진이 자동으로 새로 수집된다.
 * 내 사진으로 교체한 자리는 크레딧이 없으므로 기록하지 않는다 → 키워드를 고쳐도 덮어쓰지 않음.
 */
function rememberKeyword(slot) {
  const credit = getCredit(slot);
  const keyword = getKeyword(slot);
  if (!credit || !keyword || credit.keyword) return;
  credit.keyword = keyword;
}

const REASON_LABEL = {
  replace: '교체 요청(replace: true)',
  keyword: '키워드 변경',
  book: '책 정보 변경',
  missing: '없음',
  keep: '유지',
};

module.exports = {
  listSlots,
  findSlot,
  getFile,
  setFile,
  getKeyword,
  setKeyword,
  getCredit,
  setCredit,
  getPhotoId,
  makeCredit,
  hasFile,
  takeReplaceFlag,
  keywordChanged,
  rememberKeyword,
  queryChanged,
  markQuery,
  shouldFetch,
  coverOrientation,
  moodOrientation,
  REASON_LABEL,
};
