# 북꾸러기 캐러셀 자동 생성기 v4

인스타그램 책 큐레이션 계정 "북꾸러기"의 카드뉴스 자동화 시스템.
**Claude 채팅에서 게시물 요청 → JSON 받기 → 명령어 2번 → PNG 완성.**

## 워크플로

```
[1] Claude 채팅: "커버 X + 인트로 Y + 본문 N으로 [주제] 만들어줘"
[2] Claude가 책 큐레이션 → (인트로 질문) → 최종 JSON 제시
[3] JSON을 generated_data.json에 붙여넣기
[4] node fetch_images.js    # 표지·사진 자동 수집
[5] node replace_photo.js   # (선택) 마음에 안 드는 사진만 골라서 교체
[6] node generate.js        # PNG 생성 → output/generated_data/
```

미리보기: `node preview.js` → `preview.html`을 크롬/엣지로 열기 (클로드 앱 안에서 열면 웹폰트가 차단됨).

## 셋업 (한 번만)

1. Node.js LTS 설치 (https://nodejs.org)
2. 프로젝트 폴더에서 `npm install`
3. `.env` 파일 생성:
```
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...
UNSPLASH_ACCESS_KEY=...
PEXELS_API_KEY=...      # 선택 (없으면 Unsplash만 사용)
PIXABAY_API_KEY=...     # 선택
```

## 파일 구성

| 파일 | 역할 | 수정 빈도 |
|---|---|---|
| `template.html` | 디자인 시스템 (CSS 전부, 폰트 등록) | 디자인 바꿀 때 |
| `builders.js` | 슬라이드 빌더 (표지/인트로/본문 7종/엔딩) | 레이아웃 바꿀 때 |
| `free_page.js` | 자유 페이지 + 슬라이드 조립 | 거의 안 바뀜 |
| `fetch_images.js` | 이미지 자동 수집 (네이버+사진API) | 거의 안 바뀜 |
| `replace_photo.js` | **이미 들어간 사진 교체** (후보 고르기·내 사진 넣기) | 필요할 때 실행 |
| `image_sources.js` | 사진/표지 검색·다운로드 공통 모듈 | 거의 안 바뀜 |
| `photo_slots.js` | JSON 안의 사진 자리 목록화 | 거의 안 바뀜 |
| `generate.js` | PNG 렌더링 (puppeteer) | 거의 안 바뀜 |
| `preview.js` | 미리보기 HTML 생성 | 거의 안 바뀜 |
| `generated_data.json` | 게시물 데이터 (Claude가 생성) | 매 게시물 |

## 디자인 시스템 (v4)

**폰트**
- 표지 제목: 프리텐다드 900 + 장평 84%
- 본문 줄글: 프리텐다드 400
- 오버레이/부연/읽는시간: 조선굴림 (오버레이는 장평 92%)
- 인트로·엔딩: 프리텐다드 Light 300 + 장평 88%
- 태그라인: 프리텐다드 700 + 장평 84%

**컬러**: 라임 `#DAF100` / 검정 `#0E0E0E` / 흰 `#FFFFFF`
**슬라이드**: 1080×1350 (4:5)
**공통**: 라벨 없음, VOL 없음. 모든 푸터에 `@book_kkurueogi I 내가 책으로 간다 (능동)`

## meta 필드

```json
"meta": {
  "handle": "@book_kkurueogi",
  "coverVariant": "A" | "B" | "C",
  "introVariant": "1" | "2" | "3",   // 인트로 있을 때, 기본 1
  "bodyStyle": "1"~"7"                // 게시물 전체 한 형식으로 통일
}
```

## 본문 스타일 7종 (bodyStyle)

한 게시물은 하나의 스타일로 통일한다. 사용자가 번호를 지정하거나, 안 하면 주제 톤에 맞게 제안.

| # | 이름 | 특징 | 사진 필요 |
|---|---|---|---|
| 1 | 사진 배경 + 흰 패널 | 무드 사진이 배경, 소개글은 하단 흰 패널 | 세로 |
| 2 | 번호 뱃지 + 표지 카드 | 가장 깔끔, 흰 배경 | 없음 |
| 3 | 인셋 사진 + 검정 박스 | 라임 테두리 인셋 사진 + 검정 오버레이 | 세로 |
| 4 | 인용 후킹형 | 소개글 첫 문장이 사진 위 줄 하이라이트로 커짐 | 세로 |
| 5 | 2단 그리드 | 표지·무드사진 나란히, 줄글 우측 정렬 | 세로 |
| 6 | 폴라로이드 + 라임 박스 | 기울인 표지 + 라임 오버레이 | 세로 |
| 7 | 매거진 분할 | 좌상단 표지 + 글이 L자로 감김 + 하단 가로 배너 | 가로 |

## 인트로 (타원 사진 레이아웃)

`intro.photoKeyword`가 있으면 세로 타원 사진이 오른쪽에 서고, 글이 곡선을 따라 왼쪽으로 감긴다.
`intro.photoKeyword`가 없으면 기존 시안 1/2/3 (미니멀/에디토리얼/일기장).

인트로 작성은 **사용자 개인 경험을 지어내지 않는다.** 책 큐레이션을 먼저 보여준 뒤, 질문으로 사실 조각을 받아 3~5단락으로 작성.

## 자유 페이지 (freePages, 선택)

책 소개 사이에 끼우는 페이지. 배경 사진 + 오버레이 박스 + 줄 하이라이트 + 번호 뱃지 조합.
`slot`: `beforeBooks` | `afterBook:N` | `afterBooks`.
자세한 스키마는 `README_freepages.md` 참고.

## 포토키워드 규칙

- 모든 사진 자리에 **영어 포토키워드 필수** (한국어는 검색 결과 없음)
- 본문 1~6번: 세로(portrait), 7번: 가로(landscape)
- 수집 우선순위: Unsplash → Pexels → Pixabay (키 있는 것만)

## 사진 교체 (넣은 뒤에 마음에 안 들 때)

`fetch_images.js`는 **비어 있는 자리만** 채운다(이미 받은 사진은 건너뜀).
이미 들어간 사진을 바꾸는 건 `replace_photo.js`가 담당한다.

```bash
node replace_photo.js                    # 사진 자리 목록 (어떤 id를 쓰는지 확인)
node replace_photo.js cover              # 같은 키워드로 다른 사진 (직전 사진은 제외)
node replace_photo.js book2 --keyword "moonlit herb garden"   # 새 키워드로
node replace_photo.js intro --candidates # 후보 10장 → candidates.html 열어서 눈으로 고르기
node replace_photo.js intro --pick 4     # 후보 4번으로 확정
node replace_photo.js book3 --file photos/IMG_1234.jpg        # 내 사진으로
node replace_photo.js cover --url https://.../photo.jpg       # 이미지 주소로
node replace_photo.js book1.cover --candidates                # 책 표지 판본 고르기
```

**사진 자리 id**

| id | 자리 |
|---|---|
| `cover` | 표지 배경 사진 |
| `intro` | 인트로 타원 사진 |
| `book1`, `book2`… | 책 N번 무드 사진 |
| `book1.cover`, `book2.cover`… | 책 N번 책 표지 (네이버) |
| `free1.bg` | 자유 페이지 N 배경 |
| `free1.1`, `free1.2`… | 자유 페이지 N의 배치 이미지 |

**옵션**: `--data <파일.json>` (기본 generated_data.json) / `--source unsplash|pexels|pixabay`
/ `--orientation portrait|landscape|squarish` / `--book "제목" --author "저자"` (책 표지 재검색)

**JSON만 고쳐서 교체하기** (아이패드·깃허브에서 터미널 없이):
바꾸고 싶은 자리에 교체 플래그를 넣고 커밋하면 다음 `fetch_images.js` 실행 때 새로 받는다.
플래그는 실행 후 자동으로 지워진다.

```json
"cover":  { ..., "photoReplace": true },     // 표지 사진
"intro":  { ..., "photoReplace": true },     // 인트로 사진
"books":  [{ ..., "photoReplace": true,      // 무드 사진
                  "coverReplace": true }],   // 책 표지
"freePages": [{ "background": { ..., "replace": true },
                "images": [{ ..., "replace": true }] }]
```

키워드(`photoKeyword` / `source.keyword`)를 고쳐서 커밋해도 사진이 새로 수집된다.
단, `--file`로 넣은 내 사진은 키워드를 고쳐도 덮어쓰지 않는다(교체 플래그를 넣거나 파일 경로를 지워야 함).

## 아이패드로 작업하려면

`README_ipad.md` 참고 — GitHub Actions로 커밋만 하면 클라우드에서 자동 생성.

## 트러블슈팅

- **폰트 안 보임** → 클로드 앱 미리보기의 한계. 크롬/엣지로 열 것. PNG에는 영향 없음.
- **표지가 가로로 보임** → 미리보기 플레이스홀더 현상. 실제 표지는 세로로 수집됨.
- **책 표지 안 나옴** → 네이버 검색 실패. placeholder(회색 박스)로 정상 생성.
- **사진이 마음에 안 듦** → `node replace_photo.js` 로 자리 확인 후 교체 (위 "사진 교체" 참고).
- **다른 책 표지가 들어옴** → `node replace_photo.js book2.cover --candidates` 로 판본 목록에서 고르기.
- **`Cannot find module`** → `npm install` 재실행.
