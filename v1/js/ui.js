/* =============================================================
   ui.js — HUD / 손패 / 오버레이 / 간단한 효과음
   최소한의 정보만 띄운다 (§22). 실패 이유는 반드시 글로도 보여준다 (§37).
   ============================================================= */

var UI = (function () {

  var el = {};
  var ZONE_INDEX = { LT: 0, RT: 1, LB: 2, RB: 3 };

  function $(id) { return document.getElementById(id); }

  function init() {
    ['scoreMe', 'scoreSep', 'scoreOpp', 'inning', 'outs', 'roleTag', 'chance', 'gaugeWrap', 'gaugeFill',
     'gaugeHint', 'feverWrap', 'feverFill', 'baseTrack', 'combo', 'stageInfo', 'waitInfo', 'feverBtn',
     'defBar', 'costNum', 'lockInfo', 'hand', 'flash', 'callout', 'subCallout', 'overlay',
     'hintLayer', 'pickLayer', 'dust'].forEach(function (id) { el[id] = $(id); });
    el.zones = document.querySelectorAll('.zone');
    el.hintLayer.innerHTML = '<div></div><div></div><div></div><div></div>';
    el.pickLayer.innerHTML = '<div></div><div></div><div></div><div></div>';
  }

  /* ---------- HUD ---------- */

  /* opp 가 null 이면 연습 모드 — 내 점수만 */
  function setScores(me, opp) {
    el.scoreMe.textContent = me;
    var solo = opp === null || opp === undefined;
    el.scoreSep.textContent = solo ? '' : ':';
    el.scoreOpp.textContent = solo ? '' : opp;
  }

  function setInning(text) { el.inning.textContent = text; }

  function setOuts(n) {
    var dots = el.outs.querySelectorAll('i');
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i < n);
  }

  function setRole(role) {
    el.roleTag.textContent = role === 'ATTACK' ? '공격' : (role === 'DEFENSE' ? '수비' : '');
    el.roleTag.className = role === 'DEFENSE' ? 'def' : 'att';
  }

  function setStage(text) { el.stageInfo.textContent = text; }

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

  function setGaugeVisible(on) {
    el.gaugeWrap.style.opacity = on ? '1' : '0.15';
    el.gaugeHint.style.opacity = on ? '1' : '0';
    el.feverWrap.style.opacity = on ? '1' : '0.15';
  }

  /* 피버: 가득 차면 상단 가운데 버튼이 뜬다 (공격자만 누를 수 있다) */
  function setFever(v, canPress) {
    el.feverFill.style.width = Math.max(0, Math.min(100, v)) + '%';
    var full = v >= RUN.FEVER_MAX;
    el.feverWrap.classList.toggle('full', full);
    el.feverBtn.hidden = !(full && canPress);
  }

  function setCombo(n) {
    if (n < 2) { el.combo.textContent = ''; el.combo.classList.remove('show'); return; }
    if (el.combo.textContent === n + ' COMBO') return;
    el.combo.textContent = n + ' COMBO';
    el.combo.classList.remove('show');
    void el.combo.offsetWidth;
    el.combo.classList.add('show');
  }

  /* 베이스 트랙 — 어디까지 왔고 어디까지 갈 수 있는지 (§23). HR 은 3B 에서 피버로만. */
  var BASE_LABEL = ['1B', '2B', '3B', 'HR'];
  var trackKey = '';

  function setBaseTrack(reached, target) {
    var key = reached + '/' + target;
    if (key === trackKey) return;
    trackKey = key;
    var html = '<b>H</b>';
    for (var i = 0; i < 4; i++) {
      var cls = i < reached ? 'done' : (i < target ? 'goal' : 'far');
      html += '<s class="' + cls + '"></s><b class="' + cls + '">' + BASE_LABEL[i] + '</b>';
    }
    el.baseTrack.innerHTML = html;
  }

  function setWait(text) { el.waitInfo.textContent = text || ''; }

  /* ---------- 연출 ---------- */

  function callout(text, color) {
    el.callout.textContent = text;
    el.callout.style.color = color || '#ffffff';
    el.callout.classList.remove('show');
    void el.callout.offsetWidth;
    el.callout.classList.add('show');
  }

  function sub(text) {
    el.subCallout.textContent = text || '';
    el.subCallout.classList.remove('show');
    if (!text) return;
    void el.subCallout.offsetWidth;
    el.subCallout.classList.add('show');
  }

  function flash(color) {
    el.flash.style.background = color;
    el.flash.classList.remove('on');
    void el.flash.offsetWidth;
    el.flash.classList.add('on');
  }

  function litZone(zone) {
    var z = el.zones[ZONE_INDEX[zone]];
    if (!z) return;
    z.classList.add('lit');
    setTimeout(function () { z.classList.remove('lit'); }, 150);
  }

  /* 위험이 유효 창에 들어왔다 — 정답이 아니라 위험이 있는 쪽을 표시한다 */
  function armZone(zone) {
    var z = el.zones[ZONE_INDEX[zone]];
    if (!z) return;
    z.classList.remove('armed');
    void z.offsetWidth;
    z.classList.add('armed');
    setTimeout(function () { z.classList.remove('armed'); }, 420);
  }

  /* Lv.1 학습용 정답 힌트 (§15). 동시에 여러 칸일 수 있다. */
  var hintKey = '';
  function showHints(zones) {
    var key = zones.join(',');
    if (key === hintKey) return;
    hintKey = key;
    for (var i = 0; i < 4; i++) el.hintLayer.children[i].innerHTML = '';
    zones.forEach(function (z) {
      el.hintLayer.children[ZONE_INDEX[z]].innerHTML = '<span class="hint">' + ZONE_ARROW[z] + '</span>';
    });
  }
  function hideHint() { showHints([]); }

  /* 수비자 투구 선택 — 첫 번째로 고른 칸 표시 */
  function showPick(first) {
    for (var i = 0; i < 4; i++) {
      var on = first && ZONE_INDEX[first] === i;
      el.pickLayer.children[i].innerHTML = on ? '<span class="pick">시작</span>' : '';
    }
  }

  function setDust(on) { el.dust.classList.toggle('on', !!on); }

  /* ---------- 수비 손패 ---------- */

  var BLOCK_TEXT = { COST: '코스트 부족', LOCK: '잠금', NO_TARGET: '다가오는 공 없음', TOO_LATE: '베이스 임박', PHASE: '' };
  var handKey = '';

  function setDefBar(on) {
    el.defBar.hidden = !on;
    handKey = '';
  }

  /* hand: [{uid,id,zones}], reasons: 카드별 막힌 이유('' = 사용 가능) */
  function renderHand(hand, cost, reasons, lock) {
    el.costNum.textContent = cost;
    el.lockInfo.textContent = lock > 0 ? '  카드 잠금 ' + lock.toFixed(1) : '';
    var key = hand.map(function (c, i) { return c.uid + reasons[i]; }).join('|');
    if (key === handKey) return;
    handKey = key;
    var html = '';
    hand.forEach(function (c, i) {
      var def = CARDS[c.id], why = reasons[i];
      var where = c.zones.length ? c.zones.map(function (z) { return ZONE_ARROW[z]; }).join(' ') : '✦';
      html += '<div class="card' + (why ? ' off' : '') + '" data-card="' + i + '">' +
        '<span class="c-cost">' + def.cost + '</span>' +
        '<span class="c-where">' + where + '</span>' +
        '<span class="c-name">' + def.name + '</span>' +
        '<span class="c-type">' + def.type + ' · ' + (i + 1) + '</span>' +
        (why && BLOCK_TEXT[why] ? '<span class="c-why">' + BLOCK_TEXT[why] + '</span>' : '') +
        '</div>';
    });
    el.hand.innerHTML = html;
  }

  function pulseCard(i) {
    var c = el.hand.querySelector('[data-card="' + i + '"]');
    if (!c) return;
    c.classList.add('used');
  }

  /* ---------- 오버레이 ---------- */

  function hideOverlay() { el.overlay.classList.remove('show'); }

  function overlay(html) {
    el.overlay.innerHTML = html;
    el.overlay.classList.add('show');
  }

  function row(k, v) {
    return '<div class="row"><span>' + k + '</span><span>' + v + '</span></div>';
  }

  function btn(act, text, dim) {
    return '<div class="btn' + (dim ? ' dim' : '') + '" data-act="' + act + '">' + text + '</div>';
  }

  function showLobby(pvpNote) {
    overlay(
      '<h1><span class="sub">PROTOTYPE · 1v1</span>BASEBALL<br>ACTION RUNNER</h1>' +
      '<div class="desc">타격으로 <b>루타의 가능성</b>을 만들고<br>주루로 그 가능성을 <b>지켜낸다</b></div>' +
      '<div class="btns">' +
      btn('pvp', 'PvP 대전', !!pvpNote) +
      btn('practice-attack', '연습 · 공격') +
      btn('practice-defense', '연습 · 수비') +
      '</div>' +
      (pvpNote ? '<div class="note">' + pvpNote + '</div>' : '') +
      '<div class="keys">' +
      '<b>타격</b> 공이 <b>도착하는 칸</b>을 도착 순간에<br>' +
      '<b>위쪽 공</b> 반대쪽 &nbsp; <b>아래 수비수</b> 같은 쪽<br>' +
      '<b>투구</b> 두 칸 선택 (같은 칸 = 직구)<br><br>' +
      '&#8598; Q &nbsp; &#8599; E &nbsp; &#8601; A &nbsp; &#8600; D &nbsp;·&nbsp; 피버 SPACE &nbsp;·&nbsp; 카드 1~4' +
      '</div>');
  }

  function showMessage(title, text, actions) {
    overlay(
      '<h1><span class="sub">' + (title.sub || '') + '</span>' + title.main + '</h1>' +
      (text ? '<div class="desc">' + text + '</div>' : '') +
      '<div class="btns">' + (actions || []).map(function (a) { return btn(a[0], a[1]); }).join('') + '</div>');
  }

  var HALF_NAME = { TOP: '1회 초', BOTTOM: '1회 말' };

  function showRoleIntro(role, half, practice) {
    var att = role === 'ATTACK';
    overlay(
      '<h1><span class="sub">' + (practice ? '연습 · 반 이닝' : HALF_NAME[half]) + '</span>' +
      (att ? '공격' : '수비') + '</h1>' +
      '<div class="desc">' + (att
        ? '공의 궤적을 읽고 <b>도착 칸</b>을 친다<br>주루에서 피해 <b>세이프</b>를 만든다<br>3B 에서 피버를 쓰면 <b>HOME RUN</b>'
        : '두 칸을 골라 던진다 (3초)<br>타자가 피할 때마다 코스트가 찬다<br>카드로 장애물을 기습 배치한다') +
      '</div>');
  }

  var OUT_REASON = {
    MISS: '타격 실패', GAUGE: '런 게이지 고갈', NO_REACTION: '무반응 2회', NO_DODGE: '구간에서 하나도 못 피함'
  };

  /* §20 의 결과 화면 구성. mine: 내가 친 타석인가 */
  function showAtBatResult(d) {
    var hr = !d.out && d.bases >= HOME_RUN;
    var big = d.out ? 'OUT' : (hr ? 'HOME RUN' : CHANCE_LABEL[d.bases] + '!');
    var color = d.out ? '#ff4b4b' : (hr ? '#ff5ad0' : (d.bases >= 3 ? '#ffe14d' : '#ffffff'));
    var start = d.startChance ? CHANCE_LABEL[d.startChance] + ' CHANCE' : '—';
    var st = d.stats || { success: 0, total: 0, perfect: 0, bestCombo: 0 };
    overlay(
      '<div class="who">' + (d.mine ? '내 타석' : '상대 타석') + '</div>' +
      '<div class="big' + (hr ? ' hr' : '') + '" style="color:' + color + '">' + big + '</div>' +
      '<div class="chain">' + start + ' → <b>' + (d.out ? 'OUT' : CHANCE_LABEL[d.bases]) + '</b></div>' +
      (d.out ? '<div class="reason">' + (OUT_REASON[d.reason] || '') + '</div>' : '') +
      '<div class="rows">' +
      row('BAT', (d.batGrade || '—') + (d.mishit ? ' (빗맞음)' : '')) +
      row('RUN', st.success + ' / ' + st.total) +
      row('PERFECT', st.perfect) +
      row('BEST COMBO', st.bestCombo) +
      row('SCORE', '+' + (d.gained || 0)) +
      '</div>');
  }

  function showInningChange(role, scores) {
    overlay(
      '<h1><span class="sub">3 OUTS</span>공수 교대</h1>' +
      '<div class="chain">' + scores + '</div>' +
      '<div class="desc">이제 <b>' + (role === 'ATTACK' ? '공격' : '수비') + '</b>입니다</div>');
  }

  function showGameOver(d) {
    overlay(
      '<h1><span class="sub">' + d.sub + '</span>' + d.title + '</h1>' +
      '<div class="big small" style="color:' + d.color + '">' + d.score + '</div>' +
      '<div class="btns">' + d.actions.map(function (a) { return btn(a[0], a[1]); }).join('') + '</div>');
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
    notes.forEach(function (n, idx) {
      setTimeout(function () { tone(n[0], n[1], n[2] || 'square', n[3]); }, idx * 70);
    });
  }

  var Sfx = {
    swing:   function () { tone(180, 0.10, 'sawtooth', 0.05, 90); },
    pitch:   function () { tone(420, 0.05, 'triangle', 0.04); },
    hit:     function (g) {
      if (g === 'JUST') seq([[990, 0.07], [1320, 0.07], [1760, 0.22]]);
      else if (g === 'PERFECT') seq([[880, 0.08], [1320, 0.16]]);
      else if (g === 'GREAT' || g === 'LUCKY') seq([[660, 0.08], [990, 0.13]]);
      else tone(520, 0.12, 'square', 0.07);
    },
    homerun: function () { seq([[660, 0.09], [880, 0.09], [1100, 0.09], [1320, 0.09], [1760, 0.32]]); },
    fever:   function () { seq([[520, 0.06], [780, 0.06], [1040, 0.14]]); },
    dodge:   function () { tone(620, 0.07, 'square', 0.06, 880); },
    perfect: function () { seq([[880, 0.06], [1180, 0.10]]); },
    whiff:   function () { tone(260, 0.09, 'triangle', 0.06, 170); },
    fail:    function () { tone(160, 0.22, 'sawtooth', 0.09, 70); },
    card:    function () { tone(980, 0.06, 'square', 0.04, 620); },
    base:    function () { seq([[520, 0.07], [780, 0.14]]); },
    out:     function () { seq([[220, 0.14, 'sawtooth'], [140, 0.30, 'sawtooth']]); },
    unlock:  function () { audio(); }
  };

  return {
    init: init, setScores: setScores, setInning: setInning, setOuts: setOuts, setRole: setRole,
    setStage: setStage, setChance: setChance, setGauge: setGauge, setGaugeVisible: setGaugeVisible,
    setFever: setFever, setCombo: setCombo, setBaseTrack: setBaseTrack, setWait: setWait,
    callout: callout, sub: sub, flash: flash, litZone: litZone, armZone: armZone,
    showHints: showHints, hideHint: hideHint, showPick: showPick, setDust: setDust,
    setDefBar: setDefBar, renderHand: renderHand, pulseCard: pulseCard,
    hideOverlay: hideOverlay, showLobby: showLobby, showMessage: showMessage, showRoleIntro: showRoleIntro,
    showAtBatResult: showAtBatResult, showInningChange: showInningChange, showGameOver: showGameOver,
    HALF_NAME: HALF_NAME, Sfx: Sfx
  };
})();
