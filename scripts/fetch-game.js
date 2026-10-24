// 빌드 전에 내장할 게임을 받는다 — fire-direction-lab 저장소의 update.json 이 가리키는 최신 판
// 사용: node scripts/fetch-game.js            (GitHub 에서)
//       node scripts/fetch-game.js 파일.html  (손에 있는 판으로 — 이름의 v2.31.160.0 을 판 번호로 쓴다)
'use strict';
const fs = require('fs');
const path = require('path');
const { buildOf, sha256, looksLikeHtml } = require('../updater');

const BASE = process.env.FDL_UPDATE_BASE || 'https://raw.githubusercontent.com/Byanka-Rail/fire-direction-lab/main/';
const OUT = path.join(__dirname, '..', 'game');

function write(buf, version, file) {
  if (!looksLikeHtml(buf)) throw new Error('HTML 이 아닙니다');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'game.html'), buf);
  const meta = { version, build: buildOf(version), file, sha256: sha256(buf) };
  if (!meta.build) throw new Error('판 번호를 읽지 못했습니다: ' + version);
  fs.writeFileSync(path.join(OUT, 'game.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log('내장 게임', meta.version, meta.build, (buf.length / 1048576).toFixed(2) + ' MB', meta.sha256);
}

async function main() {
  const local = process.argv[2];
  if (local) {
    const m = /v(\d+\.\d+\.\d+\.\d+)/.exec(path.basename(local));
    if (!m) throw new Error('파일 이름에 v2.31.160.0 같은 판 번호가 있어야 합니다');
    return write(fs.readFileSync(local), m[1], path.basename(local));
  }
  const man = await (await fetch(BASE + 'update.json', { cache: 'no-store' })).json();
  const res = await fetch(BASE + man.file.split('/').map(encodeURIComponent).join('/'));
  if (!res.ok) throw new Error('게임 파일 HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (man.sha256 && sha256(buf) !== String(man.sha256).toLowerCase()) throw new Error('SHA-256 검증 실패');
  write(buf, man.version, man.file);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
