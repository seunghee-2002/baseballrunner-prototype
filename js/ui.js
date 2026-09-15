/* =============================================================
   ui.js — HUD / 손패 / 오버레이 / 간단한 효과음
   주루 중에는 하트와 남은 거리만 크게 보여준다 (v2 10.3). 실패 이유는 반드시 글로도 보여준다.
   ============================================================= */

var UI = (function () {

  var el = {};
  var ZONE_INDEX = { LT: 0, RT: 1, LB: 2, RB: 3 };

  function $(id) { return document.getElementById(id); }

  function init() {
    ['hud', 'scoreMe', 'scoreSep', 'scoreOpp', 'inning', 'outs', 'roleTag', 'attacks', 'count', 'legBar',
     'legName', 'legFill', 'waitInfo', 'hearts', 'defBar', 'costNum', 'cdInfo', 'hand', 'flash', 'callout',
     'subCallout', 'overlay', 'dust', 'dustWarn'].forEach(function (id) { el[id] = $(id); });
    el.zones = document.querySelectorAll('.zone');
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

  function dots(sel, n) {
    var list = el.hud.querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) list[i].classList.toggle('on', i < n);
  }

  function setOuts(n) { dots('#outs i', n); }

  function setCount(strikes, balls) {
    dots('#count i.s', strikes);
    dots('#count i.b', balls);
  }

  function setAttacks(text) { el.attacks.textContent = text; }

  function setRole(role) {
    el.roleTag.textContent = role === 'ATTACK' ? '공격' : (role === 'DEFENSE' ? '수비' : '');
    el.roleTag.className = role === 'DEFENSE' ? 'def' : 'att';
  }

  /* 주루 중에는 점수판을 흐리게 하고 하트·거리만 또렷하게 */
  function setRunHud(on) {
    el.hud.classList.toggle('running', !!on);
    el.legBar.hidden = !on;
    el.hearts.hidden = !on;
  }

  function setLeg(label, progress, boosted) {
    el.legName.textContent = label;
    el.legFill.style.width = Math.max(0, Math.min(100, progress * 100)) + '%';
    el.legBar.classList.toggle('boost', !!boosted);
  }

  /* 하트. 줄어들면 방금 잃은 하트가 깨지는 연출 */
  var heartKey = '';
  function setHearts(n, max) {
    var key = n + '/' + max;
    if (key === heartKey) return;
    var prev = heartKey ? Number(heartKey.split('/')[0]) : n;
    heartKey = key;
    var html = '';
    for (var i = 0; i < max; i++) {
      var cls = i < n ? 'on' : (i < prev ? 'broken' : 'off');
      html += '<i class="' + cls + '">&#10084;</i>';
    }
    el.hearts.innerHTML = html;
  }

  function resetHearts() { heartKey = ''; el.hearts.innerHTML = ''; }

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

  function setDust(on) { el.dust.classList.toggle('on', !!on); }
  function setDustWarn(on) { el.dustWarn.classList.toggle('on', !!on); }

  /* ---------- 수비 손패 ---------- */

  var BLOCK_TEXT = { COST: '코스트 부족', COOLDOWN: '쿨다운', NO_TARGET: '다가오는 공 없음', TOO_LATE: '홈 임박', PHASE: '' };
  var handKey = '';

  function setDefBar(on) {
    el.defBar.hidden = !on;
    handKey = '';
  }

  function setCostInfo(cost, cooldown) {
    el.costNum.textContent = cost;
    el.cdInfo.textContent = cooldown > 0 ? '  쿨다운 ' + cooldown.toFixed(1) : '';
  }

  /* 장애물 손패. hand: [{uid,id,zones}], reasons: 카드별 막힌 이유('' = 사용 가능) */
  function renderHand(hand, reasons) {
    var key = 'H' + hand.map(function (c, i) { return c.uid + reasons[i]; }).join('|');
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
    el.hand.className = 'obstacle';
    el.hand.innerHTML = html;
  }

  /* 투구 이동 표시 — 수비자(투수 시점) 화면 기준 */
  function moveText(card) {
    if (!card.move) return '●';
    if (card.move === 'DIAGONAL') return '⤡';
    if (card.move.dc > 0) return '→';
    if (card.move.dc < 0) return '←';
    return card.move.dr > 0 ? '↓' : '↑';
  }

  /* 투구 손패: 직구(고정) + 3장. pick: -1 직구 / 0~2 / null, blocks: 카드별 막힌 이유
     enabled: 구질 단계에서만 true. 칸 단계에서는 고른 카드만 또렷하고 나머지는 흐리다 */
  function renderPitchHand(hand, pick, blocks, enabled) {
    var key = 'P' + (enabled ? 1 : 0) + ':' + pick + ':' + hand.map(function (c, i) { return c.uid + blocks[i]; }).join('|');
    if (key === handKey) return;
    handKey = key;
    function tile(card, idx, keyName, why) {
      var picked = pick === idx;
      return '<div class="card pitch' + ((why || !enabled) && !picked ? ' off' : '') + (picked ? ' picked' : '') +
        '" data-pitch="' + idx + '">' +
        '<span class="c-cost">' + card.cost + '</span>' +
        '<span class="c-where">' + moveText(card) + '</span>' +
        '<span class="c-name">' + card.name + '</span>' +
        '<span class="c-type">' + card.speed + ' · ' + keyName + '</span>' +
        (why && BLOCK_TEXT[why] ? '<span class="c-why">' + BLOCK_TEXT[why] + '</span>' : '') +
        '</div>';
    }
    var html = tile(FASTBALL, -1, 'F', '');
    hand.forEach(function (c, i) { html += tile(PITCH_CARDS[c.id], i, String(i + 1), blocks[i]); });
    el.hand.className = 'pitching';
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

  function showLobby(pvpNote, deck) {
    overlay(
      '<h1><span class="sub">PROTOTYPE v2 · 1v1</span>BASEBALL<br>ACTION RUNNER</h1>' +
      '<div class="desc">타격으로 <b>생명</b>을 얻고<br>회피로 생명을 지키며 <b>홈까지</b> 달린다</div>' +
      '<div class="btns">' +
      btn('pvp', 'PvP 대전', !!pvpNote) +
      btn('practice-attack', '연습 · 공격') +
      btn('practice-defense', '연습 · 수비') +
      '<div class="btn ghost" data-act="deck">덱 편집</div>' +
      '</div>' +
      (pvpNote ? '<div class="note">' + pvpNote + '</div>' : '') +
      '<div class="deckLine">덱 ' + deck.join(' · ') + '</div>' +
      '<div class="keys">' +
      '<b>타격</b> 공이 <b>도착하는 칸</b>을 도착 순간에 · 볼은 치지 않는다<br>' +
      '<b>위쪽 공</b> 반대쪽 &nbsp; <b>아래 수비수</b> 같은 쪽<br>' +
      '<b>투구</b> 투구 카드를 고른 뒤 <b>시작 칸</b>을 탭<br><br>' +
      '&#8598; Q &nbsp; &#8599; E &nbsp; &#8601; A &nbsp; &#8600; D &nbsp;·&nbsp; 카드 1~3 &nbsp;·&nbsp; 직구 F' +
      '</div>');
  }

  /* 덱 편집: 장애물 카드 8종 중 6장 */
  function showDeckEditor(selected) {
    var html = '<h1><span class="sub">장애물 카드 8종 중 ' + DEFENSE.DECK_SIZE + '장</span>덱 편집</h1><div class="deckGrid">';
    CARD_POOL.forEach(function (id) {
      var def = CARDS[id], on = selected.indexOf(id) >= 0;
      html += '<div class="deckCard' + (on ? ' on' : '') + '" data-act="deck-toggle" data-id="' + id + '">' +
        '<span class="c-cost">' + def.cost + '</span>' +
        '<b>' + id + '</b><span>' + def.name + '</span><em>' + def.type + '</em></div>';
    });
    var ready = selected.length === DEFENSE.DECK_SIZE;
    html += '</div><div class="deckCount">' + selected.length + ' / ' + DEFENSE.DECK_SIZE + '</div>' +
      '<div class="btns">' + btn('deck-save', '저장', !ready) + btn('lobby', '취소') + '</div>';
    overlay(html);
  }

  function showMessage(title, text, actions) {
    overlay(
      '<h1><span class="sub">' + (title.sub || '') + '</span>' + title.main + '</h1>' +
      (text ? '<div class="desc">' + text + '</div>' : '') +
      '<div class="btns">' + (actions || []).map(function (a) { return btn(a[0], a[1]); }).join('') + '</div>');
  }

  var HALF_NAME = { TOP: '초', BOTTOM: '말' };

  function inningText(inning, half) { return inning + '회 ' + HALF_NAME[half]; }

  function showRoleIntro(role, subText) {
    var att = role === 'ATTACK';
    overlay(
      '<h1><span class="sub">' + subText + '</span>' + (att ? '공격' : '수비') + '</h1>' +
      '<div class="desc">' + (att
        ? '공의 궤적을 읽고 <b>도착 칸</b>을 친다 · 볼은 참는다<br>잘 칠수록 <b>생명</b>이 많다<br>생명이 남아 있는 한 <b>홈까지</b> 달린다'
        : '<b>구질</b>을 고르고(' + PITCH.PICK_TIME + '초, 넘기면 직구)<br><b>시작 칸</b>을 탭한다(' + PITCH.ZONE_TIME + '초, 넘기면 무작위)<br>타석마다 코스트 +' + DEFENSE.COST_GRANT + ', 타자가 피할 때마다 +1<br>주루 중 장애물 카드로 기습한다') +
      '</div>');
  }

  var REASON_TEXT = { STRIKEOUT: '삼진', NO_FIRST: '1루에 닿지 못했다', LIVES: '생명 소진', HOME: '끝까지 달렸다' };

  /* 타석 결과. mine: 내가 친 타석인가 */
  function showAtBatResult(d) {
    var hr = !d.out && d.bases >= HOME;
    var big = d.out ? 'OUT' : BASE_LABEL[d.bases];
    var color = d.out ? '#ff4b4b' : (hr ? '#ff5ad0' : (d.bases >= 3 ? '#ffe14d' : '#ffffff'));
    var reason = REASON_TEXT[d.reason] || '';
    if (d.reason === 'LIVES') reason += ' — ' + BASE_NAME[d.bases - 1] + ' 세이프';
    var st = d.stats || { success: 0, total: 0, perfect: 0 };
    var batText = d.walk ? 'BALL 2 (2루 출루)' : (d.batGrade || '—');
    overlay(
      '<div class="who">' + (d.mine ? '내 타석' : '상대 타석') + '</div>' +
      '<div class="big' + (hr ? ' hr' : '') + '" style="color:' + color + '">' + big + '</div>' +
      '<div class="reason' + (d.out ? ' bad' : '') + '">' + reason + '</div>' +
      '<div class="rows">' +
      row('BAT', batText) +
      (d.reason === 'STRIKEOUT' ? '' : row('생명', d.livesStart + ' → ' + d.livesLeft)) +
      (d.reason === 'STRIKEOUT' ? '' : row('RUN', st.success + ' / ' + st.total + ' (PERFECT ' + st.perfect + ')')) +
      row('SCORE', '+' + (d.gained || 0)) +
      '</div>');
  }

  /* handicap: 'ME' | 'OPP' | null — 다음 이닝 공격 +1 을 받는 쪽 */
  function showInningChange(role, inning, half, scores, handicap) {
    var hc = handicap === 'ME' ? '<div class="reason">점수 차 — 다음 이닝 내 공격 +1</div>'
      : (handicap === 'OPP' ? '<div class="reason">점수 차 — 다음 이닝 상대 공격 +1</div>' : '');
    overlay(
      '<h1><span class="sub">' + inningText(inning, half) + '</span>공수 교대</h1>' +
      '<div class="chain">' + scores + '</div>' + hc +
      '<div class="desc">이제 <b>' + (role === 'ATTACK' ? '공격' : '수비') + '</b>입니다</div>');
  }

  function showGameOver(d) {
    overlay(
      '<h1><span class="sub">' + d.sub + '</span>' + d.title + '</h1>' +
      '<div class="big small" style="color:' + d.color + '">' + d.score + '</div>' +
      '<div class="btns">' + d.actions.map(function (a) { return btn(a[0], a[1]); }).join('') + '</div>');
  }

  /* ---------- 효과음 ----------
     파일 없이 오실레이터만 쓴다. */

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
      if (g === 'PERFECT') seq([[990, 0.07], [1320, 0.07], [1760, 0.22]]);
      else if (g === 'GREAT') seq([[880, 0.08], [1320, 0.16]]);
      else if (g === 'GOOD' || g === 'LUCKY') seq([[660, 0.08], [990, 0.13]]);
      else tone(520, 0.12, 'square', 0.07);
    },
    ball:    function () { tone(300, 0.10, 'triangle', 0.06); },
    strike:  function () { tone(200, 0.16, 'sawtooth', 0.07, 120); },
    homerun: function () { seq([[660, 0.09], [880, 0.09], [1100, 0.09], [1320, 0.09], [1760, 0.32]]); },
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
    init: init, setScores: setScores, setInning: setInning, setOuts: setOuts, setCount: setCount,
    setAttacks: setAttacks, setRole: setRole, setRunHud: setRunHud, setLeg: setLeg,
    setHearts: setHearts, resetHearts: resetHearts, setWait: setWait,
    callout: callout, sub: sub, flash: flash, litZone: litZone, armZone: armZone,
    setDust: setDust, setDustWarn: setDustWarn,
    setDefBar: setDefBar, setCostInfo: setCostInfo, renderHand: renderHand, renderPitchHand: renderPitchHand,
    pulseCard: pulseCard,
    hideOverlay: hideOverlay, showLobby: showLobby, showDeckEditor: showDeckEditor, showMessage: showMessage,
    showRoleIntro: showRoleIntro, showAtBatResult: showAtBatResult, showInningChange: showInningChange,
    showGameOver: showGameOver, inningText: inningText, Sfx: Sfx
  };
})();
