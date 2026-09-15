/* =============================================================
   game.js — 상태 머신과 규칙 (§39)
   TITLE -> PITCH -> BAT -> BAT_RESULT -> CHANCE -> RUNNING -> RESULT -> PITCH
                                              |
                                             OUT -> RESULT
   타격 시점에 결과를 확정하지 않는다. CHANCE 를 만들고 주루로 확정한다 (§3, §43).
   ============================================================= */

(function () {

  var stage, canvas;
  var last = 0;

  var G = {
    state: 'TITLE', t: 0, overlayGuard: 0,

    /* 세션 */
    score: 0, outs: 0, atBat: 1, best: 0,
    sessSuccess: 0, sessTotal: 0,

    /* 타석 */
    level: 1, pitchDur: 1.3, ballT: 0, swung: false, batGrade: '',
    pitchZone: 'LT', fouls: 0,
    startChance: 0, chance: 0, gauge: 50, floorUsed: false,

    /* 주루 — base 는 실제로 밟고 지나간 베이스 수, chance 는 갈 수 있는 목표 */
    base: 0, legTime: 0, legDuration: 1, legSuccess: 0,
    course: null, spawnIdx: 0, spawnTimer: 0, live: [], results: [], combo: 0,
    stats: { success: 0, total: 0, perfect: 0, bestCombo: 0 }
  };

  /* ---------------------------------------------------------- */

  function setState(s) { G.state = s; G.t = 0; }

  function chanceText(level) {
    return level > 0 ? CHANCE_LABEL[level] + ' CHANCE' : 'OUT';
  }

  function refreshChance(pop) {
    UI.setChance(G.chance, chanceText(G.chance), pop);
    UI.setGaugeLabel(G.chance >= 3 ? 'HOME RUN GAUGE' : 'RUN GAUGE');
  }

  var BAT_COLOR = { JUST: '#ff5ad0', PERFECT: '#ffe14d', GREAT: '#7ef2c0', GOOD: '#ffffff' };

  /* ---------------- 세션 / 타석 ---------------- */

  function startSession() {
    G.score = 0; G.outs = 0; G.atBat = 1; G.best = 0;
    G.sessSuccess = 0; G.sessTotal = 0;
    UI.setScore(0); UI.setOuts(0);
    UI.hideOverlay();
    newAtBat();
  }

  function newAtBat() {
    G.level = levelOf(G.atBat);
    G.ballT = 0; G.swung = false; G.batGrade = '';
    G.startChance = 0; G.chance = 0;
    G.gauge = RUN.GAUGE_START; G.floorUsed = false;
    G.course = null; G.spawnIdx = 0; G.spawnTimer = 0;
    G.live = []; G.results = []; G.combo = 0;
    G.base = 0; G.fouls = 0;
    G.stats = { success: 0, total: 0, perfect: 0, bestCombo: 0 };

    UI.setStage(G.atBat, G.level);
    UI.clearProgress();
    UI.setGaugeVisible(false);
    UI.setCombo(0);
    UI.setGaugeLabel('RUN GAUGE');
    UI.setChance(1, 'AT BAT', false);
    UI.setBaseTrack(0, 0);
    UI.hideHint();

    Scene3D.setMode('bat');
    Scene3D.setRunning(false);
    Scene3D.resetPlayer();

    newPitch(true);
  }

  /* 투구 하나. 파울이면 같은 타석에서 다시 던진다. */
  function newPitch(first) {
    G.ballT = 0;
    G.swung = false;
    G.pitchZone = ZONES[Math.floor(Math.random() * ZONES.length)];
    G.pitchDur = LEVELS[G.level].pitchTime * (0.92 + Math.random() * 0.16);
    Scene3D.hidePitch();
    UI.hideHint();
    /* Lv.1 은 학습 단계다. 공이 올 칸을 미리 알려준다 (§15 Lv.1) */
    if (G.level === 1) UI.showHint(G.pitchZone, ZONE_ARROW[G.pitchZone]);
    UI.sub(first && G.atBat === 1 ? '공이 오는 칸을, 링이 겹칠 때' : '');
    setState('PITCH');
  }

  /* ---------------- 타격 (§5) ---------------- */

  function doSwing(zone) {
    if (G.swung) return;
    G.swung = true;
    UI.hideHint();
    Scene3D.swing();
    UI.Sfx.swing();
    judgeBat(Math.abs(G.ballT - G.pitchDur), zone, false);
  }

  /* 타격은 타이밍 + 코스 두 축이다 (§5).
     정확한 칸이면 타이밍 등급 그대로, 인접한 칸이면 빗맞은 안타,
     대각선 반대쪽이면 배트에 스쳐 파울이 된다. */
  function judgeBat(err, zone, noSwing) {
    var w = null;
    for (var i = 0; i < BAT_WINDOWS.length; i++) {
      if (err <= BAT_WINDOWS[i].err) { w = BAT_WINDOWS[i]; break; }
    }

    /* 배트에 맞기는 했는데 코스를 완전히 반대로 읽은 경우 */
    if (w && !noSwing && zone === OPPOSITE_ZONE[G.pitchZone]) {
      G.fouls++;
      if (G.fouls <= FOUL_LIMIT) {
        G.batGrade = 'FOUL';
        UI.callout('FOUL!', '#ffb43c');
        UI.sub('공은 ' + ZONE_ARROW[G.pitchZone] + ' 로 왔다  ·  파울 ' + G.fouls + '/' + FOUL_LIMIT);
        UI.Sfx.foul();
        Scene3D.shake(0.20);
        Scene3D.launchHitBall(-0.4);        // 뒤로 빗나가는 파울 타구
        setState('BAT_RESULT');
        return;
      }
      w = null;                              // 파울 한도 초과 -> 헛스윙 처리
    }

    /* 코스는 빗났지만 인접한 칸이면 빗맞은 안타 (1B) */
    var mishit = false;
    if (w && !noSwing && zone !== G.pitchZone) {
      w = BAT_WINDOWS[BAT_WINDOWS.length - 1];   // GOOD 고정
      mishit = true;
    }

    if (!w) {
      G.batGrade = 'MISS';
      G.startChance = 0;
      UI.callout('MISS', '#ff4b4b');
      UI.sub(noSwing ? '스윙하지 않았다'
        : (G.fouls > FOUL_LIMIT ? '파울 한도 초과'
        : (G.ballT < G.pitchDur ? '너무 빨랐다' : '너무 늦었다')));
      UI.Sfx.fail();
      Scene3D.shake(0.25);
      Scene3D.hidePitch();
    } else {
      G.batGrade = w.grade;
      G.startChance = w.chance;
      G.gauge = w.gauge;          // JUST 는 게이지를 높이 들고 출발한다 (§5-3)
      UI.callout(mishit ? '빗맞았다' : w.grade, mishit ? '#ffffff' : BAT_COLOR[w.grade]);
      if (mishit) UI.sub('공은 ' + ZONE_ARROW[G.pitchZone] + ' 로 왔다 — 겨우 1루타');
      else if (w.grade === 'JUST') UI.sub('완벽한 타이밍 — 게이지 ' + w.gauge + ' 에서 출발');
      UI.Sfx.hit(w.grade);
      Scene3D.launchHitBall(w.grade === 'JUST' ? 1.4 : w.chance / 3);
      Scene3D.shake(w.grade === 'JUST' ? 0.34 : 0.18);
    }
    setState('BAT_RESULT');
  }

  /* ---------------- CHANCE (§6) ---------------- */

  function enterChance() {
    G.chance = G.startChance;
    refreshChance(true);
    UI.callout(CHANCE_LABEL[G.chance] + ' CHANCE!', G.chance >= 3 ? '#ffe14d' : '#7ef2c0');
    UI.sub(G.chance >= 3 ? '게이지를 끝까지 채우면 HOME RUN' : '주루로 이 기회를 키운다');

    G.base = 0;
    UI.setBaseTrack(0, G.chance);
    UI.setGaugeVisible(true);
    UI.setGauge(G.gauge);

    Scene3D.setMode('run');
    Scene3D.setRunning(true);
    setState('CHANCE');
  }

  /* ---------------- 주루 (§7, §25) ----------------
     한 구간 = 베이스 하나. 목표(CHANCE)만큼 구간을 이어 달린다.
     주루 중 CHANCE 가 오르면 구간이 하나 더 늘고, 떨어지면 거기서 멈춘다. */

  function startLeg() {
    G.course = buildCourse(G.atBat, G.base);
    G.results = [];
    for (var i = 0; i < G.course.steps.length; i++) G.results.push(null);
    G.spawnIdx = 0;
    G.spawnTimer = RUN.FIRST_GAP;
    G.legTime = 0;
    G.legSuccess = 0;
    G.legDuration = G.course.duration;

    UI.setProgress(G.results);
    UI.setBaseTrack(G.base, G.chance);
    Scene3D.setRunning(true);
    Scene3D.setBaseApproach(0);
    setState('RUNNING');
  }

  function finishLeg() {
    /* 한 구간에서 단 하나도 피하지 못했다면 그 베이스 앞에서 잡힌다.
       이게 없으면 전부 실패하고도 베이스를 공짜로 밟는다 (§19 치명적 실패). */
    if (G.legSuccess === 0) {
      UI.callout('TAG OUT!', '#ff4b4b');
      UI.sub(BASE_NAME[G.base] + ' 앞에서 잡혔다');
      doOut();
      return;
    }

    G.base++;
    Scene3D.passBase();
    Scene3D.hideBase();
    UI.setBaseTrack(G.base, G.chance);

    /* 밟은 베이스는 확보된다. 갈 수 있는 만큼(CHANCE) 갔으면 여기서 끝. */
    if (G.base >= G.chance) { finishAtBat(false); return; }

    UI.callout(BASE_NAME[G.base - 1] + ' 통과!', '#7ef2c0');
    UI.sub(BASE_NAME[G.base] + ' 까지 간다');
    UI.Sfx.base();
    setState('BASE_PASS');
  }

  function spawnNext() {
    var step = G.course.steps[G.spawnIdx];
    var o = {
      step: step,
      index: G.spawnIdx,
      distance: RUN.START_DISTANCE,
      mesh: Scene3D.addObstacle(step),
      active: false,
      resolved: null
    };
    Scene3D.placeObstacle(o.mesh, step, o.distance);
    G.live.push(o);
    G.spawnTimer = step.gapAfter;
    G.spawnIdx++;
  }

  function activeTarget() {
    for (var i = 0; i < G.live.length; i++) {
      if (G.live[i].active && !G.live[i].resolved) return G.live[i];
    }
    return null;
  }

  function resolve(o, verdict, pressed) {
    o.resolved = verdict;
    G.stats.total++;
    UI.hideHint();

    var req = o.step.def.requiredInput;

    if (verdict === 'PERFECT' || verdict === 'SUCCESS') {
      G.stats.success++;
      G.legSuccess++;
      G.results[o.index] = 'ok';
      Scene3D.dodge(req);

      /* 연속 성공일수록 게이지가 크게 오른다 (§18) */
      var base = (verdict === 'PERFECT') ? RUN.GAUGE_PERFECT : RUN.GAUGE_SUCCESS;
      var mult = 1 + Math.min(G.combo, RUN.COMBO_MAX) * RUN.COMBO_STEP;
      G.combo++;
      if (G.combo > G.stats.bestCombo) G.stats.bestCombo = G.combo;
      UI.setCombo(G.combo);

      if (verdict === 'PERFECT') {
        G.stats.perfect++;
        UI.callout(G.combo >= 3 ? 'PERFECT ×' + G.combo : 'PERFECT!', '#ffe14d');
        UI.flash('rgba(255,225,77,.42)');
        UI.Sfx.perfect();
      } else {
        UI.callout(G.combo >= 3 ? 'NICE ×' + G.combo : 'NICE!', '#7ef2c0');
        UI.Sfx.dodge();
      }
      var gain = base * mult;
      if (G.chance >= 3) gain *= RUN.HR_GAIN_RATIO;   // HR 로 가는 길은 절반 속도
      gaugeAdd(Math.round(gain));
    } else {
      G.results[o.index] = 'bad';
      G.combo = 0;
      UI.setCombo(0);
      /* 잘못 누른 쪽으로 실제로 피하는 모습을 보여준다 — 왜 맞았는지 눈에 보여야 한다 (§37) */
      if (pressed) Scene3D.dodge(pressed);
      Scene3D.hitReaction();
      UI.flash('rgba(255,64,64,.5)');
      UI.Sfx.fail();
      UI.callout(verdict === 'WRONG' ? 'WRONG!' : 'TOO LATE!', '#ff4b4b');
      UI.sub('정답 ' + ZONE_ARROW[req] + ' ' + ACTION_NAME[req]);
      /* 아예 반응하지 못한 쪽이 더 무겁다 */
      gaugeAdd(verdict === 'WRONG' ? o.step.def.penalty : o.step.def.penaltyLate);
    }

    UI.setProgress(G.results);
  }

  /* 연속 성공 게이지 (§18) */
  function gaugeAdd(v) {
    if (G.state !== 'RUNNING') return;
    G.gauge += v;

    if (G.gauge >= 100) {
      if (G.chance < MAX_CHANCE) {
        G.chance++;
        G.gauge = RUN.GAUGE_AFTER_PROMOTE;
        G.floorUsed = false;
        if (G.chance === MAX_CHANCE) {
          /* HR 은 여기서 끝이 아니다. 남은 구간 동안 지켜내야 한다. */
          announce('HOME RUN!!', '#ff5ad0');
          UI.Sfx.homerun();
          UI.flash('rgba(255,110,220,.55)');
          Scene3D.shake(0.55);
        } else {
          announce(CHANCE_LABEL[G.chance] + ' CHANCE!', '#ffe14d');
          UI.Sfx.promote();
          UI.flash('rgba(255,225,77,.5)');
        }
      } else {
        G.gauge = 100;             // HR 이 상한
      }
    } else if (G.gauge < 0) {
      if (G.chance > 1) {
        G.chance--;
        G.gauge = RUN.GAUGE_AFTER_DEMOTE;
        UI.Sfx.demote();
        /* 지금 달리는 구간의 목표에 못 미치게 됐다 — 다음 베이스는 포기하고
           이미 밟은 베이스에서 멈춘다. 그래야 하락에 의미가 생긴다. */
        if (G.chance <= G.base) {
          UI.setGauge(G.gauge);
          UI.callout(BASE_NAME[G.base - 1] + ' 에서 멈춘다', '#ff8a5c');
          UI.sub('더 갈 수 없다');
          finishAtBat(false);
          return;
        }
        announce(CHANCE_LABEL[G.chance] + ' 로 하락', '#ff8a5c');
      } else if (G.floorUsed) {
        G.gauge = 0;
        UI.setGauge(0);
        refreshChance(false);
        doOut();
        return;
      } else {
        G.gauge = 0;
        G.floorUsed = true;
        announce('DANGER!', '#ff4b4b');
      }
    }

    UI.setGauge(G.gauge);
    refreshChance(true);
  }

  /* 직전 판정 콜아웃과 겹치지 않도록 살짝 늦춰 띄운다 */
  function announce(text, color) {
    setTimeout(function () {
      if (G.state === 'RUNNING') UI.callout(text, color);
    }, 210);
  }

  function updateRunning(dt) {
    /* 베이스가 구간 진행에 맞춰 다가온다 */
    G.legTime += dt;
    Scene3D.setBaseApproach(G.legTime / G.legDuration);

    if (G.spawnIdx < G.course.steps.length) {
      G.spawnTimer -= dt;
      if (G.spawnTimer <= 0) spawnNext();
    }

    for (var i = G.live.length - 1; i >= 0; i--) {
      var o = G.live[i];
      o.distance -= o.step.speed * dt;
      Scene3D.placeObstacle(o.mesh, o.step, o.distance);

      if (!o.active && o.distance <= o.step.activeDist) {
        o.active = true;
        /* 지금부터 입력이 받아진다는 신호 */
        Scene3D.armObstacle(o.mesh);
        UI.armZone(o.step.def.spawn);
        /* Lv.1 은 학습 단계다. 정답 방향을 알려준다 (§15 Lv.1) */
        if (G.level === 1) UI.showHint(o.step.def.requiredInput, ZONE_ARROW[o.step.def.requiredInput]);
      }

      if (!o.resolved && o.distance <= 0) {
        resolve(o, 'LATE');
        if (G.state !== 'RUNNING') return;
      }

      if (o.distance <= -12) {
        Scene3D.removeObstacle(o.mesh);
        G.live.splice(i, 1);
      }
    }

    if (G.spawnIdx >= G.course.steps.length && G.live.length === 0) finishLeg();
  }

  /* ---------------- 결과 (§19, §20, §36) ---------------- */

  function doOut() {
    Scene3D.setRunning(false);
    Scene3D.hitReaction();
    Scene3D.shake(0.9);
    UI.callout('OUT!', '#ff4b4b');
    UI.sub('');
    UI.flash('rgba(255,0,0,.55)');
    UI.Sfx.out();
    UI.hideHint();
    setState('OUTRO');
  }

  function finishAtBat(isOut) {
    Scene3D.setRunning(false);
    Scene3D.clearObstacles();
    G.live = [];
    G.combo = 0;
    UI.hideHint();
    UI.setCombo(0);

    G.sessSuccess += G.stats.success;
    G.sessTotal += G.stats.total;

    /* 최종 결과는 "갈 수 있었던 곳"이 아니라 "실제로 밟고 지나간 베이스" 다 */
    var reached = isOut ? 0 : G.base;
    var gained = 0;
    if (isOut) {
      G.outs++;
      G.chance = 0;
    } else {
      gained = CHANCE_SCORE[reached] || 0;
      G.score += gained;
      if (reached > G.best) G.best = reached;
    }

    UI.setScore(G.score);
    UI.setOuts(G.outs);
    UI.setBaseTrack(reached, reached);
    UI.setChance(reached, reached > 0 ? CHANCE_LABEL[reached] : 'OUT', false);
    Scene3D.hideBase();

    UI.showAtBatResult({
      out: isOut,
      finalLevel: reached,
      finalLabel: CHANCE_LABEL[reached],
      startLabel: G.startChance ? CHANCE_LABEL[G.startChance] : '—',
      batGrade: G.batGrade || '—',
      success: G.stats.success,
      total: G.stats.total,
      perfect: G.stats.perfect,
      bestCombo: G.stats.bestCombo,
      gained: gained,
      score: G.score,
      outs: G.outs
    });
    G.overlayGuard = 0.45;
    setState('RESULT');
  }

  function proceedFromResult() {
    if (G.outs >= 3) {
      UI.showGameOver({
        score: G.score,
        atBats: G.atBat,
        best: G.best ? CHANCE_LABEL[G.best] : '—',
        successRate: G.sessTotal ? Math.round(G.sessSuccess / G.sessTotal * 100) : 0
      });
      G.overlayGuard = 0.45;
      setState('GAMEOVER');
      return;
    }
    G.atBat++;
    UI.hideOverlay();
    newAtBat();
  }

  /* ---------------- 입력 (§8) ---------------- */

  function onZone(zone) {
    UI.Sfx.unlock();
    if (G.overlayGuard > 0) return;

    if (G.state === 'TITLE' || G.state === 'GAMEOVER') { startSession(); return; }
    if (G.state === 'RESULT') { proceedFromResult(); return; }

    /* 타격도 4분면 입력이다 — 공이 오는 칸을 쳐야 한다 (§5) */
    if (G.state === 'BAT') { UI.litZone(zone); doSwing(zone); return; }
    if (G.state !== 'RUNNING') return;

    UI.litZone(zone);

    var target = activeTarget();
    if (!target) return;    // 대응할 위험이 없을 때의 입력은 무시한다 (연타 페널티 없음)

    if (zone === target.step.def.requiredInput) {
      /* 충돌까지 남은 시간이 기준이다. 눈으로 부딪히는 걸 보고 누른 순간이 PERFECT. */
      var remain = target.distance / target.step.speed;
      resolve(target, remain <= RUN.PERFECT_WINDOW ? 'PERFECT' : 'SUCCESS');
    } else {
      resolve(target, 'WRONG', zone);
    }
  }

  function zoneFromPoint(cx, cy) {
    var r = stage.getBoundingClientRect();
    var x = (cx - r.left) / r.width;
    var y = (cy - r.top) / r.height;
    return (y < 0.5) ? (x < 0.5 ? 'LT' : 'RT') : (x < 0.5 ? 'LB' : 'RB');
  }

  var KEY_ZONE = { q: 'LT', e: 'RT', a: 'LB', d: 'RB' };

  function bind() {
    stage.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      onZone(zoneFromPoint(ev.clientX, ev.clientY));
    });

    window.addEventListener('keydown', function (ev) {
      if (ev.repeat) return;
      var k = ev.key.toLowerCase();
      if (KEY_ZONE[k]) { ev.preventDefault(); onZone(KEY_ZONE[k]); return; }
      if (k === ' ' || k === 'enter') {
        ev.preventDefault();
        /* 방향이 없는 입력이다. 타격(코스)·주루(회피) 모두 사분면을 골라야 하므로
           오버레이를 넘기는 데에만 쓴다. */
        if (G.state === 'TITLE' || G.state === 'RESULT' || G.state === 'GAMEOVER') onZone('LT');
      }
    });
  }

  /* ---------------- 루프 ---------------- */

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (dt <= 0) return;

    if (G.overlayGuard > 0) G.overlayGuard -= dt;
    G.t += dt;

    switch (G.state) {
      case 'PITCH':
        if (G.t > 0.85) { G.ballT = 0; setState('BAT'); }
        break;

      case 'BAT':
        G.ballT += dt;
        Scene3D.setPitch(Math.min(1.12, G.ballT / G.pitchDur), G.pitchZone);
        if (!G.swung && G.ballT > G.pitchDur + 0.24) { G.swung = true; judgeBat(999, null, true); }
        break;

      case 'BAT_RESULT':
        if (G.t > 1.0) {
          if (G.batGrade === 'FOUL') newPitch(false);
          else if (G.batGrade === 'MISS') finishAtBat(true);
          else enterChance();
        }
        break;

      case 'CHANCE':
        if (G.t > 1.15) startLeg();
        break;

      case 'RUNNING':
        updateRunning(dt);
        break;

      case 'BASE_PASS':
        if (G.t > 0.75) startLeg();      // 베이스 연출은 짧게 (§36)
        break;

      case 'OUTRO':
        if (G.t > 0.75) finishAtBat(true);   // 실패 연출은 짧게 (§36)
        break;
    }

    Scene3D.update(dt);
    Scene3D.render();
  }

  /* ---------------- 시작 ---------------- */

  function boot() {
    stage = document.getElementById('stage');
    canvas = document.getElementById('gl');

    if (typeof THREE === 'undefined') {
      document.getElementById('loadError').hidden = false;
      return;
    }

    UI.init();
    Scene3D.init(canvas);
    bind();

    UI.setScore(0);
    UI.setOuts(0);
    UI.setGaugeVisible(false);
    UI.setChance(1, 'READY', false);
    UI.showTitle();
    G.overlayGuard = 0.3;
    setState('TITLE');

    last = performance.now();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
