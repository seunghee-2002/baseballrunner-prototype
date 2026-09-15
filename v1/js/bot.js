/* =============================================================
   bot.js — 1인 연습 모드용 봇 (정교한 AI 가 아니다, 확률로만 움직인다)
   BotDefender : 무작위 2단계 투구, 코스트가 되면 확률적으로 카드를 쓴다
   BotBatter   : 확률로 타격·회피하고, 가끔 C03/C04 전환과 C07 감속에 속는다
   ============================================================= */

var BotDefender = (function () {

  var FASTBALL_RATE = 0.4;
  var THINK_EVERY = 0.5;
  var CARD_RATE = 0.35;       // 한 번 생각할 때 카드를 쓸 확률

  function BotDefender(side, rng) {
    this.side = side;
    this.rng = rng || Math.random;
    this.pitchIn = -1;
    this.think = 0;
  }

  var P = BotDefender.prototype;

  P.handle = function (type) {
    if (type === 'AT_BAT_START') this.pitchIn = 0.8 + this.rng() * 1.4;
  };

  P.update = function (dt) {
    var side = this.side, rng = this.rng;

    if (side.selecting && this.pitchIn > 0) {
      this.pitchIn -= dt;
      if (this.pitchIn <= 0) {
        var start = ZONES[Math.floor(rng() * 4)], end = start;
        if (rng() >= FASTBALL_RATE) {
          while (end === start) end = ZONES[Math.floor(rng() * 4)];
        }
        side.tapZone(start);
        side.tapZone(end);
      }
    }

    this.think -= dt;
    if (this.think > 0) return;
    this.think = THINK_EVERY;

    var view = side.liveView();
    if (!view || view.phase !== 'RUNNING' || rng() > CARD_RATE) return;
    var usable = [];
    for (var i = 0; i < side.state.hand.length; i++) {
      if (!side.state.blockReason(i, view)) usable.push(i);
    }
    if (usable.length) side.playCard(usable[Math.floor(rng() * usable.length)]);
  };

  return BotDefender;
})();

var BotBatter = (function () {

  var SKILL = {
    course: 0.70,       // 도착 칸을 정확히 친다
    adjacent: 0.20,     // 옆 칸 (나머지는 대각선)
    timingSd: 0.09,     // 타이밍 오차 표준편차(초)
    noSwing: 0.05,
    dodgeRight: 0.85,   // 정답 칸으로 회피
    dodgeWrong: 0.08,   // 엉뚱한 칸 (나머지는 반응 못함)
    fooledSwitch: 0.3,  // C03/C04 전환을 보고도 원래 칸을 누른다
    fooledDecel: 0.5,   // C07 감속 직전에 원래 타이밍으로 먼저 누른다
    planWithin: 0.9     // 충돌까지 이 시간 안에 들어온 장애물부터 대응을 정한다
  };

  function gaussian(rng) {
    var u = 1 - rng(), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function otherZone(zone, rng) {
    var z = zone;
    while (z === zone) z = ZONES[Math.floor(rng() * 4)];
    return z;
  }

  function BotBatter(side, rng) {
    this.side = side;
    this.rng = rng || Math.random;
    this.seq = -1;
    this.plans = {};
    this.swingAt = -1;
    this.swingZone = null;
  }

  var P = BotBatter.prototype;

  P.handle = function () {};

  P.update = function () {
    var sim = this.side.sim, rng = this.rng;
    if (!sim) return;
    if (sim.seq !== this.seq) {
      this.seq = sim.seq;
      this.plans = {};
      this.swingAt = -1;
    }

    if (sim.phase === 'PITCH') this.bat(sim);
    if (sim.phase !== 'RUNNING') return;

    for (var i = 0; i < sim.obstacles.length; i++) {
      var o = sim.obstacles[i];
      if (o.resolved) continue;
      var remain = o.distance / o.speed;
      var key = (o.switched ? 's' : '') + (o.decelDone ? 'd' : '');
      var plan = this.plans[o.id];

      if (!plan) {
        if (remain > SKILL.planWithin) continue;
        plan = this.plans[o.id] = this.makePlan(o.required, key);
      } else if (plan.key !== key) {
        var decelNow = o.decelDone && plan.key.indexOf('d') < 0;
        if (decelNow && plan.zone && rng() < SKILL.fooledDecel) sim.dodge(plan.zone);      // 속았다 → 헛회피
        var keepOld = !decelNow && plan.zone && rng() < SKILL.fooledSwitch;
        plan = this.plans[o.id] = keepOld ? { key: key, zone: plan.zone, at: plan.at } : this.makePlan(o.required, key);
      }

      if (!plan.fired && plan.zone && remain <= plan.at) {
        plan.fired = true;
        sim.dodge(plan.zone);
      }
    }

    if (sim.fever >= RUN.FEVER_MAX && (sim.chance >= MAX_BAT_CHANCE || sim.gauge < 40)) sim.activateFever();
  };

  P.makePlan = function (required, key) {
    var r = this.rng();
    var plan = { key: key, zone: null, at: 0.05 + this.rng() * 0.33 };
    if (r < SKILL.dodgeRight) plan.zone = required;
    else if (r < SKILL.dodgeRight + SKILL.dodgeWrong) plan.zone = otherZone(required, this.rng);
    return plan;
  };

  P.bat = function (sim) {
    var rng = this.rng;
    if (this.swingAt < 0) {
      var end = sim.pitch.end, r = rng();
      if (r < SKILL.course) this.swingZone = end;
      else if (r < SKILL.course + SKILL.adjacent) {
        var z = end;
        while (z === end || z === OPPOSITE_ZONE[end]) z = ZONES[Math.floor(rng() * 4)];
        this.swingZone = z;
      } else this.swingZone = OPPOSITE_ZONE[end];
      this.swingAt = rng() < SKILL.noSwing ? 1e9 : Math.max(0.01, sim.pitch.dur + gaussian(rng) * SKILL.timingSd);
    }
    if (sim.pitch.t >= this.swingAt) sim.swing(this.swingZone);
  };

  return BotBatter;
})();
