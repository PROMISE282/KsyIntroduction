# MySite

포트폴리오 사이트(`https://ksyintroduction.vercel.app/`)와 실시간 메시지 기능입니다. 메시지는 Neon Realtime과 Vercel Functions(`api/`)로 동작합니다.

- 설계: `docs/superpowers/specs/2026-11-12-realtime-chat-neon-design.md`
- 구현 계획: `docs/superpowers/plans/2026-11-12-realtime-chat-neon.md`

## 구조

- 방문자는 로그인 없이 쓰고, 서버가 서명한 `pf_vid` 쿠키로 같은 대화가 이어집니다.
- 오너는 주소 끝에 `#admin`을 붙여 비밀번호로 로그인합니다(`pf_owner` 쿠키, 7일).
- 브라우저는 `POST /api/live`로 봉인된 쿼리를 받아 Neon Realtime에 구독하고, 보내기는 `POST /api/send`로 합니다.
- Realtime 클라이언트는 `vendor/neon-realtime.js`(esbuild 번들)를 self-host합니다. SDK를 올리면 `npm run build:vendor`로 다시 만들어 커밋하세요.

## 환경변수

| 이름 | 위치 | 설명 |
|---|---|---|
| `DATABASE_URL` | 서버 전용 | Neon Postgres 연결 문자열 |
| `NEON_REALTIME_SECRET` | 서버 전용 | 쿼리 봉인 키 |
| `NEON_REALTIME_URL` | 공개 | `index.html`의 `CHAT_CONFIG.realtimeUrl`에 직접 입력 |
| `OWNER_PASSWORD` | 서버 전용 | 오너 로그인 비밀번호(16자 이상 무작위 권장) |
| `SESSION_SECRET` | 서버 전용 | 쿠키 서명 키(`openssl rand -hex 32`) |

### 답장 메일(선택)

오너가 보낸 답장을 방문자가 남긴 이메일로도 보냅니다. 아래 값이 모두 있어야 켜지고, 없으면 채팅만 동작합니다. 메일 발송이 실패해도 메시지는 저장됩니다.

| 이름 | 설명 |
|---|---|
| `SMTP_HOST` / `SMTP_PORT` | SMTP 서버. Gmail은 `smtp.gmail.com` / `465` |
| `SMTP_USER` / `SMTP_PASS` | 계정과 비밀번호. Gmail은 2단계 인증을 켠 뒤 만든 **앱 비밀번호** |
| `MAIL_FROM` | (선택) 보내는 주소. 기본값은 `SMTP_USER` |
| `MAIL_REPLY_TO` | (선택) 방문자가 메일에 답장할 때 받을 주소. 기본값은 `SMTP_USER` |

`.env.example`에 이름만 있습니다. 값은 `.env.local`(git 무시)이나 Vercel 환경변수에 넣습니다.

## 설정 순서

1. Neon 프로젝트를 지원 리전(`aws-us-east-1`, `aws-us-east-2`, `aws-eu-central-1`, `aws-ap-southeast-1`)에 만들고 연결합니다: `neon link`
2. 스키마를 적용합니다: `psql "$DATABASE_URL" -f db/schema.sql` (`messages`, `owner_login_failures`)
3. Realtime을 켭니다: `neon realtime enable --allowed-origin http://localhost:3000 --allowed-origin https://<배포 도메인>`
4. `neon env pull --service postgres --service realtime`으로 `.env.local`을 만들고 `OWNER_PASSWORD`, `SESSION_SECRET`을 추가합니다.
5. `NEON_REALTIME_URL` 값을 `index.html`의 `CHAT_CONFIG.realtimeUrl`에 넣습니다.

Neon 브랜치마다 Realtime 주소가 다릅니다. 개발 브랜치로 확인한 뒤 배포용(운영) 브랜치에도 3번을 하고, 그 브랜치의 주소와 환경변수를 배포에 사용하세요.

## 로컬 실행과 테스트

```bash
# vercel dev는 .env.local을 함수에 넘기지 않으므로 환경변수로 내보내 실행합니다
set -a; . ./.env.local; set +a; vercel dev --listen 3000
npm test
```

`CHAT_CONFIG.realtimeUrl`이 비어 있으면 로컬에서는 같은 브라우저 안에서만 도는 데모 모드로, 배포본에서는 "준비 중" 안내로 동작합니다.
