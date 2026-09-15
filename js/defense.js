/* =============================================================
   defense.js — 수비 쪽 규칙 (사람 수비·봇 수비 공용, DOM 없음)
   2단계 터치 투구(3초 제한), 8장 덱 중 손패 4장.
   코스트는 시간으로 차지 않고, 타자가 회피에 성공할 때마다만 찬다.
   ============================================================= */

var DefenseState = (function () {

  function shuffle(list, rng) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1)), tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function DefenseState(rng) {
    this.rng = rng || Math.random;
    this.uid = 0;
    this.pitchLeft = 0;
    this.pitchFirst = null;
    this.pitchDone = true;
    this.resetHalf();
  }

  var P = DefenseState.prototype;

  /* 공수 교대마다 코스트·손패를 새로 한다 */
  P.resetHalf = function () {
    this.cost = DEFENSE.COST_START;
    this.lock = 0;
    this.lockPending = false;
    var ids = shuffle(DECK.slice(), this.rng);
    this.hand = [];
    for (var i = 0; i < DEFENSE.HAND_SIZE; i++) this.hand.push(this.makeCard(ids[i]));
  };

  /* 카드의 위치는 손패에 들어오는 순간 정해져 카드에 표시된다 */
  P.makeCard = function (id) {
    var def = CARDS[id], zones = [];
    for (var i = 0; i < def.slots.length; i++) {
      var list = SLOT_ZONES[def.slots[i]];
      zones.push(list[Math.floor(this.rng() * list.length)]);
    }
    return { uid: ++this.uid, id: id, zones: zones };
  };

  /* 쓴 카드는 덱으로 돌아간다. 손패에 없는 카드 중 방금 쓴 것을 뺀 나머지에서 무작위로 보충 */
  P.draw = function (usedId) {
    var inHand = {}, pool = [], i;
    for (i = 0; i < this.hand.length; i++) if (this.hand[i]) inHand[this.hand[i].id] = true;
    for (i = 0; i < DECK.length; i++) if (!inHand[DECK[i]] && DECK[i] !== usedId) pool.push(DECK[i]);
    return this.makeCard(pool[Math.floor(this.rng() * pool.length)]);
  };

  P.gainCost = function (n) { this.cost = Math.min(DEFENSE.COST_MAX, this.cost + n); };

  /* LUCKY 핸디캡: 코스트 차감 + 주루가 시작되면 잠금 */
  P.onLucky = function () {
    this.cost = Math.max(0, this.cost - LUCKY.COST_PENALTY);
    this.lockPending = true;
  };

  /* 카드 장애물이 부딪히기까지 걸리는 가장 긴 시간 (바람으로 가장 느려진 경우) */
  function cardArrival(def, level) {
    var L = LEVELS[level] || LEVELS[1], lead = 0, last = 0;
    for (var i = 0; i < def.spawns.length; i++) {
      var sp = def.spawns[i];
      var zone = SLOT_ZONES[def.slots[sp.slot]][0];
      var speed = OBSTACLES[obstacleKey(sp.kind, zone)].moveSpeed * L.speedMul * (sp.speedMul || 1) * (1 - RUN.WIND_MAX);
      lead = Math.max(lead, RUN.START_DISTANCE / speed - sp.delay);
      last = Math.max(last, sp.delay);
    }
    return lead + last;
  }

  /* 카드 i 를 지금 못 쓰는 이유. 쓸 수 있으면 '' — view 는 공격자 스냅숏 */
  P.blockReason = function (i, view) {
    var c = this.hand[i];
    if (!c) return 'EMPTY';
    var def = CARDS[c.id];
    if (!view || view.phase !== 'RUNNING') return 'PHASE';
    if (this.lock > 0 || this.lockPending) return 'LOCK';
    if (this.cost < def.cost) return 'COST';
    if (def.effect && def.effect.type === 'decel' && !AttackSim.findDecelTarget(view.obstacles, def.effect.at)) {
      return 'NO_TARGET';
    }
    /* 마지막 베이스에 닿기 전에 부딪힐 수 없으면 버려지는 카드다 */
    if (def.spawns && view.toFinal < cardArrival(def, view.level)) return 'TOO_LATE';
    return '';
  };

  P.play = function (i, view) {
    if (this.blockReason(i, view)) return null;
    var c = this.hand[i];
    this.cost -= CARDS[c.id].cost;
    this.hand[i] = null;
    this.hand[i] = this.draw(c.id);
    return { cardId: c.id, zones: c.zones.slice(), spawnTime: Date.now() };
  };

  /* ---------- 2단계 터치 투구 ---------- */

  P.beginPitch = function () {
    this.pitchLeft = PITCH.SELECT_TIME;
    this.pitchFirst = null;
    this.pitchDone = false;
  };

  /* 같은 칸 두 번 = 직구, 다른 칸 = 변화구 */
  P.tapPitch = function (zone) {
    if (this.pitchDone) return null;
    if (!this.pitchFirst) { this.pitchFirst = zone; return null; }
    this.pitchDone = true;
    return { startPos: ZONE_NUM[this.pitchFirst], endPos: ZONE_NUM[zone] };
  };

  /* 3초 안에 두 칸을 다 고르지 못하면 무작위 칸 직구 */
  P.tickPitch = function (dt) {
    if (this.pitchDone) return null;
    this.pitchLeft -= dt;
    if (this.pitchLeft > 0) return null;
    this.pitchDone = true;
    var z = ZONES[Math.floor(this.rng() * ZONES.length)];
    return { startPos: ZONE_NUM[z], endPos: ZONE_NUM[z], timeout: true };
  };

  DefenseState.cardArrival = cardArrival;
  return DefenseState;
})();

/* 수비 역할의 통신 껍데기. 사람 수비와 봇 수비가 같이 쓴다. */
var DefenseSide = (function () {

  var MAX_EXTRAPOLATE = 0.25;

  function clone(o) {
    var c = {};
    for (var k in o) c[k] = o[k];
    return c;
  }

  function DefenseSide(endpoint, opts) {
    this.endpoint = endpoint;
    this.state = new DefenseState(opts && opts.rng);
    this.seq = 0;
    this.level = 1;
    this.view = null;       // 마지막으로 받은 공격자 스냅숏
    this.viewAge = 0;
    this.selecting = false;
  }

  var P = DefenseSide.prototype;

  P.handle = function (type, p) {
    var st = this.state;
    if (type === 'AT_BAT_START') {
      this.seq = p.seq;
      this.level = p.level;
      this.view = null;
      st.lock = 0;
      st.lockPending = false;
      st.beginPitch();
      this.selecting = true;
    } else if (p && p.seq !== this.seq) {
      return;
    } else if (type === 'RUN_STATE') {
      this.view = p;
      this.viewAge = 0;
    } else if (type === 'BAT_RESULT') {
      if (p.result === 'LUCKY') st.onLucky();
    } else if (type === 'DODGE_SUCCESS') {
      st.gainCost(p.costGained || 0);
    }
  };

  P.tapZone = function (zone) {
    if (!this.selecting) return;
    var pitch = this.state.tapPitch(zone);
    if (pitch) this.throwPitch(pitch);
  };

  P.throwPitch = function (pitch) {
    this.selecting = false;
    pitch.seq = this.seq;
    this.endpoint.send('PITCH_SELECT', pitch);
  };

  P.playCard = function (i) {
    var play = this.state.play(i, this.liveView());
    if (!play) return null;
    play.seq = this.seq;
    this.endpoint.send('CARD_PLAY', play);
    return play;
  };

  P.update = function (dt) {
    var st = this.state;
    this.viewAge += dt;
    if (this.selecting) {
      var pitch = st.tickPitch(dt);
      if (pitch) this.throwPitch(pitch);
    }
    if (st.lockPending && this.view && this.view.phase === 'RUNNING') {
      st.lock = LUCKY.CARD_LOCK;
      st.lockPending = false;
    }
    if (st.lock > 0) st.lock = Math.max(0, st.lock - dt);
  };

  /* 받은 스냅숏을 받은 뒤 흐른 시간만큼 앞으로 밀어 쓴다 (20Hz 사이 보간 + LAN 지연) */
  P.liveView = function () {
    var v = this.view;
    if (!v) return null;
    var a = Math.min(this.viewAge, MAX_EXTRAPOLATE);
    var out = clone(v), i;

    out.obstacles = [];
    for (i = 0; i < v.obstacles.length; i++) {
      var o = clone(v.obstacles[i]);
      o.distance -= o.speed * a;
      out.obstacles.push(o);
    }
    out.t = v.t + a;
    if (v.pitch) {
      out.pitch = clone(v.pitch);
      var flying = v.phase === 'PITCH' || (v.phase === 'BAT_RESULT' && v.bat && v.bat.grade === 'MISS');
      if (flying) out.pitch.t += a;
    }
    if (v.leg && v.phase === 'RUNNING') {
      out.leg = clone(v.leg);
      out.leg.time += a * (v.invincible > 0 ? RUN.FEVER_DASH : 1);
      out.toFinal = Math.max(0, v.toFinal - a);
    }
    return out;
  };

  return DefenseSide;
})();
