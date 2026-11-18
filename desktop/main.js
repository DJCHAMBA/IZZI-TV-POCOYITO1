const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const ALLOWED_STREAMS = [
  { host: '15.204.142.109', port: '22880', prefix: '/TELEVISA-PROVEEDOR-DISTRITO-COMEDIA/' },
  { host: '45.5.57.58', port: '8000', prefix: '/play/a07n/' },
  { host: '138.121.15.230', port: '9002', prefix: '/DISTRITO-COMEDIA/' },
  { host: '190.61.47.54', port: '8000', prefix: '/play/a028/' }
];
function isAllowedStream(url) {
  return url.protocol === 'http:' && ALLOWED_STREAMS.some(rule =>
    url.hostname === rule.host && url.port === rule.port && url.pathname.startsWith(rule.prefix)
  );
}
const LOCAL_PORT = 18787;
let proxyServer;

function startLocalProxy() {
  if (proxyServer) return Promise.resolve();
  proxyServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end('Method not allowed'); }

    let target;
    try { target = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); return res.end('Bad request'); }
    if (target.pathname !== '/hls') { res.writeHead(404); return res.end('Not found'); }

    let upstream;
    try { upstream = new URL(target.searchParams.get('u') || ''); } catch { res.writeHead(400); return res.end('Invalid stream URL'); }
    if (!isAllowedStream(upstream)) {
      res.writeHead(403); return res.end('Stream host/path not allowed');
    }

    const headers = {
      'User-Agent': 'VLC/3.0.23 LibVLC/3.0.23',
      'Accept': '*/*',
      'Accept-Language': 'es_MX',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive'
    };
    if (req.headers.range) headers.Range = req.headers.range;
    else if (upstream.pathname.endsWith('/index.m3u8')) headers.Range = 'bytes=0-';

    const upstreamReq = http.request({
      hostname: upstream.hostname, port: Number(upstream.port),
      path: upstream.pathname + upstream.search, method: req.method, headers, timeout: 25000
    }, upstreamRes => {
      const status = upstreamRes.statusCode || 502;
      const type = String(upstreamRes.headers['content-type'] || '');
      const isPlaylist = /mpegurl|\.m3u8/i.test(type) || upstream.pathname.toLowerCase().endsWith('.m3u8');
      res.statusCode = isPlaylist ? 200 : status;
      if (!isPlaylist) {
        for (const key of ['content-range', 'accept-ranges', 'last-modified', 'etag']) {
          if (upstreamRes.headers[key]) res.setHeader(key, upstreamRes.headers[key]);
        }
      }
      if (isPlaylist) {
        const chunks = [];
        upstreamRes.on('data', chunk => chunks.push(chunk));
        upstreamRes.on('end', () => {
          let playlistBuffer = Buffer.concat(chunks);
          const encoding = String(upstreamRes.headers['content-encoding'] || '').toLowerCase();
          try {
            if (encoding.includes('gzip')) playlistBuffer = zlib.gunzipSync(playlistBuffer);
            else if (encoding.includes('deflate')) playlistBuffer = zlib.inflateSync(playlistBuffer);
            else if (encoding.includes('br')) playlistBuffer = zlib.brotliDecompressSync(playlistBuffer);
          } catch (decodeError) {
            console.error('No se pudo descomprimir playlist HLS:', decodeError);
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('No se pudo descomprimir la lista HLS');
          }
          let playlist = playlistBuffer.toString('utf8').replace(/^\\uFEFF/, '').trim();
          const rewrite = value => {
            const raw = String(value || '').trim();
            if (!raw || raw.startsWith('#')) return raw;
            try {
              const absolute = new URL(raw, upstream);
              if (!isAllowedStream(absolute)) return raw;
              return 'http://127.0.0.1:' + LOCAL_PORT + '/hls?u=' + encodeURIComponent(absolute.href);
            } catch { return raw; }
          };
          playlist = playlist.split(/\r?\n/).map(line => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (trimmed.startsWith('#')) {
              return line.replace(/URI="([^"]+)"/g, (_, uri) => 'URI="' + rewrite(uri) + '"');
            }
            return rewrite(trimmed);
          }).join('\n');
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(playlist);
        });
      } else {
        if (upstreamRes.headers['content-type']) res.setHeader('Content-Type', upstreamRes.headers['content-type']);
        if (upstreamRes.headers['content-length']) res.setHeader('Content-Length', upstreamRes.headers['content-length']);
        upstreamRes.pipe(res);
      }
    });
    upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('Upstream timeout')));
    upstreamReq.on('error', err => {
      if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Upstream error: ' + err.message); }
      else res.destroy(err);
    });
    if (req.method === 'HEAD') upstreamReq.end(); else req.pipe(upstreamReq);
  });
  return new Promise((resolve, reject) => {
    proxyServer.once('error', reject);
    proxyServer.listen(LOCAL_PORT, '127.0.0.1', () => {
      proxyServer.removeListener('error', reject);
      console.log('Pocoyito local IPTV proxy listening on 127.0.0.1:' + LOCAL_PORT);
      resolve();
    });
  });
}

function stopLocalProxy() {
  if (proxyServer) { proxyServer.close(); proxyServer = null; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#080b16', title: 'izzi TV Pocoyito', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'web', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}
app.whenReady().then(async () => {
  try { await startLocalProxy(); }
  catch (error) { console.error('No se pudo iniciar el proxy IPTV local:', error); }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', stopLocalProxy);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
