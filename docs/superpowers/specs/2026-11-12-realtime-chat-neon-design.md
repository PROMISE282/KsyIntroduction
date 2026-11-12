# 실시간 메시지 (Neon Realtime) 설계

작성일: 2026-11-12

## 1. 목표

포트폴리오 사이트(`index.html`)의 "KSY에게 메시지" 기능을 Supabase 대신 Neon으로 연결해, 방문자와 오너가 실제로 실시간 대화를 할 수 있게 한다.

**성공 기준**
- 방문자가 보낸 메시지가 오너 화면(`#admin`)에 새로고침 없이 나타나고, 오너 답장도 방문자 화면에 즉시 나타난다.
- 방문자는 로그인 없이 쓰며, 재방문해도 같은 대화가 이어진다.
- 방문자는 자신의 대화만 볼 수 있다.
- 오너는 비밀번호로 로그인해 모든 대화를 본다.
- 무료 플랜에서 유휴 상태여도 프로젝트가 정지돼 못 쓰게 되지 않는다.

**전제 (사용자가 확정)**
- 백엔드: Neon (Lakebase Postgres + Realtime 베타)
- 서버: 같은 저장소의 Vercel Functions
- 방문자: 서버가 서명한 익명 ID 쿠키
- 오너: 비밀번호 1개

## 2. 현재 상태

- 사이트는 빌드 없는 단일 `index.html`이고 Vercel에 배포된다.
- 채팅 UI(`mountChat`, `mountAdmin`)와 저장소 인터페이스(`demoStore`, `supabaseStore`, `offlineStore`)는 이미 구현되어 있다.
- `CHAT_CONFIG`가 비어 있어 로컬은 데모 모드, 배포본은 "준비 중"으로 동작한다.
- 저장소 인터페이스: `mode`, `needsLogin`, `onStatus`, `visitorId`, `restore`, `login`, `watchThread`, `watchAll`, `send`, `markSeen`.

## 3. 아키텍처

```
브라우저 (index.html)
  ├─ POST /api/live  ──▶ 서버가 쿼리를 봉인(seal)해서 반환
  ├─ POST /api/send  ──▶ 서버가 권한 확인 후 INSERT, txid 반환
  ├─ POST /api/owner/login ─▶ 비밀번호 확인, 세션 쿠키 발급
  └─ WebSocket ──▶ Neon Realtime (봉인된 쿼리로 구독)

Vercel Functions (api/) ──▶ Neon Postgres (messages)
```

- 브라우저에는 `NEON_REALTIME_URL`만 공개한다.
- `NEON_REALTIME_SECRET`, `DATABASE_URL`, `OWNER_PASSWORD`, `SESSION_SECRET`은 서버 환경변수에만 둔다.
- 권한 검사는 서버가 한다. Realtime은 RLS를 지원하지 않으므로 `messages` 테이블의 RLS는 켜지 않는다.

## 4. 데이터

테이블 `messages`:

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | uuid | PK, 기본 `gen_random_uuid()` |
| vid | uuid | not null, 방문자 ID |
| from_role | text | `'v'` 또는 `'o'` |
| name | text | 기본 `'방문자'`, 20자 이하 |
| contact | text | null 가능, 100자 이하 |
| text | text | 1~1000자 |
| ts | timestamptz | 기본 `now()` |

인덱스: `(vid, ts)`. 기본 키가 있어 Realtime이 요구하는 안정적인 replica identity를 만족한다.

## 5. 인증

**방문자**
- 첫 요청에서 서버가 `vid`(UUID)를 만들고 HMAC 서명해서 httpOnly, Secure, SameSite=Lax 쿠키로 내려준다.
- 서버는 쿠키에서 검증한 `vid`만 쓴다. 클라이언트가 보낸 `vid`는 신뢰하지 않는다.

**오너**
- `POST /api/owner/login`: `OWNER_PASSWORD`와 상수 시간 비교한다. 성공하면 만료가 있는 서명된 세션 쿠키를 발급한다.
- 로그인 실패가 반복되면 일정 시간 막는다.
- 오너 전용 API는 모두 세션 쿠키를 검증한다.

## 6. API

| 경로 | 호출자 | 동작 |
|---|---|---|
| `POST /api/live` | 방문자 | 자기 `vid`의 스레드를 조회하는 쿼리를 봉인해 반환 |
| `POST /api/live` | 오너 | 전체 스레드를 조회하는 쿼리를 봉인해 반환 |
| `POST /api/send` | 방문자 | 자기 `vid`에 `from_role='v'`로 INSERT |
| `POST /api/send` | 오너 | 지정한 `vid`에 `from_role='o'`로 INSERT |
| `POST /api/owner/login` | 오너 | 세션 쿠키 발급 |

- 쓰기는 한 문장의 INSERT로 처리하고 `RETURNING pg_current_xact_id()::text`로 `txid`를 돌려준다.
- 입력값(이름, 연락처, 본문 길이)은 서버에서 검증한다.
- 스팸 방어는 서버에서 한다: 방문자당 최대 200개, 방문자 메시지는 2초에 1개. 초과하면 기존과 같은 오류 문구를 반환한다.
- 봉인된 쿼리는 쿠키처럼 취급한다. URL, 로그, 영구 저장소에 남기지 않는다.

## 7. 클라이언트

- `supabaseStore`를 `neonStore`로 교체하고 저장소 인터페이스는 유지한다.
- `mountChat`, `mountAdmin`, 데모 모드, 오프라인 모드는 최대한 그대로 둔다.
- 봉인된 쿼리는 만료되므로 갱신(`refreshQuery`) 로직을 둔다.
- 쓰기 후 `awaitTxId(txid, timeout)`로 낙관적 표시를 확정한다.
- 클라이언트 SDK 로딩은 `esm.sh` 같은 CDN을 우선 검토하고, 버전·무결성 고정이 어렵다면 작은 빌드 단계를 추가한다. 구현 계획 단계에서 확정한다.
- `index.html`의 Supabase 설정 안내 주석은 Neon 설정 안내로 교체한다.

## 8. 오류 처리

- API나 Realtime에 연결할 수 없으면 "준비 중" 안내로 내려가고 입력을 막는다.
- 구독이 끊기면 재연결하고, 상태 표시(`onStatus`)에 반영한다.
- 오류 상태에서는 새 봉인 쿼리로 다시 구독한다.
- 비밀번호 오류는 구체적인 이유를 알리지 않고 "로그인 실패"만 표시한다.

## 9. 테스트

- `neon realtime subscribe`로 봉인 전 쿼리를 먼저 검증한다.
- 방문자 창과 `#admin` 창을 동시에 열어 양방향 송수신을 확인한다.
- 다른 `vid`의 대화가 노출되지 않는지, 변조된 쿠키가 거부되는지 확인한다.
- 비밀번호 오류와 반복 실패 제한을 확인한다.
- 스팸 제한(200개, 2초)과 길이 검증을 확인한다.
- 브라우저를 닫았다 다시 열어도 같은 대화가 이어지는지 확인한다.

## 10. 사전 조건과 위험

- Neon 계정과 CLI 로그인이 필요하고, 프로젝트는 지원 리전(`aws-us-east-1`, `aws-us-east-2`, `aws-eu-central-1`, `aws-ap-southeast-1`)에 만든다.
- Realtime은 베타다. 문제가 생기면 같은 API와 DB를 두고 폴링으로 대체할 수 있도록 클라이언트의 구독 부분을 저장소 인터페이스 뒤에 가둔다.
- 무료 플랜은 유휴 시 컴퓨트가 꺼지고 다음 요청에서 깨어난다. 첫 요청은 느릴 수 있다.

## 11. 범위 밖

- 파일 첨부, 읽음 확인 표시의 서버 동기화, 이메일·푸시 알림, 다중 오너.
