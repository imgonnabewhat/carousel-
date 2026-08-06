# 자유 배치 페이지 (freePages) — v3.2 확장

기존 파이프라인(표지 → 인트로 → 책 본문 → 엔딩)에 **사진과 텍스트를 자유롭게 배치하는 페이지**를 끼워 넣을 수 있습니다.
문맥에 필요한 이미지는 스크립트가 **자동으로 찾아옵니다** — 책 표지는 네이버에서, 분위기 사진은 Unsplash에서.
밈/짤처럼 직접 고른 사진만 `photos/` 폴더에 넣으면 됩니다.

## 바뀐 워크플로

```
[1] Claude 채팅에 요청 (freePages 포함 가능)
[2] JSON 복사 → generated_data.json
[3] node fetch_images.js     ← 새 명령어 (fetch_books.js 상위호환)
                                책 표지 + 커버 사진 + freePages 이미지 전부 자동 수집
[4] node preview.js          # (선택) 미리보기
[5] node generate.js         # PNG 생성
```

`fetch_books.js`는 그대로 두어도 되지만, 이제 `fetch_images.js` 하나만 쓰면 됩니다.

## JSON에 추가되는 부분

```json
{
  "freePages": [
    {
      "slot": "beforeBooks",
      "label": "FOCUS",
      "textPosition": "center",
      "images": [
        {
          "source": { "type": "unsplash", "keyword": "rainy window night", "orientation": "squarish" },
          "position": "top-right",
          "size": "medium"
        },
        {
          "source": { "type": "bookCover", "title": "소년이 온다", "author": "한강" },
          "position": "bottom-left",
          "size": "small"
        },
        {
          "source": { "type": "local", "path": "photos/meme1.jpg" },
          "position": "mid-right",
          "size": "small",
          "tilt": -5
        }
      ],
      "blocks": [
        { "style": "title", "text": "어떤 밤은 책으로만 견뎌집니다" },
        { "style": "emphasis", "text": "그날 저를 붙잡아준 건 한 문장이었어요", "highlightWord": "한 문장" },
        { "style": "box", "text": "오늘 소개할 네 권은 모두 그런 문장을 품고 있는 책들입니다." },
        { "style": "caption", "text": "PHOTO — UNSPLASH" }
      ]
    }
  ]
}
```

## 필드 설명

### slot — 페이지가 끼어드는 위치
| 값 | 위치 |
|---|---|
| `"beforeBooks"` (기본) | 인트로 뒤, 첫 책 앞 |
| `"afterBook:2"` | 2번째 책 뒤 (쉬어가는 페이지 등) |
| `"afterBooks"` | 마지막 책 뒤, 엔딩 앞 |

페이지 번호(`03 / 08`)와 파일명은 자동으로 다시 계산됩니다.

### images[].source — 이미지 자동 수집 방식
| type | 동작 | 필요한 필드 |
|---|---|---|
| `"bookCover"` | 네이버 책 검색으로 표지 다운로드 | `title`, `author` |
| `"photo"` (추천) | Unsplash → Pexels → Pixabay 순서로 자동 시도 | `keyword`(영어), `orientation`(선택) |
| `"unsplash"` / `"pexels"` / `"pixabay"` | 특정 소스만 사용 | `keyword`(영어), `orientation`(선택: portrait/landscape/squarish, 기본 squarish) |
| `"local"` | 내 파일 그대로 사용 | `path` (예: `photos/meme1.jpg`) |

사진 API 키는 `.env`에 있는 것만 사용합니다 (하나만 있어도 동작):

```
UNSPLASH_ACCESS_KEY=...   # https://unsplash.com/developers
PEXELS_API_KEY=...        # https://www.pexels.com/api/  (즉시 무료 발급)
PIXABAY_API_KEY=...       # https://pixabay.com/api/docs/ (로그인하면 페이지에 키 표시)
```

세 소스 모두 상업적 이용까지 허용되는 자유 라이선스라 계정 성장 후에도 안전합니다.
핀터레스트는 지원하지 않습니다 — 공개 검색/다운로드 API가 없고, 올라온 이미지 대부분이 제3자 저작물의 재업로드라 비영리 게시라도 저작권 문제가 그대로 남기 때문입니다.

- 다운로드된 파일 경로는 `file` 필드에 자동 기록됩니다. 다시 실행해도 이미 있는 파일은 건너뜁니다.
- 다른 사진으로 바꾸고 싶으면 셋 중 하나:
  - `node replace_photo.js free1.1` (자리 번호는 `node replace_photo.js` 로 확인) — 후보 보고 고르기·내 사진 넣기도 가능
  - 그 이미지에 `"replace": true` 를 넣고 `node fetch_images.js` 재실행 (아이패드/깃허브용, 실행 후 플래그 자동 삭제)
  - `file` 필드를 지우고 `node fetch_images.js` 재실행

### images[] — 배치
- `position`: `top-left / top-center / top-right / mid-left / mid-right / bottom-left / bottom-center / bottom-right`
- `size`: `small`(250px) / `medium`(360px) / `large`(480px)
- `tilt`: 기울기(도). 생략하면 자동으로 살짝 기울어짐
- `frame`: `"polaroid"`(흰 테두리+그림자, 사진 기본) / `"plain"`(라임 오프셋 그림자, 책 표지 기본)
- 한 페이지 2장 이하 권장. 텍스트가 많은 페이지에선 small 위주로.

### blocks[] — 텍스트 (브랜드 디자인 자동 적용)
| style | 모양 |
|---|---|
| `"title"` | Hahmlet 900 큰 헤드라인 |
| `"emphasis"` | `highlightWord`에 라임 형광펜 |
| `"box"` | 검정 테두리 + 라임 오프셋 그림자 박스 |
| `"plain"` | 세리프 줄글 |
| `"caption"` | 모노 작은 부연 (출처 표기 등) |

`textPosition`: `"top" / "center" / "bottom"` — 텍스트 묶음의 세로 위치. 이미지와 겹치지 않게 조절.

## 주의할 점 (실제 제약)

- **Unsplash 키워드는 영어**로. 한국어 키워드는 결과가 거의 없습니다.
- Unsplash 무료 API는 시간당 50회 요청 제한이 있습니다. 페이지 몇 장 수준에선 문제없지만, 연속으로 여러 번 재수집하면 걸릴 수 있어요.
- 네이버 표지 이미지는 원본 해상도가 크지 않아(보통 세로 400px 내외) `large` 사이즈로 쓰면 흐릿할 수 있습니다. 책 표지는 `small`~`medium` 권장.
- Unsplash 사진을 상업적 계정에 쓰는 것 자체는 라이선스상 허용되지만, 크레딧 표기가 권장됩니다. `caption` 블록이나 게시물 본문에 `Photo by ○○ on Unsplash`를 넣는 습관을 추천해요 (다운로드 시 `credit` 필드에 작가 정보가 저장됩니다).
- 밈/짤은 저작권·초상권 판단이 자동화될 수 없어서 `local` 타입으로만 지원합니다.
