// Thin helpers around PeerJS (loaded as a global from the CDN).
export const PREFIX = 'avalon-party-v1-'; // namespace on the shared PeerJS broker
export const HEARTBEAT_MS = 4000;
export const STALE_MS = 14000;

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode(len = 5) {
  const a = new Uint32Array(len); crypto.getRandomValues(a);
  return [...a].map((x) => ALPHA[x % ALPHA.length]).join('');
}
export function randomToken() {
  const a = new Uint8Array(12); crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

// Optional self-hosted PeerJS server; blank = PeerJS's free public broker.
export function peerOptions(p) {
  const o = { debug: 1 };
  if (p && p.host) {
    o.host = p.host;
    if (p.port) o.port = Number(p.port);
    if (p.path) o.path = p.path;
    o.secure = !!p.secure;
  }
  return o;
}
export function peerToQuery(p, q) {
  if (!p || !p.host) return;
  q.set('ph', p.host);
  if (p.port) q.set('pp', p.port);
  if (p.path) q.set('pa', p.path);
  q.set('ps', p.secure ? '1' : '0');
}
export function peerFromQuery(q) {
  if (!q.get('ph')) return null;
  return { host: q.get('ph'), port: q.get('pp') || '', path: q.get('pa') || '', secure: q.get('ps') !== '0' };
}

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// Keep the screen on while the tab is open (host phone especially).
export function keepAwake() {
  let lock = null;
  const req = async () => {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch {}
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') req(); });
  document.addEventListener('click', () => { if (!lock || lock.released) req(); }, { passive: true });
  req();
}
