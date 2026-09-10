/* =============================================================
   ui.js — HUD / 오버레이 / 간단한 효과음
   최소한의 정보만 띄운다 (§22). 실패 이유는 반드시 글로도 보여준다 (§37).
   ============================================================= */

var UI = (function () {

  var el = {};

  function $(id) { return document.getElementById(id); }

  function init() {
    el.score = $('score');
    el.outs = $('outs');
    el.chance = $('chance');
    el.gaugeWrap = $('gaugeWrap');
    el.gaugeFill = $('gaugeFill');
    el.gaugeHint = $('gaugeHint');
    el.progress = $('progress');
    el.stageInfo = $('stageInfo');
    el.callout = $('callout');
    el.sub = $('subCallout');
    el.flash = $('flash');
    el.overlay = $('overlay');
    el.hintLayer = $('hintLayer');
    el.combo = $('combo');
    el.baseTrack = $('baseTrack');
    el.zones = document.querySelectorAll('.zone');


    el.hintLayer.innerHTML = '<div></div><div></div><div></div><div></div>';
  }

  /* ---------- HUD ---------- */

  function setScore(n) { el.score.textContent = 'SCORE ' + n; }

  function setOuts(n) {
    var dots = el.outs.querySelectorAll('i');
    for (var i = 0; i < dots.length; i++) {
      if (i < n) dots[i].classList.add('on'); else dots[i].classList.remove('on');
    }
  }

  function setStage(atBat, level) {
    el.stageInfo.textContent = 'AT BAT ' + atBat + ' · Lv.' + level;
  }

  var CHANCE_COLOR = { 0: '#ff4b4b', 1: '#ffffff', 2: '#7ef2c0', 3: '#ffe14d', 4: '#ff5ad0' };

  function setChance(level, text, pop) {
    el.chance.textContent = text;
    el.chance.style.color = CHANCE_COLOR[level] || '#ffffff';
    if (pop) {
      el.chance.classList.remove('up');
      void el.chance.offsetWidth;
      el.chance.classList.add('up');
    }
  }

  function setGauge(v) {
    el.gaugeFill.style.width = Math.max(0, Math.min(100, v)) + '%';
    el.gaugeWrap.classList.toggle('hot', v >= 75);
    el.gaugeWrap.classList.toggle('danger', v <= 25);
  }



  function setGaugeLabel(t) { el.gaugeHint.textContent = t; }

  /* 게이지는 주루 중에만 의미가 있다 */
  function setGaugeVisible(on) {
    el.gaugeWrap.style.opacity = on ? '1' : '0.15';
    el.gaugeHint.style.opacity = on ? '1' : '0';
  }

  /* 연속 성공 콤보 — "조금만 더" 를 눈에 보이게 한다 (§18) */
  function setCombo(n) {
    if (n < 2) { el.combo.textContent = ''; el.combo.classList.remove('show'); return; }
    el.combo.textContent = n + ' COMBO';
    el.combo.classList.remove('show');
    void el.combo.offsetWidth;
    el.combo.classList.add('show');
  }

  /* 베이스 트랙 — 어디까지 왔고 어디까지 갈 수 있는지 (§23) */
  var BASE_LABEL = ['1B', '2B', '3B', 'HR'];

  function setBaseTrack(reached, target) {
    var html = '<b>H</b>';
    for (var i = 0; i < 4; i++) {
      var cls = i < reached ? 'done' : (i < target ? 'goal' : 'far');
      html += '<s class="' + cls + '"></s><b class="' + cls + '">' + BASE_LABEL[i] + '</b>';
    }
    el.baseTrack.innerHTML = html;
  }

  function setProgress(results) {
    var html = '';
    for (var i = 0; i < results.length; i++) {
      var c = results[i] === 'ok' ? ' class="ok"' : (results[i] === 'bad' ? ' class="bad"' : '');
      html += '<i' + c + '></i>';
    }
    el.progress.innerHTML = html;
  }

  function clearProgress() { el.progress.innerHTML = ''; }

  /* ---------- 연출 ---------- */

  function callout(text, color) {
    el.callout.textContent = text;
    el.callout.style.color = color || '#ffffff';
    el.callout.classList.remove('show');
    void el.callout.offsetWidth;
    el.callout.classList.add('show');
  }

  function sub(text) {
    el.sub.textContent = text || '';
    el.sub.classList.remove('show');
    if (!text) return;
    void el.sub.offsetWidth;
    el.sub.classList.add('show');
  }

  function flash(color) {
    el.flash.style.background = color;
    el.flash.classList.remove('on');
    void el.flash.offsetWidth;
    el.flash.classList.add('on');
  }

  var ZONE_INDEX = { LT: 0, RT: 1, LB: 2, RB: 3 };

  function litZone(zone) {
    var i = ZONE_INDEX[zone];
    if (i === undefined) return;
    var z = el.zones[i];
    z.classList.add('lit');
    setTimeout(function () { z.classList.remove('lit'); }, 150);
  }

  /* 위험이 입력 유효 창에 들어왔다 — "저 사분면이다" 를 알린다.
     정답이 아니라 위험이 있는 쪽을 표시한다. 규칙 적용은 플레이어 몫이다. */
  function armZone(zone) {
    var i = ZONE_INDEX[zone];
    if (i === undefined) return;
    var z = el.zones[i];
    z.classList.remove('armed');
    void z.offsetWidth;
    z.classList.add('armed');
    setTimeout(function () { z.classList.remove('armed'); }, 420);
  }

  /* Lv.1 학습용 정답 힌트 (§15 Lv.1) */
  function showHint(zone, arrow) {
    hideHint();
    var i = ZONE_INDEX[zone];
    if (i === undefined) return;
    el.hintLayer.children[i].innerHTML = '<span class="hint">' + arrow + '</span>';
  }

  function hideHint() {
    for (var i = 0; i < 4; i++) el.hintLayer.children[i].innerHTML = '';
  }


  /* ---------- 오버레이 ---------- */

  function hideOverlay() { el.overlay.classList.remove('show'); }

  function showTitle() {
    el.overlay.innerHTML =
      '<h1><span class="sub">PROTOTYPE</span>BASEBALL<br>ACTION RUNNER</h1>' +
      '<div class="desc">타격으로 <b>루타의 가능성</b>을 만들고<br>' +
      '주루로 그 가능성을 <b>실현</b>한다</div>' +
      '<div class="keys">' +
      '<b>타격</b> &nbsp; 공이 <b>오는 칸</b>을, 링이 겹칠 때<br>' +
      '<span class="dim">대각선 반대를 치면 파울</span><br><br>' +
      '<b>주루 · 위쪽 공</b> &nbsp; 날아오는 곳의 <b>반대쪽</b><br>' +
      '<b>주루 · 아래 수비수</b> &nbsp; 달려오는 <b>같은 쪽</b><br><br>' +
      '&#8598; Q &nbsp; &#8599; E &nbsp; &#8601; A &nbsp; &#8600; D' +
      '</div>' +
      '<div class="tap">TAP TO START</div>';
    el.overlay.classList.add('show');
  }

  /* §20 의 결과 화면 구성 */
  function showAtBatResult(d) {
    var hr = !d.out && d.finalLevel >= 4;
    var big = d.out ? 'OUT' : (hr ? 'HOME RUN' : d.finalLabel + '!');
    var bigColor = d.out ? '#ff4b4b'
      : (hr ? '#ff5ad0' : (d.finalLevel >= 3 ? '#ffe14d' : '#ffffff'));
    var chain = d.startLabel + ' → <b>' + (d.out ? 'OUT' : d.finalLabel) + '</b>';

    el.overlay.innerHTML =
      '<div class="big' + (hr ? ' hr' : '') + '" style="color:' + bigColor + '">' + big + '</div>' +
      '<div class="chain">' + chain + '</div>' +
      '<div class="rows">' +
      row('BAT', d.batGrade) +
      row('RUN', d.success + ' / ' + d.total) +
      row('PERFECT', d.perfect) +
      row('BEST COMBO', d.bestCombo) +
      row('SCORE', '+' + d.gained) +
      row('TOTAL', d.score) +
      '</div>' +
      '<div class="btn" data-act="next">' + (d.outs >= 3 ? 'SEE RESULT' : 'NEXT BATTER') + '</div>';
    el.overlay.classList.add('show');
  }

  function showGameOver(d) {
    el.overlay.innerHTML =
      '<h1><span class="sub">3 OUTS</span>GAME OVER</h1>' +
      '<div class="rows">' +
      row('TOTAL SCORE', d.score) +
      row('AT BATS', d.atBats) +
      row('BEST HIT', d.best) +
      row('RUN SUCCESS', d.successRate + '%') +
      '</div>' +
      '<div class="btn" data-act="retry">RETRY</div>';
    el.overlay.classList.add('show');
  }

  function row(k, v) {
    return '<div class="row"><span>' + k + '</span><span>' + v + '</span></div>';
  }

  /* ---------- 효과음 ----------
     파일 없이 오실레이터만 쓴다. 회피 성공의 손맛(§30 Q3)에 필요한 최소한이다. */

  var ac = null;

  function audio() {
    if (ac) return ac;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ac = new C();
    return ac;
  }

  function tone(freq, dur, type, vol, slideTo) {
    var a = audio();
    if (!a) return;
    if (a.state === 'suspended') a.resume();
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.08, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime + dur + 0.02);
  }

  function seq(notes) {
    for (var i = 0; i < notes.length; i++) {
      (function (n, idx) {
        setTimeout(function () { tone(n[0], n[1], n[2] || 'square', n[3]); }, idx * 70);
      })(notes[i], i);
    }
  }

  var Sfx = {
    swing:   function () { tone(180, 0.10, 'sawtooth', 0.05, 90); },
    hit:     function (g) {
      if (g === 'JUST') seq([[990, 0.07], [1320, 0.07], [1760, 0.22]]);
      else if (g === 'PERFECT') seq([[880, 0.08], [1320, 0.16]]);
      else if (g === 'GREAT') seq([[660, 0.08], [990, 0.13]]);
      else tone(520, 0.12, 'square', 0.07);
    },
    homerun: function () { seq([[660, 0.09], [880, 0.09], [1100, 0.09], [1320, 0.09], [1760, 0.32]]); },
    dodge:   function () { tone(620, 0.07, 'square', 0.06, 880); },
    perfect: function () { seq([[880, 0.06], [1180, 0.10]]); },
    fail:    function () { tone(160, 0.22, 'sawtooth', 0.09, 70); },
    promote: function () { seq([[660, 0.08], [880, 0.08], [1320, 0.20]]); },
    demote:  function () { seq([[440, 0.10], [330, 0.10], [220, 0.20]]); },
    foul:    function () { tone(300, 0.16, 'square', 0.07, 210); },
    base:    function () { seq([[520, 0.07], [780, 0.14]]); },
    out:     function () { seq([[220, 0.14, 'sawtooth'], [140, 0.30, 'sawtooth']]); },
    unlock:  function () { audio(); }
  };

  return {
    init: init, setScore: setScore, setOuts: setOuts, setStage: setStage,
    setChance: setChance, setGauge: setGauge, setCombo: setCombo,
    setGaugeLabel: setGaugeLabel,
    setGaugeVisible: setGaugeVisible,
    setProgress: setProgress, clearProgress: clearProgress, setBaseTrack: setBaseTrack,
    callout: callout, sub: sub, flash: flash, litZone: litZone, armZone: armZone,
    showHint: showHint, hideHint: hideHint,
    showTitle: showTitle, showAtBatResult: showAtBatResult, showGameOver: showGameOver,
    hideOverlay: hideOverlay,
    Sfx: Sfx
  };
})();
