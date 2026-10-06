// Cloudflare Worker: BitChord addon for Qobuz. Outputs FLAC lossless metadata. ponytail: no cache, add KV if Qobuz rate-limits.
// Env secrets: QOBUZ_APP_ID, QOBUZ_APP_SECRET, optional QOBUZ_USER_TOKEN.

const MANIFEST = {
  id: "nareida.qobuz-addon",
  name: "Qobuz Lossless",
  version: "1.0.0",
  resources: ["search", "stream"],
};

const API = "https://www.qobuz.com/api.json/0.2";
const FORMAT_FLAC = 27;

const json = (v, s = 200) =>
  new Response(JSON.stringify(v), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function md5Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = new Uint32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
  const ml = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 8) >> 6 << 6) + 64);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, ml >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(ml / 2 ** 32), true);
  const M = new Uint32Array(padded.buffer);
  let [a, b, c, d] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let i = 0; i < M.length; i += 16) {
    const [A, B, C, D] = [a, b, c, d];
    for (let j = 0; j < 64; j++) {
      let f, g;
      if (j < 16) { f = (B & C) | (~B & D); g = j; }
      else if (j < 32) { f = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { f = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { f = C ^ (B | ~D); g = (7 * j) % 16; }
      const tmp = D; D = C; C = B;
      const sh = S[(Math.floor(j / 16) * 4) + (j % 4)];
      B = (B + (((a + f + K[j] + M[i + g]) | 0) << sh | ((a + f + K[j] + M[i + g]) | 0) >>> (32 - sh))) | 0;
      a = tmp;
    }
    a = (a + A) | 0; b = (b + B) | 0; c = (c + C) | 0; d = (d + D) | 0;
  }
  const out = new Uint8Array(16);
  const vd = new DataView(out.buffer);
  [a, b, c, d].forEach((x, i) => vd.setUint32(i * 4, x >>> 0, true));
  return [...out].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function signRequestParams(trackId, formatId, appId, appSecret) {
  const ts = Math.floor(Date.now() / 1000);
  const canonical = `trackgetFileUrlformat_id${formatId}intentstreamtrack_id${trackId}request_ts${ts}request_app${appId}${appSecret}`;
  return { format_id: formatId, intent: "stream", track_id: String(trackId), request_ts: String(ts), request_sig: md5Hex(canonical) };
}

export default {
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/manifest.json") return json(MANIFEST);

    const appId = env.QOBUZ_APP_ID;
    const appSecret = env.QOBUZ_APP_SECRET;
    const userToken = env.QOBUZ_USER_TOKEN;
    if (!appId || !appSecret) return json({ error: "missing app creds" }, 500);

    if (url.pathname === "/search") {
      const q = url.searchParams.get("q");
      if (!q) return json({ tracks: [] });
      const r = await fetch(
        `${API}/catalog/search?query=${encodeURIComponent(q)}&limit=15&offset=0`,
        { headers: { "x-app-id": appId, ...(userToken ? { "x-user-auth-token": userToken } : {}) } }
      );
      if (!r.ok) return json({ error: "qobuz search failed" }, 502);
      const data = await r.json();
      const tracks = (data?.tracks?.items ?? []).map((t) => ({
        id: String(t.id),
        title: t.title,
        artist: t.performer?.name ?? t.artist?.name ?? "",
        album: t.album?.title ?? "",
        duration: t.duration,
        artworkURL: t.album?.image?.large ?? t.album?.image?.small ?? "",
        format: "flac",
        audioQuality: "LOSSLESS",
      }));
      return json({ tracks });
    }

    if (url.pathname.startsWith("/stream/")) {
      const trackId = url.pathname.slice(8);
      const formatId = parseInt(url.searchParams.get("format") ?? FORMAT_FLAC, 10);
      const params = await signRequestParams(trackId, formatId, appId, appSecret);
      const r = await fetch(`${API}/track/getFileUrl?${new URLSearchParams(params)}`, {
        headers: { "x-app-id": appId, ...(userToken ? { "x-user-auth-token": userToken } : {}) },
      });
      if (!r.ok) return json({ error: "qobuz stream failed" }, 502);
      const data = await r.json();
      if (!data?.url) return json({ error: "no stream url" }, 404);
      const isFlac = (data.mime_type ?? "").includes("flac") || formatId === FORMAT_FLAC;
      return json({
        url: data.url,
        codec: isFlac ? "flac" : "flac",
        container: "flac",
        manifest: "none",
        encrypted: false,
        sampleRate: data.sample_rate ?? 44100,
        bitDepth: data.bit_depth ?? 16,
      });
    }

    return json({ error: "not found" }, 404);
  },
};
