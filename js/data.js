/* =============================================================
   data.js — 게임 데이터 계층 (공격·수비·서버 공용)
   기준 문서: docs/기획서-v2.md. 수치는 전부 튜닝 대상이다.
   장애물과 카드는 코드 분기가 아니라 데이터로 정의한다.
   필드 장애물은 패턴 풀 + 가중 랜덤 + 구간 예산으로 만든다 (v2 9장).
   ============================================================= */

/* ---------- 4분할 (v2 4장) ---------- */

var ZONES = ['LT', 'RT', 'LB', 'RB'];
var UPPER = ['LT', 'RT'];
var LOWER = ['LB', 'RB'];
var SLOT_ZONES = { UPPER: UPPER, LOWER: LOWER };

/* 위험 위치 -> 정답 입력. 필드·카드·관객 장애물 모두 이 표 하나만 쓴다.
     상단(공·관객) : 날아오는 곳의 **반대쪽** 으로 몸을 피한다.
     하단(수비수)  : 태클해 오는 **같은 쪽** 다리를 들어 넘긴다.
   이 비대칭은 의도된 혼란 요소다. 분기를 만들지 않는다. */
var DANGER_MAP = { LT: 'RT', RT: 'LT', LB: 'LB', RB: 'RB' };

var MIRROR_ZONE = { LT: 'RT', RT: 'LT', LB: 'RB', RB: 'LB' };     // 같은 높이 반대편 (C03·C04, 투수 시점 좌우)
var OPPOSITE_ZONE = { LT: 'RB', RT: 'LB', LB: 'RT', RB: 'LT' };   // 대각선 반대 (타격 스트라이크, P5)

var ZONE_ARROW = { LT: '↖', RT: '↗', LB: '↙', RB: '↘' };
var ZONE_NAME  = { LT: '좌상', RT: '우상', LB: '좌하', RB: '우하' };

var ACTION_NAME = {
  LT: '왼쪽으로 상체 회피',
  RT: '오른쪽으로 상체 회피',
  LB: '왼쪽 다리 들기',
  RB: '오른쪽 다리 들기'
};

/* 칸 좌표. c: 0 왼쪽 / 1 오른쪽, r: 0 위 / 1 아래. 투구가 네 칸 밖으로 나가면 c·r 이 범위를 벗어난다 = 볼 */
var ZONE_CELL = { LT: { c: 0, r: 0 }, RT: { c: 1, r: 0 }, LB: { c: 0, r: 1 }, RB: { c: 1, r: 1 } };

function cellZone(c, r) {
  if (c < 0 || c > 1 || r < 0 || r > 1) return null;
  return r === 0 ? (c === 0 ? 'LT' : 'RT') : (c === 0 ? 'LB' : 'RB');
}

/* ---------- 장애물 데이터 ----------
   reactionTime : 입력 유효 창. 충돌까지 남은 시간이 이 안으로 들어와야 회피가 받아진다.
   lifeLoss     : 회피 BAD 일 때 잃는 생명.
   costGain     : 회피 성공 시 수비자 코스트 충전량. 관객 난입은 수비자 자원이 아니다. */

var OBSTACLES = {
  BALL_LT:    { id: 'BALL_LT', kind: 'ball', spawn: 'LT', requiredInput: DANGER_MAP.LT, moveSpeed: 52, reactionTime: 0.45, lifeLoss: 1, costGain: 1 },
  BALL_RT:    { id: 'BALL_RT', kind: 'ball', spawn: 'RT', requiredInput: DANGER_MAP.RT, moveSpeed: 52, reactionTime: 0.45, lifeLoss: 1, costGain: 1 },
  FIELDER_LB: { id: 'FIELDER_LB', kind: 'fielder', spawn: 'LB', requiredInput: DANGER_MAP.LB, moveSpeed: 46, reactionTime: 0.45, lifeLoss: 1, costGain: 1 },
  FIELDER_RB: { id: 'FIELDER_RB', kind: 'fielder', spawn: 'RB', requiredInput: DANGER_MAP.RB, moveSpeed: 46, reactionTime: 0.45, lifeLoss: 1, costGain: 1 },
  /* 관객 난입 — 위 좌/우에서 뛰어든다. 정답은 공과 같은 표(반대쪽 위). 보상 없음 */
  FAN_LT:     { id: 'FAN_LT', kind: 'fan', spawn: 'LT', requiredInput: DANGER_MAP.LT, moveSpeed: 44, reactionTime: 0.45, lifeLoss: 1, costGain: 0 },
  FAN_RT:     { id: 'FAN_RT', kind: 'fan', spawn: 'RT', requiredInput: DANGER_MAP.RT, moveSpeed: 44, reactionTime: 0.45, lifeLoss: 1, costGain: 0 }
};

var KIND_KEY = { ball: 'BALL', fielder: 'FIELDER', fan: 'FAN' };

function obstacleKey(kind, zone) { return KIND_KEY[kind] + '_' + zone; }

/* ---------- 필드 장애물 패턴 풀 (v2 9.1) ----------
   cost = 난이도 점수 (쉬움 1 / 보통 2 / 어려움 3)
   gap  = 이 장애물 스폰 후 다음 장애물 스폰까지의 간격(초). 아래에서 안전값으로 보정된다. */

var PATTERNS = [
  { id: 'E1', cost: 1, weight: 5, steps: [{ o: 'BALL_LT', gap: 1.50 }] },
  { id: 'E2', cost: 1, weight: 5, steps: [{ o: 'BALL_RT', gap: 1.50 }] },
  { id: 'E3', cost: 1, weight: 5, steps: [{ o: 'FIELDER_LB', gap: 1.50 }] },
  { id: 'E4', cost: 1, weight: 5, steps: [{ o: 'FIELDER_RB', gap: 1.50 }] },

  { id: 'N1', cost: 2, weight: 4, steps: [{ o: 'BALL_LT', gap: 1.15 }, { o: 'BALL_RT', gap: 1.40 }] },
  { id: 'N2', cost: 2, weight: 4, steps: [{ o: 'BALL_RT', gap: 1.15 }, { o: 'BALL_LT', gap: 1.40 }] },
  { id: 'N3', cost: 2, weight: 4, steps: [{ o: 'BALL_LT', gap: 1.15 }, { o: 'FIELDER_RB', gap: 1.40 }] },
  { id: 'N4', cost: 2, weight: 4, steps: [{ o: 'FIELDER_LB', gap: 1.15 }, { o: 'BALL_RT', gap: 1.40 }] },
  { id: 'N5', cost: 2, weight: 3, steps: [{ o: 'FIELDER_RB', gap: 1.20 }, { o: 'FIELDER_LB', gap: 1.40 }] },

  { id: 'H1', cost: 3, weight: 3,
    steps: [{ o: 'BALL_LT', gap: 0.95 }, { o: 'BALL_RT', gap: 0.95 }, { o: 'FIELDER_LB', gap: 1.30 }] },
  { id: 'H2', cost: 3, weight: 3,
    steps: [{ o: 'FIELDER_RB', gap: 0.95 }, { o: 'BALL_LT', gap: 0.95 }, { o: 'BALL_RT', gap: 1.30 }] },
  { id: 'H3', cost: 3, weight: 3,
    steps: [{ o: 'BALL_RT', gap: 0.90 }, { o: 'FIELDER_LB', gap: 0.90 }, { o: 'BALL_LT', gap: 0.90 }, { o: 'FIELDER_RB', gap: 1.30 }] },
  /* 같은 방향 연속 — 손이 먼저 나가는 것을 노린다 */
  { id: 'H4', cost: 3, weight: 2,
    steps: [{ o: 'BALL_LT', gap: 0.90 }, { o: 'BALL_LT', gap: 0.95 }, { o: 'BALL_RT', gap: 1.30 }] },
  { id: 'H5', cost: 3, weight: 3,
    steps: [{ o: 'FIELDER_LB', gap: 0.88 }, { o: 'FIELDER_RB', gap: 0.88 }, { o: 'BALL_LT', gap: 0.88 }, { o: 'BALL_RT', gap: 1.30 }] }
];

/* ---------- 주루 구간 (v2 7.1, 9.2) ----------
   한 구간 = 베이스 하나. 구간 길이는 시간으로 고정하고, 뒤 구간일수록 밀도(속도·간격)만 올린다.
   hardBias : 어려운 패턴 가중치. 패턴 weight × cost^hardBias 로 뽑는다 (0 = 낮음). */

var LEGS = [
  { duration: 4.0, budget: 1, speedMul: 1.00, gapMul: 1.30, hardBias: 0.0 },   // 홈 → 1루
  { duration: 4.5, budget: 2, speedMul: 1.10, gapMul: 1.10, hardBias: 0.6 },   // 1루 → 2루
  { duration: 5.5, budget: 3, speedMul: 1.22, gapMul: 0.95, hardBias: 1.2 },   // 2루 → 3루
  { duration: 6.0, budget: 3, speedMul: 1.35, gapMul: 0.85, hardBias: 1.2 }    // 3루 → 홈
];

var HOME = 4;
var BASE_NAME = ['1루', '2루', '3루', '홈'];
var BASE_SCORE = { 0: 0, 1: 50, 2: 150, 3: 400, 4: 1000 };
var BASE_LABEL = { 0: 'OUT', 1: '1루', 2: '2루', 3: '3루', 4: 'HOME RUN' };

/* 보너스 속도: 타격 등급이 정한 구간 수만큼 구간 시간이 이 배율로 빨리 흐른다 */
var BOOST_MUL = 1.5;

function legDuration(index, boostLegs) {
  return LEGS[index].duration / (index < boostLegs ? BOOST_MUL : 1);
}

/* ---------- 주루 규칙 상수 ---------- */

var RUN = {
  START_DISTANCE: 100,     // 거리값 하나로만 접근을 계산한다. 0 = 충돌

  /* 판정은 누르는 순간 한다. 유효 창(장애물 reactionTime) 안에서 정답 칸이면 성공.
     충돌 직전이 최고 판정이다. */
  PERFECT_WINDOW: 0.15,
  GREAT_WINDOW: 0.30,      // 그보다 이르면 GOOD (유효 창 0.45 까지)
  WHIFF_STIFF: 0.35,       // 유효 창에 아무것도 없는데 누르면 이 시간 동안 회피 입력을 받지 않는다

  LIFE_MAX: 3,

  FIRST_GAP: 0.55,         // 구간 시작 후 첫 필드 장애물까지의 여유
  LEG_END_MARGIN: 0.25,    // 필드 장애물은 베이스 도착 이만큼 전까지 부딪혀야 한다
  FIELD_SAFE_GAP: 0.12,    // 필드 장애물끼리 유효 창이 겹치지 않게 벌리는 여유
  FAN_CHANCE: 0.07,        // 구간마다 관객 난입 확률
  FAN_CLEAR: 0.6,          // 관객은 필드 장애물 충돌 시각과 이만큼 떨어뜨린다
  WIND_MIN: 0.05,          // 바람: 장애물마다 속도 ±5~10%
  WIND_MAX: 0.10,

  PREVIEW_TIME: 1.0,       // 수비자는 필드 장애물 생성을 이만큼 먼저 본다
  OUTRO: 0.75,             // 아웃·생명 소진 연출 뒤 결과
  SNAPSHOT_HZ: 20          // 수비 화면용 RUN_STATE 전송 빈도
};

/* ---------- 타격 (v2 6장) ----------
   쳐야 할 칸은 도착 칸이다. 등급은 생명 수와 보너스 속도 구간을 정한다.
   boostLegs : 앞에서부터 이 구간 수만큼 가속 (3 = 3루까지, 2 = 2루까지) */

var BAT_WINDOWS = [
  { grade: 'PERFECT', err: 0.040, lives: 3, boostLegs: 3 },
  { grade: 'GREAT',   err: 0.100, lives: 2, boostLegs: 2 },
  { grade: 'GOOD',    err: 0.160, lives: 2, boostLegs: 0 },
  { grade: 'BAD',     err: 0.230, lives: 1, boostLegs: 0 }
];

/* 옆 칸 빗맞음은 파울(스트라이크). 그중 일부만 LUCKY 로 생명 1개 주루 */
var LUCKY = { RATE: 0.25, LIVES: 1 };

/* 2스트라이크 = 삼진, 2볼 = 2루에서 주루 시작 */
var COUNT = { STRIKE_OUT: 2, BALL_WALK: 2, WALK_BASE: 2, WALK_LIVES: 2 };

/* PICK_TIME : 구질 선택 제한. 넘기면 직구
   ZONE_TIME : 칸 선택 제한(구질을 고른 뒤 새로 센다). 넘기면 무작위 칸
   BASE_TIME : 보통 구속의 비행 시간. 카드마다 timeMul 을 곱하고, 투구마다 ±SPEED_RANDOM
   BREAK_AT  : 변화구는 비행 이 지점부터 도착 칸으로 휜다. 일찍 휘어야 방향을 눈으로 읽는다 (막판 반응 싸움이 되지 않게)
   BREAK_BOW : 휘기 시작할 때 시작 칸 바깥으로 부푸는 정도 (한 칸 이동 거리 대비). 화면 연출만, 판정과 무관
   SWING_GRACE : 공이 도착한 뒤 이만큼 기다렸다가 무스윙으로 판정한다 */
var PITCH = { PICK_TIME: 3.0, ZONE_TIME: 3.0, BASE_TIME: 1.15, BREAK_AT: 0.25, BREAK_BOW: 0.35, SWING_GRACE: 0.24, SPEED_RANDOM: 0.08, RESULT_TIME: 1.0 };

/* ---------- 투구 카드 (v2 5장) ----------
   move : 수비자(투수 시점) 화면 기준 이동. dc +1 = 오른쪽, dr +1 = 아래. 'DIAGONAL' = 대각선 반대 칸.
   이동이 없는 카드는 시작 칸 = 도착 칸. 직구는 덱에 없고 항상 쓸 수 있다. */

var FASTBALL = { id: null, name: '직구', move: null, timeMul: 0.78, cost: 0, speed: '빠름' };

var PITCH_CARDS = {
  P1: { id: 'P1', name: '좌→우 슬라이더', move: { dc: 1, dr: 0 },  timeMul: 1.00, cost: 1, speed: '보통' },
  P2: { id: 'P2', name: '우→좌 슬라이더', move: { dc: -1, dr: 0 }, timeMul: 1.00, cost: 1, speed: '보통' },
  P3: { id: 'P3', name: '낙차 포크',      move: { dc: 0, dr: 1 },  timeMul: 1.00, cost: 1, speed: '보통' },
  P4: { id: 'P4', name: '라이징',         move: { dc: 0, dr: -1 }, timeMul: 1.00, cost: 1, speed: '보통' },
  P5: { id: 'P5', name: '대각 커브',      move: 'DIAGONAL',        timeMul: 1.13, cost: 2, speed: '느림' },
  P6: { id: 'P6', name: '강속구',         move: null,              timeMul: 0.65, cost: 2, speed: '매우 빠름' }
};

var PITCH_DECK = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

function pitchCard(id) { return id ? PITCH_CARDS[id] : FASTBALL; }

/* 공격자(타자 시점) 기준 궤적. start 는 타자 시점 칸이다.
   수비자는 투수 뒤에서 보므로 좌우가 반대 — 카드의 dc 를 뒤집는다. */
function pitchPath(cardId, start) {
  var card = pitchCard(cardId), s = ZONE_CELL[start], c = s.c, r = s.r;
  if (card.move === 'DIAGONAL') { c = 1 - c; r = 1 - r; }
  else if (card.move) { c -= card.move.dc; r += card.move.dr; }
  var end = cellZone(c, r);
  return { start: start, end: end, startCell: { c: s.c, r: s.r }, endCell: { c: c, r: r },
           ball: !end, breaking: c !== s.c || r !== s.r };
}

/* ---------- 수비 (v2 8장) ---------- */

var DEFENSE = {
  COST_GRANT: 4,       // 타석마다 지급. 남은 코스트는 이월
  COST_MAX: 10,
  HAND_SIZE: 3,        // 장애물 손패
  PITCH_HAND: 3,       // 투구 손패 (+ 직구 고정)
  DECK_SIZE: 6,        // 장애물 카드 8종 중 매치 전에 고르는 수
  COOLDOWN: 0.5,       // 카드 발동 후 전역 쿨다운
  WARN_TIME: 0.5       // 교란 카드는 공격자 화면 경고 뒤에 적용한다
};

/* slots   : 카드가 손패에 들어올 때 무작위로 정해지는 위치 칸 (UPPER / LOWER)
   spawns  : 만들어낼 장애물. slot 은 위 칸 번호, delay 는 첫 장애물 대비 '충돌 시각' 차이
   switchAt: 충돌까지 이 시간이 남으면 같은 높이 반대편 칸으로 옮겨간다 (유효 창이 열리기 직전)
   effect  : 교란. decel = 다가오는 가장 가까운 공을 감속 / dust = 공격자 화면 가운데를 가림 */

var CARDS = {
  C01: { id: 'C01', name: '고속 직격 공', type: '상단', cost: 1, slots: ['UPPER'],
         spawns: [{ kind: 'ball', slot: 0, delay: 0, speedMul: 1.35 }] },
  C02: { id: 'C02', name: '슬라이딩 태클', type: '하단', cost: 1, slots: ['LOWER'],
         spawns: [{ kind: 'fielder', slot: 0, delay: 0, speedMul: 1.35 }] },
  C03: { id: 'C03', name: '대각 굴절 공', type: '상단', cost: 3, slots: ['UPPER'],
         spawns: [{ kind: 'ball', slot: 0, delay: 0, switchAt: 0.55 }] },
  C04: { id: 'C04', name: '점핑 태클', type: '하단', cost: 3, slots: ['LOWER'],
         spawns: [{ kind: 'fielder', slot: 0, delay: 0, switchAt: 0.55 }] },
  C05: { id: 'C05', name: '시차 2연타 공', type: '상단', cost: 5, slots: ['UPPER'],
         spawns: [{ kind: 'ball', slot: 0, delay: 0 }, { kind: 'ball', slot: 0, delay: 0.20 }] },
  C06: { id: 'C06', name: '상하 샌드위치', type: '복합', cost: 5, slots: ['UPPER', 'LOWER'],
         spawns: [{ kind: 'ball', slot: 0, delay: 0 }, { kind: 'fielder', slot: 1, delay: 0.15 }] },
  C07: { id: 'C07', name: '변박 체인지업', type: '교란', cost: 3, slots: [],
         effect: { type: 'decel', at: 0.50, speedMul: 0.40 } },
  C08: { id: 'C08', name: '시야 흙먼지', type: '교란', cost: 3, slots: [],
         effect: { type: 'dust', time: 1.0 } }
};

var CARD_POOL = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08'];
var DEFAULT_DECK = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06'];

/* 덱이 규칙(서로 다른 6장)에 맞지 않으면 기본 덱을 쓴다 */
function validDeck(deck) {
  if (!deck || deck.length !== DEFENSE.DECK_SIZE) return DEFAULT_DECK.slice();
  var seen = {};
  for (var i = 0; i < deck.length; i++) {
    if (!CARDS[deck[i]] || seen[deck[i]]) return DEFAULT_DECK.slice();
    seen[deck[i]] = true;
  }
  return deck.slice();
}

/* ---------- 매치 (v2 3장) ----------
   HANDICAP_DIFF : 이닝이 끝났을 때 점수 차가 이 이상이면 뒤진 쪽 다음 이닝 공격 +1 [미정].
     임시값 = 한 타석 최대 점수(홈런). 봇 대 봇 200경기: 1이닝(초+말) 평균 2158점, 이닝 종료 시 31% 발동. */

var MATCH = {
  INNINGS: 3,
  ATTACKS: 3,          // 반 이닝 공격 횟수 (타석 수)
  OUT_LIMIT: 2,        // 이만큼 아웃이면 조기 종료
  HANDICAP_DIFF: 1000,
  START_TIME: 1.5,
  RESULT_TIME: 1.5,    // 타석 결과 화면 뒤 자동으로 다음 타석
  INNING_TIME: 3.0     // 공수 교대 안내
};

/* ---------- 필드 코스 생성 ----------
   완전 랜덤이 아니라 난이도 예산을 패턴으로 채운다. */

function windMul(rng) {
  var m = RUN.WIND_MIN + rng() * (RUN.WIND_MAX - RUN.WIND_MIN);
  return 1 + (rng() < 0.5 ? -m : m);
}

function weightedPick(list, bias, rng) {
  var total = 0, i, w, weights = [];
  for (i = 0; i < list.length; i++) {
    w = list[i].weight * Math.pow(list[i].cost, bias);
    weights.push(w);
    total += w;
  }
  var r = rng() * total;
  for (i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

/* 한 구간의 필드 장애물 일정. [{ key, speed, travel, spawnAt }] — spawnAt 은 구간 시작 기준 초.
   duration 은 보너스 속도가 적용된 실제 구간 시간이다 (가속 구간은 장애물 수가 준다). */
function buildLegPlan(legIndex, duration, rng, forceFan) {
  rng = rng || Math.random;
  var L = LEGS[legIndex];
  var remaining = L.budget;
  var picked = [], lastId = null, guard = 0;

  while (remaining > 0 && guard++ < 40) {
    var cands = [];
    for (var i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i];
      if (p.cost <= remaining && p.id !== lastId) cands.push(p);
    }
    if (!cands.length) break;
    var chosen = weightedPick(cands, L.hardBias, rng);
    picked.push(chosen);
    remaining -= chosen.cost;
    lastId = chosen.id;
  }

  var steps = [];
  for (var a = 0; a < picked.length; a++) {
    for (var b = 0; b < picked[a].steps.length; b++) {
      var s = picked[a].steps[b];
      var speed = OBSTACLES[s.o].moveSpeed * L.speedMul * windMul(rng);
      steps.push({ key: s.o, speed: speed, travel: RUN.START_DISTANCE / speed, gap: s.gap * L.gapMul });
    }
  }

  /* 안전 보정: 앞 장애물이 부딪히기 전에 다음 장애물이 유효 창에 들어오면
     필드가 스스로 "동시에 두 개" 를 만든다. 겹침은 수비 카드로만 생겨야 한다. */
  for (var k = 0; k < steps.length - 1; k++) {
    var cur = steps[k], nxt = steps[k + 1];
    var need = cur.travel - nxt.travel + OBSTACLES[nxt.key].reactionTime + RUN.FIELD_SAFE_GAP;
    if (cur.gap < need) cur.gap = need;
  }

  var t = RUN.FIRST_GAP;
  for (var n = 0; n < steps.length; n++) { steps[n].spawnAt = t; t += steps[n].gap; }

  /* 베이스에 닿기 전에 부딪히지 못하는 장애물은 뺀다. 단 구간마다 최소 하나는 남긴다. */
  var limit = duration - RUN.LEG_END_MARGIN;
  var plan = [];
  for (var q = 0; q < steps.length; q++) {
    if (steps[q].spawnAt + steps[q].travel <= limit) plan.push(steps[q]);
  }
  if (!plan.length && steps.length) {
    steps[0].spawnAt = Math.max(0, limit - steps[0].travel);
    plan.push(steps[0]);
  }

  /* 관객 난입. 필드 장애물과 겹치지 않는 시각에만 넣는다. */
  if (forceFan || rng() < RUN.FAN_CHANCE) {
    var fanKey = obstacleKey('fan', UPPER[rng() < 0.5 ? 0 : 1]);
    var fanSpeed = OBSTACLES[fanKey].moveSpeed * L.speedMul * windMul(rng);
    var fanTravel = RUN.START_DISTANCE / fanSpeed;
    var earliest = RUN.FIRST_GAP + fanTravel;
    for (var tries = 0; tries < 8 && limit > earliest; tries++) {
      var hit = earliest + rng() * (limit - earliest);
      var clear = true;
      for (var c = 0; c < plan.length; c++) {
        if (Math.abs(hit - (plan[c].spawnAt + plan[c].travel)) < RUN.FAN_CLEAR) { clear = false; break; }
      }
      if (clear) {
        plan.push({ key: fanKey, speed: fanSpeed, travel: fanTravel, spawnAt: hit - fanTravel });
        plan.sort(function (x, y) { return x.spawnAt - y.spawnAt; });
        break;
      }
    }
  }

  return plan;
}

/* node(서버·규칙 검증)에서만 사용한다. 브라우저에서는 무시된다. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ZONES: ZONES, UPPER: UPPER, LOWER: LOWER, SLOT_ZONES: SLOT_ZONES, DANGER_MAP: DANGER_MAP,
    MIRROR_ZONE: MIRROR_ZONE, OPPOSITE_ZONE: OPPOSITE_ZONE, ZONE_CELL: ZONE_CELL, cellZone: cellZone,
    OBSTACLES: OBSTACLES, obstacleKey: obstacleKey, PATTERNS: PATTERNS, LEGS: LEGS, HOME: HOME,
    BASE_SCORE: BASE_SCORE, BOOST_MUL: BOOST_MUL, legDuration: legDuration, RUN: RUN,
    BAT_WINDOWS: BAT_WINDOWS, LUCKY: LUCKY, COUNT: COUNT, PITCH: PITCH, FASTBALL: FASTBALL,
    PITCH_CARDS: PITCH_CARDS, PITCH_DECK: PITCH_DECK, pitchPath: pitchPath, DEFENSE: DEFENSE,
    CARDS: CARDS, CARD_POOL: CARD_POOL, DEFAULT_DECK: DEFAULT_DECK, validDeck: validDeck,
    MATCH: MATCH, buildLegPlan: buildLegPlan
  };
}
