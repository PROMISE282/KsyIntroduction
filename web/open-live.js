const LIVE_TIMEOUT_MS = 15000;
const RENEW_EARLY_MS = 10000;
const MIN_RENEW_MS = 5000, MAX_RENEW_MS = 45000;

// expiresAt 은 서버 시계 기준이라 클라이언트 시계가 어긋나면 지연이 0이 되거나 만료 뒤로 밀린다. 5~45초로 제한한다
const renewDelay = expiresAt => Math.min(MAX_RENEW_MS, Math.max(MIN_RENEW_MS, expiresAt - Date.now() - RENEW_EARLY_MS));

// 봉인된 쿼리를 구독한다. 만료 전에 갱신하고, 오류가 나면 새 쿼리로 다시 구독한다.
// getClient(): 공유 Realtime 클라이언트, dropClient(used): 그 클라이언트가 아직 현재 것이면 닫기, report(status): "connecting" | "live" | "error"
export function createLiveOpener({ getClient, dropClient, report }) {
  const active = new Set();

  function openLive(fetchSealed, onRows) {
    let sub = null, used = null, fingerprint = null, renewTimer = null, retryTimer = null, watchdog = null, dead = false, failures = 0, renewFails = 0;
    const say = s => { if (!dead) report(s); };
    const stop = () => { clearTimeout(renewTimer); clearTimeout(watchdog); if (sub) { active.delete(sub); try { sub.unsubscribe(); } catch {} sub = null; } };
    const retry = () => {
      stop();
      dropClient(used);
      failures++;
      say(failures >= 3 ? "error" : "connecting");
      if (!dead) retryTimer = setTimeout(start, Math.min(3000 * failures, 30000));
    };
    const renewIn = delay => {
      clearTimeout(renewTimer);
      renewTimer = setTimeout(async () => {
        if (dead || !sub) return;
        try {
          const next = await fetchSealed();
          if (dead || !sub) return;
          // 다른 쿼리(예: 쿠키의 vid 가 바뀜)로 봉인되면 renew 는 거부되므로 새 쿼리로 처음부터 구독한다
          if (next.queryFingerprint !== fingerprint) { stop(); return start(next); }
          await sub.renew(next); renewFails = 0; renewIn(renewDelay(next.expiresAt));
        } catch { renewIn(Math.min(1000 * ++renewFails, 15000)); }
      }, delay);
    };
    async function start(prefetched) {
      if (dead) return;
      let sealed = prefetched;
      if (!sealed) { try { sealed = await fetchSealed(); } catch { return retry(); } }
      if (dead) return;
      fingerprint = sealed.queryFingerprint;
      used = getClient();
      sub = used.subscribe(sealed);
      active.add(sub);
      say("connecting");
      watchdog = setTimeout(retry, LIVE_TIMEOUT_MS);   // 상태 이벤트 없이 연결 중에 멈춰 있는 경우도 재시도로 이어지게 한다
      sub.onChange(snap => { if (snap.data) onRows(snap.data); });
      sub.onStateChange(st => {
        if (st.status === "error") retry();
        else if (st.status === "live") { clearTimeout(watchdog); failures = 0; say("live"); }
        else if (st.status === "connecting" || st.status === "stale") say("connecting");
      });
      renewIn(renewDelay(sealed.expiresAt));
    }
    start();
    return () => { dead = true; clearTimeout(retryTimer); stop(); };
  }

  return { openLive, active };
}
