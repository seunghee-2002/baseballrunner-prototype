/* =============================================================
   game.js — 앱 흐름과 화면 (로비 → 매치 → 결과)
   역할에 맞춰 공격(AttackSide)·수비(DefenseSide)를 붙이고,
   두 역할 모두 공격자 스냅숏 하나로 같은 장면과 연출을 만든다.
   ============================================================= */

(function () {

  var stage;
  var last = 0;
  var DEBUG = /[?&]debug\b/.test(location.search);

  var App = {
    mode: 'LOBBY',        // LOBBY | WAITING | MATCH | OVER
    practice: false,
    practiceRole: null,
    link: null,           // Net.NetLink 또는 Net.LocalLink
    me: 0,                // 내 자리 번호
    role: null,
    side: null,           // 내 AttackSide / DefenseSide
    bot: null,            // 연습 모드 상대 { side, brain }
    half: 'TOP',
    scores: [0, 0],
    outs: 0,
    atBat: null           // 마지막 AT_BAT_START
  };

  /* 스냅숏 차이로 연출을 만들기 위한 화면 상태 */
  var V = { seq: -1, phase: '', lastEvent: 0, armed: {}, result: null, resultAt: 0, resultShown: false };

  var BAT_COLOR = { JUST: '#ff5ad0', PERFECT: '#ffe14d', GREAT: '#7ef2c0', GOOD: '#ffffff', LUCKY: '#7ef2c0' };
  var MISS_TEXT = { NO_SWING: '스윙하지 않았다', EARLY: '너무 빨랐다', LATE: '너무 늦었다' };
  var OUT_TEXT = {
    MISS: '', GAUGE: '런 게이지가 바닥났다', NO_REACTION: '한 구간에서 두 번 반응하지 못했다',
    NO_DODGE: '이 구간에서 하나도 피하지 못했다'
  };

  /* ---------------- 연결 ---------------- */

  function closeLink() {
    if (App.link) App.link.close();
    App.link = null;
    App.side = null;
    App.bot = null;
    App.role = null;
    App.atBat = null;
  }

  function toLobby() {
    closeLink();
    App.mode = 'LOBBY';
    resetView();
    UI.setRole(null);
    UI.setDefBar(false);
    UI.setScores(0, null);
    UI.setOuts(0);
    UI.setInning('');
    UI.setStage('');
    UI.showLobby(location.protocol === 'file:'
      ? 'PvP 는 <b>node server.js</b> 로 띄운 주소에서 접속해야 합니다' : '');
  }

  function leaveWithMessage(main, text) {
    closeLink();
    App.mode = 'LOBBY';
    resetView();
    UI.setDefBar(false);
    UI.showMessage({ main: main, sub: '' }, text, [['lobby', '로비로']]);
  }

  function startPvp() {
    if (location.protocol === 'file:') {
      UI.showMessage({ main: 'PvP 는 서버가 필요합니다', sub: 'PvP' },
        'PC 에서 <b>node server.js</b> 를 실행하고<br>출력된 주소로 접속하세요', [['lobby', '로비로']]);
      return;
    }
    closeLink();
    App.practice = false;
    App.mode = 'WAITING';
    UI.showMessage({ main: '연결 중', sub: 'PvP' }, '', [['lobby', '취소']]);
    App.link = new Net.NetLink({
      onMessage: onMessage,
      onClose: function () {
        if (App.mode === 'LOBBY' || App.mode === 'OVER') return;
        leaveWithMessage('연결이 끊겼습니다', '서버(node server.js)가 켜져 있는지 확인하세요');
      }
    });
  }

  function startPractice(role) {
    closeLink();
    App.practice = true;
    App.practiceRole = role;
    App.mode = 'MATCH';

    var link = App.link = new Net.LocalLink(role);
    link.endpoints[0].onMessage(onMessage);

    var botEp = link.endpoints[1];
    var bot = App.bot = { side: null, brain: null };
    botEp.onMessage(function (type, p) {
      if (type === 'MATCH_START') {
        if (p.role === 'ATTACK') { bot.side = new AttackSide(botEp); bot.brain = new BotBatter(bot.side); }
        else { bot.side = new DefenseSide(botEp); bot.brain = new BotDefender(bot.side); }
      }
      if (!bot.side) return;
      bot.side.handle(type, p);
      bot.brain.handle(type, p);
    });
    link.start();
  }

  /* ---------------- 매치 메시지 ---------------- */

  function onMessage(type, p) {
    switch (type) {
      case 'WAITING':
        UI.showMessage({ main: '상대를 기다리는 중', sub: 'PvP' },
          '같은 네트워크의 다른 기기에서<br><b>' + location.host + '</b> 로 접속해 PvP 를 누르세요',
          [['lobby', '취소']]);
        break;
      case 'ROOM_FULL':
        leaveWithMessage('방이 가득 찼습니다', '이미 두 사람이 대전 중입니다');
        return;
      case 'OPPONENT_LEFT':
        if (App.mode !== 'OVER') leaveWithMessage('상대가 나갔습니다', '');
        return;
      case 'MATCH_START':
        App.mode = 'MATCH';
        App.me = p.you;
        App.half = p.half;
        App.scores = p.scores;
        App.outs = 0;
        setRole(p.role);
        UI.showRoleIntro(p.role, p.half, App.practice);
        break;
      case 'INNING_CHANGE':
        App.half = p.half;
        App.scores = p.scores;
        App.outs = 0;
        setRole(p.role);
        UI.showInningChange(p.role, p.scores[App.me] + ' : ' + p.scores[1 - App.me]);
        break;
      case 'AT_BAT_START':
        App.atBat = p;
        App.outs = p.outs;
        App.scores = p.scores;
        App.half = p.half;
        UI.hideOverlay();
        resetView();
        break;
      case 'SAFE':
      case 'OUT_OCCURRED':      // 상대 타석의 결과 (수비자에게만 온다)
        App.scores = p.scores;
        if (type === 'OUT_OCCURRED') App.outs = p.currentOuts;
        queueResult({
          mine: false, out: type === 'OUT_OCCURRED', reason: p.reason, bases: p.bases || 0,
          startChance: p.startChance, batGrade: p.batGrade, mishit: p.mishit, stats: p.stats, gained: p.gained || 0
        });
        break;
      case 'GAME_OVER':
        gameOver(p);
        break;
    }
    if (App.side) App.side.handle(type, p);
  }

  function setRole(role) {
    App.role = role;
    var ep = App.practice ? App.link.endpoints[0] : App.link;
    App.side = role === 'ATTACK' ? new AttackSide(ep, { debug: { fan: DEBUG } }) : new DefenseSide(ep);
    UI.setRole(role);
    UI.setDefBar(role === 'DEFENSE');
    resetView();
  }

  function gameOver(p) {
    App.mode = 'OVER';
    App.scores = p.scores;
    resetView();
    if (App.practice) {
      var att = App.practiceRole === 'ATTACK';
      UI.showGameOver({
        sub: '연습 종료 · 3 OUTS', title: att ? '내 점수' : '내준 점수',
        score: p.scores[att ? 0 : 1], color: '#ffe14d',
        actions: [['retry', '다시'], ['lobby', '로비로']]
      });
      return;
    }
    var result = p.winner === null ? 'DRAW' : (p.winner === App.me ? 'WIN' : 'LOSE');
    UI.showGameOver({
      sub: '1이닝 종료', title: { WIN: '승리', LOSE: '패배', DRAW: '무승부' }[result],
      score: p.scores[App.me] + ' : ' + p.scores[1 - App.me],
      color: { WIN: '#ffe14d', LOSE: '#ff4b4b', DRAW: '#ffffff' }[result],
      actions: [['lobby', '로비로']]
    });
  }

  /* 결과 화면은 도착·아웃 순간을 잠깐 보여준 뒤 띄운다. 다음 타석이 시작되면 닫힌다. */
  function queueResult(d) {
    V.result = d;
    V.resultAt = performance.now() + 550;
    V.resultShown = false;
  }

  /* ---------------- 화면 ---------------- */

  function resetView() {
    V.seq = -1;
    V.phase = '';
    V.lastEvent = 0;
    V.armed = {};
    V.result = null;
    V.resultShown = false;
    Scene3D.setMode('bat');
    Scene3D.setRunning(0);
    Scene3D.resetPlayer();
    UI.hideHint();
    UI.showPick(null);
    UI.setDust(false);
    UI.setCombo(0);
    UI.setWait('');
    UI.setGaugeVisible(false);
    UI.setGauge(RUN.GAUGE_START);
    UI.setFever(0, false);
    UI.setChance(1, App.mode === 'MATCH' ? 'AT BAT' : 'READY', false);
    UI.setBaseTrack(0, 0);
  }

  function currentSnap() {
    if (!App.side) return null;
    if (App.role === 'ATTACK') return App.side.sim ? App.side.sim.snapshot() : null;
    return App.side.liveView();
  }

  function refreshHud() {
    var a = App.atBat;
    if (App.practice) UI.setScores(App.scores[App.practiceRole === 'ATTACK' ? 0 : 1], null);
    else UI.setScores(App.scores[App.me], App.scores[1 - App.me]);
    UI.setInning(App.practice ? '연습' : UI.HALF_NAME[App.half]);
    UI.setOuts(App.outs);
    UI.setStage(a ? 'AT BAT ' + a.atBat + ' · Lv.' + a.level : '');
  }

  function renderMatch() {
    refreshHud();
    if (App.mode !== 'MATCH' || !App.side) return;

    var s = currentSnap();
    if (App.role === 'DEFENSE') renderDefense(s);
    else UI.setWait(s && s.phase === 'WAIT_PITCH' ? '투수가 코스를 고르는 중…' : '');

    if (V.result && !V.resultShown && performance.now() >= V.resultAt) {
      V.resultShown = true;
      UI.showAtBatResult(V.result);
    }
    if (!s) return;

    if (s.seq !== V.seq) {
      V.seq = s.seq; V.phase = ''; V.lastEvent = 0; V.armed = {};
    }
    for (var i = 0; i < s.events.length; i++) {
      var e = s.events[i];
      if (e.id > V.lastEvent) { V.lastEvent = e.id; playEvent(e, s); }
    }
    if (s.phase !== V.phase) { enterPhase(s); V.phase = s.phase; }

    /* 내 타석 결과 — 수비자는 SAFE / OUT_OCCURRED 패킷으로 받는다 */
    if (App.role === 'ATTACK' && s.phase === 'DONE' && !V.result && s.result) {
      var r = s.result, gained = r.out ? 0 : (CHANCE_SCORE[r.bases] || 0);
      if (r.out) App.outs++;
      else App.scores[App.me] += gained;
      queueResult({
        mine: true, out: r.out, reason: r.reason, bases: r.bases, startChance: s.bat ? s.bat.chance : 0,
        batGrade: s.bat ? s.bat.grade : '', mishit: s.bat && s.bat.mishit, stats: s.stats, gained: gained
      });
    }

    var missed = !!(s.bat && s.bat.grade === 'MISS');
    var batting = s.phase === 'WAIT_PITCH' || s.phase === 'PITCH' || s.phase === 'BAT_RESULT' ||
      (s.phase === 'DONE' && missed);
    Scene3D.setMode(batting ? 'bat' : 'run');
    if (s.pitch && (s.phase === 'PITCH' || (missed && batting))) Scene3D.setPitch(s.pitch);

    if (batting) {
      renderBatHint(s);
      return;
    }

    var runningNow = s.phase === 'RUNNING' || s.phase === 'CHANCE';
    Scene3D.setRunning(s.phase === 'HR_RUN' ? 2.2 : (runningNow ? (s.invincible > 0 ? RUN.FEVER_DASH : 1) : 0));
    Scene3D.syncObstacles(s.obstacles);
    Scene3D.setAura(s.invincible > 0 || s.phase === 'HR_RUN');
    renderBase(s);
    renderRunHint(s);

    UI.setGauge(s.gauge);
    UI.setFever(s.fever, App.role === 'ATTACK' && s.phase === 'RUNNING' && s.invincible <= 0);
    UI.setCombo(s.combo);
    UI.setChance(s.phase === 'HR_RUN' ? 4 : s.chance, s.phase === 'HR_RUN' ? 'HOME RUN' : CHANCE_LABEL[s.chance] + ' CHANCE', false);
    UI.setBaseTrack(s.base, Math.max(s.chance, s.base));
    UI.setDust(App.role === 'ATTACK' && s.dust > 0);
  }

  function renderDefense(s) {
    var side = App.side, st = side.state, reasons = [];
    for (var i = 0; i < st.hand.length; i++) reasons.push(st.blockReason(i, s));
    UI.renderHand(st.hand, st.cost, reasons, st.lock);
    document.getElementById('defBar').classList.toggle('picking', side.selecting);
    if (side.selecting) {
      UI.showPick(st.pitchFirst);
      UI.setWait('코스 선택 ' + Math.max(0, st.pitchLeft).toFixed(1) + '초 · ' +
        (st.pitchFirst ? '도착 칸' : '시작 칸') + ' — 같은 칸 두 번 = 직구');
    } else {
      UI.showPick(null);
      UI.setWait('');
    }
  }

  /* Lv.1 학습 힌트 — 공격자 화면에만. 타격은 도착 칸이 눈에 확정되는 순간부터 */
  function renderBatHint(s) {
    if (App.role !== 'ATTACK' || s.level !== 1 || s.phase !== 'PITCH') { UI.hideHint(); return; }
    var known = s.pitch.type === 'FAST' || s.pitch.t / s.pitch.dur >= PITCH.BREAK_AT;
    UI.showHints(known ? [s.pitch.end] : []);
  }

  function renderRunHint(s) {
    var hints = [];
    for (var i = 0; i < s.obstacles.length; i++) {
      var o = s.obstacles[i];
      if (o.resolved || o.distance <= 0 || o.distance / o.speed > o.window) continue;
      /* 위험이 유효 창에 들어온 순간 그 사분면을 알린다 (정답이 아니라 위험 위치) */
      if (!V.armed[o.id]) { V.armed[o.id] = true; UI.armZone(o.zone); }
      if (hints.indexOf(o.required) < 0) hints.push(o.required);
    }
    if (App.role === 'ATTACK' && s.level === 1 && s.phase === 'RUNNING') UI.showHints(hints);
    else UI.hideHint();
  }

  function renderBase(s) {
    if (s.phase === 'RUNNING' && s.leg) {
      Scene3D.setBaseApproach(s.leg.time / s.leg.duration);
    } else if (s.phase === 'HR_RUN') {
      var span = RUN.HR_RUN_TIME / (HOME_RUN - s.hrFrom);
      Scene3D.setBaseApproach((s.t % span) / span);
    } else {
      Scene3D.hideBase();
    }
  }

  function enterPhase(s) {
    switch (s.phase) {
      case 'WAIT_PITCH':
        Scene3D.hidePitch();
        UI.setGaugeVisible(false);
        UI.setChance(1, 'AT BAT', false);
        break;
      case 'CHANCE':
      case 'RUNNING':
        UI.setGaugeVisible(true);
        break;
      case 'DONE':
        Scene3D.clearObstacles();
        Scene3D.hideBase();
        Scene3D.setAura(false);
        UI.hideHint();
        UI.setDust(false);
        break;
    }
  }

  /* ---------------- 이벤트 → 연출 ---------------- */

  function playEvent(e, s) {
    var mine = App.role === 'ATTACK';
    switch (e.type) {
      case 'pitch':
        UI.Sfx.pitch();
        break;

      case 'swing':
        Scene3D.swing();
        UI.Sfx.swing();
        break;

      case 'bat':
        if (e.grade === 'MISS') {
          UI.callout('MISS', '#ff4b4b');
          UI.sub(e.reason === 'DIAGONAL' ? '공은 ' + ZONE_ARROW[e.end] + ' 로 왔다 — 코스를 완전히 잘못 읽었다' : MISS_TEXT[e.reason]);
          UI.Sfx.fail();
          Scene3D.shake(0.25);
          break;
        }
        if (e.lucky) {
          UI.callout('LUCKY!', BAT_COLOR.LUCKY);
          UI.sub('빗맞았지만 ' + CHANCE_LABEL[e.chance] + ' CHANCE — 수비 코스트 -' + LUCKY.COST_PENALTY);
        } else if (e.mishit) {
          UI.callout('빗맞았다', '#ffffff');
          UI.sub('공은 ' + ZONE_ARROW[e.end] + ' 로 왔다 — 겨우 1루타');
        } else {
          UI.callout(e.grade, BAT_COLOR[e.grade]);
          if (e.grade === 'JUST' || e.grade === 'PERFECT') UI.sub('1·2루 구간 가속');
        }
        UI.Sfx.hit(e.grade);
        Scene3D.launchHitBall(e.grade === 'JUST' ? 1.4 : e.chance / 3);
        Scene3D.shake(e.grade === 'JUST' ? 0.34 : 0.18);
        break;

      case 'chance':
        UI.setChance(e.chance, CHANCE_LABEL[e.chance] + ' CHANCE', true);
        UI.callout(CHANCE_LABEL[e.chance] + ' CHANCE!', e.chance >= 3 ? '#ffe14d' : '#7ef2c0');
        UI.sub(e.chance >= 3 ? '피버를 채워 발동하면 HOME RUN' : '끝까지 피해 세이프를 만든다');
        break;

      case 'verdict':
        playVerdict(e);
        break;

      case 'whiff':
        Scene3D.dodge(e.zone);
        UI.callout('헛회피', '#9aa4b8');
        UI.sub('다가오는 위험이 없는데 피했다 — 잠깐 굳는다');
        UI.Sfx.whiff();
        break;

      case 'base':
        Scene3D.passBase();
        UI.Sfx.base();
        /* 마지막 베이스는 SAFE 문구가 대신한다. 홈런 질주는 베이스마다 보여준다. */
        if (s.phase === 'HR_RUN' || e.base < s.chance) {
          UI.callout(BASE_NAME[e.base - 1] + (e.base >= HOME_RUN ? ' 인!' : ' 통과!'), '#7ef2c0');
        }
        break;

      case 'fever':
        UI.callout('FEVER!', '#ff5ad0');
        UI.sub('무적 돌진 — 런 게이지 +' + RUN.FEVER_GUARD_GAUGE);
        UI.flash('rgba(255,110,220,.45)');
        UI.Sfx.fever();
        break;

      case 'homerun':
        UI.callout('HOME RUN!!', '#ff5ad0');
        UI.sub('3B + 피버 — 홈까지 무적 질주');
        UI.flash('rgba(255,110,220,.55)');
        UI.Sfx.homerun();
        Scene3D.shake(0.55);
        break;

      case 'card':
        /* 기습은 공격자에게 알리지 않는다. 수비자에게만 발동 확인을 준다. */
        if (!mine) { UI.sub(CARDS[e.cardId].name + ' 발동'); UI.Sfx.card(); }
        break;

      case 'out':
        Scene3D.hitReaction();
        Scene3D.shake(0.9);
        UI.callout('OUT!', '#ff4b4b');
        UI.sub(OUT_TEXT[e.reason] || '');
        UI.flash('rgba(255,0,0,.55)');
        UI.Sfx.out();
        break;

      case 'safe':
        if (e.bases < HOME_RUN) UI.callout('SAFE!  ' + CHANCE_LABEL[e.bases], '#7ef2c0');
        break;
    }
  }

  function playVerdict(e) {
    UI.hideHint();
    if (e.verdict === 'FEVER') return;

    if (e.verdict === 'PERFECT' || e.verdict === 'NICE') {
      Scene3D.dodge(e.required);
      if (e.verdict === 'PERFECT') {
        UI.callout(e.combo >= 3 ? 'PERFECT ×' + e.combo : 'PERFECT!', '#ffe14d');
        UI.flash('rgba(255,225,77,.42)');
        UI.Sfx.perfect();
      } else {
        UI.callout(e.combo >= 3 ? 'NICE ×' + e.combo : 'NICE!', '#7ef2c0');
        UI.Sfx.dodge();
      }
      if (e.kind === 'fan') UI.sub('난입한 관객을 피했다! 피버 +' + OBSTACLES.FAN_LT.reward.fever);
      return;
    }

    /* 잘못 누른 쪽으로 실제로 피한 뒤 맞는다 — 왜 맞았는지 보여야 한다 (§37) */
    if (e.pressed) Scene3D.dodge(e.pressed);
    Scene3D.hitReaction();
    UI.flash('rgba(255,64,64,.5)');
    UI.Sfx.fail();
    UI.callout(e.verdict === 'WRONG' ? 'WRONG!' : 'TOO LATE!', '#ff4b4b');
    UI.sub('정답 ' + ZONE_ARROW[e.required] + ' ' + ACTION_NAME[e.required]);
  }

  /* ---------------- 입력 (§8) ---------------- */

  function onZone(zone) {
    UI.Sfx.unlock();
    if (App.mode !== 'MATCH' || !App.side) return;
    UI.litZone(zone);
    if (App.role === 'DEFENSE') { App.side.tapZone(zone); return; }
    var sim = App.side.sim;
    if (!sim) return;
    if (sim.phase === 'PITCH') sim.swing(zone);
    else if (sim.phase === 'RUNNING') sim.dodge(zone);
  }

  function onFever() {
    if (App.role === 'ATTACK' && App.side && App.side.sim) App.side.sim.activateFever();
  }

  function onCard(i) {
    UI.Sfx.unlock();
    if (App.mode !== 'MATCH' || App.role !== 'DEFENSE' || !App.side) return;
    if (App.side.playCard(i)) UI.pulseCard(i);
  }

  function onAction(act) {
    UI.Sfx.unlock();
    if (act === 'pvp') startPvp();
    else if (act === 'practice-attack') startPractice('ATTACK');
    else if (act === 'practice-defense') startPractice('DEFENSE');
    else if (act === 'retry') startPractice(App.practiceRole);
    else if (act === 'lobby') toLobby();
  }

  function zoneFromPoint(cx, cy) {
    var r = stage.getBoundingClientRect();
    var x = (cx - r.left) / r.width;
    var y = (cy - r.top) / r.height;
    return (y < 0.5) ? (x < 0.5 ? 'LT' : 'RT') : (x < 0.5 ? 'LB' : 'RB');
  }

  var KEY_ZONE = { q: 'LT', e: 'RT', a: 'LB', d: 'RB' };

  function bind() {
    /* 칸마다 따로 받는다 — 두 손가락으로 두 칸을 같은 순간에 눌러도 각각 판정된다 */
    stage.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('#overlay, #feverBtn, .card')) return;
      ev.preventDefault();
      onZone(zoneFromPoint(ev.clientX, ev.clientY));
    });

    document.getElementById('feverBtn').addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      onFever();
    });

    document.getElementById('hand').addEventListener('pointerdown', function (ev) {
      var c = ev.target.closest('[data-card]');
      if (!c) return;
      ev.preventDefault();
      onCard(Number(c.getAttribute('data-card')));
    });

    document.getElementById('overlay').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]');
      if (b) onAction(b.getAttribute('data-act'));
    });

    window.addEventListener('keydown', function (ev) {
      if (ev.repeat) return;
      var k = ev.key.toLowerCase();
      if (KEY_ZONE[k]) { ev.preventDefault(); onZone(KEY_ZONE[k]); return; }
      if (k === ' ') { ev.preventDefault(); onFever(); return; }
      if (k >= '1' && k <= '4') { onCard(Number(k) - 1); return; }
      if (DEBUG && k === 'f' && App.role === 'ATTACK' && App.side && App.side.sim) App.side.sim.fever = RUN.FEVER_MAX;
    });
  }

  /* ---------------- 루프 ---------------- */

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (dt <= 0) return;

    if (App.bot && App.bot.side) {
      App.bot.brain.update(dt);
      App.bot.side.update(dt);
    }
    if (App.side) App.side.update(dt);
    if (App.mode === 'MATCH') renderMatch();

    Scene3D.update(dt);
    Scene3D.render();
  }

  function boot() {
    stage = document.getElementById('stage');
    if (typeof THREE === 'undefined') {
      document.getElementById('loadError').hidden = false;
      return;
    }
    UI.init();
    Scene3D.init(document.getElementById('gl'));
    bind();
    toLobby();
    last = performance.now();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
