/* =============================================================
   attack.js — 공격 쪽 규칙 (사람 타자·봇 타자 공용, DOM 없음)
   한 타석: WAIT_PITCH -> PITCH -> BAT_RESULT -> (WAIT_PITCH 다시 | RUNNING | 삼진 DONE)
            RUNNING -> 홈 도착 DONE / 생명 0 OUTRO -> DONE
   타격은 생명 수를 주고, 주루는 생명이 다할 때까지 이어진다. 어디까지 갔느냐가 점수다.
   화면은 snapshot() 의 events 를 읽어 연출한다 — 공격자 화면과 수비자 화면이 같은 길을 쓴다.
   ============================================================= */

var AttackSim = (function () {

  var EVENT_KEEP = 16;

  /* opts: { seq, emit(type, payload), rng, debug } */
  function AttackSim(opts) {
    this.seq = opts.seq;
    this.emit = opts.emit || function () {};
    this.rng = opts.rng || Math.random;
    this.debug = opts.debug || {};

    this.phase = 'WAIT_PITCH';
    this.t = 0;
    this.clock = 0;

    this.pitch = null;
    this.pitchNo = 0;
    this.queuedPitch = null;
    this.swung = false;
    this.bat = null;
    this.strikes = 0;
    this.balls = 0;

    this.lives = 0;
    this.livesStart = 0;
    this.boostLegs = 0;
    this.base = 0;
    this.startBase = 0;
    this.stiff = 0;
    this.dust = 0;

    this.leg = null;
    this.nextPlan = null;
    this.obstacles = [];
    this.pending = [];       // 카드 장애물 출발 대기
    this.warnings = [];      // 경고 중인 교란 카드
    this.nextId = 1;

    this.events = [];
    this.eventId = 0;
    this.result = null;
    this.stats = { success: 0, total: 0, perfect: 0 };
  }

  var P = AttackSim.prototype;

  P.setPhase = function (ph) { this.phase = ph; this.t = 0; };

  P.pushEvent = function (e) {
    e.id = ++this.eventId;
    this.events.push(e);
    if (this.events.length > EVENT_KEEP) this.events.shift();
  };

  /* ---------------- 투구 · 타격 ---------------- */

  /* p: { pitchNo, cardId(직구 null), start(타자 시점 칸), speedMul, timeout } */
  P.onPitch = function (p) {
    if (p.pitchNo !== this.pitchNo + 1) return;
    if (this.phase === 'BAT_RESULT') { this.queuedPitch = p; return; }
    if (this.phase !== 'WAIT_PITCH' || !ZONE_CELL[p.start]) return;

    var path = pitchPath(p.cardId || null, p.start);
    var card = pitchCard(p.cardId || null);
    this.pitchNo = p.pitchNo;
    this.pitch = {
      cardId: p.cardId || null, start: path.start, end: path.end, startCell: path.startCell, endCell: path.endCell,
      ball: path.ball, breaking: path.breaking, dur: PITCH.BASE_TIME * card.timeMul * (p.speedMul || 1), t: 0
    };
    this.swung = false;
    this.pushEvent({ type: 'pitch', cardId: this.pitch.cardId });
    this.setPhase('PITCH');
  };

  P.swing = function (zone) {
    if (this.phase !== 'PITCH' || this.swung) return;
    this.swung = true;
    this.pushEvent({ type: 'swing', zone: zone });
    this.judgeBat(Math.abs(this.pitch.t - this.pitch.dur), zone, false);
  };

  /* 쳐야 할 칸은 도착 칸이다.
     볼: 스윙하지 않으면 볼, 스윙하면 스트라이크.
     스트라이크 존: 도착 칸 = 타이밍 등급 / 옆 칸 = 파울(25% LUCKY) / 대각선 반대·타이밍 실패·무스윙 = 스트라이크 */
  P.judgeBat = function (err, zone, noSwing) {
    var pt = this.pitch, w = null, i;
    var bat = { grade: 'STRIKE', reason: '', zone: zone || null, end: pt.end, ball: pt.ball, lives: 0, boostLegs: 0 };

    if (pt.ball) {
      if (noSwing) bat.grade = 'BALL';
      else bat.reason = 'BALL_SWING';
    } else if (noSwing) {
      bat.reason = 'NO_SWING';
    } else {
      for (i = 0; i < BAT_WINDOWS.length; i++) {
        if (err <= BAT_WINDOWS[i].err) { w = BAT_WINDOWS[i]; break; }
      }
      if (!w) bat.reason = pt.t < pt.dur ? 'EARLY' : 'LATE';
      else if (zone === OPPOSITE_ZONE[pt.end]) bat.reason = 'DIAGONAL';
      else if (zone !== pt.end) {
        if (this.rng() < LUCKY.RATE) { bat.grade = 'LUCKY'; bat.lives = LUCKY.LIVES; }
        else bat.reason = 'FOUL';
      } else {
        bat.grade = w.grade;
        bat.lives = w.lives;
        bat.boostLegs = w.boostLegs;
      }
    }

    if (bat.grade === 'STRIKE') this.strikes++;
    else if (bat.grade === 'BALL') this.balls++;

    if (bat.grade === 'STRIKE') bat.outcome = this.strikes >= COUNT.STRIKE_OUT ? 'STRIKEOUT' : 'CONTINUE';
    else if (bat.grade === 'BALL') bat.outcome = this.balls >= COUNT.BALL_WALK ? 'WALK' : 'CONTINUE';
    else bat.outcome = 'HIT';
    bat.strikes = this.strikes;
    bat.balls = this.balls;

    this.bat = bat;
    this.emit('BAT_RESULT', { seq: this.seq, pitchNo: this.pitchNo, result: bat.grade, reason: bat.reason,
      outcome: bat.outcome, strikes: bat.strikes, balls: bat.balls, lives: bat.lives });
    var ev = { type: 'bat' };
    for (var k in bat) ev[k] = bat[k];
    this.pushEvent(ev);
    this.setPhase('BAT_RESULT');
  };

  /* ---------------- 루프 ---------------- */

  P.update = function (dt) {
    this.t += dt;
    this.clock += dt;

    switch (this.phase) {
      case 'PITCH':
        this.pitch.t += dt;
        if (!this.swung && this.pitch.t > this.pitch.dur + PITCH.SWING_GRACE) {
          this.swung = true;
          this.judgeBat(999, null, true);
        }
        break;

      case 'BAT_RESULT':
        if (this.bat.outcome !== 'HIT') this.pitch.t += dt;     // 치지 못한 공은 그대로 지나간다
        if (this.t >= PITCH.RESULT_TIME) this.afterBat();
        break;

      case 'RUNNING':
        this.updateRunning(dt);
        break;

      case 'OUTRO':
        this.moveObstacles(dt);
        if (this.t >= RUN.OUTRO) this.finish();              // 실패 연출은 짧게
        break;
    }
  };

  P.afterBat = function () {
    var bat = this.bat;
    if (bat.outcome === 'CONTINUE') {
      this.pitch = null;
      this.setPhase('WAIT_PITCH');
      if (this.queuedPitch) { var q = this.queuedPitch; this.queuedPitch = null; this.onPitch(q); }
    } else if (bat.outcome === 'STRIKEOUT') {
      this.result = { out: true, reason: 'STRIKEOUT', bases: 0 };
      this.pushEvent({ type: 'out', reason: 'STRIKEOUT' });
      this.finish();
    } else if (bat.outcome === 'WALK') {
      this.startRun(COUNT.WALK_BASE, COUNT.WALK_LIVES, 0, true);
    } else {
      this.startRun(0, bat.lives, bat.boostLegs, false);
    }
  };

  /* ---------------- 주루 ----------------
     한 구간 = 베이스 하나. 구간 길이는 시간으로 고정되고, 달리는 중에도 장애물은 끊기지 않는다.
     베이스를 밟는 순간 아직 날아오는 장애물은 다음 구간으로 이어진다. */

  P.startRun = function (base, lives, boostLegs, walk) {
    this.base = base;
    this.startBase = base;
    this.lives = Math.min(RUN.LIFE_MAX, lives);
    this.livesStart = this.lives;
    this.boostLegs = boostLegs;
    this.pitch = null;
    this.startLeg();
    this.pushEvent({ type: 'run', lives: this.lives, base: base, boostLegs: boostLegs, walk: walk });
    this.setPhase('RUNNING');
  };

  P.makePlan = function (idx) {
    return { index: idx, plan: buildLegPlan(idx, legDuration(idx, this.boostLegs), this.rng, !!this.debug.fan) };
  };

  P.startLeg = function () {
    var idx = this.base;
    var next = this.nextPlan && this.nextPlan.index === idx ? this.nextPlan : this.makePlan(idx);
    this.nextPlan = null;
    this.leg = { index: idx, duration: legDuration(idx, this.boostLegs), time: 0, plan: next.plan, spawnIdx: 0,
                 boosted: idx < this.boostLegs };
  };

  P.updateRunning = function (dt) {
    var leg = this.leg, i;
    leg.time += dt;
    if (this.stiff > 0) this.stiff = Math.max(0, this.stiff - dt);
    if (this.dust > 0) this.dust = Math.max(0, this.dust - dt);

    while (leg.spawnIdx < leg.plan.length && leg.plan[leg.spawnIdx].spawnAt <= leg.time) {
      var s = leg.plan[leg.spawnIdx++];
      this.spawn(OBSTACLES[s.key].kind, OBSTACLES[s.key].spawn, s.speed, null, 0);
    }
    for (i = this.pending.length - 1; i >= 0; i--) {
      var pd = this.pending[i];
      if (pd.at <= this.clock) {
        this.pending.splice(i, 1);
        this.spawn(pd.kind, pd.zone, pd.speed, pd.card, pd.switchAt);
      }
    }
    for (i = this.warnings.length - 1; i >= 0; i--) {
      var w = this.warnings[i];
      w.left -= dt;
      if (w.left <= 0) { this.warnings.splice(i, 1); this.applyEffect(w); }
    }

    /* 수비자 선행 표시가 구간 경계를 넘을 수 있게 다음 구간 일정을 미리 만든다 */
    if (!this.nextPlan && leg.index + 1 < HOME && leg.duration - leg.time <= RUN.PREVIEW_TIME) {
      this.nextPlan = this.makePlan(leg.index + 1);
    }

    this.moveObstacles(dt);
    if (this.phase !== 'RUNNING') return;

    if (leg.time >= leg.duration) this.reachBase();
  };

  P.spawn = function (kind, zone, speed, card, switchAt) {
    var def = OBSTACLES[obstacleKey(kind, zone)];
    this.obstacles.push({
      id: this.nextId++, kind: kind, zone: zone, fromZone: zone, def: def, required: def.requiredInput,
      distance: RUN.START_DISTANCE, speed: speed, window: def.reactionTime, resolved: null,
      card: card || null, switchAt: switchAt || 0, switched: false, switchDist: 0,
      decel: null, decelDone: false, decelWarn: false
    });
  };

  /* 거리값 하나로 접근시킨다. distance 0 = 플레이어 몸 중심 */
  P.moveObstacles = function (dt) {
    for (var i = this.obstacles.length - 1; i >= 0; i--) {
      var o = this.obstacles[i];
      o.distance -= o.speed * dt;

      if (!o.resolved && this.phase === 'RUNNING') {
        /* C03·C04: 유효 창이 열리기 직전에 같은 높이 반대편으로 옮겨간다 */
        if (o.switchAt && !o.switched && o.distance / o.speed <= o.switchAt) this.switchZone(o);
        /* C07: 충돌 직전 감속 — 원래 타이밍에 누른 손을 헛회피로 만든다 */
        if (o.decel && !o.decelDone && o.distance / o.speed <= o.decel.at) {
          o.speed *= o.decel.speedMul;
          o.decelDone = true;
        }
        if (o.distance <= 0) {
          this.resolve(o, 'BAD', null);
          if (this.phase !== 'RUNNING') return;
        }
      }

      if (o.distance <= -12) this.obstacles.splice(i, 1);
    }
  };

  P.switchZone = function (o) {
    o.fromZone = o.zone;
    o.zone = MIRROR_ZONE[o.zone];
    o.def = OBSTACLES[obstacleKey(o.kind, o.zone)];
    o.required = o.def.requiredInput;
    o.switched = true;
    o.switchDist = o.distance;
  };

  /* ---------------- 회피 판정 ----------------
     누르는 순간 판정한다. 충돌까지 유효 창 안으로 들어온 장애물 중
       1) 누른 칸이 정답인 것이 있으면 가장 가까운 것 성공 (0.15 PERFECT / 0.30 GREAT / 그 전 GOOD)
       2) 유효 창 안에 장애물은 있는데 정답이 아니면 가장 가까운 것에 BAD
       3) 유효 창 안에 아무것도 없으면 헛회피 — 짧은 경직
     칸마다 따로 판정하므로 두 칸을 같은 순간에 눌러 두 장애물을 함께 피할 수 있다. */

  P.dodge = function (zone) {
    if (this.phase !== 'RUNNING' || this.stiff > 0) return;

    var best = null, bestRemain = 1e9, near = null, nearRemain = 1e9;
    for (var i = 0; i < this.obstacles.length; i++) {
      var o = this.obstacles[i];
      if (o.resolved || o.distance <= 0) continue;
      var remain = o.distance / o.speed;
      if (remain > o.window) continue;
      if (remain < nearRemain) { near = o; nearRemain = remain; }
      if (o.required === zone && remain < bestRemain) { best = o; bestRemain = remain; }
    }

    if (best) {
      this.resolve(best, bestRemain <= RUN.PERFECT_WINDOW ? 'PERFECT' : (bestRemain <= RUN.GREAT_WINDOW ? 'GREAT' : 'GOOD'), zone);
      return;
    }
    if (near) { this.resolve(near, 'BAD', zone); return; }

    this.stiff = RUN.WHIFF_STIFF;
    this.pushEvent({ type: 'whiff', zone: zone });
  };

  P.resolve = function (o, verdict, pressed) {
    o.resolved = verdict;
    this.stats.total++;
    var ev = { type: 'verdict', verdict: verdict, kind: o.kind, zone: o.zone, required: o.required,
      pressed: pressed || null, card: o.card };

    if (verdict !== 'BAD') {
      this.stats.success++;
      if (verdict === 'PERFECT') this.stats.perfect++;
      this.pushEvent(ev);
      if (o.def.costGain) this.emit('DODGE_SUCCESS', { seq: this.seq, costGained: o.def.costGain });
      return;
    }

    /* 틀린 칸은 잘못 누른 쪽으로 실제로 피한 뒤 맞는다 — 왜 맞았는지 보여야 한다 */
    this.lives = Math.max(0, this.lives - o.def.lifeLoss);
    ev.lives = this.lives;
    this.pushEvent(ev);
    if (this.lives <= 0) this.endByLives();
  };

  /* 생명 0: 마지막으로 밟은 베이스에서 세이프. 1루도 못 밟았으면 아웃 */
  P.endByLives = function () {
    this.pending = [];
    this.warnings = [];
    if (this.base >= 1) {
      this.result = { out: false, reason: 'LIVES', bases: this.base };
      this.pushEvent({ type: 'down', bases: this.base });
    } else {
      this.result = { out: true, reason: 'NO_FIRST', bases: 0 };
      this.pushEvent({ type: 'out', reason: 'NO_FIRST' });
    }
    this.setPhase('OUTRO');
  };

  P.reachBase = function () {
    this.base++;
    this.pushEvent({ type: 'base', base: this.base });
    if (this.base >= HOME) {
      this.result = { out: false, reason: 'HOME', bases: HOME };
      this.obstacles = [];
      this.pending = [];
      this.warnings = [];
      this.pushEvent({ type: 'homerun' });
      this.finish();
      return;
    }
    this.startLeg();
  };

  /* ---------------- 수비 카드 ---------------- */

  P.onCard = function (p) {
    var card = CARDS[p && p.cardId];
    if (!card || this.phase !== 'RUNNING') return;

    if (card.effect) { this.warnEffect(card); return; }

    var speedMul = LEGS[this.leg.index].speedMul, zones = p.zones || [], plans = [], lead = 0, i;
    for (i = 0; i < card.spawns.length; i++) {
      var sp = card.spawns[i];
      var allowed = SLOT_ZONES[card.slots[sp.slot]];
      var zone = allowed.indexOf(zones[sp.slot]) >= 0 ? zones[sp.slot] : allowed[0];
      var speed = OBSTACLES[obstacleKey(sp.kind, zone)].moveSpeed * speedMul * (sp.speedMul || 1) * windMul(this.rng);
      var travel = RUN.START_DISTANCE / speed;
      plans.push({ sp: sp, zone: zone, speed: speed, travel: travel });
      lead = Math.max(lead, travel - sp.delay);
    }

    /* delay 는 '충돌 시각' 차이다. 속도가 달라도 C06 의 공과 태클이 정확히 그만큼 엇갈리게 한다 */
    for (i = 0; i < plans.length; i++) {
      var pl = plans[i];
      this.pending.push({
        at: this.clock + lead + pl.sp.delay - pl.travel, kind: pl.sp.kind, zone: pl.zone,
        speed: pl.speed, card: card.id, switchAt: pl.sp.switchAt || 0
      });
    }
    this.pushEvent({ type: 'card', cardId: card.id });
  };

  /* 교란 카드는 공격자 화면에 경고를 먼저 띄우고 WARN_TIME 뒤에 적용한다.
     감속은 대상 공에 표시가 붙고, 흙먼지는 화면 가장자리에 먼지가 피어오른다. */
  P.warnEffect = function (card) {
    var fx = card.effect, target = null;
    if (fx.type === 'decel') {
      target = findDecelTarget(this.obstacles, fx.at + DEFENSE.WARN_TIME);
      if (!target) return;
      target.decelWarn = true;
    }
    this.warnings.push({ card: card, left: DEFENSE.WARN_TIME, target: target });
    this.pushEvent({ type: 'warn', effect: fx.type });
    this.pushEvent({ type: 'card', cardId: card.id });
  };

  P.applyEffect = function (w) {
    var fx = w.card.effect;
    if (fx.type === 'dust') { this.dust = fx.time; return; }
    var target = w.target;
    if (!target || target.resolved || target.distance / target.speed <= fx.at) {
      if (target) target.decelWarn = false;
      target = findDecelTarget(this.obstacles, fx.at);
      if (!target) return;
    }
    target.decelWarn = false;
    target.decel = { at: fx.at, speedMul: fx.speedMul };
  };

  /* C07 대상: 충돌까지 minRemain 보다 멀리 있는, 가장 가까이 오는 공. 스냅숏 객체에도 그대로 쓴다. */
  function findDecelTarget(list, minRemain) {
    var best = null, bestRemain = 1e9;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.kind !== 'ball' || o.resolved || o.decel || o.decelWarn) continue;
      var remain = o.distance / o.speed;
      if (remain <= minRemain) continue;
      if (remain < bestRemain) { best = o; bestRemain = remain; }
    }
    return best;
  }

  /* ---------------- 결과 ---------------- */

  P.finish = function () {
    var r = this.result;
    this.emit('AT_BAT_END', {
      seq: this.seq, out: r.out, reason: r.reason, bases: r.bases, walk: this.startBase === COUNT.WALK_BASE,
      batGrade: this.bat ? this.bat.grade : '', livesStart: this.livesStart, livesLeft: this.lives,
      stats: { success: this.stats.success, total: this.stats.total, perfect: this.stats.perfect }
    });
    this.setPhase('DONE');
  };

  /* 홈까지 남은 시간. 수비자가 장애물 카드를 쓸 수 있는지 판단한다. */
  P.timeToHome = function () {
    if (this.phase !== 'RUNNING' || !this.leg) return 0;
    var t = this.leg.duration - this.leg.time;
    for (var i = this.leg.index + 1; i < HOME; i++) t += legDuration(i, this.boostLegs);
    return t;
  };

  /* 수비자 선행 표시: 앞으로 PREVIEW_TIME 안에 출발할 필드 장애물 */
  P.preview = function () {
    var out = [], leg = this.leg, i, e, inT;
    if (this.phase !== 'RUNNING' || !leg) return out;
    for (i = leg.spawnIdx; i < leg.plan.length; i++) {
      e = leg.plan[i];
      inT = e.spawnAt - leg.time;
      if (inT > RUN.PREVIEW_TIME) break;
      out.push({ key: e.key, kind: OBSTACLES[e.key].kind, zone: OBSTACLES[e.key].spawn, inT: inT });
    }
    if (this.nextPlan) {
      var left = leg.duration - leg.time;
      for (i = 0; i < this.nextPlan.plan.length; i++) {
        e = this.nextPlan.plan[i];
        inT = left + e.spawnAt;
        if (inT > RUN.PREVIEW_TIME) break;
        out.push({ key: e.key, kind: OBSTACLES[e.key].kind, zone: OBSTACLES[e.key].spawn, inT: inT });
      }
    }
    return out;
  };

  P.snapshot = function () {
    var obs = [];
    for (var i = 0; i < this.obstacles.length; i++) {
      var o = this.obstacles[i];
      obs.push({
        id: o.id, kind: o.kind, zone: o.zone, fromZone: o.fromZone, required: o.required,
        distance: o.distance, speed: o.speed, window: o.window, resolved: o.resolved, card: o.card,
        switched: o.switched, switchDist: o.switchDist, decel: !!o.decel, decelWarn: o.decelWarn
      });
    }
    var dustWarn = false;
    for (var w = 0; w < this.warnings.length; w++) if (this.warnings[w].card.effect.type === 'dust') dustWarn = true;
    var pt = this.pitch;
    return {
      seq: this.seq, phase: this.phase, t: this.t, pitchNo: this.pitchNo,
      strikes: this.strikes, balls: this.balls,
      pitch: pt ? { cardId: pt.cardId, start: pt.start, end: pt.end, startCell: pt.startCell, endCell: pt.endCell,
                    ball: pt.ball, breaking: pt.breaking, dur: pt.dur, t: pt.t } : null,
      bat: this.bat, lives: this.lives, livesStart: this.livesStart, base: this.base, startBase: this.startBase,
      boostLegs: this.boostLegs,
      leg: this.leg ? { index: this.leg.index, time: this.leg.time, duration: this.leg.duration, boosted: this.leg.boosted } : null,
      toHome: this.timeToHome(), stiff: this.stiff, dust: this.dust, dustWarn: dustWarn,
      obstacles: obs, preview: this.preview(), events: this.events.slice(), result: this.result, stats: this.stats
    };
  };

  AttackSim.findDecelTarget = findDecelTarget;
  return AttackSim;
})();

/* 공격 역할의 통신 껍데기. 사람 타자와 봇 타자가 같이 쓴다.
   endpoint.send(type, payload) 로 내보내고, handle(type, payload) 로 받는다. */
var AttackSide = (function () {

  function AttackSide(endpoint, opts) {
    this.endpoint = endpoint;
    this.debug = (opts && opts.debug) || {};
    this.rng = (opts && opts.rng) || Math.random;
    this.sim = null;
    this.sendTimer = 0;
  }

  var P = AttackSide.prototype;

  P.handle = function (type, p) {
    var self = this;
    if (type === 'AT_BAT_START') {
      this.sim = new AttackSim({
        seq: p.seq, debug: this.debug, rng: this.rng,
        emit: function (t, payload) { self.endpoint.send(t, payload); }
      });
      this.sendTimer = 0;
      return;
    }
    if (!this.sim || (p && p.seq !== undefined && p.seq !== this.sim.seq)) return;
    if (type === 'PITCH_SELECT') this.sim.onPitch(p);
    else if (type === 'CARD_PLAY') this.sim.onCard(p);
  };

  P.update = function (dt) {
    if (!this.sim) return;
    this.sim.update(dt);
    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      this.sendTimer = 1 / RUN.SNAPSHOT_HZ;
      this.endpoint.send('RUN_STATE', this.sim.snapshot());
    }
  };

  return AttackSide;
})();
