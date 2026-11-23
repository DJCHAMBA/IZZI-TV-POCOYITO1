/**
 * Pocoyito IPTV HTTPS relay (Cloudflare Worker)
 * Deploy this file as a Worker, then paste its https://...workers.dev URL
 * into the Laboratorio IPTV "Proxy HTTPS" field.
 *
 * Security: only the host(s) listed below can be fetched. Add hosts you trust.
 */
const ALLOWED_HOSTS = new Set([
  "45.5.118.152"
]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges"
};

function proxyUrl(workerUrl, target) {
  const u = new URL(workerUrl);
  u.search = "";
  u.searchParams.set("url", target);
  return u.toString();
}
function allowed(target) {
  try {
    const u = new URL(target);
    return u.protocol === "http:" && ALLOWED_HOSTS.has(u.hostname);
  } catch { return false; }
}
export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const target = incoming.searchParams.get("url");
    if (!target || !allowed(target)) {
      return new Response("URL no permitida. Revisa ALLOWED_HOSTS en el Worker.", {
        status: 403, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" }
      });
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Método no permitido", { status: 405, headers: CORS });
    }
    const headers = new Headers();
    const range = request.headers.get("Range");
    if (range) headers.set("Range", range);
    headers.set("User-Agent", "Mozilla/5.0 PocoyitoIPTV/1.0");
    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers,
        redirect: "follow"
      });
    } catch (e) {
      return new Response("Error conectando al origen: " + e.message, {
        status: 502, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" }
      });
    }
    const type = upstream.headers.get("Content-Type") || "";
    const looksPlaylist = /mpegurl/i.test(type) || /\.m3u8?(?:$|[?#])/i.test(new URL(target).pathname);
    const outHeaders = new Headers(CORS);
    for (const key of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Cache-Control", "Last-Modified", "ETag"]) {
      const value = upstream.headers.get(key);
      if (value) outHeaders.set(key, value);
    }
    if (looksPlaylist && request.method === "GET" && upstream.ok) {
      const body = await upstream.text();
      const rewritten = body.split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith("#")) {
          return line.replace(/URI="([^"]+)"/g, (_, uri) => {
            const absolute = new URL(uri, target).toString();
            return 'URI="' + proxyUrl(request.url, absolute) + '"';
          });
        }
        const absolute = new URL(trimmed, target).toString();
        return proxyUrl(request.url, absolute);
      }).join("\n");
      outHeaders.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      outHeaders.delete("Content-Length");
      outHeaders.set("Cache-Control", "no-store");
      return new Response(rewritten, { status: upstream.status, headers: outHeaders });
    }
    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  }
};