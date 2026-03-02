# AI Keyboard BLE 웹앱 — 기능 명세 (현행화)

> 코드 기준 전체 기능 정리. `web/index.html`, `web/app.js`, `web/styles.css` 반영.

---

## 1. 개요

| 항목 | 내용 |
|------|------|
| 경로 | `web/` |
| 기술 | HTML/CSS/JS, Web Bluetooth API |
| 목적 | BLE 키보드 장치와 연결해 텍스트·키·명령 전송, 매크로 실행 |
| 실행 | `python -m http.server 8080` 후 `http://localhost:8080` (또는 HTTPS) |

---

## 2. BLE 연결

### 2.1 연결·해제

- **연결**: 최초 1회는 `navigator.bluetooth.requestDevice()`로 장치 선택. 이후에는 마지막 선택 장치로 재연결.
- **해제**: `device.gatt.disconnect()`, notify 해제 후 `setConnectedState(false)`.
- **자동 재연결**: 페이지 로드 시 `tryAutoReconnect()` — `lastDeviceId`와 `navigator.bluetooth.getDevices()`로 이전 장치 찾아서 `setupGatt()` 호출. (getDevices 미지원 브라우저에서는 스킵.)

### 2.2 끊김 감지

- `device.addEventListener("gattserverdisconnected", onDisconnected)` 로 등록.
- 장치가 멀어지거나 제거되어 GATT가 끊기면 **F5 없이** `onDisconnected()` → `setConnectedState(false)` 호출되어 UI가 "상태: 연결 안 됨"으로 갱신됨.

### 2.3 UI

- **상태 표시**: "상태: 연결됨" / "상태: 연결 안 됨".
- **연결 시 디바이스 이름**: 같은 박스 안에 `(장치이름)` 표시 (예: `(zero2w)`). 이름 없으면 빈 문자열.
- 연결 시: 연결 버튼 비활성, 해제·전송 정지·PING·STATUS·TEXT 전송·RAW·서식·키·매크로 실행 활성.

---

## 3. 전송 설정 패널

### 3.1 레이아웃

- **헤더**: "전송 설정" + 상태 박스(연결됨/디바이스명) + 연결 / 해제 / 전송 정지 + **접기** 버튼.
- **펼침/접침**: `#settingsContent.settings-grid`에 `is-collapsed` 토글. 버튼 문구 "접기" ↔ "펼치기".
- **펼쳤을 때**: 헤더와 내용 사이 `margin-top: 8px` (매크로 탭과 동일).

### 3.2 설정 항목

| 항목 | ID | 설명 | 저장 |
|------|-----|------|------|
| 전송 지연(초) | `delayInput` | PING/STATUS/TEXT 등 전송 전 대기 시간(초). 숫자, 기본 2. | `delaySec` |
| 타이핑 속도(%) | `speedInput` | 20~300. `SPEED:{값}` 전송. 기본 90. | `speedPercent` |
| PING | `btnPing` | `PING` 명령 전송. | — |
| STATUS | `btnStatus` | `STATUS` 명령 전송. | — |

### 3.3 전송 정지

- **전송 정지** 버튼: `requestStopSending()` → `sendStopToken` 증가 + 연결 중이면 `STOP` 명령 전송.
- 텍스트 전송·매크로 실행 등은 `waitWithStop()`/`isSendStopped(token)`으로 주기적으로 확인해 중단.

---

## 4. 텍스트 전송

### 4.1 TEXT 전송

- **TEXT 전송** 버튼: `#textInput` 내용을 `TEXT:` 접두어로 BLE 전송.
- **전송 지연**: 전송 전 `getDelayMs()` 만큼 대기 (전송 정지로 취소 가능).
- **마크다운 인식** 체크 시: `parseMarkdownActions()` 후 텍스트 + 서식 키 조합으로 `sendActions()` 호출.

### 4.2 마크다운 인식 (mdMode)

| 입력 | 동작 |
|------|------|
| `**...**` | `CTRL+B` (굵게) |
| `*...*` | `CTRL+I` (기울임) |
| `__...__` | `CTRL+U` (밑줄) |
| `***...***` | `CTRL+B` + `CTRL+I` |

### 4.3 대용량 텍스트 (채널 분할)

- UTF-8 기준 `TEXT:` 포함 512바이트 초과 시 `confirmLargeTextIfNeeded()`로 확인 후 `splitTextByUtf8Bytes()`로 청크 분할 전송.
- 매크로 내 TEXT는 `confirmLarge: false`로 확인 없이 분할만 수행.

---

## 5. 키 전송

- **키 전송**: `data-key` 버튼 클릭 시 `KEY:{키이름}` 전송.
- 지원 키: ENTER, BACKSPACE, TAB, ESC, UP/DOWN/LEFT/RIGHT, SHIFT+방향, SHIFT+TAB, CTRL+LEFT/RIGHT, 한/영 등.

---

## 6. 서식 단축키

- **굵게 / 기울임 / 밑줄**: 각각 `KEY:CTRL+B`, `KEY:CTRL+I`, `KEY:CTRL+U` 전송.

---

## 7. 전문 명령 (RAW)

- **RAW 전송**: `#rawInput`에 입력한 문자열을 그대로 한 번에 전송 (예: `KEY:F1`).
- 전송 전 전송 지연 적용.

---

## 8. 매크로

### 8.1 패널

- **매크로** 섹션: 헤더("매크로" + **열기** 버튼) + `#macroContent.macro-wrap`. 열기/접기 시 "접기" ↔ "열기" 문구 변경.
- 펼쳤을 때 헤더 아래 `margin-top: 8px` (`.macro-grid`).

### 8.2 프로필

- **저장**: 프로필 이름 + 편집창 스크립트 → `macroProfiles`에 저장, `macroSelectedProfile` 갱신.
- **불러오기**: 선택한 프로필 스크립트를 편집창에 로드.
- **삭제**: 선택 프로필 제거 후 선택 해제.
- **JSON 불러오기**: 파일 선택 → `macroProfiles` 형식 JSON 파싱 후 기존 프로필과 병합, 선택은 임포트된 첫 프로필.
- 프로필 이름: 40자 제한, 특수문자·연속 공백 정규화.

### 8.3 매크로 빌더

- **텍스트 추가**: 입력값을 줄 단위로 `TEXT:...` 라인으로 편집창에 추가.
- **지연(ms) 추가**: `macroDelayInput` 값을 `DELAY:{ms}` 로 추가.
- **키 버튼**: `data-macro-key` 값으로 `KEY:{키}` 라인 추가 (ENTER, TAB, F1~F4, CTRL+B/I/U 등).

### 8.4 스크립트 문법

- **TEXT:...** — 콜론 뒤 문자열을 TEXT로 전송 (한 줄).
- **KEY:...** — 콜론 뒤 키 이름을 KEY 명령으로 전송.
- **DELAY:ms** — 정수 ms만큼 대기 (전송 정지로 취소 가능).
- **#** 로 시작하는 줄 — 주석(무시).
- 그 외 라인 — **raw** 로 한 줄씩 그대로 명령 전송.

### 8.5 매크로 실행

- **매크로 실행** 버튼: `parseMacroScript()` → step 배열 생성 후 `runMacroScript()`.
- 각 step: delay / text / key / raw 에 따라 `waitWithStop`, `sendTextPayload`, `writeCommand(KEY:...)`, `writeCommand(raw)` 수행.
- 실행 중 `isSendStopped(sendToken)` 이면 "Macro run cancelled." 로 중단.
- 실행 중에는 **매크로 실행** 버튼 비활성.

---

## 9. 설정 저장 (localStorage)

- **키**: `STORAGE_KEY` (`ai_kbd_webapp_settings_v1`).
- **저장 항목**:
  - `delaySec`, `speedPercent`
  - `mdMode`
  - `settingsExpanded` (전송 설정 패널 펼침 여부)
  - `macroScript` (편집창 내용)
  - `macroSelectedProfile` (선택된 프로필 이름)
  - `macroProfiles` (이름 → 스크립트 객체)
  - `lastDeviceId` (마지막 연결 장치 ID, 자동 재연결용)
- **복원**: `applySettingsToUI()` 에서 로드 후 입력값·체크·패널 접힘·매크로 옵션 반영. 매크로 패널은 초기 "접힌" 상태로 복원.

---

## 10. GATT 프로토콜

- **Service UUID**: `12345678-1234-5678-1234-56789abcdef0`
- **RX (쓰기)**: `...f1` — 명령 전송 (`writeValueWithResponse`).
- **TX (알림)**: `...f2` — `startNotifications` 후 수신 로그 `notify <= ...`.
- **최대 전송 크기**: 512바이트 (청크 분할 기준).

---

## 11. 로그

- **로그 영역**: `#logBox` (pre). 모든 전송/수신/연결/에러/매크로 단계 등 `log()` 로 추가.
- 시간 접두어 `[HH:mm:ss]` + 자동 스크롤.

---

## 12. UI 요약 (현행)

- **전송 설정**: 상태 박스와 연결/해제/전송 정지 버튼 높이·스타일 통일(38px, 동일 패딩). 제목 "전송 설정" 위아래 가운데 정렬. 전송 설정 탭 아래 마진 없음(`margin-bottom: 0`). 펼쳤을 때만 상단 8px 여백.
- **매크로**: 펼침 시 상단 8px 여백으로 전송 설정과 동일한 느낌.
- **접기/펼치기**: 전송 설정은 "접기"/"펼치기", 매크로는 "접기"/"열기".

---

*문서 끝. 코드 변경 시 이 명세를 함께 현행화하는 것을 권장합니다.*
