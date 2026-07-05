# 아이패드에서 카드뉴스 만들기 (GitHub Actions)

노트북 없이 아이패드 사파리만으로 전체 워크플로를 돌리는 방법입니다.
원리: 프로젝트를 GitHub 비공개 저장소에 올려두면, JSON이 바뀌거나 사진이 올라올 때마다
GitHub 서버가 대신 `fetch_images.js` + `generate.js`를 실행하고 PNG를 만들어줍니다.

## 최초 설정 (노트북에서 한 번, 20~30분)

이 단계만 노트북에서 하는 걸 권장합니다 (여러 파일 업로드가 편해서).

1. **github.com 가입** → **New repository** → 이름 아무거나, 반드시 **Private** 선택
2. 프로젝트 파일 전부 업로드 (repo 페이지 → Add file → Upload files, 드래그 앤 드롭):
   - `generate.js`, `preview.js`, `fetch_images.js`, `free_page.js`, `template.html`
   - `package.json`, `package-lock.json`, `generated_data.json`
   - `.gitignore`, `.github/workflows/generate.yml` (이 두 개가 핵심)
   - ⚠️ **`.env` 파일은 절대 올리지 마세요** — 키는 다음 단계의 Secrets로 등록
3. **API 키 등록**: repo → Settings → Secrets and variables → Actions → New repository secret
   아래 이름 그대로 하나씩 등록 (Pexels/Pixabay는 없으면 생략 가능):
   - `NAVER_CLIENT_ID`
   - `NAVER_CLIENT_SECRET`
   - `UNSPLASH_ACCESS_KEY`
   - `PEXELS_API_KEY`
   - `PIXABAY_API_KEY`
4. repo에 `photos` 폴더 생성 (Add file → Create new file → 이름에 `photos/.gitkeep` 입력 → Commit)

## 평소 사용 (아이패드에서, 게시물 하나당 ~5분 + 대기)

1. **Claude 채팅**에서 사진 첨부 + 주제 요청 → JSON 받기
2. 첨부했던 사진을 **파일 앱에 저장** (사진 꾹 눌러 "이미지 저장" 또는 파일에 저장)
3. 사파리에서 **github.com 접속** → 내 repo:
   - `photos` 폴더 열기 → Add file → Upload files → 파일 앱에서 사진 선택 (Claude가 지정한 파일명 `01.jpg`, `02.jpg`…로 이름 맞추기) → Commit
   - `generated_data.json` 열기 → 연필 아이콘(Edit) → 전체 선택 후 Claude가 준 JSON 붙여넣기 → Commit changes
4. 커밋하는 순간 **자동 실행**됩니다. repo의 **Actions 탭**에서 진행 상황 확인 (보통 2~4분)
5. 완료되면 해당 실행 클릭 → 하단 **Artifacts** → `carousel-png` 다운로드 (zip)
6. 파일 앱에서 zip 압축 해제 → PNG를 사진 앱으로 → 인스타 업로드

## 알아두면 좋은 것

- **비용**: GitHub Actions는 비공개 저장소 기준 월 2,000분 무료. 한 번 실행에 3분 정도라
  한 달에 게시물 수백 개를 만들어도 무료 한도 안입니다.
- **자동 커밋**: 실행이 끝나면 다운로드된 표지/사진(covers/)과 갱신된 JSON이 저장소에
  자동 저장됩니다. 같은 게시물을 다시 생성해도 이미지를 재다운로드하지 않아요.
- **사진만 바꾸고 싶을 때**: `generated_data.json`에서 해당 이미지의 `"file"` 필드만 지우고
  커밋하면 그 이미지만 새로 수집됩니다.
- **실패했을 때**: Actions 탭에서 빨간 X가 뜨면 클릭해서 로그 확인. 대부분 JSON 문법 오류
  (따옴표, 쉼표)이니 로그의 에러 메시지를 Claude 채팅에 붙여넣으면 바로 고쳐드립니다.
- **preview.js는 이 흐름에선 생략**: 미리보기 없이 바로 PNG가 나옵니다. 마음에 안 들면
  JSON 수정 후 다시 커밋하면 돼요 (2~4분이면 재생성).

## 대안: GitHub Codespaces

터미널을 직접 만지고 싶다면 repo 페이지에서 Code → Codespaces → Create codespace를 누르면
사파리 안에서 VS Code + 터미널이 열립니다. 노트북에서 쓰던 명령어(`node fetch_images.js` 등)를
그대로 쓸 수 있어요. 무료 한도는 월 60시간(2코어 기준 120시간). 다만 매번 터미널을 여는 것보다
위의 Actions 자동 실행이 손이 덜 갑니다.
