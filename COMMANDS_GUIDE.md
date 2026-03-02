# 명령어 가이드 (RAW 명령 탭)

## 개요

웹앱의 `원문 명령(RAW)` 입력창은 문자열을 그대로 Pi GATT 서버로 전송합니다.

## 기본 명령

- `PING`
  - 응답: `PONG`
- `STATUS`
  - 응답 예: `OK:LIVE:/dev/hidg0:lang=en:speed=90`

## 입력/설정 명령

- `TEXT:<문자열>`
  - 예: `TEXT:Hello`
  - 예: `TEXT:저는 KDS입니다.`
  - 응답: `OK:TEXT:<count>`
- `KEY:<키/조합키>`
  - 예: `KEY:ENTER`
  - 예: `KEY:CTRL+B`
  - 응답: `OK:KEY:<TOKEN>`
- `SPEED:<percent>`
  - 범위: `20`~`300`
  - 예: `SPEED:90`
  - 응답: `OK:SPEED:90`

## 지원 KEY

- 기본: `ENTER`, `ESC`, `BACKSPACE`, `TAB`, `SPACE`
- 방향: `UP`, `DOWN`, `LEFT`, `RIGHT`
- 기능키: `F1`~`F12`
- 숫자: `0`~`9`
- 알파벳: `A`~`Z`
- 한/영: `HANGEUL`, `HAN/ENG`
- 조합키: `CTRL+B`, `CTRL+I`, `CTRL+U`, `ALT+TAB`, `SHIFT+TAB`, `CTRL+LEFT` 등

## TEXT 처리 규칙

- ASCII/한글(2벌식 변환 가능 범위)은 그대로 입력합니다.
- 일부 특수문자는 내부 fallback 규칙으로 치환됩니다.
- 치환 불가 문자는 `?`로 대체하여 전송 중단을 피합니다.

## 오류 응답

- `ERR:UNKNOWN_CMD`: 알 수 없는 명령
- `ERR:PermissionError`: `/dev/hidg0` 권한 문제
- `ERR:ValueError`: 잘못된 키/조합키/속도 값
- `ERR:<ExceptionType>`: 기타 예외

## 대용량 TEXT

- GATT write 제한(512바이트) 초과 시 웹앱이 자동 분할 전송합니다.
- 전송 전에 확인 창이 표시됩니다.
