// 게임 HTML 갱신 — 안드로이드 앱(fire-direction-lab-apk)과 같은 규칙
// update.json(version · build · file · sha256 · mandatory)을 읽고, 새 판이면 받아서 검증한 뒤 바꾼다.
// 지금 판 하나는 backup.html 로 남겨 되돌릴 수 있다. 전기(Electron)와 무관한 순수 함수만 둔다.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_MANIFEST = 1024 * 1024;
const MAX_GAME = 60 * 1024 * 1024;

function files(dir) {
  return {
    current: path.join(dir, 'current.html'),
    backup: path.join(dir, 'backup.html'),
    state: path.join(dir, 'state.json'),
    tmp: path.join(dir, 'update.tmp'),
  };
}

// 2.31.160.0 → 23260000 (fire-direction-lab 저장소 워크플로와 같은 셈)
function buildOf(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
  if (!m) return 0;
  const [a, b, c, d] = m.slice(1).map(Number);
  return a * 10000000 + b * 100000 + c * 1000 + d;
}

function loadState(dir) {
  try { return JSON.parse(fs.readFileSync(files(dir).state, 'utf8')); } catch (e) { return {}; }
}
function saveState(dir, st) {
  const f = files(dir);
  fs.writeFileSync(f.state + '.new', JSON.stringify(st, null, 2));
  fs.renameSync(f.state + '.new', f.state);
}

function looksLikeHtml(buf) {
  const head = buf.subarray(0, 8192).toString('utf8').toLowerCase();
  return head.includes('<!doctype html') || head.includes('<html');
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// 처음 켤 때 · 앱을 새로 깔았을 때: 내장판이 지금 판보다 새것이면 올린다(지금 판은 backup 으로)
function prepareBundled(dir, bundledDir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = files(dir);
  const st = loadState(dir);
  const meta = JSON.parse(fs.readFileSync(path.join(bundledDir, 'game.json'), 'utf8'));
  const bundled = { version: meta.version, build: meta.build || buildOf(meta.version) };
  const hasCurrent = fs.existsSync(f.current) && fs.statSync(f.current).size > 1000;
  if (hasCurrent && st.current && st.current.build >= bundled.build) return st;
  if (hasCurrent) {
    fs.copyFileSync(f.current, f.backup);
    st.backup = st.current || { version: '이전 판', build: 0 };
  }
  fs.copyFileSync(path.join(bundledDir, 'game.html'), f.current + '.new');
  fs.renameSync(f.current + '.new', f.current);
  st.current = bundled;
  saveState(dir, st);
  return st;
}

async function readCapped(res, max, onProgress) {
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > max) throw new Error('파일이 너무 큽니다');
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (got > max) { try { reader.cancel(); } catch (e) {} throw new Error('파일이 너무 큽니다'); }
    parts.push(Buffer.from(value));
    if (onProgress && total) onProgress(got / total);
  }
  return Buffer.concat(parts);
}

async function get(fetchFn, url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetchFn(url, {
      signal: ctl.signal, cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'FDL-PC-Updater/1.0' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { res, done: () => clearTimeout(timer) };
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e.name === 'AbortError' ? '응답이 없습니다' : (e.message || String(e)));
  }
}

async function fetchManifest(fetchFn, base) {
  const { res, done } = await get(fetchFn, base + 'update.json', 8000);
  try {
    const o = JSON.parse((await readCapped(res, MAX_MANIFEST)).toString('utf8'));
    const info = {
      version: String(o.version || ''),
      build: Number.isInteger(o.build) ? o.build : buildOf(o.version),
      file: String(o.file || ''),
      sha256: String(o.sha256 || '').trim().toLowerCase(),
      notes: String(o.notes || ''),
      mandatory: o.mandatory === true,
    };
    if (!info.version || !info.build || !info.file) throw new Error('update.json 형식이 맞지 않습니다');
    return info;
  } finally { done(); }
}

function encodePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

// 받기 → 검사(크기 · HTML · SHA-256) → 지금 판을 backup 으로 → 새 판을 current 로
async function downloadUpdate(fetchFn, base, info, dir, onProgress) {
  const f = files(dir);
  const url = /^https:\/\//i.test(info.file) ? info.file : base + encodePath(info.file);
  const { res, done } = await get(fetchFn, url, 120000);
  let buf;
  try { buf = await readCapped(res, MAX_GAME, onProgress); } finally { done(); }
  if (buf.length < 1000) throw new Error('받은 파일이 비정상적으로 작습니다');
  if (!looksLikeHtml(buf)) throw new Error('HTML 파일이 아닙니다');
  if (info.sha256 && sha256(buf) !== info.sha256) throw new Error('SHA-256 검증 실패');
  fs.writeFileSync(f.tmp, buf);
  const st = loadState(dir);
  if (fs.existsSync(f.current)) fs.renameSync(f.current, f.backup);
  fs.renameSync(f.tmp, f.current);
  st.backup = st.current || { version: '이전 판', build: 0 };
  st.current = { version: info.version, build: info.build };
  saveState(dir, st);
  return st;
}

// 지금 판 ↔ 이전 판 맞바꾸기
function rollback(dir) {
  const f = files(dir);
  if (!fs.existsSync(f.backup)) throw new Error('되돌릴 판이 없습니다');
  const swap = path.join(dir, 'swap.html');
  fs.renameSync(f.current, swap);
  fs.renameSync(f.backup, f.current);
  fs.renameSync(swap, f.backup);
  const st = loadState(dir);
  [st.current, st.backup] = [st.backup, st.current];
  saveState(dir, st);
  return st;
}

module.exports = { files, buildOf, loadState, saveState, prepareBundled, fetchManifest, downloadUpdate, rollback, sha256, looksLikeHtml };
