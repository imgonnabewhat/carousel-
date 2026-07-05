/**
 * builders.js — 슬라이드 빌더 공유 모듈 (v4)
 * generate.js와 preview.js가 함께 사용한다.
 *
 * v4 디자인 시스템:
 *  - 표지: 프리텐다드 900 + 장평 84%, forWhom 오버레이 박스(조선굴림 100%)
 *  - 인트로: 타원 사진 중앙 + 글이 사진을 피해 흐름, 프리텐다드 300 + 장평 88%
 *  - 본문(mix): 3가지 구성 순환 — photo-bg / clean / inset
 *  - 엔딩: 콘텐츠 질문형, 인트로와 동일 타이포
 */

function createBuilders(DATA, toDataURL) {

  // ── 공통 유틸 ──────────────────────────────────────────
  function pageLabel(idx, total) {
    return `${String(idx).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  }

  function topRowHTML(labelText, pageText) {
    return `<div class="top-row">
      <div class="label-block">
        <div class="label-bar"></div>
        <div class="label-text">${labelText}</div>
      </div>
      <div class="page-num">${pageText}</div>
    </div>`;
  }

  const TAGLINE = 'I 내가 책으로 간다 (능동)';

  function footerRowHTML() {
    return `<div class="footer-row">
      <div>${DATA.meta.handle}<span class="fr-tag">${TAGLINE}</span></div>
      <div>SWIPE  →</div>
    </div>`;
  }

  function bookCoverHTML(book, cls) {
    const url = toDataURL(book.cover);
    if (url) return `<img class="${cls || 'book-cover-img'}" src="${url}" alt="${book.title}"/>`;
    return `<div class="book-cover-placeholder">
      <div class="ph-icon"></div>
      <div class="ph-label">BOOK COVER</div>
    </div>`;
  }

  function ratingDotsHTML(rating) {
    const r = Math.max(0, Math.min(5, rating || 0));
    let html = '<div class="rating-dots">';
    for (let i = 0; i < 5; i++) html += `<div class="rating-dot${i < r ? ' filled' : ''}"></div>`;
    html += '</div>';
    return html;
  }

  // ── COVER ─────────────────────────────────────────────
  function buildCover(totalPages) {
    const c = DATA.cover;
    const variant = (DATA.meta.coverVariant || 'A').toUpperCase();
    const labelText = c.category || 'BOOKLIST';
    const pageText = pageLabel(1, totalPages);

    const lines = c.titleLines || [];
    const hi = c.highlightLine || 0;
    // 강조 방식: "marker"(형광펜, 기본) | "outline"(검정 테두리 + 채움색)
    const hlStyle = c.highlightStyle === 'outline' ? 'outline' : 'marker';
    const hlClass = hlStyle === 'outline' ? 'highlight hl-outline' : 'highlight';
    // outline 채움색 (없으면 흰색). CSS 변수로 주입.
    const hlFill = c.highlightFill || '#FFFFFF';
    const hlFillStyle = hlStyle === 'outline' ? ` style="--hl-fill:${hlFill}"` : '';

    const photoUrl = toDataURL(c.photo);
    const photoStyle = photoUrl ? `style="background-image:url('${photoUrl}')"` : '';
    const photoClass = photoUrl ? 'has-photo' : '';
    const photoPlaceholder = photoUrl ? '' : `<div class="photo-placeholder">PHOTO<span>사진 영역</span></div>`;

    // "이런 분께" 오버레이 박스 (조선굴림 100%)
    const forWhomHTML = c.forWhom
      ? `<div class="cover-forwhom">${c.forWhom}</div>`
      : '';

    if (variant === 'A') {
      return `<div class="slide cover-a">
        <div class="photo-area ${photoClass}" ${photoStyle}>${photoPlaceholder}</div>
        ${forWhomHTML}
        <div class="text-area">
          ${topRowHTML(labelText, pageText)}
          <div class="title-stack">
            ${lines.map((line, i) => {
              const isHi = (i + 1) === hi;
              return `<div><span class="title-line${isHi ? ' ' + hlClass : ''}"${isHi ? hlFillStyle : ''}>${line}</span></div>`;
            }).join('')}
          </div>
        </div>
        ${footerRowHTML()}
      </div>`;
    }

    if (variant === 'B') {
      return `<div class="slide cover-b">
        <div class="photo-area ${photoClass}" ${photoStyle}>${photoPlaceholder}</div>
        ${forWhomHTML}
        <div class="text-area">
          <div class="title-stack">
            ${lines.map((line, i) => {
              const isHi = (i + 1) === hi;
              const isLast = i === lines.length - 1;
              return `<span class="title-line${isHi ? ' ' + hlClass : ''}${isLast ? ' full-row' : ''}"${isHi ? hlFillStyle : ''}>${line}</span>`;
            }).join('')}
          </div>
        </div>
        ${topRowHTML(labelText, pageText)}
        ${footerRowHTML()}
      </div>`;
    }

    // variant === 'C'
    return `<div class="slide cover-c">
      <div class="photo-area ${photoClass}" ${photoStyle}>${photoPlaceholder}</div>
      ${forWhomHTML}
      <div class="text-card">
        <div class="label-block">
          <div class="label-bar"></div>
          <div class="label-text">${labelText}</div>
        </div>
        <div class="title-stack">
          ${lines.map((line, i) => {
            const isHi = (i + 1) === hi;
            return `<div><span class="title-line${isHi ? ' ' + hlClass : ''}"${isHi ? hlFillStyle : ''}>${line}</span></div>`;
          }).join('')}
        </div>
        <div class="card-footer">
          <div>${DATA.meta.handle}<span class="fr-tag">${TAGLINE}</span></div>
          <div>SWIPE  →</div>
        </div>
      </div>
      <div class="page-num" style="position:absolute;top:75px;right:75px;font-family:var(--font-mono);font-size:22px;font-weight:500;color:var(--ink);">${pageText}</div>
    </div>`;
  }

  // ── INTRO — 타원 사진 + 글 흐름 (v4 기본) ─────────────────
  // intro.photo가 있으면(또는 photoKeyword로 수집 예정이면) 이 레이아웃 사용.
  // 없으면 기존 시안 1/2/3으로 렌더링.
  function buildIntroPhoto(totalPages) {
    const intro = DATA.intro;
    const labelText = intro.label || 'PROLOGUE';
    const pageText = pageLabel(2, totalPages);
    const paras = intro.paragraphs || [];

    const photoUrl = toDataURL(intro.photo);
    const inner = photoUrl
      ? `<img class="oval-img" src="${photoUrl}" alt=""/>`
      : `<div class="oval-img oval-ph"><span>INTRO PHOTO</span></div>`;
    const photoHTML = `<div class="oval-float">${inner}</div>`;

    return `<div class="slide intro-photo">
      ${topRowHTML(labelText, pageText)}
      <div class="ipx">
        ${photoHTML}
        ${paras.map(p => `<p class="ip-para">${p}</p>`).join('')}
      </div>
      ${footerRowHTML()}
    </div>`;
  }

  function buildIntro(totalPages) {
    const intro = DATA.intro;
    if (!intro) return null;

    // 사진이 있거나 사진 키워드가 지정된 인트로는 타원 사진 레이아웃
    if (intro.photo || intro.photoKeyword) return buildIntroPhoto(totalPages);

    const variant = (DATA.meta.introVariant || '1').toString();
    const labelText = intro.label || 'PROLOGUE';
    const pageText = pageLabel(2, totalPages);
    const paragraphs = intro.paragraphs || [];

    function renderHeadline(text, hlWord) {
      if (!hlWord || !text.includes(hlWord)) return text;
      const parts = text.split(hlWord);
      return parts.map((p, i) => {
        if (i === parts.length - 1) return p;
        return `${p}<span class="hl">${hlWord}</span>`;
      }).join('');
    }

    if (variant === '1') {
      return `<div class="slide intro-1">
        ${topRowHTML(labelText, pageText)}
        <div class="text-block">
          <div class="intro-mark"></div>
          ${paragraphs.map(p => `<p class="intro-paragraph">${p}</p>`).join('')}
        </div>
        ${footerRowHTML()}
      </div>`;
    }

    if (variant === '3') {
      return `<div class="slide intro-3">
        ${topRowHTML(labelText, pageText)}
        <div class="text-block">
          <div class="quote-mark">"</div>
          ${paragraphs.map(p => `<p class="intro-paragraph">${p}</p>`).join('')}
          <div class="sign">— ${DATA.meta.handle}</div>
        </div>
        ${footerRowHTML()}
      </div>`;
    }

    const headlineHTML = renderHeadline(intro.headline || '', intro.highlightWord);
    return `<div class="slide intro-2">
      ${topRowHTML(labelText, pageText)}
      <div class="headline-block">
        <h2 class="headline">${headlineHTML}</h2>
      </div>
      <div class="body-block">
        <div class="body-divider"></div>
        ${paragraphs.map(p => `<p class="intro-paragraph">${p}</p>`).join('')}
      </div>
      ${footerRowHTML()}
    </div>`;
  }

  // ── BODY: mix 구성 3종 ─────────────────────────────────
  const MIX_CYCLE = ['photo-bg', 'clean', 'inset'];

  function bodyMetaLine(book) {
    const authorLine = book.publisher ? `${book.author} · ${book.publisher}` : book.author;
    return `<div class="bm-meta">
      <span class="bm-author">${authorLine}</span>
      ${ratingDotsHTML(book.rating)}
      ${book.readingTime ? `<span class="bm-time">${book.readingTime}</span>` : ''}
    </div>`;
  }

  // 구성 1: 사진 배경 + 하단 흰 패널 (오버레이 글: 조선굴림 92%)
  function buildBodyPhotoBg(book, idx, totalPages, pageNum) {
    const pageText = pageLabel(pageNum, totalPages);
    const moodUrl = toDataURL(book.moodPhoto);
    const bg = moodUrl
      ? `<div class="fpv-bg" style="background-image:url('${moodUrl}')"></div><div class="fpv-dim"></div>`
      : `<div class="fpv-bg fpv-bg-ph"><span>MOOD PHOTO — ${book.photoKeyword || ''}</span></div>`;

    return `<div class="slide body-photo">
      ${bg}
      ${topRowHTML(`BOOK ${String(idx + 1).padStart(2, '0')}`, pageText)}
      <div class="bp-cover" style="--tilt:${idx % 2 ? 3 : -3}deg">${bookCoverHTML(book, 'bp-cover-img')}</div>
      <div class="bp-panel">
        <h2 class="bp-title">${book.title}</h2>
        ${bodyMetaLine(book)}
        <div class="bp-body"><span class="cg92">${book.body}</span></div>
      </div>
      ${footerRowHTML()}
    </div>`;
  }

  // 구성 2: 흰 배경 + 번호 뱃지 + 표지 카드 + 프리텐다드 줄글
  function buildBodyClean(book, idx, totalPages, pageNum) {
    const pageText = pageLabel(pageNum, totalPages);
    return `<div class="slide body-clean">
      ${topRowHTML(`BOOK ${String(idx + 1).padStart(2, '0')}`, pageText)}
      <div class="bc-head">
        <span class="bc-num">${idx + 1}</span>
        <span class="bc-pill">${book.title}</span>
      </div>
      <div class="bc-row">
        <div class="bc-cover">${bookCoverHTML(book, 'bc-cover-img')}</div>
        <div class="bc-info">
          ${bodyMetaLine(book)}
        </div>
      </div>
      <div class="bc-body">${book.body}</div>
      ${footerRowHTML()}
    </div>`;
  }

  // 구성 3: 인셋 사진 카드 + 검정 오버레이 박스 (조선굴림 92%)
  function buildBodyInset(book, idx, totalPages, pageNum) {
    const pageText = pageLabel(pageNum, totalPages);
    const moodUrl = toDataURL(book.moodPhoto);
    const inset = moodUrl
      ? `<img class="bi-photo" src="${moodUrl}" alt="" style="--tilt:${idx % 2 ? -2 : 2}deg"/>`
      : `<div class="bi-photo bi-photo-ph" style="--tilt:${idx % 2 ? -2 : 2}deg"><span>MOOD PHOTO — ${book.photoKeyword || ''}</span></div>`;

    return `<div class="slide body-inset">
      ${topRowHTML(`BOOK ${String(idx + 1).padStart(2, '0')}`, pageText)}
      <h2 class="bi-title">${book.title}</h2>
      ${bodyMetaLine(book)}
      <div class="bi-photo-wrap">
        ${inset}
        <div class="bi-cover">${bookCoverHTML(book, 'bi-cover-img')}</div>
      </div>
      <div class="bi-box"><span class="cg92">${book.body}</span></div>
      ${footerRowHTML()}
    </div>`;
  }

  // 무드 사진 배경 HTML (photo-bg / quote / polaroid 공용)
  function moodBgHTML(book, dimAlpha) {
    const moodUrl = toDataURL(book.moodPhoto);
    return moodUrl
      ? `<div class="fpv-bg" style="background-image:url('${moodUrl}')"></div><div class="fpv-dim" style="background:rgba(10,10,10,${dimAlpha})"></div>`
      : `<div class="fpv-bg fpv-bg-ph"><span>MOOD PHOTO — ${book.photoKeyword || ''}</span></div>`;
  }

  // 소개글 첫 문장 분리 (quote형 후킹)
  function splitFirstSentence(text) {
    const m = String(text || '').match(/^(.+?[.!?])\s*([\s\S]*)$/);
    return m ? [m[1], m[2]] : [String(text || ''), ''];
  }

  // 구성 4: 인용 후킹형 — 사진 배경 + 첫 문장 줄 하이라이트 + 하단 패널
  function buildBodyQuote(book, idx, totalPages, pageNum) {
    const pageText = pageLabel(pageNum, totalPages);
    const [hook, rest] = splitFirstSentence(book.body);
    return `<div class="slide body-quote">
      ${moodBgHTML(book, 0.35)}
      ${topRowHTML(`BOOK ${String(idx + 1).padStart(2, '0')}`, pageText)}
      <div class="bq-hook"><span class="bq-line">${hook}</span></div>
      <div class="bq-cover" style="--tilt:${idx % 2 ? -3 : 3}deg">${bookCoverHTML(book, 'bq-cover-img')}</div>
      <div class="bq-panel">
        <h2 class="bq-title">${book.title}</h2>
        ${bodyMetaLine(book)}
        <div class="bq-body"><span class="cg92">${rest}</span></div>
      </div>
      ${footerRowHTML()}
    </div>`;
  }

  // 구성 5: 2단 그리드 — 표지 | 무드사진 나란히 + 우측 정렬 줄글
  function buildBodyDuo(book, idx, totalPages, pageNum) {
    const pageText = pageLabel(pageNum, totalPages);
    const moodUrl = toDataURL(book.moodPhoto);
    const photoCell = moodUrl
      ? `<img class="bd-photo-img" src="${moodUrl}" alt=""/>`
      : `<div class="bd-photo-ph"><span>MOOD PHOTO — ${book.photoKeyword || ''}</span></div>`;
    return `<div class="slide body-duo">
      ${topRowHTML(`BOOK ${String(idx + 1).padStart(2, '0')}`, pageText)}
      <div class="bd-head">
        <span class="bd-num">${idx + 1}</span>
        <span class="bd-pill">${book.title}</span>
      </div>
      <div class="bd-grid">
        <div class="bd-cell">${bookCoverHTML(book, 'bd-cover-img')}</div>
        <div class="bd-cell">${photoCell}</div>
      </div>
      <div class="bd-meta">${bodyMetaLine(book)}</div>
      <div class="bd-body">${book.body}</div>
      ${footerRowHTML()}
    </div>`;
  }

  // 구성 6: 폴라로이드 + 라임 박스 — 사진 배경 + 기울인 표지 + 라임 오버레이
  function buildBodyPolaroid(book, idx, totalPages, pageNum) {
    const pageText = pageLabel(pageNum, totalPages);
    return `<div class="slide body-polaroid">
      ${moodBgHTML(book, 0.30)}
      ${topRowHTML(`BOOK ${String(idx + 1).padStart(2, '0')}`, pageText)}
      <div class="bpl-title"><span class="bq-line">${book.title}</span></div>
      <div class="bpl-meta">${bodyMetaLine(book)}</div>
      <div class="bpl-cover" style="--tilt:${idx % 2 ? 4 : -4}deg">${bookCoverHTML(book, 'bpl-cover-img')}</div>
      <div class="bpl-box"><span class="cg92">${book.body}</span></div>
      ${footerRowHTML()}
    </div>`;
  }

  // 구성 7: 매거진 분할 — 큰 표지 좌측 + 우측 지면 + 좌하단 무드 사진
  function buildBodyMagazine(book, idx, totalPages, pageNum) {
    const pageText = pageLabel(pageNum, totalPages);
    const moodUrl = toDataURL(book.moodPhoto);
    const moodHTML = moodUrl
      ? `<img class="bmg-mood-img" src="${moodUrl}" alt=""/>`
      : `<div class="bmg-mood-ph"><span>MOOD PHOTO — ${book.photoKeyword || ''}</span></div>`;
    return `<div class="slide body-magazine">
      ${topRowHTML(`BOOK ${String(idx + 1).padStart(2, '0')}`, pageText)}
      <div class="bmg-flow">
        <div class="bmg-figure">
          ${bookCoverHTML(book, 'bmg-cover-img')}
          ${bodyMetaLine(book)}
        </div>
        <h2 class="bmg-title">${book.title}</h2>
        <div class="bmg-rule"></div>
        <div class="bmg-body">${book.body}</div>
      </div>
      <div class="bmg-mood">${moodHTML}</div>
      ${footerRowHTML()}
    </div>`;
  }

  // ── BODY: 기존 고정 시안 1/2/3 (하위 호환) ────────────────
  function buildBodyLegacy(book, idx, totalPages, pageNum, variant) {
    const labelText = `BOOK ${String(idx + 1).padStart(2, '0')}`;
    const pageText = pageLabel(pageNum, totalPages);
    const bookTag = `${String(idx + 1).padStart(2, '0')} / ${String(DATA.books.length).padStart(2, '0')}`;
    const authorLine = book.publisher ? `${book.author} · ${book.publisher}` : book.author;

    if (variant === '1') {
      return `<div class="slide body-1">
        ${topRowHTML(labelText, pageText)}
        <div class="top-section">
          <div class="book-cover-area">${bookCoverHTML(book)}</div>
          <div class="info-area">
            <div class="book-tag-bar"></div>
            <div class="book-tag">${bookTag}</div>
            <h2 class="book-title">${book.title}</h2>
            <div class="book-author">${authorLine}</div>
            <div class="meta-block">
              <div class="meta-label">꾸러기's PICK</div>
              ${ratingDotsHTML(book.rating)}
            </div>
            <div class="meta-block">
              <div class="meta-label">READING TIME</div>
              <div class="reading-time">${book.readingTime || ''}</div>
            </div>
          </div>
        </div>
        <div class="body-text-area">
          <span class="quote-mark">"</span>
          <div class="book-body-text">${book.body}</div>
        </div>
        ${footerRowHTML()}
      </div>`;
    }

    if (variant === '2') {
      return `<div class="slide body-2">
        ${topRowHTML(labelText, pageText)}
        <div class="top-section">
          <div class="book-cover-area">${bookCoverHTML(book)}</div>
          <div class="info-area">
            <div class="book-tag-bar"></div>
            <div class="book-tag">${bookTag}</div>
            <h2 class="book-title">${book.title}</h2>
            <div class="book-author">${authorLine}</div>
            <div class="meta-row">
              <div class="meta-col">
                <div class="meta-label">PICK</div>
                ${ratingDotsHTML(book.rating)}
              </div>
              <div class="meta-col">
                <div class="meta-label">READING TIME</div>
                <div class="reading-time-row"><div class="reading-time">${book.readingTime || ''}</div></div>
              </div>
            </div>
          </div>
        </div>
        <div class="body-section">
          <div class="body-divider"></div>
          <div class="body-text-area">
            <span class="quote-mark">"</span>
            <div class="book-body-text">${book.body}</div>
          </div>
        </div>
        ${footerRowHTML()}
      </div>`;
    }

    return `<div class="slide body-3">
      ${topRowHTML(labelText, pageText)}
      <div class="center-section">
        <div class="book-cover-area">${bookCoverHTML(book)}</div>
        <h2 class="book-title">${book.title}</h2>
        <div class="book-author">${authorLine}</div>
        <div class="meta-line">
          ${ratingDotsHTML(book.rating)}
          <span class="meta-sep">·</span>
          <div class="reading-time">${book.readingTime || ''}</div>
        </div>
        <div class="body-text-area">
          <div class="book-body-text">${book.body}</div>
        </div>
      </div>
      ${footerRowHTML()}
    </div>`;
  }

  // 본문 스타일 번호(1~7) → 빌더. 게시물 전체가 하나의 스타일로 통일된다.
  const STYLE_BUILDERS = {
    '1': buildBodyPhotoBg,
    '2': buildBodyClean,
    '3': buildBodyInset,
    '4': buildBodyQuote,
    '5': buildBodyDuo,
    '6': buildBodyPolaroid,
    '7': buildBodyMagazine,
  };

  function buildBody(book, idx, totalPages, pageNum) {
    // 우선순위: meta.bodyStyle(신규, 게시물 통일) > book.layout(개별) > meta.bodyVariant(구)
    const style = DATA.meta.bodyStyle && String(DATA.meta.bodyStyle);
    if (style && STYLE_BUILDERS[style]) return STYLE_BUILDERS[style](book, idx, totalPages, pageNum);

    if (book.layout && LAYOUT_BUILDERS[book.layout]) return LAYOUT_BUILDERS[book.layout](book, idx, totalPages, pageNum);

    const variant = (DATA.meta.bodyVariant || '2').toString();
    if (['1','2','3'].includes(variant)) return buildBodyLegacy(book, idx, totalPages, pageNum, variant);
    // 구 'mix' 호환: 순환
    const layout = MIX_CYCLE[idx % MIX_CYCLE.length];
    return LAYOUT_BUILDERS[layout](book, idx, totalPages, pageNum);
  }

  const LAYOUT_BUILDERS = {
    'photo-bg': buildBodyPhotoBg,
    'clean':    buildBodyClean,
    'inset':    buildBodyInset,
    'quote':    buildBodyQuote,
    'duo':      buildBodyDuo,
    'polaroid': buildBodyPolaroid,
    'magazine': buildBodyMagazine,
  };

  // ── OUTRO — 콘텐츠 질문형 (인트로와 동일 타이포) ──────────
  function buildOutro(totalPages) {
    const pageText = pageLabel(totalPages, totalPages);
    const o = DATA.outro || {};
    const qLines = o.questionLines || ['다음엔 어떤 콘텐츠가', '보고 싶으세요?'];
    const sub = o.sub || '궁금한 주제, 읽고 싶은 장르 — 댓글로 알려주세요';

    return `<div class="slide outro-v2">
      <div class="page-num">${pageText}</div>
      <div class="ov-center">
        <div class="ov-q">${qLines.map(l => `<div>${l}</div>`).join('')}</div>
        <div class="ov-sub">${sub}</div>
        <div class="ov-cta">
          <span class="cta-btn primary">팔로우</span>
          <span class="cta-btn">저장</span>
          <span class="cta-btn">공유</span>
        </div>
      </div>
      <div class="ov-handle">— ${DATA.meta.handle}<span class="fr-tag">${TAGLINE}</span></div>
    </div>`;
  }

  return { buildCover, buildIntro, buildBody, buildOutro, topRowHTML, footerRowHTML, pageLabel };
}

module.exports = { createBuilders };
