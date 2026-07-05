/**
 * free_page.js — 자유 배치 페이지 빌더 (북꾸러기 v3 확장)
 *
 * generate.js / preview.js 양쪽에서 require해서 사용.
 * JSON의 data.freePages 배열의 페이지 하나를 HTML로 렌더링한다.
 *
 * freePages 스키마:
 * {
 *   "slot": "beforeBooks" | "afterBooks" | "afterBook:2",   // 삽입 위치 (기본 beforeBooks)
 *   "label": "FOCUS",                                        // 상단 라벨
 *   "textPosition": "center" | "top" | "bottom",             // 텍스트 세로 위치 (기본 center)
 *   "images": [
 *     {
 *       "source": {"type":"bookCover","title":"소년이 온다","author":"한강"}
 *                | {"type":"unsplash","keyword":"rainy window night"}
 *                | {"type":"local","path":"photos/meme1.jpg"},
 *       "file": "covers/free_01_01.jpg",   // fetch_images.js가 채워줌 (직접 써도 됨)
 *       "position": "top-left" | "top-right" | "mid-left" | "mid-right"
 *                 | "bottom-left" | "bottom-right" | "top-center" | "bottom-center",
 *       "size": "small" | "medium" | "large",
 *       "tilt": -4,                        // 선택. 없으면 자동
 *       "frame": "polaroid" | "plain"      // 선택. bookCover는 plain, 그 외 polaroid 기본
 *     }
 *   ],
 *   "blocks": [
 *     {"style":"title","text":"..."},          // Hahmlet 900 헤드라인
 *     {"style":"emphasis","text":"...","highlightWord":"단어"},  // 라임 형광펜 강조
 *     {"style":"box","text":"..."},            // 테두리 박스 본문
 *     {"style":"plain","text":"..."},          // 줄글
 *     {"style":"caption","text":"..."}         // 모노 작은 부연
 *   ]
 * }
 */

const POSITIONS = {
  'top-left':      'top:175px; left:75px;',
  'top-center':    'top:175px; left:50%; --tx:-50%;',
  'top-right':     'top:175px; right:75px;',
  'mid-left':      'top:50%; left:60px; --ty:-50%;',
  'mid-right':     'top:50%; right:60px; --ty:-50%;',
  'bottom-left':   'bottom:195px; left:75px;',
  'bottom-center': 'bottom:195px; left:50%; --tx:-50%;',
  'bottom-right':  'bottom:195px; right:75px;',
};

const SIZES = { small: 250, medium: 360, large: 480 };
const TILTS = [-4, 3, -2, 5, -3, 2];

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// emphasis 블록: highlightWord가 있으면 그 단어에 라임 형광펜
function renderEmphasis(text, hlWord) {
  const esc = escapeHTML(text);
  if (!hlWord || !text.includes(hlWord)) {
    return `<span class="hl">${esc}</span>`;
  }
  const escWord = escapeHTML(hlWord);
  return esc.split(escWord).join(`<span class="hl">${escWord}</span>`);
}

// 블록별 폰트 지정용 레지스트리 — 새 폰트를 추가하면 여기와
// template.html의 @font-face/:root 변수에 함께 등록한다.
const BLOCK_FONTS = {
  'hahmlet':       "var(--font-heading)",
  'noto-sans':     "var(--font-sans-ko)",
  'mono':          "var(--font-mono)",
  'fraunces':      "var(--font-serif-en)",
  'chosun-gulim':  "var(--font-chosun-gulim)",
  'pretendard':    "var(--font-pretendard)",
};

// 블록의 font / weight / scaleX(장평 %) 필드를 인라인 스타일로 변환
function blockStyleAttr(b) {
  const rules = [];
  if (b.font && BLOCK_FONTS[b.font]) rules.push(`font-family:${BLOCK_FONTS[b.font]}`);
  if (b.weight) rules.push(`font-weight:${b.weight}`);
  if (b.scaleX && b.scaleX !== 100) {
    // 장평: 88~100 권장. 그 아래는 획 비율이 왜곡됨
    rules.push(`transform:scaleX(${b.scaleX / 100})`);
    rules.push('transform-origin:left');
  }
  return rules.length ? ` style="${rules.join(';')}"` : '';
}

function blockHTML(b) {
  const text = escapeHTML(b.text);
  const attr = blockStyleAttr(b);
  const tone = ['light', 'dark', 'lime'].includes(b.tone) ? b.tone : null;
  switch (b.style) {
    case 'title':
      return `<div class="fp-title"${attr}>${text}</div>`;
    case 'emphasis':
      return `<div class="fp-emphasis"${attr}>${renderEmphasis(b.text, b.highlightWord)}</div>`;
    case 'box':
      return `<div class="fp-box"${attr}>${text}</div>`;
    case 'caption':
      return `<div class="fp-caption"${attr}>${text}</div>`;
    case 'overlay-box': {
      // 사진 배경 위에 얹는 불투명 박스. tone: light(흰) | dark(검정) | lime(라임)
      // 조선굴림 92% + 검정 테두리는 CSS에서 박스째 적용 (v4 규칙)
      return `<div class="fp-overlay-box tone-${tone || 'light'}"${attr}>${text}</div>`;
    }
    case 'line-highlight': {
      // 줄 단위 하이라이트 — text 안의 \n 기준으로 줄마다 배경 블록.
      // 인용문·대사에 어울림. tone: dark(검정 배경/흰 글씨) | light | lime
    const lines = String(b.text == null ? '' : b.text).split('\n')
        .map(ln => `<span class="ln">${escapeHTML(ln)}</span>`)
        .join('<br>');
      return `<div class="fp-linehl tone-${tone || 'dark'}"${attr}>${lines}</div>`;
    }
    case 'badge': {
      // 번호 뱃지 — ❷ 당인리책발전소 스타일. num(선택) + text
      const numHTML = (b.num != null) ? `<span class="bnum">${escapeHTML(b.num)}</span>` : '';
      return `<div class="fp-badge"${attr}>${numHTML}<span class="btxt">${text}</span></div>`;
    }
    default: // plain
      return `<div class="fp-plain"${attr}>${text}</div>`;
  }
}

function imagePlaceholderLabel(img) {
  const s = img.source || {};
  if (s.type === 'bookCover') return `표지: ${s.title || ''}`;
  if (s.type === 'unsplash') return `unsplash: ${s.keyword || ''}`;
  if (s.type === 'local') return `파일: ${s.path || ''}`;
  return 'IMAGE';
}

/**
 * @param {object} DATA      전체 JSON 데이터 (meta.handle 등에 사용)
 * @param {object} page      freePages[i]
 * @param {number} pageIdx   freePages 안에서의 인덱스 (기울기 시드용)
 * @param {string} pageText  "03 / 08" 형태 페이지 번호
 * @param {object} helpers   { toDataURL, topRowHTML, footerRowHTML }
 */
function buildFreePage(DATA, page, pageIdx, pageText, helpers) {
  const { toDataURL, topRowHTML, footerRowHTML } = helpers;
  const labelText = page.label || 'FOCUS';

  // 배경 사진 (선택) — page.background = { source: {...}, file: "...", dim: 0~70 }
  // dim: 사진 위 어두운 오버레이 강도(%). 텍스트 가독성용. 기본 25.
  let bgHTML = '';
  let hasBg = false;
  if (page.background) {
    const bgSrc = toDataURL(page.background.file);
    const dim = Math.max(0, Math.min(70, page.background.dim != null ? page.background.dim : 25));
    if (bgSrc) {
      hasBg = true;
      bgHTML = `<div class="fp-bg" style="background-image:url('${bgSrc}')"></div>
        <div class="fp-bg-dim" style="background:rgba(10,10,10,${(dim / 100).toFixed(2)})"></div>`;
    } else {
      hasBg = true; // 미리보기에서도 배경 페이지임을 알 수 있게
      bgHTML = `<div class="fp-bg fp-bg-ph"><span>BACKGROUND — ${escapeHTML(imagePlaceholderLabel(page.background))}</span></div>`;
    }
  }

  // 이미지들
  const imagesHTML = (page.images || []).map((img, j) => {
    const posCSS = POSITIONS[img.position] || POSITIONS['top-right'];
    const width = SIZES[img.size] || SIZES.small;
    const tilt = (typeof img.tilt === 'number')
      ? img.tilt
      : TILTS[(pageIdx * 2 + j) % TILTS.length];
    const isCover = img.source && img.source.type === 'bookCover';
    const frame = img.frame || (isCover ? 'plain' : 'polaroid');
    const src = toDataURL(img.file);

    const inner = src
      ? `<img src="${src}" alt=""/>`
      : `<div class="fp-img-ph">${escapeHTML(imagePlaceholderLabel(img))}</div>`;

    return `<div class="fp-img ${frame}" style="${posCSS} width:${width}px; --tilt:${tilt}deg;">${inner}</div>`;
  }).join('');

  // 텍스트 블록들
  const vAlign = { top: 'flex-start', bottom: 'flex-end' }[page.textPosition] || 'center';
  const blocksHTML = (page.blocks || []).map(blockHTML).join('');

  return `<div class="slide free-page${hasBg ? ' has-bg' : ''}">
    ${bgHTML}
    ${topRowHTML(labelText, pageText)}
    <div class="fp-text-zone" style="justify-content:${vAlign};">
      ${blocksHTML}
    </div>
    ${imagesHTML}
    ${footerRowHTML()}
  </div>`;
}

/**
 * freePages를 슬라이드 순서에 삽입하기 위한 정렬 도우미.
 * 반환: { beforeBooks: [...], afterBooks: [...], afterBook: {1:[...], 2:[...]} }
 */
function groupFreePages(freePages) {
  const g = { beforeBooks: [], afterBooks: [], afterBook: {} };
  (freePages || []).forEach((p, i) => {
    const slot = p.slot || 'beforeBooks';
    const m = /^afterBook:(\d+)$/.exec(slot);
    if (m) {
      const n = parseInt(m[1], 10);
      (g.afterBook[n] = g.afterBook[n] || []).push({ page: p, idx: i });
    } else if (slot === 'afterBooks') {
      g.afterBooks.push({ page: p, idx: i });
    } else {
      g.beforeBooks.push({ page: p, idx: i });
    }
  });
  return g;
}

// ============================================================
// 슬라이드 조립 — cover / intro / freePages / books / outro 순서를
// slot 규칙에 따라 하나의 리스트로 만들고 페이지 번호를 매긴다.
// generate.js와 preview.js가 공유.
// ============================================================
const pad = (n) => String(n).padStart(2, '0');
const pageLabelOf = (n, total) => `${pad(n)} / ${pad(total)}`;

/**
 * @param {object} DATA
 * @param {object} builders  { buildCover, buildIntro, buildBody(book, idx, totalPages, pageNum), buildOutro }
 * @param {object} helpers   { toDataURL, topRowHTML, footerRowHTML }
 * @returns {Array<{name: string, html: string}>}
 */
function assembleSlides(DATA, builders, helpers) {
  const g = groupFreePages(DATA.freePages);
  const items = [{ type: 'cover' }];
  if (DATA.intro) items.push({ type: 'intro' });
  g.beforeBooks.forEach(f => items.push({ type: 'free', ...f }));
  (DATA.books || []).forEach((b, i) => {
    items.push({ type: 'book', book: b, bookIdx: i });
    (g.afterBook[i + 1] || []).forEach(f => items.push({ type: 'free', ...f }));
  });
  g.afterBooks.forEach(f => items.push({ type: 'free', ...f }));
  items.push({ type: 'outro' });

  const totalPages = items.length;

  return items.map((it, k) => {
    const pageNum = k + 1;
    switch (it.type) {
      case 'cover':
        return { name: `slide_${pad(pageNum)}_cover`, html: builders.buildCover(totalPages) };
      case 'intro':
        return { name: `slide_${pad(pageNum)}_intro`, html: builders.buildIntro(totalPages) };
      case 'free':
        return {
          name: `slide_${pad(pageNum)}_free`,
          html: buildFreePage(DATA, it.page, it.idx, pageLabelOf(pageNum, totalPages), helpers),
        };
      case 'book':
        return { name: `slide_${pad(pageNum)}_book`, html: builders.buildBody(it.book, it.bookIdx, totalPages, pageNum) };
      case 'outro':
        return { name: `slide_${pad(pageNum)}_outro`, html: builders.buildOutro(totalPages) };
    }
  });
}

module.exports = { buildFreePage, groupFreePages, assembleSlides };
