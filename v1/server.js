/* =============================================================
   server.js — LAN PvP 서버 (Node 내장 모듈만 사용, 패키지 설치 없음)
   실행: node server.js          포트 변경: PORT=9000 node server.js
   - 게임 파일(index.html, js, css)을 그대로 내려준다
   - /ws 로 WebSocket 을 받아 방 하나(선착 2명)에 넣고 js/match.js 로 진행한다
   - 먼저 접속한 사람이 A(1회 초 공격)
   ============================================================= */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const MatchCore = require('./js/match.js');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1 << 20;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function log(msg) {
  console.log(new Date().toTimeString().slice(0, 8) + '  ' + msg);
}

/* ---------------- 정적 파일 ---------------- */

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { urlPath = null; }
  if (urlPath === null) { res.writeHead(400); res.end(); return; }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  /* 프로젝트 밖이나 숨김 파일(.git 등)은 내려주지 않는다 */
  const file = path.normalize(path.join(ROOT, urlPath));
  const rel = path.relative(ROOT, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some((s) => s.startsWith('.'))) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

/* ---------------- WebSocket (RFC 6455 최소 구현) ---------------- */

class Client {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.alive = true;
    this.idx = -1;
    this.onmessage = null;
    this.onclose = null;
    socket.on('data', (d) => this.receive(d));
    socket.on('close', () => this.closed());
    socket.on('error', () => { this.closed(); socket.destroy(); });
  }

  receive(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.alive && this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > MAX_FRAME) { this.close(); return; }

      const start = off + (masked ? 4 : 0);
      if (this.buf.length < start + len) return;
      const payload = Buffer.from(this.buf.subarray(start, start + len));
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(start + len);

      if (op === 0x8) { this.close(); return; }                 // close
      if (op === 0x9) { this.frame(0xA, payload); continue; }    // ping -> pong
      if (op === 0x1 || op === 0x0) {                            // text / continuation
        this.frags.push(payload);
        if (fin) {
          const text = Buffer.concat(this.frags).toString('utf8');
          this.frags = [];
          this.message(text);
        }
      }
    }
  }

  message(text) {
    let m;
    try { m = JSON.parse(text); } catch (e) { return; }
    if (m && typeof m.t === 'string' && this.onmessage) this.onmessage(m.t, m.p || {});
  }

  frame(op, payload) {
    if (!this.alive) return;
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(type, payload) {
    this.frame(0x1, Buffer.from(JSON.stringify({ t: type, p: payload }), 'utf8'));
  }

  close() {
    if (!this.alive) return;
    this.frame(0x8, Buffer.alloc(0));
    this.socket.end();
    this.closed();
  }

  closed() {
    if (!this.alive) return;
    this.alive = false;
    if (this.onclose) this.onclose();
  }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if ((req.url || '').split('?')[0] !== '/ws' || !key ||
      String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  join(new Client(socket));
});

/* ---------------- 방 (선착 2명) ---------------- */

const slots = [null, null];
let match = null;

const NAME = ['A', 'B'];

function join(client) {
  const idx = !slots[0] ? 0 : (!slots[1] ? 1 : -1);
  if (idx < 0) {
    client.send('ROOM_FULL', {});
    client.close();
    return;
  }
  client.idx = idx;
  slots[idx] = client;
  log('플레이어 ' + NAME[idx] + ' 접속 (' + client.socket.remoteAddress + ')');

  client.onmessage = (type, payload) => { if (match) match.receive(idx, type, payload); };
  client.onclose = () => leave(client);

  if (slots[0] && slots[1]) startMatch();
  else client.send('WAITING', { you: idx });
}

function startMatch() {
  match = new MatchCore({
    halves: 2,
    firstAttacker: 0,
    send: (i, type, payload) => { if (slots[i]) slots[i].send(type, payload); }
  });
  log('매치 시작 — 1회 초 공격: A');
  match.start();
}

function leave(client) {
  if (slots[client.idx] !== client) return;
  slots[client.idx] = null;
  log('플레이어 ' + NAME[client.idx] + ' 나감');
  if (!match) return;
  match.stop();
  match = null;
  const other = slots[1 - client.idx];
  if (other) {
    other.send('OPPONENT_LEFT', {});
    other.close();
  }
}

/* ---------------- 시작 ---------------- */

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error('포트 ' + PORT + ' 가 이미 사용 중입니다. PORT=다른번호 node server.js 로 실행하세요.');
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('Baseball Action Runner PvP 서버');
  console.log('  이 PC          : http://localhost:' + PORT);
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((n) => {
      if ((n.family === 'IPv4' || n.family === 4) && !n.internal) {
        console.log('  같은 네트워크 : http://' + n.address + ':' + PORT + '   (' + name + ')');
      }
    });
  });
  console.log('두 사람이 접속해 PvP 를 누르면 매치가 시작됩니다. 종료: Ctrl+C');
});
