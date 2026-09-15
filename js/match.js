/* =============================================================
   match.js — 매치 진행 (서버·연습 모드 공용)
   1이닝 = 초(첫 공격자) / 말(교대). 3아웃이면 공수 교대, 끝나면 루타 점수 합산으로 승패.
   판정은 공격자 쪽이 한다. 여기서는 결과를 받아 아웃·점수·이닝만 관리하고 패킷을 중계한다.
   ============================================================= */

var MatchCore = (function () {

  var D = (typeof module !== 'undefined' && module.exports && typeof require === 'function')
    ? require('./data.js')
    : { levelOf: levelOf, CHANCE_SCORE: CHANCE_SCORE };

  var START_TIME = 1.5;     // 매치 시작 안내
  var RESULT_TIME = 2.5;    // 타석 결과를 보여준 뒤 자동으로 다음 타석
  var INNING_TIME = 3.0;    // 공수 교대 안내

  var RELAY_FROM_DEFENSE = { PITCH_SELECT: 1, CARD_PLAY: 1 };
  var RELAY_FROM_ATTACK = { BAT_RESULT: 1, RUN_STATE: 1, DODGE_SUCCESS: 1, FEVER_ACTIVATE: 1 };

  function copy(src, extra) {
    var o = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) o[k] = src[k];
    for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    return o;
  }

  /* opts.send(playerIndex, type, payload)
     opts.halves        : 2 = PvP 1이닝, 1 = 연습(반 이닝)
     opts.firstAttacker : 첫 반 이닝의 공격자 번호 (PvP 는 먼저 접속한 0번) */
  function MatchCore(opts) {
    this.send = opts.send;
    this.halves = opts.halves || 2;
    this.firstAttacker = opts.firstAttacker || 0;
    this.half = 0;
    this.outs = 0;
    this.scores = [0, 0];
    this.atBats = [0, 0];
    this.seq = 0;
    this.phase = 'IDLE';
    this.timers = [];
  }

  var P = MatchCore.prototype;

  P.attacker = function () { return (this.firstAttacker + this.half) % 2; };
  P.defender = function () { return 1 - this.attacker(); };
  P.halfName = function () { return this.half === 0 ? 'TOP' : 'BOTTOM'; };
  P.roleOf = function (i) { return i === this.attacker() ? 'ATTACK' : 'DEFENSE'; };

  P.later = function (sec, fn) {
    var self = this;
    var id = setTimeout(function () {
      var at = self.timers.indexOf(id);
      if (at >= 0) self.timers.splice(at, 1);
      if (self.phase !== 'STOPPED') fn();
    }, sec * 1000);
    this.timers.push(id);
  };

  P.stop = function () {
    this.phase = 'STOPPED';
    while (this.timers.length) clearTimeout(this.timers.pop());
  };

  P.both = function (type, payloadFor) {
    for (var i = 0; i < 2; i++) this.send(i, type, payloadFor(i));
  };

  P.start = function () {
    var self = this;
    this.phase = 'STARTING';
    this.both('MATCH_START', function (i) {
      return { role: self.roleOf(i), you: i, half: self.halfName(), halves: self.halves, scores: self.scores.slice() };
    });
    this.later(START_TIME, function () { self.nextAtBat(); });
  };

  P.nextAtBat = function () {
    var a = this.attacker();
    this.atBats[a]++;
    this.seq++;
    this.phase = 'AT_BAT';
    var payload = {
      seq: this.seq, atBat: this.atBats[a], level: D.levelOf(this.atBats[a]),
      outs: this.outs, scores: this.scores.slice(), half: this.halfName(), attacker: a
    };
    this.both('AT_BAT_START', function () { return payload; });
  };

  P.receive = function (from, type, p) {
    if (this.phase === 'IDLE' || this.phase === 'STOPPED' || this.phase === 'OVER') return;
    p = p || {};

    if (RELAY_FROM_DEFENSE[type]) { if (from === this.defender()) this.send(this.attacker(), type, p); return; }
    if (RELAY_FROM_ATTACK[type]) { if (from === this.attacker()) this.send(this.defender(), type, p); return; }

    /* 타석 결과. 이전 타석의 늦은 패킷은 버린다. */
    if (this.phase !== 'AT_BAT' || from !== this.attacker() || p.seq !== this.seq) return;

    if (type === 'OUT_OCCURRED') {
      this.outs++;
      this.send(this.defender(), type, copy(p, { currentOuts: this.outs, scores: this.scores.slice() }));
      this.endAtBat();
    } else if (type === 'SAFE') {
      var gained = D.CHANCE_SCORE[p.bases] || 0;
      this.scores[from] += gained;
      this.send(this.defender(), type, copy(p, { gained: gained, scores: this.scores.slice() }));
      this.endAtBat();
    }
  };

  P.endAtBat = function () {
    var self = this;
    this.phase = 'BETWEEN';
    this.later(RESULT_TIME, function () {
      if (self.outs >= 3) self.endHalf();
      else self.nextAtBat();
    });
  };

  P.endHalf = function () {
    var self = this;
    if (this.half + 1 < this.halves) {
      this.half++;
      this.outs = 0;
      this.phase = 'INNING_CHANGE';
      /* 공수 교대: 역할이 바뀌고, 수비 코스트·손패는 받는 쪽에서 초기화한다 */
      this.both('INNING_CHANGE', function (i) {
        return { scores: self.scores.slice(), role: self.roleOf(i), half: self.halfName() };
      });
      this.later(INNING_TIME, function () { self.nextAtBat(); });
      return;
    }
    this.phase = 'OVER';
    var s = this.scores.slice();
    var winner = s[0] === s[1] ? null : (s[0] > s[1] ? 0 : 1);   // 동점은 무승부
    this.both('GAME_OVER', function () { return { winner: winner, scores: s }; });
  };

  return MatchCore;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MatchCore;
