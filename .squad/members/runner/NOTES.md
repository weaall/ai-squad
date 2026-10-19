## 인계 메모

- T-mvewgg01-ffc7: `squad board` = 감시 프로세스(bin/board-watch.mjs). 자식(SQUAD_BOARD_CHILD=1)에 TOKEN·VERSION env 전달, server/lib/bin 변경 3초 조용·HEAD 변경 시 재시작, 3연속 실패면 같은 포트에 503 오류 페이지. version 노출·실행 규칙은 server T-mvewn8lg-3631, 재접속 새로고침은 ui T-mvewn8pb-845c 대기.
- T-mvev7cbh-186f: 어댑터 sessionId·resume, map.mjs, `squad map`, `doctor --propose`. 연결은 server T-mvew1zwm-37ab, 표시는 ui T-mvew200f-7c1d 대기.
- run-queue 는 locks/run-queue.lock 으로 프로젝트당 하나. 위험 명령은 `approve run` 만. agy 설치 URL 확정되면 bin/setup.mjs DEFAULT_TOOLS 에 추가.
