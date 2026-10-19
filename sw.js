// 아봄네 여행 사이트 오프라인용 서비스워커
// - 페이지(index.html): 인터넷 되면 새 버전, 안 되면 저장본 (암호화된 페이지 그대로 저장)
// - 사진·지도 라이브러리·글꼴: 한 번 받으면 저장해 두고 다시 씀
// - 지도 타일: 본 곳은 자동 저장, '오프라인 저장' 버튼으로 일정 주변을 미리 저장
const VER = '2610192226';
const PAGE = 'page-' + VER, ASSET = 'asset-' + VER, TILE = 'tile-v1';
const CORE = ['./', './index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(PAGE).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![PAGE, ASSET, TILE].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isTile = u => u.hostname === 'server.arcgisonline.com';
const isAsset = u => /\/images\//.test(u.pathname) || ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname);

async function networkFirst(req) {
  const c = await caches.open(PAGE);
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(req, { signal: ctl.signal, cache: 'no-cache' }); clearTimeout(t);
    if (res.ok) c.put('./index.html', res.clone());
    return res;
  } catch (e) {
    return (await c.match('./index.html')) || (await c.match('./')) || new Response('오프라인이에요. 인터넷이 될 때 한 번 열어 두면 다음부터는 오프라인에서도 열려요.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
async function cacheFirst(req, name, cors) {
  const c = await caches.open(name);
  const hit = await c.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(cors ? new Request(req.url, { mode: 'cors' }) : req);
    if (res.ok) c.put(req.url, res.clone());
    return res;
  } catch (e) {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (req.mode === 'navigate' || (u.origin === location.origin && /\/(index\.html)?$/.test(u.pathname))) return e.respondWith(networkFirst(req));
  if (isTile(u)) return e.respondWith(cacheFirst(req, TILE, true));
  if (isAsset(u) || (u.origin === location.origin && /\.(png|json)$/.test(u.pathname))) return e.respondWith(cacheFirst(req, ASSET, u.origin !== location.origin));
});

// 페이지에서 '오프라인 저장' 요청: { type: 'precache', assets: [...], tiles: [...] }
self.addEventListener('message', e => {
  const m = e.data || {}; if (m.type !== 'precache') return;
  const src = e.source;
  e.waitUntil((async () => {
    const jobs = [...(m.assets || []).map(u => [ASSET, u]), ...(m.tiles || []).map(u => [TILE, u])];
    const ca = await caches.open(ASSET), ct = await caches.open(TILE);
    let done = 0, fail = 0;
    const q = jobs.slice();
    async function worker() {
      while (q.length) {
        const [name, url] = q.shift();
        const c = name === ASSET ? ca : ct;
        try {
          if (!(await c.match(url))) {
            const res = await fetch(new Request(url, { mode: new URL(url, location.href).origin === location.origin ? 'same-origin' : 'cors' }));
            if (res.ok) await c.put(url, res); else fail++;
          }
        } catch (err) { fail++; }
        done++;
        if (done % 10 === 0 || done === jobs.length) src && src.postMessage({ type: 'progress', done, total: jobs.length, fail });
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    src && src.postMessage({ type: 'done', total: jobs.length, fail });
  })());
});
