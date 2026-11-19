const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const zlib = require('zlib');

const ALLOWED_STREAMS = [
  { host: '15.204.142.109', port: '22880', prefix: '/TELEVISA-PROVEEDOR-DISTRITO-COMEDIA/' },
  { host: '187.245.231.226', port: '8000', prefix: '/play/a0uz/' },
  // Canal 5 México: permitir únicamente sus rutas HLS /play/ a través del relay local.
  { host: '45.5.118.152', port: '8000', prefix: '/play/' },
];
function isAllowedStream(url) {
  return url.protocol === 'http:' && ALLOWED_STREAMS.some(rule =>
    url.hostname === rule.host && url.port === rule.port && url.pathname.startsWith(rule.prefix)
  );
}
const LOCAL_PORT = 18787;
let transcodeProcess = null;
let transcodeDir = null;
let proxyServer;

function writeProxyLog(message) {
  try {
    const logPath = path.join(app.getPath('userData'), 'pocoyito-local-proxy.log');
    fs.appendFileSync(logPath, new Date().toISOString() + ' ' + message + '\\n', 'utf8');
  } catch (error) {
    console.error('No se pudo escribir el log del proxy:', error);
  }
}

function findFfmpeg() {
  if (process.env.POCOYITO_FFMPEG && fs.existsSync(process.env.POCOYITO_FFMPEG)) return process.env.POCOYITO_FFMPEG;
  if (process.platform === 'win32') {
    try {
      const found = execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
        .split(/\r?\n/).map(x => x.trim()).find(x => x && fs.existsSync(x));
      if (found) return found;
    } catch {}
  }
  return 'ffmpeg';
}

function startDistritoTranscode(sourceUrl) {
  if (transcodeProcess && transcodeProcess.exitCode === null) return;
  if (transcodeProcess) { try { transcodeProcess.kill(); } catch {} transcodeProcess = null; }
  if (transcodeDir) { try { fs.rmSync(transcodeDir, { recursive: true, force: true }); } catch {} }
  transcodeDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'pocoyito-distrito-'));
  const ffmpeg = findFfmpeg();
  const output = path.join(transcodeDir, 'index.m3u8');
  const headers = 'Accept: */*\r\nAccept-Language: es_MX\r\n';
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-nostdin', '-y',
    '-user_agent', 'VLC/3.0.23 LibVLC/3.0.23',
    '-headers', headers,
    '-i', sourceUrl,
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
    '-f', 'hls', '-hls_time', '6', '-hls_list_size', '8',
    '-hls_flags', 'delete_segments+append_list+independent_segments+omit_endlist',
    '-hls_segment_filename', path.join(transcodeDir, 'seg_%06d.ts'),
    output
  ];
  writeProxyLog('Iniciando FFmpeg para Distrito Comedia: ' + ffmpeg);
  transcodeProcess = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  transcodeProcess.stderr.on('data', chunk => writeProxyLog('FFmpeg: ' + chunk.toString().trim()));
  transcodeProcess.on('error', error => writeProxyLog('FFmpeg no pudo arrancar: ' + (error.stack || error.message)));
  transcodeProcess.on('exit', (code, signal) => {
    writeProxyLog('FFmpeg terminó. code=' + code + ' signal=' + signal);
  });
}

async function handleTranscodeRequest(route, res) {
  const isIndex = route === '/transcode/index.m3u8';
  const segmentName = route.startsWith('/transcode/') ? route.slice(11) : '';
  const segmentDigits = segmentName.startsWith('seg_') && segmentName.endsWith('.ts')
    ? segmentName.slice(4, -3) : '';
  const isSegment = segmentDigits.length > 0 && [...segmentDigits].every(ch => ch >= '0' && ch <= '9');
  if (!isIndex && !isSegment) {
    res.writeHead(404); return res.end('Not found');
  }
  const sourceUrl = 'http://15.204.142.109:22880/TELEVISA-PROVEEDOR-DISTRITO-COMEDIA/index.m3u8';
  if (!transcodeProcess || transcodeProcess.exitCode !== null) startDistritoTranscode(sourceUrl);
  const name = path.basename(route);
  const file = path.join(transcodeDir, name);
  if (name === 'index.m3u8') {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && !fs.existsSync(file) && transcodeProcess && transcodeProcess.exitCode === null) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  if (!fs.existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '2', 'Cache-Control': 'no-store' });
    return res.end('FFmpeg está preparando la señal. Reintenta en unos segundos.');
  }
  res.writeHead(200, {
    'Content-Type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl; charset=utf-8' : 'video/MP2T',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(file).pipe(res);
}

function startLocalProxy() {
  if (proxyServer && proxyServer.listening) return Promise.resolve();
  if (proxyServer) { try { proxyServer.close(); } catch {} proxyServer = null; }
  proxyServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end('Method not allowed'); }

    let target;
    try { target = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); return res.end('Bad request'); }
    if (target.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, service: 'Pocoyito local IPTV relay', port: LOCAL_PORT }));
    }
    if (target.pathname.startsWith('/transcode/')) {
      return handleTranscodeRequest(target.pathname, res);
    }
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
    const server = proxyServer;
    const onError = (error) => {
      writeProxyLog('ERROR al iniciar en 127.0.0.1:' + LOCAL_PORT + ': ' + (error.stack || error.message));
      if (proxyServer === server) proxyServer = null;
      reject(error);
    };
    server.once('error', onError);
    server.listen(LOCAL_PORT, '0.0.0.0', () => {
      server.removeListener('error', onError);
      writeProxyLog('OK escuchando en http://127.0.0.1:' + LOCAL_PORT);
      console.log('Pocoyito local IPTV proxy listening on 127.0.0.1:' + LOCAL_PORT);
      resolve();
    });
  });
}

function stopLocalProxy() {
  if (transcodeProcess) { try { transcodeProcess.kill(); } catch {} transcodeProcess = null; }
  if (transcodeDir) { try { fs.rmSync(transcodeDir, { recursive: true, force: true }); } catch {} transcodeDir = null; }

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
  catch (error) {
    console.error('No se pudo iniciar el proxy IPTV local:', error);
    writeProxyLog('INICIO FALLIDO: ' + (error.stack || error.message));
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', stopLocalProxy);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
