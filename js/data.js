/* =============================================================
   data.js — 게임 데이터 계층 (공격·수비·서버 공용)
   장애물과 카드는 코드 분기가 아니라 데이터로 정의한다 (§40).
   필드 장애물은 패턴 풀 + 가중 랜덤 + 난이도 예산으로 만든다 (§14, §32).
   ============================================================= */

/* ---------- 4분면 (§8) ---------- */

var ZONES = ['LT', 'RT', 'LB', 'RB'];
var UPPER = ['LT', 'RT'];
var LOWER = ['LB', 'RB'];
var SLOT_ZONES = { UPPER: UPPER, LOWER: LOWER };

/* 패킷의 startPos / endPos (1~4) */
var ZONE_NUM = { LT: 1, RT: 2, LB: 3, RB: 4 };
var NUM_ZONE = { 1: 'LT', 2: 'RT', 3: 'LB', 4: 'RB' };

/* 위험 위치 -> 정답 입력. 필드·카드·관객 장애물 모두 이 표 하나만 쓴다.
     상단(공·관객) : 날아오는 곳의 **반대쪽** 으로 몸을 피한다.
     하단(수비수)  : 태클해 오는 **같은 쪽** 다리를 들어 넘긴다.
   이 비대칭은 의도된 혼란 요소다. 분기를 만들지 않는다. */
var DANGER_MAP = { LT: 'RT', RT: 'LT', LB: 'LB', RB: 'RB' };

var MIRROR_ZONE = { LT: 'RT', RT: 'LT', LB: 'RB', RB: 'LB' };     // 같은 높이 반대편 (C03·C04 전환)
var OPPOSITE_ZONE = { LT: 'RB', RT: 'LB', LB: 'RT', RB: 'LT' };   // 대각선 반대 (타격 MISS)

var ZONE_ARROW = { LT: '↖', RT: '↗', LB: '↙', RB: '↘' };
var ZONE_NAME  = { LT: '좌상', RT: '우상', LB: '좌하', RB: '우하' };

var ACTION_NAME = {
  LT: '왼쪽으로 상체 회피',
  RT: '오른쪽으로 상체 회피',
  LB: '왼쪽 다리 들기',
  RB: '오른쪽 다리 들기'
};

/* ---------- 장애물 데이터 (§40) ----------
   Type / SpawnPosition / RequiredInput / MoveSpeed / ReactionTime / Reward / Penalty
   reactionTime : 입력 유효 창. 충돌까지 남은 시간이 이 안으로 들어와야 회피가 받아진다.
   reward       : null 이면 표준 획득(PERFECT/NICE × 연속 배율). 값이 있으면 그 양을 그대로 준다.
   penaltyLate  : 끝까지 반응하지 못한 경우. 오답보다 무겁다 — 틀리더라도 반응하는 편이 낫게.
   costGain     : 회피 성공 시 수비자 코스트 충전량. 관객 난입은 수비자 자원이 아니다. */

var OBSTACLES = {
  BALL_LT: {
    id: 'BALL_LT', kind: 'ball', spawn: 'LT', requiredInput: DANGER_MAP.LT,
    moveSpeed: 52, reactionTime: 0.45, reward: null, penalty: -35, penaltyLate: -45, costGain: 1
  },
  BALL_RT: {
    id: 'BALL_RT', kind: 'ball', spawn: 'RT', requiredInput: DANGER_MAP.RT,
    moveSpeed: 52, reactionTime: 0.45, reward: null, penalty: -35, penaltyLate: -45, costGain: 1
  },
  FIELDER_LB: {
    id: 'FIELDER_LB', kind: 'fielder', spawn: 'LB', requiredInput: DANGER_MAP.LB,
    moveSpeed: 46, reactionTime: 0.45, reward: null, penalty: -35, penaltyLate: -45, costGain: 1
  },
  FIELDER_RB: {
    id: 'FIELDER_RB', kind: 'fielder', spawn: 'RB', requiredInput: DANGER_MAP.RB,
    moveSpeed: 46, reactionTime: 0.45, reward: null, penalty: -35, penaltyLate: -45, costGain: 1
  },
  /* 관객 난입 (기획서 4-1) — 위 좌/우에서 뛰어든다. 정답은 공과 같은 표(반대쪽 위). */
  FAN_LT: {
    id: 'FAN_LT', kind: 'fan', spawn: 'LT', requiredInput: DANGER_MAP.LT,
    moveSpeed: 44, reactionTime: 0.45, reward: { gauge: 40, fever: 50 }, penalty: -35, penaltyLate: -45, costGain: 0
  },
  FAN_RT: {
    id: 'FAN_RT', kind: 'fan', spawn: 'RT', requiredInput: DANGER_MAP.RT,
    moveSpeed: 44, reactionTime: 0.45, reward: { gauge: 40, fever: 50 }, penalty: -35, penaltyLate: -45, costGain: 0
  }
};

var KIND_KEY = { ball: 'BALL', fielder: 'FIELDER', fan: 'FAN' };

function obstacleKey(kind, zone) { return KIND_KEY[kind] + '_' + zone; }

/* ---------- 필드 장애물 패턴 풀 (§14) ----------
   cost = 난이도 점수 (쉬움 1 / 보통 2 / 어려움 3, §32)
   gap  = 이 장애물 스폰 후 다음 장애물 스폰까지의 간격(초). 아래에서 안전값으로 보정된다. */

var PATTERNS = [
  /* --- 쉬움 (1점) --- */
  { id: 'E1', cost: 1, minLevel: 1, weight: 5, steps: [{ o: 'BALL_LT', gap: 1.50 }] },
  { id: 'E2', cost: 1, minLevel: 1, weight: 5, steps: [{ o: 'BALL_RT', gap: 1.50 }] },
  { id: 'E3', cost: 1, minLevel: 2, weight: 5, steps: [{ o: 'FIELDER_LB', gap: 1.50 }] },
  { id: 'E4', cost: 1, minLevel: 2, weight: 5, steps: [{ o: 'FIELDER_RB', gap: 1.50 }] },

  /* --- 보통 (2점) --- */
  { id: 'N1', cost: 2, minLevel: 1, weight: 4, steps: [{ o: 'BALL_LT', gap: 1.15 }, { o: 'BALL_RT', gap: 1.40 }] },
  { id: 'N2', cost: 2, minLevel: 1, weight: 4, steps: [{ o: 'BALL_RT', gap: 1.15 }, { o: 'BALL_LT', gap: 1.40 }] },
  { id: 'N3', cost: 2, minLevel: 2, weight: 4, steps: [{ o: 'BALL_LT', gap: 1.15 }, { o: 'FIELDER_RB', gap: 1.40 }] },
  { id: 'N4', cost: 2, minLevel: 2, weight: 4, steps: [{ o: 'FIELDER_LB', gap: 1.15 }, { o: 'BALL_RT', gap: 1.40 }] },
  { id: 'N5', cost: 2, minLevel: 2, weight: 3, steps: [{ o: 'FIELDER_RB', gap: 1.20 }, { o: 'FIELDER_LB', gap: 1.40 }] },

  /* --- 어려움 (3점) --- 기획안 §14 의 Pattern A / B / C --- */
  { id: 'H1', cost: 3, minLevel: 2, weight: 3,
    steps: [{ o: 'BALL_LT', gap: 0.95 }, { o: 'BALL_RT', gap: 0.95 }, { o: 'FIELDER_LB', gap: 1.30 }] },
  { id: 'H2', cost: 3, minLevel: 2, weight: 3,
    steps: [{ o: 'FIELDER_RB', gap: 0.95 }, { o: 'BALL_LT', gap: 0.95 }, { o: 'BALL_RT', gap: 1.30 }] },
  { id: 'H3', cost: 3, minLevel: 3, weight: 3,
    steps: [{ o: 'BALL_RT', gap: 0.90 }, { o: 'FIELDER_LB', gap: 0.90 }, { o: 'BALL_LT', gap: 0.90 }, { o: 'FIELDER_RB', gap: 1.30 }] },
  /* 같은 방향 연속 — 손이 먼저 나가는 것을 노린다 */
  { id: 'H4', cost: 3, minLevel: 3, weight: 2,
    steps: [{ o: 'BALL_LT', gap: 0.90 }, { o: 'BALL_LT', gap: 0.95 }, { o: 'BALL_RT', gap: 1.30 }] },
  { id: 'H5', cost: 3, minLevel: 4, weight: 3,
    steps: [{ o: 'FIELDER_LB', gap: 0.88 }, { o: 'FIELDER_RB', gap: 0.88 }, { o: 'BALL_LT', gap: 0.88 }, { o: 'BALL_RT', gap: 1.30 }] }
];

/* ---------- 난이도 단계 (§15) ----------
   레벨은 구간의 '길이' 가 아니라 '밀도' 만 올린다. 레벨은 타자별 타석 수로 오른다. */

var LEVELS = {
  1: { speedMul: 1.00, gapMul: 1.30, pitchTime: 1.30 },
  2: { speedMul: 1.10, gapMul: 1.10, pitchTime: 1.20 },
  3: { speedMul: 1.22, gapMul: 0.95, pitchTime: 1.08 },
  4: { speedMul: 1.35, gapMul: 0.85, pitchTime: 0.98 }
};

function levelOf(atBat) {
  if (atBat <= 2) return 1;
  if (atBat <= 4) return 2;
  if (atBat <= 7) return 3;
  return 4;
}

/* ---------- 베이스 구간 ----------
   주루는 베이스 하나마다 한 구간이고, 구간 길이는 시간으로 고정한다.
   JUST/PERFECT 타격은 앞 두 구간을 1.5배 빠르게 달린다 (3.3초 / 3.7초). 3루 구간은 표준 속도.
   HR 은 구간을 달려서가 아니라 3B 에서 피버를 발동해야만 나온다. */

var LEG_DURATION = [5.0, 5.5, 8.0];   // 홈->1루, 1->2루, 2->3루
var LEG_BUDGET = [1, 2, 3];
var FAST_RUN = { MUL: 1.5, LEGS: 2 };

/* 뒤 구간일수록 '길어지는' 게 아니라 '험해진다'. 같은 예산이라도 어려운 패턴 쪽으로 기운다. */
var LEG_DIFFICULTY_BIAS = 0.55;

var BASE_NAME = ['1루', '2루', '3루', '홈'];

function legDuration(index, fast) {
  var d = LEG_DURATION[Math.min(index, LEG_DURATION.length - 1)];
  return (fast && index < FAST_RUN.LEGS) ? d / FAST_RUN.MUL : d;
}

/* ---------- 주루 규칙 상수 ---------- */

var RUN = {
  START_DISTANCE: 100,     // 거리값 하나로만 접근을 계산한다 (§25)

  /* 판정은 누르는 순간 한다. 유효 창(장애물 reactionTime) 안에서 정답 칸이면 성공,
     그중 충돌까지 이 시간 이내면 PERFECT. 충돌 직전이 최고 판정이어야 손이 납득한다. */
  PERFECT_WINDOW: 0.20,
  WHIFF_STIFF: 0.35,       // 유효 창에 아무것도 없는데 누르면 이 시간 동안 회피 입력을 받지 않는다

  GAUGE_START: 50,
  GAUGE_MAX: 100,          // 게이지는 체력이다. 0 이하가 되면 즉시 아웃
  GAUGE_PERFECT: 25,
  GAUGE_NICE: 15,
  COMBO_STEP: 0.10,        // 연속 성공 배율. 5연속에서 1.5배로 상한
  COMBO_MAX: 5,
  LATE_OUT: 2,             // 한 구간에서 TOO LATE 가 이만큼 나오면 태그아웃

  /* 봇 대 봇 40경기 기준 HR 이 세이프의 약 9% 가 되는 값. 20/12 에서는 40% 가 HR 이었다. */
  FEVER_MAX: 100,          // 타석마다 0 에서 시작한다
  FEVER_PERFECT: 10,
  FEVER_NICE: 5,
  FEVER_GUARD_TIME: 2.5,   // 방어용 발동: 무적 시간
  FEVER_GUARD_GAUGE: 30,   // 방어용 발동: 런 게이지 회복
  FEVER_DASH: 1.5,         // 무적 동안 구간 진행 배율
  HR_RUN_TIME: 2.6,        // 3B 에서 발동한 홈런 직행 연출 길이

  FIRST_GAP: 0.55,         // 구간 시작 후 첫 필드 장애물까지의 여유 (§13-3)
  LEG_END_MARGIN: 0.25,    // 필드 장애물은 베이스 도착 이만큼 전까지 부딪혀야 한다
  FIELD_SAFE_GAP: 0.12,    // 필드 장애물끼리 유효 창이 겹치지 않게 벌리는 여유 (§13-3)
  FAN_CHANCE: 0.07,        // 구간마다 관객 난입 확률 (기획서 4-1: 5~8%)
  FAN_CLEAR: 0.6,          // 관객은 필드 장애물 충돌 시각과 이만큼 떨어뜨린다
  WIND_MIN: 0.05,          // 바람: 장애물마다 속도 ±5~10% (기획서 4-1)
  WIND_MAX: 0.10,

  SNAPSHOT_HZ: 20          // 수비 화면용 RUN_STATE 전송 빈도
};

/* ---------- 타격 ----------
   타이밍(언제) + 코스(어디). 쳐야 할 칸은 공이 도착하는 칸이다.
   정확한 칸 = 타이밍 등급 그대로 / 옆 칸 = 빗맞은 1B(그중 일부 LUCKY) / 대각선 반대 = MISS.
   타이밍 링은 없다. 공의 궤적과 속도를 눈으로 읽는다. */

var BAT_WINDOWS = [
  { grade: 'JUST',    err: 0.030, chance: 3, gauge: 60, fast: true },
  { grade: 'PERFECT', err: 0.070, chance: 3, gauge: 50, fast: true },
  { grade: 'GREAT',   err: 0.140, chance: 2, gauge: 50, fast: false },
  { grade: 'GOOD',    err: 0.230, chance: 1, gauge: 50, fast: false }
];

/* 빗맞은 타격 중 일부. 타자는 1B/2B CHANCE, 수비자는 코스트 차감 + 주루 초반 카드 잠금 */
var LUCKY = { RATE: 0.12, CHANCES: [1, 2], COST_PENALTY: 2, CARD_LOCK: 2.0 };

/* 직구 = 같은 칸 두 번, 변화구 = 다른 칸. 변화구는 비행 BREAK_AT 지점부터 도착 칸으로 휜다 */
var PITCH = { SELECT_TIME: 3.0, FASTBALL_MUL: 0.78, BREAK_AT: 0.55, SWING_GRACE: 0.24 };

var CHANCE_LABEL = { 0: 'OUT', 1: '1B', 2: '2B', 3: '3B', 4: 'HR' };
var CHANCE_SCORE = { 1: 100, 2: 200, 3: 350, 4: 600 };
var MAX_BAT_CHANCE = 3;
var HOME_RUN = 4;

/* ---------- 수비 덱 (기획서 3-1) ----------
   slots   : 카드가 손패에 들어올 때 무작위로 정해지는 위치 칸 (UPPER / LOWER)
   spawns  : 만들어낼 장애물. slot 은 위 칸 번호, delay 는 첫 장애물 대비 '충돌 시각' 차이
   switchAt: 충돌까지 이 시간이 남으면 같은 높이 반대편 칸으로 옮겨간다 (유효 창이 열리기 직전)
   effect  : 교란. decel = 다가오는 가장 가까운 공을 감속 / dust = 공격자 화면 가운데를 가림 */

var DEFENSE = { COST_START: 3, COST_MAX: 10, HAND_SIZE: 4 };

var CARDS = {
  C01: { id: 'C01', name: '고속 직격 공', type: '상단', cost: 1, slots: ['UPPER'],
         spawns: [{ kind: 'ball', slot: 0, delay: 0, speedMul: 1.35 }] },
  C02: { id: 'C02', name: '슬라이딩 태클', type: '하단', cost: 1, slots: ['LOWER'],
         spawns: [{ kind: 'fielder', slot: 0, delay: 0, speedMul: 1.35 }] },
  C03: { id: 'C03', name: '대각 굴절 공', type: '상단', cost: 2, slots: ['UPPER'],
         spawns: [{ kind: 'ball', slot: 0, delay: 0, switchAt: 0.55 }] },
  C04: { id: 'C04', name: '점핑 태클', type: '하단', cost: 2, slots: ['LOWER'],
         spawns: [{ kind: 'fielder', slot: 0, delay: 0, switchAt: 0.55 }] },
  C05: { id: 'C05', name: '시차 2연타 공', type: '상단', cost: 3, slots: ['UPPER'],
         spawns: [{ kind: 'ball', slot: 0, delay: 0 }, { kind: 'ball', slot: 0, delay: 0.20 }] },
  C06: { id: 'C06', name: '상하 샌드위치', type: '복합', cost: 3, slots: ['UPPER', 'LOWER'],
         spawns: [{ kind: 'ball', slot: 0, delay: 0 }, { kind: 'fielder', slot: 1, delay: 0.15 }] },
  C07: { id: 'C07', name: '변박 체인지업', type: '교란', cost: 2, slots: [],
         effect: { type: 'decel', at: 0.50, speedMul: 0.40 } },
  C08: { id: 'C08', name: '시야 흙먼지', type: '교란', cost: 2, slots: [],
         effect: { type: 'dust', time: 1.0 } }
};

var DECK = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08'];

/* ---------- 필드 코스 생성 ----------
   완전 랜덤이 아니라 난이도 예산을 패턴으로 채운다 (§32). */

function windMul(rng) {
  var m = RUN.WIND_MIN + rng() * (RUN.WIND_MAX - RUN.WIND_MIN);
  return 1 + (rng() < 0.5 ? -m : m);
}

function weightedPick(list, level, legIndex, rng) {
  var total = 0, i, w, weights = [];
  var bias = (level - 1) * 0.6 + legIndex * LEG_DIFFICULTY_BIAS;
  for (i = 0; i < list.length; i++) {
    /* 레벨이 오르거나 구간이 뒤로 갈수록 비싼(어려운) 패턴 쪽으로 기운다 */
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

/* 한 구간의 필드 장애물 일정. [{ key, speed, travel, spawnAt }] — spawnAt 은 구간 시작 기준 초 */
function buildLegPlan(level, legIndex, duration, rng, forceFan) {
  rng = rng || Math.random;
  var L = LEVELS[level];
  var remaining = LEG_BUDGET[Math.min(legIndex, LEG_BUDGET.length - 1)];
  var picked = [], lastId = null, guard = 0;

  while (remaining > 0 && guard++ < 40) {
    var cands = [];
    for (var i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i];
      if (p.minLevel <= level && p.cost <= remaining && p.id !== lastId) cands.push(p);
    }
    if (!cands.length) break;
    var chosen = weightedPick(cands, level, legIndex, rng);
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

  /* 안전 보정 (§13-3): 앞 장애물이 부딪히기 전에 다음 장애물이 유효 창에 들어오면
     필드가 스스로 "동시에 두 개" 를 만든다. 겹침은 수비 카드로만 생겨야 한다. */
  for (var k = 0; k < steps.length - 1; k++) {
    var cur = steps[k], nxt = steps[k + 1];
    var need = cur.travel - nxt.travel + OBSTACLES[nxt.key].reactionTime + RUN.FIELD_SAFE_GAP;
    if (cur.gap < need) cur.gap = need;
  }

  var t = RUN.FIRST_GAP;
  for (var n = 0; n < steps.length; n++) { steps[n].spawnAt = t; t += steps[n].gap; }

  /* 베이스에 닿기 전에 부딪히지 못하는 장애물은 뺀다. 단 구간마다 최소 하나는 남긴다 —
     "구간 성공 0개 = 태그아웃" 규칙이 장애물 없는 구간에서 억울하게 걸리지 않도록. */
  var limit = duration - RUN.LEG_END_MARGIN;
  var plan = [];
  for (var q = 0; q < steps.length; q++) {
    if (steps[q].spawnAt + steps[q].travel <= limit) plan.push(steps[q]);
  }
  if (!plan.length && steps.length) {
    steps[0].spawnAt = Math.max(0, limit - steps[0].travel);
    plan.push(steps[0]);
  }

  /* 관객 난입 (기획서 4-1). 필드 장애물과 겹치지 않는 시각에만 넣는다. */
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
    ZONES: ZONES, UPPER: UPPER, LOWER: LOWER, SLOT_ZONES: SLOT_ZONES, ZONE_NUM: ZONE_NUM, NUM_ZONE: NUM_ZONE,
    DANGER_MAP: DANGER_MAP, MIRROR_ZONE: MIRROR_ZONE, OPPOSITE_ZONE: OPPOSITE_ZONE,
    OBSTACLES: OBSTACLES, KIND_KEY: KIND_KEY, obstacleKey: obstacleKey, PATTERNS: PATTERNS,
    LEVELS: LEVELS, levelOf: levelOf, LEG_DURATION: LEG_DURATION, LEG_BUDGET: LEG_BUDGET,
    FAST_RUN: FAST_RUN, legDuration: legDuration, RUN: RUN, BAT_WINDOWS: BAT_WINDOWS, LUCKY: LUCKY,
    PITCH: PITCH, CHANCE_LABEL: CHANCE_LABEL, CHANCE_SCORE: CHANCE_SCORE, MAX_BAT_CHANCE: MAX_BAT_CHANCE,
    HOME_RUN: HOME_RUN, DEFENSE: DEFENSE, CARDS: CARDS, DECK: DECK, buildLegPlan: buildLegPlan
  };
}
