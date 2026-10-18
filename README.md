# FIRE DIRECTION LAB · Windows 앱

FIRE DIRECTION LAB(단일 HTML 게임)을 Windows 프로그램으로 실행한다. 새 판은 [fire-direction-lab](https://github.com/Byanka-Rail/fire-direction-lab) 저장소의 `update.json`에서 받는다. 안드로이드 앱([fire-direction-lab-apk](https://github.com/Byanka-Rail/fire-direction-lab-apk))과 같은 규칙이다.

## 받기

[Releases](https://github.com/Byanka-Rail/fire-direction-lab-pc/releases/latest)에서 둘 중 하나를 받는다.

| 파일 | 설명 |
|---|---|
| `FIRE_DIRECTION_LAB_Setup_*.exe` | 설치판. 바탕화면 · 시작 메뉴 바로가기 생성. 관리자 권한 불필요 |
| `FIRE_DIRECTION_LAB_Portable_*.exe` | 설치 없이 실행. 켤 때 몇 초 더 걸림 |

- 대상: Windows 10 · 11 (64비트)
- 처음 실행 시 «Windows의 PC 보호» 창: «추가 정보» → «실행». 코드 서명 인증서가 없어서 뜨는 창이다.

## 새 판

- 켤 때 `update.json`의 `build`가 지금 판보다 크면 «업데이트 / 나중에»를 묻는다.
- 받은 파일은 크기 · HTML 여부 · SHA-256을 확인한 뒤 바꾼다. 실패하면 지금 판을 그대로 쓴다.
- 직전 판 하나를 보관한다. 메뉴 «게임 → 이전 판으로 되돌리기».
- 인터넷이 없으면 확인을 건너뛰고 지금 판으로 실행한다. 게임 자체는 오프라인에서 모두 동작한다.
- 게임 화면은 밖으로 요청을 내지 않는다. 옛 판에 남은 바깥 통계 스크립트 같은 것은 앱이 막는다. 새 판 확인만 앱이 직접 한다.

## 저장

- 게임 저장(localStorage)은 `%APPDATA%\FIRE DIRECTION LAB`에 있다. 판을 바꾸거나 앱을 지워도 남는다.
- 설치판과 포터블은 같은 저장을 쓴다.
- 게임의 «출력 · 저장» 파일은 저장 창에서 위치를 고른다.

## 운영

**게임 새 판 배포** — 지금과 같다. `fire-direction-lab` 저장소에 `FIRE_DIRECTION_LAB_v*.html`을 올리면 그 저장소의 Actions가 `update.json`을 갱신하고, PC 앱과 안드로이드 앱이 그것을 본다. PC 앱을 다시 만들 필요는 없다.

**PC 앱 다시 만들기** — 앱 코드가 바뀌었거나 새 설치 파일에 최신 판을 넣고 싶을 때.
1. `package.json`의 `version`을 올린다(예: 1.0.1).
2. main에 올린다.
3. Actions «Build Windows app»이 빌드 → Windows에서 켜 보는 시험 → `v1.0.1` 태그 · Releases 등록까지 한다.

`version`이 이미 릴리스된 값이면 Releases는 그대로 두고 Artifacts에만 남긴다. Actions 탭의 «Run workflow»로도 돌릴 수 있다.

## 구성

| 파일 | 역할 |
|---|---|
| `main.js` | 창 · 메뉴 · 업데이트 확인 · 저장 창 · `fdl://app` 출처 |
| `updater.js` | `update.json` 읽기 · 받기 · 검증 · 교체 · 되돌리기 |
| `scripts/fetch-game.js` | 빌드 전에 최신 판을 `game/`에 받는다 |
| `.github/workflows/build-windows.yml` | Windows 빌드 · 시험 · 릴리스 |
