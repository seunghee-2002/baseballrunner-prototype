/* =============================================================
   net.js — 통신 계층
   NetLink   : PvP. server.js 의 /ws 에 붙는다. 메시지는 { t: 패킷ID, p: 페이로드 } JSON
   LocalLink : 연습 모드. 서버 없이 페이지 안에서 MatchCore 를 돌린다 (사람 0번, 봇 1번)
   두 쪽 모두 send(type, payload) 로 보내고 받은 메시지는 onMessage(type, payload) 로 넘긴다.
   ============================================================= */

var Net = (function () {

  function NetLink(handlers) {
    var self = this;
    this.closed = false;
    this.onMessage = handlers.onMessage;

    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    this.ws = new WebSocket(proto + location.host + '/ws');
    this.ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!self.closed && m && m.t) self.onMessage(m.t, m.p || {});
    };
    this.ws.onclose = function () {
      if (self.closed) return;
      self.closed = true;
      if (handlers.onClose) handlers.onClose();
    };
  }

  NetLink.prototype.send = function (type, payload) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: type, p: payload }));
  };

  NetLink.prototype.close = function () {
    this.closed = true;
    try { this.ws.close(); } catch (e) { /* 이미 닫힘 */ }
  };

  /* humanRole: 사람이 맡을 역할 'ATTACK' | 'DEFENSE'. 연습은 반 이닝(3아웃)만 한다. */
  function LocalLink(humanRole) {
    var self = this;
    this.closed = false;
    this.handlers = [null, null];
    this.core = new MatchCore({
      halves: 1,
      firstAttacker: humanRole === 'ATTACK' ? 0 : 1,
      send: function (i, type, payload) { self.deliver(i, type, payload); }
    });
    this.endpoints = [this.endpoint(0), this.endpoint(1)];
  }

  LocalLink.prototype.endpoint = function (i) {
    var self = this;
    return {
      send: function (type, payload) {
        var data = JSON.parse(JSON.stringify(payload));
        self.post(function () { self.core.receive(i, type, data); });
      },
      onMessage: function (fn) { self.handlers[i] = fn; }
    };
  };

  /* 한 틱 늦춰 전달한다 — 네트워크와 같은 순서, 같은 복사 규칙 */
  LocalLink.prototype.post = function (fn) {
    var self = this;
    setTimeout(function () { if (!self.closed) fn(); }, 0);
  };

  LocalLink.prototype.deliver = function (i, type, payload) {
    var self = this;
    var data = JSON.parse(JSON.stringify(payload));
    this.post(function () { if (self.handlers[i]) self.handlers[i](type, data); });
  };

  LocalLink.prototype.start = function () { this.core.start(); };

  LocalLink.prototype.close = function () {
    this.closed = true;
    this.core.stop();
  };

  return { NetLink: NetLink, LocalLink: LocalLink };
})();
