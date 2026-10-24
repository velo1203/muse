# Muse for Android — 단계별 목표

폰에 APK로 직접 설치해서 쓰는 개인용 뮤즈. 데스크톱과 같은 코드베이스(Tauri v2)에서
화면·재생 엔진·라이브러리 로직을 공유하고, 다운로드처럼 플랫폼마다 다른 부분만 따로 구현한다.

## 목표 0 — 개발 환경 & 빈 앱 실행 ✅
- [x] rustup + 안드로이드 타깃(aarch64, armv7, x86_64) 설치
- [x] Android NDK 설치
- [x] `tauri android init` 로 안드로이드 프로젝트 생성
- [x] 에뮬레이터에서 지금의 뮤즈 화면이 뜬다 (기능은 안 돼도 됨)
- [x] 디버그 APK 파일이 만들어진다

**완료 기준:** 에뮬레이터에서 앱이 실행되고, 폰에 설치할 수 있는 APK가 나온다.

## 목표 1 — 폰에서 검색·받기·듣기 ✅
- [x] 폰 화면 구조: 하단 탭(홈 / 검색 / 라이브러리), 미니 플레이어, 전체화면 재생 화면
- [x] 검색(곡·앨범) — 데스크톱과 같은 카탈로그 검색
- [x] youtubedl-android 로 유튜브 음원 받기 (원본 최고 음질, 진행률 표시)
- [x] 받은 곡 재생, 다음/이전, 셔플·반복

**완료 기준:** 에뮬레이터에서 곡을 검색 → 받기 → 재생이 끝까지 된다.

## 목표 2 — 진짜 음악 앱처럼 재생 ✅
- [x] 화면이 꺼지거나 다른 앱을 써도 계속 재생 (포그라운드 서비스)
- [x] 알림창·잠금화면에서 재생/일시정지/다음 곡 조작, 앨범 커버 표시
- [x] 이어폰 버튼·블루투스 조작, 이어폰 빠지면 일시정지
- ~~자동 재생: 곡/목록이 끝나면 비슷한 곡을 이어서 재생~~ — 필요 없어서 뺌

**완료 기준:** 화면을 끈 상태로 여러 곡이 이어서 재생되고, 잠금화면에서 조작된다.

## 목표 3 — 내 라이브러리 ✅
- [x] 좋아요, 플레이리스트 만들기·담기·순서 바꾸기
- [x] 아티스트·앨범 페이지, 최근 재생, 많이 들은 곡
- [x] 검색 결과에서 "받고 플레이리스트에 담기" 등 ⊕ 메뉴
- [x] 곡 삭제, 정보 편집, 다른 음원으로 바꾸기

**완료 기준:** 데스크톱 뮤즈에서 하던 라이브러리 관리를 폰에서도 할 수 있다.

## 목표 4 — 부가 기능 ✅
- [x] 싱크 가사
- [x] 이퀄라이저·볼륨 표준화·크로스페이드
- [x] 수면 타이머
- [x] 폰에 있는 음악 파일 가져오기

**완료 기준:** 데스크톱의 재생 설정·가사 기능이 폰에서도 동작한다.

## 목표 5 — 배포 ✅
- [x] 개인 서명 키로 릴리스 APK 만들기 (설치·업데이트 가능)
- ~~GitHub Actions 에서 APK 자동 빌드~~ — APK 파일을 직접 공유하므로 생략
- [x] 설치 방법 README 에 추가

**완료 기준:** Releases 에서 APK를 받아 폰에 설치하고, 새 버전을 덮어 설치해도 라이브러리가 유지된다.

## 추가 — 안드로이드 오토 ✅
- [x] MediaBrowserService 로 차 화면에서 좋아요·모든 곡·최근 재생·플레이리스트 둘러보기
- [x] 차에서 곡 선택 → 그 목록으로 재생, 재생/일시정지/다음/이전/탐색
- [x] 음성 검색("OK Google, 뮤즈에서 … 틀어줘") → 라이브러리에서 가장 맞는 곡 재생
- [x] 디버그 자체 테스트(`AutoSelfTest`)로 목록·재생 확인 (에뮬레이터의 Android Auto는 로그인이 필요해 실제 차 화면 시뮬레이터는 미확인)

## 안드로이드에서 따로 처리한 것
- 재생은 앱 화면(WebView)의 Web Audio 그대로. 파일은 통째로 읽어 메모리에서 재생 (Tauri asset 프로토콜이 곡 중간의 범위 읽기를 실패해서 30초쯤에 끊겼음)
- 오디오 포커스는 WebView가 관리 (서비스가 따로 요청하면 서로 뺏어서 멈춤)
- 앱에 들어 있는 yt-dlp는 오래돼서 YouTube가 403으로 거부 → 처음 실행 때와 이후 매주 GitHub 최신판으로 교체
- 볼륨 표준화용 음량은 ffmpeg 대신 WebView에서 EBU R128 방식으로 측정
- 릴리스 빌드(R8)에서 Commons Compress가 깨지지 않도록 keep 규칙 추가 (`app/proguard-muse.pro`)

## 빌드 메모
- 안드로이드 빌드는 rustup의 Rust를 써야 함 (Homebrew Rust에는 안드로이드 타깃이 없음):
  `PATH=/opt/homebrew/opt/rustup/bin:$PATH`, `JAVA_HOME=/Applications/Android Studio.app/Contents/jbr/Contents/Home`,
  `ANDROID_HOME=~/Library/Android/sdk`, `NDK_HOME=$ANDROID_HOME/ndk/30.0.16248370`
- 디버그 APK: `npx tauri android build --debug --apk --target aarch64`
- 릴리스 APK: `npx tauri android build --apk --target aarch64` → `app/build/outputs/apk/universal/release/app-universal-release.apk` (약 62MB)
- 서명 키: `~/.muse/muse-release.jks`, 비밀번호는 `src-tauri/gen/android/keystore.properties` (git 제외). **키를 잃어버리면 기존 앱 위에 업데이트 설치가 안 됨**
