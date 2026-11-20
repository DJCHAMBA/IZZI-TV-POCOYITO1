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
let canal5TranscodeProcess = null;
let canal5TranscodeDir = null;
let canal5TranscodeSource = null;
let canal5TranscodeError = '';
let canal5TranscodeLog = [];
let backupTranscodeProcess = null;
let backupTranscodeDir = null;
let backupTranscodeSource = null;
let backupTranscodeLog = [];
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
  const headers = ['Accept: */*', 'Accept-Language: es_MX', ''].join('\r\n');
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


function startCanal5Transcode(sourceUrl) {
  if (canal5TranscodeProcess && canal5TranscodeProcess.exitCode === null && canal5TranscodeSource === sourceUrl) return;
  if (canal5TranscodeProcess) { try { canal5TranscodeProcess.kill(); } catch {} canal5TranscodeProcess = null; }
  if (canal5TranscodeDir) { try { fs.rmSync(canal5TranscodeDir, { recursive: true, force: true }); } catch {} }
  canal5TranscodeDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'pocoyito-canal5-'));
  canal5TranscodeSource = sourceUrl;
  const ffmpeg = findFfmpeg();
  const output = path.join(canal5TranscodeDir, 'index.m3u8');
  const headers = ['Accept: */*', 'Accept-Language: es_MX', ''].join('\r\n');
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-nostdin', '-y',
    '-user_agent', 'VLC/3.0.23 LibVLC/3.0.23',
    '-headers', headers,
    '-i', sourceUrl,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', 'scale=-2:720',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'main',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
    '-f', 'hls', '-hls_time', '4', '-hls_list_size', '8',
    '-hls_flags', 'delete_segments+append_list+independent_segments+omit_endlist',
    '-hls_segment_filename', path.join(canal5TranscodeDir, 'seg_%06d.ts'),
    output
  ];
  writeProxyLog('Iniciando transcodificación Canal 5 HEVC -> H.264 con FFmpeg: ' + ffmpeg);
  canal5TranscodeProcess = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  canal5TranscodeError = ''; canal5TranscodeLog = [];
  canal5TranscodeProcess.stderr.on('data', chunk => { const line = chunk.toString().trim(); if (line) { canal5TranscodeLog.push(line); canal5TranscodeLog = canal5TranscodeLog.slice(-20); writeProxyLog('FFmpeg Canal 5: ' + line); } });
  canal5TranscodeProcess.on('error', error => { canal5TranscodeError = error.message; writeProxyLog('FFmpeg Canal 5 no pudo arrancar: ' + (error.stack || error.message)); });
  canal5TranscodeProcess.on('exit', (code, signal) => { canal5TranscodeError = code === 0 ? canal5TranscodeError : (canal5TranscodeError || 'FFmpeg terminó con código ' + code + ' (' + signal + ')'); writeProxyLog('FFmpeg Canal 5 terminó. code=' + code + ' signal=' + signal); });
}

function isPublicBackupUrl(source) {
  if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) return false;
  const host = source.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) || host === '0.0.0.0') return false;
  return true;
}
function startBackupTranscode(sourceUrl) {
  if (backupTranscodeProcess) { try { backupTranscodeProcess.kill(); } catch {} backupTranscodeProcess = null; }
  if (backupTranscodeDir) { try { fs.rmSync(backupTranscodeDir, { recursive: true, force: true }); } catch {} }
  backupTranscodeDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'pocoyito-backup-'));
  backupTranscodeSource = sourceUrl; backupTranscodeLog = [];
  const output = path.join(backupTranscodeDir, 'index.m3u8');
  const headers = ['Accept: */*', 'Accept-Language: es_MX', ''].join('\r\n');
  const args = ['-hide_banner','-loglevel','warning','-nostdin','-y','-user_agent','VLC/3.0.23 LibVLC/3.0.23','-headers',headers,'-i',sourceUrl,
    '-map','0:v:0?','-map','0:a:0?','-vf','scale=-2:720','-c:v','libx264','-preset','veryfast','-tune','zerolatency','-crf','24','-pix_fmt','yuv420p','-profile:v','main',
    '-c:a','aac','-b:a','128k','-ac','2','-ar','48000','-f','hls','-hls_time','4','-hls_list_size','8',
    '-hls_flags','delete_segments+append_list+independent_segments+omit_endlist','-hls_segment_filename',path.join(backupTranscodeDir,'seg_%06d.ts'),output];
  const ffmpeg=findFfmpeg();
  writeProxyLog('Iniciando respaldo Dearbulut con FFmpeg H.264: '+ffmpeg+' · '+sourceUrl);
  backupTranscodeProcess=spawn(ffmpeg,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
  backupTranscodeProcess.stderr.on('data',chunk=>{const line=chunk.toString().trim();if(line){backupTranscodeLog.push(line);backupTranscodeLog=backupTranscodeLog.slice(-20);writeProxyLog('FFmpeg respaldo: '+line);}});
  backupTranscodeProcess.on('error',error=>{backupTranscodeLog.push('ERROR: '+error.message);writeProxyLog('FFmpeg respaldo no arrancó: '+error.message);});
  backupTranscodeProcess.on('exit',(code,signal)=>writeProxyLog('FFmpeg respaldo terminó. code='+code+' signal='+signal));
}
async function handleBackupTranscodeRequest(route, searchParams, res) {
  const isIndex=route==='/backup/index.m3u8';
  const segment=route.startsWith('/backup/')?route.slice('/backup/'.length):'';
  const digits=segment.startsWith('seg_')&&segment.endsWith('.ts')?segment.slice(4,-3):'';
  const isSegment=digits.length===6&&[...digits].every(ch=>ch>='0'&&ch<='9');
  if(!isIndex&&!isSegment){res.writeHead(404);return res.end('Not found');}
  if(isIndex){
    let source;try{source=new URL(searchParams.get('u')||'');}catch{res.writeHead(400);return res.end('Invalid backup URL');}
    if(!isPublicBackupUrl(source)){res.writeHead(403);return res.end('Backup URL is not allowed');}
    if(backupTranscodeSource!==source.href||!backupTranscodeProcess||backupTranscodeProcess.exitCode!==null)startBackupTranscode(source.href);
  }else if(!backupTranscodeDir||!backupTranscodeProcess){res.writeHead(503,{'Retry-After':'2'});return res.end('Backup stream is starting');}
  const name=isIndex?'index.m3u8':segment,file=path.join(backupTranscodeDir,name);
  if(isIndex){const deadline=Date.now()+30000;while(Date.now()<deadline&&!fs.existsSync(file)&&backupTranscodeProcess&&backupTranscodeProcess.exitCode===null)await new Promise(resolve=>setTimeout(resolve,250));}
  if(!fs.existsSync(file)){res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Retry-After':'2','Cache-Control':'no-store'});return res.end('FFmpeg is preparing the backup stream. Retry shortly.');}
  res.writeHead(200,{'Content-Type':isIndex?'application/vnd.apple.mpegurl; charset=utf-8':'video/MP2T','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
  fs.createReadStream(file).pipe(res);
}

async function handleCanal5TranscodeRequest(route, searchParams, res) {
  const isIndex = route === '/canal5/index.m3u8';
  const segmentName = route.startsWith('/canal5/') ? route.slice('/canal5/'.length) : '';
  const digits = segmentName.startsWith('seg_') && segmentName.endsWith('.ts') ? segmentName.slice(4, -3) : '';
  const isSegment = digits.length === 6 && [...digits].every(ch => ch >= '0' && ch <= '9');
  if (!isIndex && !isSegment) { res.writeHead(404); return res.end('Not found'); }

  if (isIndex) {
    let source;
    try { source = new URL(searchParams.get('u') || ''); } catch {
      res.writeHead(400); return res.end('Invalid Canal 5 source URL');
    }
    if (!isAllowedStream(source) || source.hostname !== '45.5.118.152' || !source.pathname.startsWith('/play/a03i/')) {
      res.writeHead(403); return res.end('Canal 5 source not allowed');
    }
    if (!canal5TranscodeProcess || canal5TranscodeProcess.exitCode !== null || canal5TranscodeSource !== source.href) {
      startCanal5Transcode(source.href);
    }
  } else if (!canal5TranscodeDir || !canal5TranscodeProcess) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '2', 'Cache-Control': 'no-store' });
    return res.end('Canal 5 todavía no inició la conversión. Vuelve a solicitar la lista.');
  }

  const name = isIndex ? 'index.m3u8' : segmentName;
  const file = path.join(canal5TranscodeDir, name);
  if (isIndex) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && !fs.existsSync(file) && canal5TranscodeProcess && canal5TranscodeProcess.exitCode === null) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  if (!fs.existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '2', 'Cache-Control': 'no-store' });
    return res.end('FFmpeg está preparando Canal 5 en H.264. Reintenta en unos segundos.');
  }
  res.writeHead(200, {
    'Content-Type': isIndex ? 'application/vnd.apple.mpegurl; charset=utf-8' : 'video/MP2T',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(file).pipe(res);
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
    if (target.pathname === '/canal5/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ffmpeg: findFfmpeg(), running: !!canal5TranscodeProcess && canal5TranscodeProcess.exitCode === null, exitCode: canal5TranscodeProcess?.exitCode ?? null, error: canal5TranscodeError, log: canal5TranscodeLog, outputReady: !!canal5TranscodeDir && fs.existsSync(path.join(canal5TranscodeDir, 'index.m3u8')) }));
    }
    if (target.pathname.startsWith('/backup/')) {
      return handleBackupTranscodeRequest(target.pathname, target.searchParams, res);
    }
    if (target.pathname.startsWith('/canal5/')) {
      return handleCanal5TranscodeRequest(target.pathname, target.searchParams, res);
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
  if (backupTranscodeProcess) { try { backupTranscodeProcess.kill(); } catch {} backupTranscodeProcess = null; }
  if (backupTranscodeDir) { try { fs.rmSync(backupTranscodeDir, { recursive: true, force: true }); } catch {} backupTranscodeDir = null; }
  if (canal5TranscodeProcess) { try { canal5TranscodeProcess.kill(); } catch {} canal5TranscodeProcess = null; }
  if (canal5TranscodeDir) { try { fs.rmSync(canal5TranscodeDir, { recursive: true, force: true }); } catch {} canal5TranscodeDir = null; }
  if (transcodeProcess) { try { transcodeProcess.kill(); } catch {} transcodeProcess = null; }
  if (transcodeDir) { try { fs.rmSync(transcodeDir, { recursive: true, force: true }); } catch {} transcodeDir = null; }

  if (proxyServer) { proxyServer.close(); proxyServer = null; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#080b16', title: 'izzi TV Pocoyito', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icons', 'pocoyito.ico'),
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
  if (process.platform === 'win32') app.setAppUserModelId('com.djchamba.izzitvpocoyito');
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

// Windows installer branding: the packaged icon is generated by scripts/prepare-icon.js.
