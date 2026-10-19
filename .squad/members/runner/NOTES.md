## 인계 메모

- T-mveubxm6-d4b4: run-queue 는 <squad>/locks/run-queue.lock 을 잡고 프로젝트당 하나만 돈다. task add/done·msg·order 가 lock.mjs wakeQueue 로 안 돌면 백그라운드로 깨운다. 서버(startQueue 잠금 공유·30초 점검·queue 상태 API)는 server M-mveujd96-4814, 상단 표시는 ui M-mveujdd5-5c39 대기.
- T-mveu426k-9122: 위험 명령은 멤버 도구에서 빠지고 `approve run` 이 승인된 --cmd 만 실행. 연결 대기: server M-mveuf5gd-8786·M-mvetv3ri-0ca7, ui M-mvetv3u7-4262.
- setup 의 agy 설치는 공식 URL 확정되면 bin/setup.mjs DEFAULT_TOOLS 에 추가.
