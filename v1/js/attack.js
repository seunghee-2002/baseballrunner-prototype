/* =============================================================
   attack.js — 공격 쪽 규칙 (사람 타자·봇 타자 공용, DOM 없음)
   한 타석: WAIT_PITCH -> PITCH -> BAT_RESULT -> CHANCE -> RUNNING -> (HR_RUN) -> OUTRO -> DONE
   타격 시점에 결과를 확정하지 않는다. CHANCE 를 만들고 주루로 확정한다 (§3, §43).
   화면은 snapshot() 의 events 를 읽어 연출한다 — 공격자 화면과 수비자 화면이 같은 길을 쓴다.
   ============================================================= */

var AttackSim = (function () {

  var PHASE_TIME = { BAT_RESULT: 1.0, CHANCE: 1.15, OUTRO: 0.75 };
  var EVENT_KEEP = 16;

  /* opts: { seq, atBat, level, outs, emit(type, payload), rng, debug } */
  function AttackSim(opts) {
    this.seq = opts.seq;
    this.atBat = opts.atBat;
    this.level = opts.level;
    this.outs = opts.outs || 0;
    this.emit = opts.emit || function () {};
    this.rng = opts.rng || Math.random;
    this.debug = opts.debug || {};

    this.phase = 'WAIT_PITCH';
    this.t = 0;
    this.clock = 0;

    this.pitch = null;
    this.swung = false;
    this.bat = null;

    /* chance 는 타격이 정한 목표, base 는 실제로 밟고 지나간 베이스 수 */
    this.chance = 0;
    this.fast = false;
    this.base = 0;
    this.hrFrom = 0;

    this.gauge = RUN.GAUGE_START;
    this.fever = 0;
    this.combo = 0;
    this.stiff = 0;
    this.invincible = 0;
    this.dust = 0;

    this.leg = null;
    this.obstacles = [];
    this.pending = [];
    this.nextId = 1;

    this.events = [];
    this.eventId = 0;
    this.result = null;
    this.stats = { success: 0, total: 0, perfect: 0, bestCombo: 0 };
  }

  var P = AttackSim.prototype;

  P.setPhase = function (ph) { this.phase = ph; this.t = 0; };

  P.pushEvent = function (e) {
    e.id = ++this.eventId;
    this.events.push(e);
    if (this.events.length > EVENT_KEEP) this.events.shift();
  };

  /* ---------------- 투구 · 타격 ---------------- */

  /* 수비자의 2단계 터치. 같은 칸 = 직구, 다른 칸 = 시작 칸에서 도착 칸으로 휘는 변화구 */
  P.onPitch = function (p) {
    if (this.phase !== 'WAIT_PITCH') return;
    var start = NUM_ZONE[p.startPos] || 'LT';
    var end = NUM_ZONE[p.endPos] || start;
    var type = start === end ? 'FAST' : 'BREAK';
    var dur = LEVELS[this.level].pitchTime * (type === 'FAST' ? PITCH.FASTBALL_MUL : 1);
    this.pitch = { start: start, end: end, type: type, dur: dur, t: 0 };
    this.swung = false;
    this.pushEvent({ type: 'pitch', pitchType: type });
    this.setPhase('PITCH');
  };

  P.swing = function (zone) {
    if (this.phase !== 'PITCH' || this.swung) return;
    this.swung = true;
    this.pushEvent({ type: 'swing', zone: zone });
    this.judgeBat(Math.abs(this.pitch.t - this.pitch.dur), zone, false);
  };

  /* 쳐야 할 칸은 도착 칸이다.
     정확한 칸 = 타이밍 등급 / 옆 칸 = 빗맞은 1B, 그중 일부 LUCKY / 대각선 반대·타이밍 실패 = MISS */
  P.judgeBat = function (err, zone, noSwing) {
    var w = null, i;
    if (!noSwing) {
      for (i = 0; i < BAT_WINDOWS.length; i++) {
        if (err <= BAT_WINDOWS[i].err) { w = BAT_WINDOWS[i]; break; }
      }
    }
    var end = this.pitch.end;
    var bat = { grade: 'MISS', zone: zone || null, end: end, chance: 0, mishit: false, lucky: false, reason: '' };

    if (w && zone === OPPOSITE_ZONE[end]) { w = null; bat.reason = 'DIAGONAL'; }

    if (!w) {
      if (!bat.reason) bat.reason = noSwing ? 'NO_SWING' : (this.pitch.t < this.pitch.dur ? 'EARLY' : 'LATE');
    } else if (zone !== end) {
      bat.mishit = true;
      if (this.rng() < LUCKY.RATE) {
        bat.lucky = true;
        bat.grade = 'LUCKY';
        bat.chance = LUCKY.CHANCES[Math.floor(this.rng() * LUCKY.CHANCES.length)];
      } else {
        bat.grade = 'GOOD';
        bat.chance = 1;
      }
      this.gauge = RUN.GAUGE_START;
    } else {
      bat.grade = w.grade;
      bat.chance = w.chance;
      this.gauge = w.gauge;       // JUST 는 게이지를 높이 들고 출발한다
      this.fast = w.fast;         // JUST/PERFECT 는 앞 두 구간 가속
    }

    this.bat = bat;
    this.emit('BAT_RESULT', { seq: this.seq, result: bat.grade, chance: bat.chance, zone: zone, mishit: bat.mishit });
    this.pushEvent({ type: 'bat', grade: bat.grade, chance: bat.chance, mishit: bat.mishit,
      lucky: bat.lucky, reason: bat.reason, zone: zone, end: end });
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
        if (this.bat.grade === 'MISS') this.pitch.t += dt;     // 헛친 공은 그대로 지나간다
        if (this.t >= PHASE_TIME.BAT_RESULT) {
          if (this.bat.grade === 'MISS') { this.out('MISS'); this.emitOut(); }
          else this.enterChance();
        }
        break;

      case 'CHANCE':
        if (this.t >= PHASE_TIME.CHANCE) {
          this.base = 0;
          this.startLeg();
          this.setPhase('RUNNING');
        }
        break;

      case 'RUNNING':
        this.updateRunning(dt);
        break;

      case 'HR_RUN':
        this.updateHomeRun();
        break;

      case 'OUTRO':
        this.moveObstacles(dt);
        if (this.t >= PHASE_TIME.OUTRO) this.emitOut();     // 실패 연출은 짧게 (§36)
        break;
    }
  };

  P.enterChance = function () {
    this.chance = this.bat.chance;
    this.fever = 0;             // 피버는 타석마다 0 에서 시작한다
    this.pushEvent({ type: 'chance', chance: this.chance });
    this.setPhase('CHANCE');
  };

  /* ---------------- 주루 ----------------
     한 구간 = 베이스 하나. 구간 길이는 시간으로 고정되고, 달리는 중에도 장애물은 끊기지 않는다.
     베이스를 밟는 순간 아직 날아오는 장애물은 다음 구간으로 이어진다. */

  P.startLeg = function () {
    var idx = this.base;
    var duration = legDuration(idx, this.fast);
    this.leg = {
      index: idx, duration: duration, time: 0, clock: 0,
      plan: buildLegPlan(this.level, idx, duration, this.rng, !!this.debug.fan),
      spawnIdx: 0, clear: 0, late: 0, fevered: this.invincible > 0
    };
  };

  P.updateRunning = function (dt) {
    var leg = this.leg;
    /* 무적 돌진 중에는 베이스가 빨리 다가온다. 필드 장애물 일정은 실제 시간 기준이라 압축되지 않는다. */
    leg.time += dt * (this.invincible > 0 ? RUN.FEVER_DASH : 1);
    leg.clock += dt;
    if (this.stiff > 0) this.stiff = Math.max(0, this.stiff - dt);
    if (this.invincible > 0) this.invincible = Math.max(0, this.invincible - dt);
    if (this.dust > 0) this.dust = Math.max(0, this.dust - dt);

    while (leg.spawnIdx < leg.plan.length && leg.plan[leg.spawnIdx].spawnAt <= leg.clock) {
      var s = leg.plan[leg.spawnIdx++];
      this.spawn(OBSTACLES[s.key].kind, OBSTACLES[s.key].spawn, s.speed, null, 0);
    }
    for (var i = this.pending.length - 1; i >= 0; i--) {
      var pd = this.pending[i];
      if (pd.at <= this.clock) {
        this.pending.splice(i, 1);
        this.spawn(pd.kind, pd.zone, pd.speed, pd.card, pd.switchAt);
      }
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
      decel: null, decelDone: false
    });
  };

  /* 거리값 하나로 접근시킨다 (§25). distance 0 = 플레이어 몸 중심 */
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
        if (this.invincible > 0 && o.distance / o.speed <= o.window) {
          this.resolve(o, 'FEVER');
        } else if (o.distance <= 0) {
          this.resolve(o, 'LATE');
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
       1) 누른 칸이 정답인 것이 있으면 가장 가까운 것 성공 (PERFECT_WINDOW 이내면 PERFECT)
       2) 유효 창 안에 장애물은 있는데 정답이 아니면 가장 가까운 것에 WRONG
       3) 유효 창 안에 아무것도 없으면 헛회피 — 짧은 경직
     칸마다 따로 판정하므로 두 칸을 같은 순간에 눌러 두 장애물을 함께 피할 수 있다. */

  P.dodge = function (zone) {
    if (this.phase !== 'RUNNING' || this.invincible > 0 || this.stiff > 0) return;

    var best = null, bestRemain = 1e9, near = null, nearRemain = 1e9;
    for (var i = 0; i < this.obstacles.length; i++) {
      var o = this.obstacles[i];
      if (o.resolved || o.distance <= 0) continue;
      var remain = o.distance / o.speed;
      if (remain > o.window) continue;
      if (remain < nearRemain) { near = o; nearRemain = remain; }
      if (o.required === zone && remain < bestRemain) { best = o; bestRemain = remain; }
    }

    if (best) { this.resolve(best, bestRemain <= RUN.PERFECT_WINDOW ? 'PERFECT' : 'NICE', zone); return; }
    if (near) { this.resolve(near, 'WRONG', zone); return; }

    this.stiff = RUN.WHIFF_STIFF;
    this.pushEvent({ type: 'whiff', zone: zone });
  };

  P.resolve = function (o, verdict, pressed) {
    var leg = this.leg;
    o.resolved = verdict;

    /* 피버 무적으로 지나간 장애물: 태그아웃 판정에서만 '피한 것' 이고 보상·감점은 없다 */
    if (verdict === 'FEVER') { leg.clear++; return; }

    this.stats.total++;
    var ev = { type: 'verdict', verdict: verdict, kind: o.kind, zone: o.zone, required: o.required,
      pressed: pressed || null, card: o.card };

    if (verdict === 'PERFECT' || verdict === 'NICE') {
      var perfect = verdict === 'PERFECT';
      var mult = 1 + Math.min(this.combo, RUN.COMBO_MAX) * RUN.COMBO_STEP;   // 연속 성공일수록 크게
      var rw = o.def.reward;
      this.stats.success++;
      if (perfect) this.stats.perfect++;
      leg.clear++;
      this.combo++;
      if (this.combo > this.stats.bestCombo) this.stats.bestCombo = this.combo;

      this.gauge = Math.min(RUN.GAUGE_MAX,
        this.gauge + (rw ? rw.gauge : Math.round((perfect ? RUN.GAUGE_PERFECT : RUN.GAUGE_NICE) * mult)));
      this.fever = Math.min(RUN.FEVER_MAX,
        this.fever + (rw ? rw.fever : Math.round((perfect ? RUN.FEVER_PERFECT : RUN.FEVER_NICE) * mult)));

      ev.combo = this.combo;
      this.pushEvent(ev);
      if (o.def.costGain) this.emit('DODGE_SUCCESS', { seq: this.seq, costGained: o.def.costGain });
      return;
    }

    /* WRONG 은 잘못 누른 쪽으로 실제로 피한 뒤 맞는다 — 왜 맞았는지 보여야 한다 (§37).
       아예 반응하지 못한 TOO LATE 가 더 무겁다. */
    this.combo = 0;
    if (verdict === 'WRONG') this.gauge += o.def.penalty;
    else { this.gauge += o.def.penaltyLate; leg.late++; }
    this.pushEvent(ev);

    if (this.gauge <= 0) { this.gauge = 0; this.out('GAUGE'); }
    else if (leg.late >= RUN.LATE_OUT) this.out('NO_REACTION');
  };

  P.reachBase = function () {
    /* 한 구간에서 단 하나도 피하지 못했다면 베이스 앞에서 잡힌다 (§19).
       피버 무적을 쓴 구간은 예외 — 무적으로 건너뛴 구간을 벌하지 않는다. */
    if (this.leg.clear === 0 && !this.leg.fevered) { this.out('NO_DODGE'); return; }

    this.base++;
    this.pushEvent({ type: 'base', base: this.base });
    if (this.base >= this.chance) { this.safe(this.base); return; }
    this.startLeg();
  };

  /* ---------------- 피버 ---------------- */

  P.activateFever = function () {
    if (this.phase !== 'RUNNING' || this.fever < RUN.FEVER_MAX || this.invincible > 0) return;
    this.fever = 0;

    /* 3B CHANCE 에서 발동하면 홈런 직행. 일반 주루로는 HR 이 나오지 않는다. */
    if (this.chance >= MAX_BAT_CHANCE) {
      this.emit('FEVER_ACTIVATE', { seq: this.seq, isHomeRun: true });
      this.pushEvent({ type: 'homerun' });
      this.obstacles = [];
      this.pending = [];
      this.hrFrom = this.base;
      this.setPhase('HR_RUN');
      return;
    }

    this.invincible = RUN.FEVER_GUARD_TIME;
    this.gauge = Math.min(RUN.GAUGE_MAX, this.gauge + RUN.FEVER_GUARD_GAUGE);
    this.leg.fevered = true;
    this.emit('FEVER_ACTIVATE', { seq: this.seq, isHomeRun: false });
    this.pushEvent({ type: 'fever' });
  };

  P.updateHomeRun = function () {
    var span = RUN.HR_RUN_TIME / (HOME_RUN - this.hrFrom);
    var target = Math.min(HOME_RUN, this.hrFrom + Math.floor(this.t / span));
    while (this.base < target) {
      this.base++;
      this.pushEvent({ type: 'base', base: this.base });
    }
    if (this.t >= RUN.HR_RUN_TIME) {
      this.base = HOME_RUN;
      this.safe(HOME_RUN);
    }
  };

  /* ---------------- 수비 카드 ---------------- */

  P.onCard = function (p) {
    var card = CARDS[p && p.cardId];
    if (!card || this.phase !== 'RUNNING') return;

    if (card.effect) { this.applyEffect(card); return; }

    var L = LEVELS[this.level], zones = p.zones || [], plans = [], lead = 0, i;
    for (i = 0; i < card.spawns.length; i++) {
      var sp = card.spawns[i];
      var allowed = SLOT_ZONES[card.slots[sp.slot]];
      var zone = allowed.indexOf(zones[sp.slot]) >= 0 ? zones[sp.slot] : allowed[0];
      var speed = OBSTACLES[obstacleKey(sp.kind, zone)].moveSpeed * L.speedMul * (sp.speedMul || 1) * windMul(this.rng);
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

  P.applyEffect = function (card) {
    var fx = card.effect;
    if (fx.type === 'dust') {
      this.dust = fx.time;
    } else if (fx.type === 'decel') {
      var target = findDecelTarget(this.obstacles, fx.at);
      if (!target) return;
      target.decel = { at: fx.at, speedMul: fx.speedMul };
    }
    this.pushEvent({ type: 'card', cardId: card.id });
  };

  /* C07 대상: 아직 감속 지점에 닿지 않은, 가장 가까이 오는 공. 스냅숏 객체에도 그대로 쓴다. */
  function findDecelTarget(list, at) {
    var best = null, bestRemain = 1e9;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.kind !== 'ball' || o.resolved || o.decel) continue;
      var remain = o.distance / o.speed;
      if (remain <= at) continue;
      if (remain < bestRemain) { best = o; bestRemain = remain; }
    }
    return best;
  }

  /* ---------------- 결과 ---------------- */

  P.out = function (reason) {
    this.result = { out: true, reason: reason, bases: 0 };
    this.pending = [];
    this.pushEvent({ type: 'out', reason: reason });
    this.setPhase('OUTRO');
  };

  P.emitOut = function () {
    this.emit('OUT_OCCURRED', this.summary({ currentOuts: this.outs + 1, reason: this.result.reason }));
    this.setPhase('DONE');
  };

  /* 최종 결과는 "갈 수 있었던 곳" 이 아니라 실제로 밟고 지나간 베이스 */
  P.safe = function (bases) {
    this.result = { out: false, reason: '', bases: bases };
    this.obstacles = [];
    this.pending = [];
    this.pushEvent({ type: 'safe', bases: bases });
    this.emit('SAFE', this.summary({ bases: bases, result: CHANCE_LABEL[bases] }));
    this.setPhase('DONE');
  };

  P.summary = function (extra) {
    var s = {
      seq: this.seq,
      batGrade: this.bat ? this.bat.grade : '',
      mishit: this.bat ? this.bat.mishit : false,
      startChance: this.bat ? this.bat.chance : 0,
      stats: { success: this.stats.success, total: this.stats.total,
               perfect: this.stats.perfect, bestCombo: this.stats.bestCombo }
    };
    for (var k in extra) s[k] = extra[k];
    return s;
  };

  /* 마지막 베이스까지 남은 시간(표준 속도). 수비자가 카드를 쓸 수 있는지 판단한다. */
  P.timeToFinal = function () {
    if (this.phase !== 'RUNNING' || !this.leg) return 0;
    var t = this.leg.duration - this.leg.time;
    for (var i = this.base + 1; i < this.chance; i++) t += legDuration(i, this.fast);
    return t;
  };

  P.snapshot = function () {
    var obs = [];
    for (var i = 0; i < this.obstacles.length; i++) {
      var o = this.obstacles[i];
      obs.push({
        id: o.id, kind: o.kind, zone: o.zone, fromZone: o.fromZone, required: o.required,
        distance: o.distance, speed: o.speed, window: o.window, resolved: o.resolved, card: o.card,
        switched: o.switched, switchDist: o.switchDist, decel: !!o.decel
      });
    }
    var pt = this.pitch;
    return {
      seq: this.seq, atBat: this.atBat, level: this.level, outs: this.outs,
      phase: this.phase, t: this.t,
      pitch: pt ? { start: pt.start, end: pt.end, type: pt.type, dur: pt.dur, t: pt.t } : null,
      bat: this.bat, chance: this.chance, fast: this.fast, base: this.base, hrFrom: this.hrFrom,
      leg: this.leg ? { index: this.leg.index, time: this.leg.time, duration: this.leg.duration } : null,
      toFinal: this.timeToFinal(),
      gauge: this.gauge, fever: this.fever, combo: this.combo,
      invincible: this.invincible, stiff: this.stiff, dust: this.dust,
      obstacles: obs, events: this.events.slice(), result: this.result, stats: this.stats
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
        seq: p.seq, atBat: p.atBat, level: p.level, outs: p.outs, debug: this.debug, rng: this.rng,
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
