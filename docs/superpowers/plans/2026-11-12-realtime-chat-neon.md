# 실시간 메시지 (Neon Realtime) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `index.html`의 메시지 창을 Neon Realtime과 Vercel Functions에 연결해 방문자와 오너가 실시간으로 대화하게 한다.

**Architecture:** 같은 저장소에 `api/` 함수(Vercel, Web 표준 `Request`/`Response` 핸들러)를 추가한다. 서버가 쿠키로 신원을 확인하고 Realtime 쿼리를 봉인해 내려주며, 쓰기는 서버가 한 문장의 INSERT로 처리한다. 브라우저는 `neonStore`로 기존 저장소 인터페이스를 유지하고, Realtime 클라이언트는 esbuild로 번들한 `vendor/neon-realtime.js`를 self-host한다.

**Tech Stack:** Node 24 ESM, `node:test`, `@neon/realtime`, `@neondatabase/serverless`, esbuild, Neon Postgres, Vercel Functions.

**Spec:** `docs/superpowers/specs/2026-11-12-realtime-chat-neon-design.md`

## Global Constraints

- 테이블 `messages`: `id uuid PK default gen_random_uuid()`, `vid uuid not null`, `from_role text check in ('v','o')`, `name text default '방문자' check char_length <= 20`, `contact text check char_length <= 100`, `text text not null check char_length between 1 and 1000`, `ts timestamptz default now()`; 인덱스 `(vid, ts)`; RLS 사용 안 함.
- 방문자당 메시지 최대 200개, 방문자 메시지는 2초에 1개. 오류 코드는 `limit`, `too_fast`.
- 쿠키는 httpOnly, Secure, SameSite=Lax, HMAC 서명. 클라이언트가 보낸 `vid`는 방문자 호출에서 신뢰하지 않는다.
- 브라우저에 공개하는 값은 `NEON_REALTIME_URL`뿐. `NEON_REALTIME_SECRET`, `DATABASE_URL`, `OWNER_PASSWORD`, `SESSION_SECRET`은 서버 환경변수에만 둔다.
- 비밀번호 오류 문구는 "로그인 실패"만 쓴다. 비밀번호 비교는 상수 시간으로 한다.
- 봉인된 쿼리는 URL, 로그, 영구 저장소에 남기지 않는다.
- Neon 프로젝트는 `aws-us-east-1`, `aws-us-east-2`, `aws-eu-central-1`, `aws-ap-southeast-1` 중 하나.
- 사용자에게 보이는 문구는 한국어, 코드·커밋 메시지는 영어.

## Review Focus

- 쿠키가 없거나 변조된 방문자 요청은 새 `vid`를 받고 기존 어떤 대화도 보지 못한다. (Task 2)
- 공백만 있는 본문, 1000자 초과(이모지는 코드포인트 1개로 센다), 21자 이름은 400으로 거부한다. (Task 3)
- 오너가 `vid` 없이, 또는 UUID가 아닌 값으로 보내면 400이다. (Task 4)
- 다른 사이트에서 온 POST(`Origin` 불일치)는 403이다. (Task 4)
- 봉인된 쿼리가 만료되거나 Neon 컴퓨트가 깨어나는 동안에도 UI가 오류가 아닌 "연결 중"으로 남는다. (Task 5)

---

### Task 1: 프로젝트 골격과 Neon 프로비저닝

**Files:**
- Create: `package.json`, `db/schema.sql`, `.env.example`
- Modify: `.gitignore` (줄 추가: `node_modules`, `.env`, `.env.local`)

**Interfaces:**
- Produces: 환경변수 이름 `DATABASE_URL`, `NEON_REALTIME_URL`, `NEON_REALTIME_SECRET`, `OWNER_PASSWORD`, `SESSION_SECRET`; 테이블 `messages`, `owner_login_failures(ip text, ts timestamptz default now())`; npm 스크립트 `test`(`node --test tests/`), `build:vendor`(Task 5에서 정의).

- [ ] **Step 1: Neon 로그인 상태 확인** — `neon --version`, `neon profile list -o json`. 로그인이 안 되어 있으면 사용자에게 `neon login`을 요청하고 멈춘다.
- [ ] **Step 2: 프로젝트 연결** — 지원 리전에 프로젝트를 만들고(`neon link --org-id <id> --project-name portfolio-chat --region-id aws-ap-southeast-1`) 개발용 브랜치를 `neon checkout dev-chat --create`로 만든다. 기존 `.neon` 파일이 있으면 덮어쓰지 않는다.
- [ ] **Step 3: `package.json` 작성** — `"type": "module"`, 의존성 `@neon/realtime`, `@neondatabase/serverless`, 개발 의존성 `esbuild`, 스크립트 `test`. `npm install`.
- [ ] **Step 4: `db/schema.sql` 작성** — Global Constraints의 `messages` 정의, 인덱스, `owner_login_failures` 테이블과 `(ip, ts)` 인덱스. 스키마를 `psql "$DATABASE_URL" -f db/schema.sql`로 적용한다.
- [ ] **Step 5: Realtime 활성화** — `neon realtime enable --allowed-origin http://localhost:3000 --allowed-origin <배포 도메인>`; `neon env pull --service postgres --service realtime`로 `.env.local`을 만들고 `OWNER_PASSWORD`(16자 이상 무작위), `SESSION_SECRET`(32바이트 hex)을 직접 추가한다. `.env.example`에는 키 이름만 쓴다.
- [ ] **Step 6: 쿼리 검증**

Run: `neon realtime subscribe "SELECT id, vid, from_role, name, contact, text, ts FROM messages ORDER BY ts DESC LIMIT 1000"`
Expected: 빈 초기 결과를 출력하고 대기한다. 다른 터미널에서 `psql`로 행 하나를 INSERT하면 변경이 출력된다.

- [ ] **Step 7: Commit** — `git add package.json package-lock.json db .env.example .gitignore && git commit -m "chore: scaffold Neon backend and schema"`

---

### Task 2: 쿠키 세션 라이브러리

**Files:**
- Create: `api/_lib/session.js`
- Test: `tests/session.test.js`

**Interfaces:**
- Produces:
  - `signToken(payload: object, secret: string): string` — `base64url(JSON)` + `.` + `base64url(HMAC-SHA256)`
  - `verifyToken(token: string, secret: string, now?: number): object | null` — 서명 불일치나 `payload.exp`(ms)가 `now` 이하면 `null`
  - `getVisitor(request: Request, secret: string): { vid: string, setCookie: string | null }` — 유효한 `vid` 쿠키가 있으면 그 값과 `null`, 없거나 변조면 새 UUID와 `Set-Cookie` 문자열
  - `ownerCookie(secret: string, now?: number): string` — `Set-Cookie` 문자열, 만료 7일
  - `isOwner(request: Request, secret: string, now?: number): boolean`
  - 쿠키 이름 `pf_vid`, `pf_owner`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/session.test.js`에 다음 테스트 이름과 단언을 둔다.
  - `verifyToken rejects tampered signature`: 서명을 한 글자 바꾸면 `null`.
  - `verifyToken rejects expired token`: `exp`가 지난 토큰은 `null`.
  - `getVisitor reuses a valid cookie`: 첫 호출의 쿠키를 `Cookie` 헤더로 넣으면 같은 `vid`, `setCookie === null`.
  - `getVisitor issues a new vid for a forged cookie`: 다른 비밀키로 서명한 쿠키는 새 `vid`와 `setCookie`가 나온다. 이전 `vid`와 달라야 한다.
  - `getVisitor issues a new vid when no cookie`.
  - `ownerCookie is httpOnly Secure SameSite=Lax`: 문자열에 세 속성이 모두 있다.
  - `isOwner is false for visitor cookie and true for owner cookie`.
- [ ] **Step 2: 실패 확인** — Run: `npm test -- tests/session.test.js` / Expected: FAIL, 모듈 없음.
- [ ] **Step 3: 구현** — `node:crypto`의 `createHmac`, `timingSafeEqual`, `randomUUID` 사용. 서명 비교는 길이가 다르면 `false`를 먼저 반환한 뒤 `timingSafeEqual`.
- [ ] **Step 4: 통과 확인** — Run: `npm test -- tests/session.test.js` / Expected: PASS 7개.
- [ ] **Step 5: Commit** — `git add api/_lib/session.js tests/session.test.js && git commit -m "feat: add signed cookie sessions"`

---

### Task 3: 입력 검증과 DB 계층

**Files:**
- Create: `api/_lib/validate.js`, `api/_lib/db.js`, `api/_lib/queries.js`
- Test: `tests/validate.test.js`, `tests/db.integration.test.js`

**Interfaces:**
- Produces:
  - `parseSend(body: unknown, role: 'v' | 'o'): { ok: true, value: { vid?: string, name: string, contact: string | null, text: string } } | { ok: false, status: 400, code: string }` — `text`는 trim 후 코드포인트 1~1000, `name`은 trim 후 기본 `'방문자'`, 코드포인트 20 이하, `contact`는 빈 문자열이면 `null`, 100 이하. `role === 'o'`이면 `vid`가 UUID 형식이어야 한다.
  - `insertMessage(sql, m: { vid: string, from: 'v' | 'o', name: string, contact: string | null, text: string }): Promise<{ ok: true, txid: string } | { ok: false, code: 'limit' | 'too_fast' }>` — 한 문장의 `INSERT ... SELECT ... WHERE`로 한도 조건을 확인하고 `RETURNING pg_current_xact_id()::text AS txid`. 행이 없으면 두 번째 조회로 `limit`와 `too_fast`를 구분한다. 한도 조건은 방문자(`from === 'v'`)에게만 적용한다.
  - `checkLoginThrottle(sql, ip: string): Promise<boolean>`(최근 10분 실패 5회 이상이면 `false`), `recordLoginFailure(sql, ip: string): Promise<void>`
  - `visitorThreadQuery(vid: string)`, `ownerAllQuery()` — `rawSql` 반환. 컬럼은 Task 1 Step 6과 같고 방문자 쿼리는 `WHERE vid = $1 ORDER BY ts DESC LIMIT 200`.
  - `getSql(): NeonQueryFunction` — `process.env.DATABASE_URL` 사용.

- [ ] **Step 1: 검증 테스트 작성** — `tests/validate.test.js`: `rejects whitespace-only text`, `rejects 1001 code points`, `accepts 1000 emoji as 1000 code points`, `rejects 21-char name`, `defaults empty name to 방문자`, `owner send requires uuid vid`, `visitor send ignores body vid`.
- [ ] **Step 2: 실패 확인** — Run: `npm test -- tests/validate.test.js` / Expected: FAIL.
- [ ] **Step 3: `parseSend` 구현** — 길이는 `[...str].length`로 센다.
- [ ] **Step 4: 통과 확인** — Run: `npm test -- tests/validate.test.js` / Expected: PASS.
- [ ] **Step 5: DB 통합 테스트 작성** — `tests/db.integration.test.js`는 `DATABASE_URL`이 없으면 skip한다. 테스트마다 새 UUID를 쓰고 끝나면 정리한다: `inserts and returns txid`, `visitor second message within 2s returns too_fast`, `visitor 201st message returns limit`, `owner reply is not rate limited`, `login throttle blocks after 5 failures`.
- [ ] **Step 6: 실패 확인** — Run: `npm test -- tests/db.integration.test.js` / Expected: FAIL.
- [ ] **Step 7: 구현** — `@neondatabase/serverless`의 `neon()`을 쓰고, 개발 브랜치(`.env.local`의 `DATABASE_URL`)에서 실행한다.
- [ ] **Step 8: 통과 확인** — Run: `node --env-file=.env.local --test tests/db.integration.test.js` / Expected: PASS 5개.
- [ ] **Step 9: Commit** — `git add api/_lib tests && git commit -m "feat: add validation and message queries"`

---

### Task 4: API 엔드포인트

**Files:**
- Create: `api/_lib/http.js`, `api/live.js`, `api/send.js`, `api/owner/login.js`, `api/owner/session.js`
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: Task 2의 `getVisitor`, `isOwner`, `ownerCookie`; Task 3의 `parseSend`, `insertMessage`, `checkLoginThrottle`, `recordLoginFailure`, `visitorThreadQuery`, `ownerAllQuery`, `getSql`.
- Produces: 각 파일은 `export async function POST(request: Request): Promise<Response>`(`session.js`는 `GET`).
  - `api/_lib/http.js`: `json(status, body, setCookie?): Response`, `sameOrigin(request): boolean`(`Origin` 헤더가 있고 요청 호스트와 다르면 `false`), `makeRealtime()`(`createRealtime`, 비밀키·DB 이름은 환경변수에서).
  - `POST /api/live` body `{ scope?: 'owner' }` → `200 { sealed, vid? }`. `scope: 'owner'`인데 오너가 아니면 `401`.
  - `POST /api/send` body `{ name?, contact?, text, vid? }` → `200 { kind: 'committed', txid }`, 한도 초과는 `429 { error: 'limit' | 'too_fast' }`, 검증 실패는 `400 { error }`.
  - `POST /api/owner/login` body `{ password }` → `200`과 `Set-Cookie`, 틀리면 `401 { error: 'login_failed' }`, 제한 초과면 `429`.
  - `GET /api/owner/session` → `200 { owner: boolean }`.
  - 모든 POST는 `sameOrigin`이 거짓이면 `403`.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/api.test.js`는 `Request` 객체로 핸들러를 직접 호출하고 `getSql`과 `makeRealtime`은 주입 가능한 의존성으로 대체한다. 테스트 이름: `live returns sealed visitor query and sets vid cookie`, `live owner scope without owner cookie is 401`, `send as visitor uses cookie vid not body vid`, `send as owner without vid is 400`, `send as owner with non-uuid vid is 400`, `send with foreign Origin is 403`, `send returns 429 too_fast`, `login with wrong password is 401 login_failed`, `login with correct password sets owner cookie`, `login is 429 after 5 failures`, `session reports owner true only with owner cookie`.
- [ ] **Step 2: 실패 확인** — Run: `npm test -- tests/api.test.js` / Expected: FAIL.
- [ ] **Step 3: 구현** — 각 핸들러는 `sameOrigin` → 신원 확인 → 검증 → DB 순서. 방문자의 `vid`는 `getVisitor`에서만 얻는다. 비밀번호 비교는 두 값을 SHA-256으로 해시한 뒤 `timingSafeEqual`.
- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 모든 테스트 PASS.
- [ ] **Step 5: 로컬 확인** — `vercel dev`(또는 `npx vercel dev`)를 `.env.local`로 실행하고 `curl -i -X POST localhost:3000/api/live -H 'content-type: application/json' -d '{}'`로 `Set-Cookie: pf_vid=...`와 `sealed` 필드를 확인한다.
- [ ] **Step 6: Commit** — `git add api tests && git commit -m "feat: add live, send and owner login endpoints"`

---

### Task 5: 클라이언트 저장소 `neonStore`

**Files:**
- Create: `scripts/vendor-entry.js`, `vendor/neon-realtime.js`(빌드 산출물, 커밋한다)
- Modify: `package.json`(`build:vendor` 스크립트), `index.html`(`CHAT_CONFIG`와 설명 주석 `:490-549`, `supabaseStore`와 `initStore` `:872-953`)

**Interfaces:**
- Consumes: Task 4의 엔드포인트 계약.
- Produces: `neonStore(): Store` — 기존 `demoStore`와 같은 인터페이스(`mode: "neon"`, `needsLogin: true`, `onStatus`, `visitorId`, `restore`, `login`, `watchThread`, `watchAll`, `send`, `markSeen`). `CHAT_CONFIG = { realtimeUrl: "" }`. `initStore()`는 `realtimeUrl`이 비어 있으면 기존처럼 로컬은 `demoStore`, 배포본은 `offlineStore("not-configured")`, 모듈 로드나 `/api/live` 호출이 실패하면 `offlineStore("load-failed")`.

- [ ] **Step 1: 번들 작성** — `scripts/vendor-entry.js`에서 `createRealtimeClient`를 re-export하고, `build:vendor`를 `esbuild scripts/vendor-entry.js --bundle --format=esm --minify --outfile=vendor/neon-realtime.js`로 정의한다. 실행해서 산출물을 만든다. 클라이언트 API(`subscribe`, `getSnapshot`, `onChange`, `onStateChange`, `renew`)는 `neon-realtime` 스킬의 `references/subscribing.md`를 읽고 쓴다.
- [ ] **Step 2: `neonStore` 구현** — 각 메서드의 동작:
  - `visitorId()`: `POST /api/live`를 호출해 쿠키를 받고 `vid`를 반환한다.
  - `watchThread(vid, cb)`: `/api/live`로 받은 봉인 쿼리를 구독하고 행을 `{id, vid, from, name, contact, text, ts}`로 변환해 `ts` 오름차순으로 `cb`에 넘긴다. `ts`는 `new Date(r.ts).getTime()`.
  - `watchAll(cb)`: `{scope:'owner'}`로 봉인 쿼리를 받아 기존 `supabaseStore.watchAll`과 같은 트리(`{[vid]: {meta, messages}}`)를 만든다.
  - `send(vid, from, name, text, contact)`: `/api/send` 호출, 응답의 `txid`를 `awaitTxId(txid, 10000)`로 기다린다. `429`의 `too_fast`와 `limit`은 기존 한국어 문구를 쓴다.
  - `restore()`는 `GET /api/owner/session`이 `owner:false`면 throw, `login(email, pw)`는 `pw`만 `/api/owner/login`에 보낸다(이메일 입력은 UI에서 제거).
  - `onStatus`: 구독 상태가 `SUBSCRIBED` 계열이면 `"live"`, 오류면 `"error"`, 그 외(최초 연결, 컴퓨트 깨우는 중 포함)는 `"connecting"`.
  - 봉인 쿼리 만료 시 `refreshQuery`로 `/api/live`를 다시 호출한다. 오류 상태가 되면 새 봉인 쿼리로 새 구독을 만든다.
- [ ] **Step 3: 교체와 정리** — `index.html`에서 `supabaseStore`, Supabase 로더 상수, Supabase SQL 안내 주석을 제거하고 Neon 설정 안내(환경변수 5개, 스키마 파일 위치)로 바꾼다. 오너 로그인 폼의 이메일 입력을 비밀번호 하나로 줄인다. `loadScript` 대신 `import("./vendor/neon-realtime.js")`를 쓴다.
- [ ] **Step 4: 데모 모드 회귀 확인** — `CHAT_CONFIG.realtimeUrl`을 비운 채 로컬에서 열어 기존 데모 모드가 그대로 동작하는지 확인한다(방문자 탭과 `#admin` 탭).
- [ ] **Step 5: Commit** — `git add scripts vendor package.json index.html && git commit -m "feat: replace Supabase store with Neon Realtime store"`

---

### Task 6: 종단 간 검증과 배포

**Files:**
- Modify: `README.md`(설정 순서와 환경변수 5개), `index.html`(`CHAT_CONFIG.realtimeUrl` 값)

**Interfaces:**
- Consumes: 전 단계.

- [ ] **Step 1: 로컬 종단 간 확인** — `vercel dev`로 띄우고 브라우저 두 탭(방문자, `#admin`)을 열어 다음을 확인한다.
  - 방문자 메시지가 오너 화면에 새로고침 없이 나타난다.
  - 오너 답장이 방문자 화면에 나타난다.
  - 방문자 탭을 닫았다 다시 열어도 같은 대화가 이어진다.
  - 시크릿 창(다른 방문자)에서는 이전 대화가 보이지 않는다.
  - 틀린 비밀번호는 "로그인 실패", 5회 실패 후에는 제한 문구가 나온다.
  - 연속 전송은 2초 제한 문구가 나온다.
- [ ] **Step 2: 오류 경로 확인** — `NEON_REALTIME_URL`을 잘못된 값으로 바꿔 "준비 중" 안내와 입력 차단을 확인하고 되돌린다.
- [ ] **Step 3: 문서** — `README.md`에 Neon 설정 순서와 환경변수 5개(값은 쓰지 않는다)를 적는다. `CHAT_CONFIG.realtimeUrl`에 `.env.local`의 `NEON_REALTIME_URL` 값을 넣는다(공개 값).
- [ ] **Step 4: 배포 전 사용자 확인** — 배포는 외부에 공개되는 작업이므로 환경변수 등록(`vercel env add`)과 `vercel --prod`를 실행하기 전에 사용자에게 승인을 받는다. `neon realtime enable --allowed-origin`에 실제 배포 도메인이 들어 있는지도 확인한다.
- [ ] **Step 5: 배포 후 확인** — 배포 도메인에서 Step 1의 첫 두 항목을 다시 확인한다.
- [ ] **Step 6: Commit** — `git add README.md index.html && git commit -m "docs: document Neon chat setup"`
