// FIRE DIRECTION LAB · Windows 앱
// 내장 게임으로 바로 켜지고, 켤 때 GitHub(fire-direction-lab 저장소의 update.json)를 보고 새 판이 있으면 묻는다.
// 저장(localStorage)은 fdl://app 한 곳에 묶여 있어 판을 바꿔도 남는다.
'use strict';
const { app, BrowserWindow, Menu, dialog, net, protocol, session, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const U = require('./updater');

const REPO_PAGE = 'https://github.com/Byanka-Rail/fire-direction-lab-pc';
const RAW_BASE = process.env.FDL_UPDATE_BASE || 'https://raw.githubusercontent.com/Byanka-Rail/fire-direction-lab/main/';
const ORIGIN = 'fdl://app';
const GAME_URL = ORIGIN + '/game.html';
const T = {   // 시험용 손잡이 — 평소에는 비어 있다
  answer: process.env.FDL_AUTOANSWER || '',   // update | later
  dlDir: process.env.FDL_DLDIR || '',
  smoke: process.env.FDL_SMOKE || '',
};
if (process.env.FDL_USERDATA) app.setPath('userData', process.env.FDL_USERDATA);

protocol.registerSchemesAsPrivileged([{
  scheme: 'fdl', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
}]);

const gotLock = app.requestSingleInstanceLock();   // 두 번 켜면 처음 창으로
if (!gotLock) app.quit();

let win = null;
let st = {};
let busy = false;
const blocked = [];   // 화면이 밖으로 내려다 막힌 주소(시험 기록용)
const dataDir = () => path.join(app.getPath('userData'), 'game');
const bundledDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'game') : path.join(__dirname, 'game'));
const verText = () => (st.current ? 'v' + st.current.version : '');

// 기록 — %APPDATA%\FIRE DIRECTION LAB\log.txt (도움말 → 저장 폴더 열기). 화면이 안 뜰 때 무엇이 막혔는지 남긴다
function log(...a) {
  const line = new Date().toISOString() + ' ' + a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n';
  try {
    const f = path.join(app.getPath('userData'), 'log.txt');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f) && fs.statSync(f).size > 256 * 1024) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, line);
  } catch (e) {}
  if (T.smoke || T.answer) process.stdout.write('[fdl] ' + line);
}
const trace = { failLoads: [], gone: [], consoleErrors: [], paint: null, gpu: null };

function setTitle() { if (win) win.setTitle('FIRE DIRECTION LAB · ' + verText()); }

async function ask(opts) {
  if (T.answer) return T.answer === 'update' ? 0 : 1;
  const r = await dialog.showMessageBox(win, Object.assign({ noLink: true, defaultId: 0, cancelId: 1 }, opts));
  return r.response;
}
function info(message, detail, type) {
  if (T.answer || T.smoke) { console.log('[fdl]', message, detail || ''); return; }
  dialog.showMessageBox(win, { type: type || 'info', title: 'FIRE DIRECTION LAB', message, detail: detail || '', noLink: true });
}

// ── 업데이트 ──
async function checkUpdate(manual) {
  if (busy) return;
  busy = true;
  try {
    let m;
    try { m = await U.fetchManifest(net.fetch, RAW_BASE); }
    catch (e) { if (manual) info('업데이트 확인 실패', e.message + '\n지금 판을 그대로 씁니다.', 'warning'); return; }
    st.lastCheck = Date.now(); U.saveState(dataDir(), st);
    const cur = st.current || { version: '?', build: 0 };
    if (!(m.build > cur.build)) { if (manual) info('최신 판입니다', 'v' + cur.version); return; }
    const buttons = m.mandatory ? ['업데이트'] : ['업데이트', '나중에'];
    const r = await ask({
      type: 'question', title: 'LAB 업데이트', buttons,
      message: '새 판이 있습니다',
      detail: 'v' + cur.version + '  →  v' + m.version + (m.notes ? '\n\n' + m.notes : ''),
    });
    if (r !== 0) return;
    if (win) win.setProgressBar(0.01);
    try {
      st = await U.downloadUpdate(net.fetch, RAW_BASE, m, dataDir(), p => win && win.setProgressBar(Math.max(0.01, p)));
    } catch (e) {
      info('업데이트 실패', e.message + '\n지금 판을 그대로 씁니다.', 'warning');
      return;
    } finally { if (win) win.setProgressBar(-1); }
    buildMenu(); setTitle();
    win.webContents.reloadIgnoringCache();
    console.log('[fdl] updated to', m.version);
  } finally { busy = false; }
}

async function confirmRollback() {
  if (!st.backup) return;
  const r = await ask({
    type: 'question', title: '이전 판으로 되돌리기', buttons: ['되돌리기', '취소'],
    message: 'v' + st.backup.version + ' 으로 되돌릴까요?',
    detail: '지금 판(v' + (st.current && st.current.version) + ')은 이전 판 자리로 갑니다. 저장은 그대로입니다.',
  });
  if (r !== 0) return;
  try { st = U.rollback(dataDir()); } catch (e) { info('되돌리기 실패', e.message, 'warning'); return; }
  buildMenu(); setTitle();
  win.webContents.reloadIgnoringCache();
}

// ── 메뉴 ──
function buildMenu() {
  const hasBackup = !!st.backup && fs.existsSync(U.files(dataDir()).backup);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '게임', submenu: [
      { id: 'check', label: '업데이트 확인', click: () => checkUpdate(true) },
      { id: 'rollback', label: hasBackup ? '이전 판으로 되돌리기 (v' + st.backup.version + ')' : '이전 판으로 되돌리기', enabled: hasBackup, click: confirmRollback },
      { type: 'separator' },
      { label: '다시 불러오기', accelerator: 'CmdOrCtrl+R', click: () => { if (!win) return; shownError = false; win.loadURL(GAME_URL); } },
      { label: '전체 화면', role: 'togglefullscreen' },
      { type: 'separator' },
      { label: '종료', role: 'quit' },
    ] },
    { label: '보기', submenu: [
      { label: '크게', role: 'zoomIn' },
      { label: '작게', role: 'zoomOut' },
      { label: '원래 크기', role: 'resetZoom' },
    ] },
    { label: '도움말', submenu: [
      { label: '저장 폴더 열기', click: () => shell.openPath(app.getPath('userData')) },
      { label: 'PC판 내려받는 곳', click: () => shell.openExternal(REPO_PAGE + '/releases/latest') },
      { type: 'separator' },
      { id: 'about', label: '정보', click: () => info('FIRE DIRECTION LAB', [
        '게임 ' + verText() + (st.backup ? '  ·  이전 판 v' + st.backup.version : ''),
        'PC 앱 ' + app.getVersion(),
        '새 판 확인: ' + RAW_BASE + 'update.json',
      ].join('\n')) },
    ] },
  ]));
}

// ── 창 ──
function createWindow() {
  const b = st.win || {};
  win = new BrowserWindow({
    width: b.width || 1400, height: b.height || 900, x: b.x, y: b.y,
    minWidth: 820, minHeight: 560, show: false, backgroundColor: '#071018',
    title: 'FIRE DIRECTION LAB',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', spellcheck: false,
    },
  });
  if (b.max) win.maximize();
  win.on('page-title-updated', e => e.preventDefault());
  setTitle();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => {
    st.win = Object.assign(win.getNormalBounds(), { max: win.isMaximized() });
    try { U.saveState(dataDir(), st); } catch (e) {}
  });
  win.on('closed', () => { win = null; });

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN + '/')) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  wc.on('render-process-gone', (e, d) => { trace.gone.push({ renderer: d && d.reason }); log('renderer gone', d); });
  wc.on('unresponsive', () => log('renderer unresponsive'));
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    trace.failLoads.push({ code, desc, url: String(url).slice(0, 200), isMain });
    log('did-fail-load', { code, desc, url, isMain });
    if (isMain && code !== -3 && !T.smoke && !shownError) showLoadError(code + ' ' + desc);
  });
  wc.on('console-message', (ev, level, message, line, source) => {
    const L = typeof level === 'number' ? level : ev.level;
    const M = String(message !== undefined ? message : ev.message);
    const at = (source !== undefined ? source : ev.sourceId) + ':' + (line !== undefined ? line : ev.lineNumber);
    if ((L === 3 || L === 'error') && trace.consoleErrors.length < 20) {
      trace.consoleErrors.push(M.slice(0, 300) + ' @' + at);
      log('console error', M.slice(0, 300), '@' + at);
    }
  });
  wc.on('did-finish-load', () => {
    log('did-finish-load', wc.getURL().slice(0, 80));
    setTimeout(() => paintCheck(wc), 3000);
  });
  if (T.smoke) smokeTest(wc);
  win.loadURL(GAME_URL);
  wc.once('did-finish-load', () => { if (!T.smoke) setTimeout(() => checkUpdate(false), 1500); });
}

// 화면에 실제로 그려졌는지 — 창을 한 장 찍어 밝기의 퍼짐을 잰다(한 색이면 0에 가깝다)
async function paintCheck(wc) {
  try {
    const img = await wc.capturePage();
    const sz = img.getSize(), bm = img.toBitmap();
    let s = 0, s2 = 0, n = 0;
    for (let i = 0; i + 3 < bm.length; i += 4 * 97) { const g = bm[i] + bm[i + 1] + bm[i + 2]; s += g; s2 += g * g; n++; }
    trace.paint = { w: sz.width, h: sz.height, std: n ? Math.round(Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2))) : -1 };
  } catch (e) { trace.paint = { error: String(e) }; }
  try { trace.gpu = app.getGPUFeatureStatus(); } catch (e) {}
  try {
    trace.dom = await wc.executeJavaScript(`({ lab: window.LAB_VERSION || null, eof: window.__LAB_EOF === 1, start: !!document.getElementById('startBtn'),
      bodyH: document.body ? document.body.scrollHeight : -1, vis: document.body ? getComputedStyle(document.body).visibility : '' })`);
  } catch (e) { trace.dom = { error: String(e) }; }
  log('paint', trace.paint, 'dom', trace.dom, 'gpu', trace.gpu);
}

let shownError = false;
function showLoadError(why) {
  shownError = true;
  const logPath = path.join(app.getPath('userData'), 'log.txt');
  const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = '<!doctype html><meta charset="utf-8"><body style="background:#071018;color:#eef5fa;font:15px system-ui,sans-serif;padding:32px;line-height:1.6">'
    + '<h2 style="margin:0 0 12px">게임 화면을 열지 못했습니다</h2>'
    + '<div>오류: ' + esc(why) + '</div>'
    + '<div>게임 파일: ' + esc(U.files(dataDir()).current) + '</div>'
    + '<div>기록: ' + esc(logPath) + '</div>'
    + '<div style="margin-top:12px;color:#bccbd5">«도움말 → 저장 폴더 열기»에서 log.txt 를 보내 주세요. «게임 → 다시 불러오기»로 다시 시도합니다.</div></body>';
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

// 시험: 판이 뜨는지 · 저장이 되는지 · GitHub 의 update.json 을 읽는지 적고 끝낸다 (CI 의 Windows 에서 돌린다)
function smokeTest(wc) {
  const errors = [];
  wc.on('console-message', (ev, level, message, line, source) => {
    const L = typeof level === 'number' ? level : ev.level;
    const M = message !== undefined ? message : ev.message;
    const at = (source !== undefined ? source : ev.sourceId) + ':' + (line !== undefined ? line : ev.lineNumber);
    if ((L === 3 || L === 'error') && !/net::ERR_|Failed to load resource/.test(String(M))) errors.push(String(M).slice(0, 300) + ' @' + at);
  });
  wc.once('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 4000));
    const out = { app: app.getVersion(), platform: process.platform, game: st.current, errors, blocked };
    try {
      Object.assign(out, await wc.executeJavaScript(`(() => {
        localStorage.setItem('__fdl_smoke', 'ok');
        return { origin: location.origin, labVersion: window.LAB_VERSION || null, eof: window.__LAB_EOF === 1,
                 storage: localStorage.getItem('__fdl_smoke'), canvases: document.querySelectorAll('canvas').length,
                 startBtn: !!document.getElementById('startBtn') };
      })()`));
    } catch (e) { out.evalError = String(e); }
    try { const m = await U.fetchManifest(net.fetch, RAW_BASE); out.manifest = { version: m.version, build: m.build }; }
    catch (e) { out.manifestError = e.message; }
    if (!trace.paint) await paintCheck(wc);
    Object.assign(out, { paint: trace.paint, gpu: trace.gpu, failLoads: trace.failLoads, gone: trace.gone, userData: app.getPath('userData'),
      electron: process.versions.electron, os: os.release() });
    out.ok = !!(out.labVersion && out.eof && out.storage === 'ok' && out.origin === ORIGIN && out.startBtn && !errors.length
      && out.paint && out.paint.std > 8);
    fs.writeFileSync(T.smoke, JSON.stringify(out, null, 2));
    app.quit();
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

app.on('child-process-gone', (e, d) => { trace.gone.push(d); log('child-process-gone', d); });

app.whenReady().then(() => {
  if (!gotLock) return;
  log('start', { app: app.getVersion(), electron: process.versions.electron, os: os.release(), arch: process.arch,
    packaged: app.isPackaged, userData: app.getPath('userData'), exe: process.execPath });
  try { st = U.prepareBundled(dataDir(), bundledDir()); }
  catch (e) { log('prepare failed', String(e && e.stack || e)); dialog.showErrorBox('FIRE DIRECTION LAB', '게임 파일 준비 실패\n' + e.message); app.quit(); return; }
  log('game', st.current, 'backup', st.backup || null);

  protocol.handle('fdl', req => {
    const u = new URL(req.url);
    if (u.host === 'app' && (u.pathname === '/game.html' || u.pathname === '/')) {
      try {
        // 파일 읽기는 크롬 쪽(net.fetch file://)에 맡긴다 — Buffer 로 넘기면 4 MB 판의 끝 64 KB 토막이 가끔 잘렸다(계측: 12번 중 7번 · 줄 23564에서 SyntaxError)
        const fileUrl = pathToFileURL(U.files(dataDir()).current).toString();
        return net.fetch(fileUrl, { cache: 'no-store' }).then(r => {
          log('game served', r.status, fileUrl);
          return r;
        }, e => {
          log('game read failed', fileUrl, String(e));
          return new Response('게임 파일 읽기 실패: ' + e.message, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        });
      } catch (e) {
        return new Response('게임 파일 읽기 실패: ' + e.message, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    }
    return new Response('', { status: 404 });
  });

  // 게임 화면은 밖으로 나가지 않는다(게임은 오프라인 단일 파일) — 옛 판에 남은 바깥 통계 스크립트 같은 것을 막는다.
  // 앱 자신의 업데이트 확인(net.fetch)은 화면이 아니라서 webContentsId 가 없고, 막히지 않는다
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => {
    const cancel = d.webContentsId !== undefined && d.webContentsId !== null;
    if (cancel && blocked.length < 20) blocked.push(d.url.slice(0, 120));
    cb({ cancel });
  });

  // 게임의 «출력 · 저장» 파일 — 저장 창을 띄운다
  session.defaultSession.on('will-download', (e, item) => {
    if (T.dlDir) item.setSavePath(path.join(T.dlDir, item.getFilename()));
    else item.setSaveDialogOptions({ title: '파일 저장', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });

  buildMenu();
  createWindow();
});
