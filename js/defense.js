/* =============================================================
   defense.js — 수비 쪽 규칙 (사람 수비·봇 수비 공용, DOM 없음)
   투구: 투구 카드(6장 풀, 손패 3 + 직구 고정)를 고르고(구질 3초, 넘기면 직구)
         시작 칸을 탭한다(칸 3초, 넘기면 무작위 칸).
   기습: 매치 전에 고른 장애물 덱 6장 중 손패 3장. 발동 후 전역 쿨다운.
   코스트: 타석마다 고정 지급 + 타자의 회피 성공마다 +1. 투구 카드와 장애물 카드가 같이 쓴다.
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

  /* 쓴 카드는 덱으로 돌아간다. 손패에 없는 카드 중 방금 쓴 것을 뺀 나머지에서 무작위로 뽑는다 */
  function drawId(deck, hand, usedId, rng) {
    var inHand = {}, pool = [], i;
    for (i = 0; i < hand.length; i++) if (hand[i]) inHand[hand[i].id] = true;
    for (i = 0; i < deck.length; i++) if (!inHand[deck[i]] && deck[i] !== usedId) pool.push(deck[i]);
    return pool[Math.floor(rng() * pool.length)];
  }

  /* 새 DefenseState = 공수 교대 시점. 코스트 0, 손패 두 종류를 새로 섞는다 */
  function DefenseState(rng, deck) {
    this.rng = rng || Math.random;
    this.deck = validDeck(deck);
    this.uid = 0;
    this.cost = 0;
    this.cooldown = 0;

    var ids = shuffle(this.deck.slice(), this.rng), i;
    this.hand = [];
    for (i = 0; i < DEFENSE.HAND_SIZE; i++) this.hand.push(this.makeCard(ids[i]));

    var pids = shuffle(PITCH_DECK.slice(), this.rng);
    this.pitchHand = [];
    for (i = 0; i < DEFENSE.PITCH_HAND; i++) this.pitchHand.push({ uid: ++this.uid, id: pids[i] });

    this.selecting = false;
    this.pitchStage = null;    // 'PICK' 구질 선택 / 'ZONE' 칸 선택
    this.pitchLeft = 0;
    this.pitchPick = null;     // -1 = 직구, 0~2 = 투구 손패
  }

  var P = DefenseState.prototype;

  /* 장애물 카드의 위치는 손패에 들어오는 순간 정해져 카드에 표시된다 */
  P.makeCard = function (id) {
    var def = CARDS[id], zones = [];
    for (var i = 0; i < def.slots.length; i++) {
      var list = SLOT_ZONES[def.slots[i]];
      zones.push(list[Math.floor(this.rng() * list.length)]);
    }
    return { uid: ++this.uid, id: id, zones: zones };
  };

  P.grant = function (n) { this.cost = Math.min(DEFENSE.COST_MAX, this.cost + n); };

  P.tick = function (dt) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
  };

  /* 카드 장애물이 부딪히기까지 걸리는 가장 긴 시간 (바람으로 가장 느려진 경우) */
  function cardArrival(def, legIndex) {
    var L = LEGS[legIndex] || LEGS[0], lead = 0, last = 0;
    for (var i = 0; i < def.spawns.length; i++) {
      var sp = def.spawns[i];
      var zone = SLOT_ZONES[def.slots[sp.slot]][0];
      var speed = OBSTACLES[obstacleKey(sp.kind, zone)].moveSpeed * L.speedMul * (sp.speedMul || 1) * (1 - RUN.WIND_MAX);
      lead = Math.max(lead, RUN.START_DISTANCE / speed - sp.delay);
      last = Math.max(last, sp.delay);
    }
    return lead + last;
  }

  /* 장애물 카드 i 를 지금 못 쓰는 이유. 쓸 수 있으면 '' — view 는 공격자 스냅숏 */
  P.blockReason = function (i, view) {
    var c = this.hand[i];
    if (!c) return 'EMPTY';
    var def = CARDS[c.id];
    if (!view || view.phase !== 'RUNNING' || !view.leg) return 'PHASE';
    if (this.cooldown > 0) return 'COOLDOWN';
    if (this.cost < def.cost) return 'COST';
    if (def.effect && def.effect.type === 'decel' &&
        !AttackSim.findDecelTarget(view.obstacles, def.effect.at + DEFENSE.WARN_TIME)) {
      return 'NO_TARGET';
    }
    /* 홈에 닿기 전에 부딪힐 수 없으면 버려지는 카드다 */
    if (def.spawns && view.toHome < cardArrival(def, view.leg.index)) return 'TOO_LATE';
    return '';
  };

  P.play = function (i, view) {
    if (this.blockReason(i, view)) return null;
    var c = this.hand[i];
    this.cost -= CARDS[c.id].cost;
    this.cooldown = DEFENSE.COOLDOWN;
    this.hand[i] = null;
    this.hand[i] = this.makeCard(drawId(this.deck, this.hand, c.id, this.rng));
    return { cardId: c.id, zones: c.zones.slice(), spawnTime: Date.now() };
  };

  /* ---------- 투구 ---------- */

  /* 투구 선택은 두 단계를 차례로 한다: 구질(PICK) → 칸(ZONE). 단계마다 제한 시간을 새로 센다 */
  P.beginPitch = function () {
    this.selecting = true;
    this.pitchStage = 'PICK';
    this.pitchLeft = PITCH.PICK_TIME;
    this.pitchPick = null;
  };

  /* i: -1 = 직구, 0~2 = 투구 손패. 코스트가 모자라면 'COST' */
  P.pitchBlock = function (i) {
    if (i < 0) return '';
    var c = this.pitchHand[i];
    if (!c) return 'EMPTY';
    return this.cost < PITCH_CARDS[c.id].cost ? 'COST' : '';
  };

  /* 구질을 고르면 바로 칸 단계로 넘어간다. 칸 단계에서는 구질을 바꿀 수 없다 */
  P.pickPitch = function (i) {
    if (!this.selecting || this.pitchStage !== 'PICK' || this.pitchBlock(i)) return;
    this.pitchPick = i;
    this.pitchStage = 'ZONE';
    this.pitchLeft = PITCH.ZONE_TIME;
  };

  /* 칸 단계에서 칸을 탭한다. zone 은 수비자(투수 시점) 화면 기준 칸 — 타자 시점으로는 좌우가 반대 */
  P.tapPitch = function (zone) {
    if (!this.selecting || this.pitchStage !== 'ZONE') return null;
    return this.throwAt(zone, false);
  };

  P.throwAt = function (zone, timeout) {
    var i = this.pitchPick, cardId = null;
    if (i >= 0) {
      var c = this.pitchHand[i];
      cardId = c.id;
      this.cost -= PITCH_CARDS[cardId].cost;
      this.pitchHand[i] = null;
      this.pitchHand[i] = { uid: ++this.uid, id: drawId(PITCH_DECK, this.pitchHand, cardId, this.rng) };
    }
    this.selecting = false;
    this.pitchStage = null;
    this.pitchPick = null;
    return { cardId: cardId, start: MIRROR_ZONE[zone], speedMul: this.speedMul(), timeout: timeout };
  };

  P.speedMul = function () { return 1 + (this.rng() * 2 - 1) * PITCH.SPEED_RANDOM; };

  /* 구질 시간 초과 = 직구로 정하고 칸 단계로. 칸 시간 초과 = 고른 구질로 무작위 칸 */
  P.tickPitch = function (dt) {
    if (!this.selecting) return null;
    this.pitchLeft -= dt;
    if (this.pitchLeft > 0) return null;
    if (this.pitchStage === 'PICK') {
      this.pitchPick = -1;
      this.pitchStage = 'ZONE';
      this.pitchLeft = PITCH.ZONE_TIME;
      return null;
    }
    return this.throwAt(ZONES[Math.floor(this.rng() * ZONES.length)], true);
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

  /* opts: { rng, deck } */
  function DefenseSide(endpoint, opts) {
    this.endpoint = endpoint;
    this.state = new DefenseState(opts && opts.rng, opts && opts.deck);
    this.seq = 0;
    this.pitchNo = 0;
    this.reselectIn = 0;
    this.view = null;       // 마지막으로 받은 공격자 스냅숏
    this.viewAge = 0;
  }

  var P = DefenseSide.prototype;

  P.handle = function (type, p) {
    var st = this.state;
    if (type === 'AT_BAT_START') {
      this.seq = p.seq;
      this.pitchNo = 0;
      this.reselectIn = 0;
      this.view = null;
      st.grant(p.costGrant || 0);
      st.beginPitch();
    } else if (p && p.seq !== this.seq) {
      return;
    } else if (type === 'RUN_STATE') {
      this.view = p;
      this.viewAge = 0;
    } else if (type === 'BAT_RESULT') {
      /* 스트라이크·볼이면 결과를 보여준 뒤 같은 타석에서 다시 던진다 */
      if (p.outcome === 'CONTINUE' && p.pitchNo === this.pitchNo) this.reselectIn = PITCH.RESULT_TIME;
    } else if (type === 'DODGE_SUCCESS') {
      st.grant(p.costGained || 0);
    }
  };

  P.pickPitch = function (i) { this.state.pickPitch(i); };

  P.tapZone = function (zone) {
    var pitch = this.state.tapPitch(zone);
    if (pitch) this.throwPitch(pitch);
  };

  P.throwPitch = function (pitch) {
    this.pitchNo++;
    pitch.seq = this.seq;
    pitch.pitchNo = this.pitchNo;
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
    st.tick(dt);
    if (this.reselectIn > 0) {
      this.reselectIn -= dt;
      if (this.reselectIn <= 0) { this.reselectIn = 0; st.beginPitch(); }
    }
    var pitch = st.tickPitch(dt);
    if (pitch) this.throwPitch(pitch);
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
      var flying = v.phase === 'PITCH' || (v.phase === 'BAT_RESULT' && v.bat && v.bat.outcome !== 'HIT');
      if (flying) out.pitch.t += a;
    }
    if (v.leg && v.phase === 'RUNNING') {
      out.leg = clone(v.leg);
      out.leg.time = Math.min(v.leg.duration, v.leg.time + a);
      out.toHome = Math.max(0, v.toHome - a);
      out.preview = [];
      for (i = 0; i < v.preview.length; i++) {
        var pv = clone(v.preview[i]);
        pv.inT -= a;
        if (pv.inT > 0) out.preview.push(pv);
      }
    }
    return out;
  };

  return DefenseSide;
})();
