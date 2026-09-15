/* =============================================================
   data.js — 게임 데이터 계층
   장애물은 코드 분기가 아니라 데이터로 정의한다 (§40).
   패턴 풀 + 가중 랜덤 + 난이도 예산으로 코스를 만든다 (§14, §32).
   ============================================================= */

/* ---------- 4분면 (§8) ---------- */

var ZONES = ['LT', 'RT', 'LB', 'RB'];

/* 위험 위치 -> 정답 입력.
   장애물 종류별 if/else 를 만들지 않기 위해 이 테이블 하나로만 다룬다.

   상체와 하체의 규칙이 일부러 반대다. 이 비대칭이 의도된 혼란 요소다.
     상단(공)     : 날아오는 곳의 **반대쪽** 으로 몸을 피한다.
     하단(수비수) : 태클해 오는 **같은 쪽** 다리를 들어 넘긴다.

   주: 기획안 §11 표는 하단도 반대쪽이었으나 사용자 지시로 하단만 반전했다.
   §9 의 액션 명칭도 이에 맞춰 정합화했다 (아래 ACTION_NAME). */
var DANGER_MAP = { LT: 'RT', RT: 'LT', LB: 'LB', RB: 'RB' };

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
   penaltyLate 는 아예 반응하지 못하고 충돌한 경우다. 오답보다 무겁게 매겨
   "틀리더라도 일단 반응하는 쪽이 낫다" 가 되게 한다. */

var OBSTACLES = {
  BALL_LT: {
    id: 'BALL_LT', type: 'ball', spawn: 'LT', requiredInput: DANGER_MAP.LT,
    moveSpeed: 52, reactionTime: 0.95, reward: 15, penalty: -35, penaltyLate: -45
  },
  BALL_RT: {
    id: 'BALL_RT', type: 'ball', spawn: 'RT', requiredInput: DANGER_MAP.RT,
    moveSpeed: 52, reactionTime: 0.95, reward: 15, penalty: -35, penaltyLate: -45
  },
  FIELDER_LB: {
    id: 'FIELDER_LB', type: 'fielder', spawn: 'LB', requiredInput: DANGER_MAP.LB,
    moveSpeed: 46, reactionTime: 1.05, reward: 15, penalty: -35, penaltyLate: -45
  },
  FIELDER_RB: {
    id: 'FIELDER_RB', type: 'fielder', spawn: 'RB', requiredInput: DANGER_MAP.RB,
    moveSpeed: 46, reactionTime: 1.05, reward: 15, penalty: -35, penaltyLate: -45
  }
};

/* ---------- 패턴 풀 (§14) ----------
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
   레벨은 구간의 '길이' 가 아니라 '밀도' 만 올린다.
   길이는 아래 LEG_BUDGET, 즉 몇 루타를 노리는가로 정해진다. */

var LEVELS = {
  1: { speedMul: 1.00, reactMul: 1.00, gapMul: 1.30, pitchTime: 1.30 },
  2: { speedMul: 1.10, reactMul: 0.92, gapMul: 1.10, pitchTime: 1.20 },
  3: { speedMul: 1.22, reactMul: 0.85, gapMul: 0.95, pitchTime: 1.08 },
  4: { speedMul: 1.35, reactMul: 0.78, gapMul: 0.85, pitchTime: 0.98 }
};

/* ---------- 베이스 구간 ----------
   주루는 베이스 하나마다 끊어서 달린다. 한 구간에 배정되는 난이도 예산이다 (§32).
   앞 구간일수록 짧고 쉽다 — 1루까지는 금방 가고, 3루로 가는 길이 제일 험하다. */

var LEG_BUDGET = [1, 2, 2, 2];   // 홈->1루, 1->2루, 2->3루, 3->홈

/* 뒤 구간일수록 '길어지는' 게 아니라 '험해진다'.
   같은 예산이라도 뒤로 갈수록 연속 패턴 쪽으로 가중치가 기운다. */
var LEG_DIFFICULTY_BIAS = 0.55;

function legBudget(baseIndex) {
  return LEG_BUDGET[Math.min(baseIndex, LEG_BUDGET.length - 1)];
}

var BASE_NAME = ['1루', '2루', '3루', '홈'];

function levelOf(atBat) {
  if (atBat <= 2) return 1;
  if (atBat <= 4) return 2;
  if (atBat <= 7) return 3;
  return 4;
}

/* ---------- 주루 규칙 상수 (§18, §25) ---------- */

var RUN = {
  START_DISTANCE: 100,   // 거리값 하나로만 접근을 계산한다 (§25)
  MAX_ACTIVE_DIST: 85,   // 입력 유효 창의 상한
  MIN_REACTION: 0.70,    // 어떤 난이도에서도 이보다 짧은 대응 시간은 만들지 않는다 (§13-3)

  /* 판정 기준은 "충돌까지 남은 시간" 이다.
     눈으로 부딪히는 걸 보고 누른 순간이 PERFECT 가 되어야 손이 납득한다.
     이 값보다 일찍 누르면 SUCCESS, 충돌을 넘기면 TOO LATE. */
  PERFECT_WINDOW: 0.20,

  GAUGE_START: 50,
  GAUGE_PERFECT: 25,
  GAUGE_SUCCESS: 15,

  /* 연속 성공 배율 (§18). 5연속에서 1.5배로 상한. */
  COMBO_STEP: 0.10,
  COMBO_MAX: 5,

  /* 3B 에 올라선 뒤부터 게이지가 절반 속도로 찬다.
     HR 을 "상위 특별 결과" 로 유지하기 위한 문턱이다 (§5-3).
     하락 페널티는 그대로라, 3B 에서 HR 을 노리는 것은 분명한 도박이 된다. */
  HR_GAIN_RATIO: 0.5,

  GAUGE_AFTER_PROMOTE: 45,
  GAUGE_AFTER_DEMOTE: 55,

  FIRST_GAP: 0.55        // 구간 시작 후 첫 장애물이 뜨기까지의 여유 (§13-3)
};

/* ---------- 타격 (§5) ----------
   타격은 두 축이다: 타이밍(언제) + 코스(어디).
   공은 스트라이크존 4칸 중 하나로 들어오고, 그 칸을 쳐야 정타다.
   인접한 칸을 치면 빗맞은 안타, 대각선 반대쪽을 치면 배트에 스쳐 파울이 된다.

   JUST 는 §5-3 이 말한 "매우 좁은 타이밍" 이다. 루타를 더 주는 대신
   게이지를 높게 들고 출발시켜 HR 사정권에 놓는다. */

var OPPOSITE_ZONE = { LT: 'RB', RT: 'LB', LB: 'RT', RB: 'LT' };
var FOUL_LIMIT = 2;          // 3번째 파울은 헛스윙으로 친다 (무한 반복 방지)

var BAT_WINDOWS = [
  { grade: 'JUST',    err: 0.030, chance: 3, gauge: 60 },
  { grade: 'PERFECT', err: 0.070, chance: 3, gauge: 50 },
  { grade: 'GREAT',   err: 0.140, chance: 2, gauge: 50 },
  { grade: 'GOOD',    err: 0.230, chance: 1, gauge: 50 }
];

var CHANCE_LABEL = { 0: 'OUT', 1: '1B', 2: '2B', 3: '3B', 4: 'HR' };
var CHANCE_SCORE = { 1: 100, 2: 200, 3: 350, 4: 600 };   // §21
var MAX_CHANCE = 4;   // HR 은 3B 에서 게이지를 끝까지 채워야만 나오는 상위 결과 (§5-3)

/* ---------- 코스 생성 ----------
   완전 랜덤이 아니라 난이도 예산을 패턴으로 채운다 (§32). */

function weightedPick(list, level, baseIndex) {
  var total = 0, i, w, weights = [];
  var bias = (level - 1) * 0.6 + baseIndex * LEG_DIFFICULTY_BIAS;
  for (i = 0; i < list.length; i++) {
    /* 레벨이 오르거나 베이스가 뒤로 갈수록 비싼(어려운) 패턴 쪽으로 기운다 */
    w = list[i].weight * Math.pow(list[i].cost, bias);
    weights.push(w);
    total += w;
  }
  var r = Math.random() * total;
  for (i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

/* baseIndex: 0 = 홈->1루, 1 = 1->2루, ... */
function buildCourse(atBat, baseIndex) {
  var level = levelOf(atBat);
  var L = LEVELS[level];
  var budget = legBudget(baseIndex);
  var remaining = budget;
  var picked = [];
  var lastId = null;
  var guard = 0;

  while (remaining > 0 && guard++ < 40) {
    var cands = [];
    for (var i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i];
      if (p.minLevel <= level && p.cost <= remaining && p.id !== lastId) cands.push(p);
    }
    if (!cands.length) break;
    var chosen = weightedPick(cands, level, baseIndex);
    picked.push(chosen);
    remaining -= chosen.cost;
    lastId = chosen.id;
  }

  /* 패턴 -> 실제 스텝으로 전개 */
  var steps = [];
  for (var a = 0; a < picked.length; a++) {
    var pat = picked[a];
    for (var b = 0; b < pat.steps.length; b++) {
      var s = pat.steps[b];
      var def = OBSTACLES[s.o];
      var speed = def.moveSpeed * L.speedMul;
      var reaction = Math.max(RUN.MIN_REACTION, def.reactionTime * L.reactMul);
      var activeDist = Math.min(RUN.MAX_ACTIVE_DIST, speed * reaction);
      steps.push({
        def: def,
        speed: speed,
        reaction: reaction,
        activeDist: activeDist,
        gapAfter: s.gap * L.gapMul,
        patternId: pat.id
      });
    }
  }

  /* 안전 보정 (§13-3):
     앞 장애물이 사라지기 전에 다음 장애물이 입력 유효 창에 들어오면
     "동시에 두 개를 처리해야 하는" 나쁜 랜덤이 된다. 간격을 늘려 막는다. */
  for (var k = 0; k < steps.length - 1; k++) {
    var cur = steps[k], nxt = steps[k + 1];
    var need = RUN.START_DISTANCE / cur.speed
             - (RUN.START_DISTANCE - nxt.activeDist) / nxt.speed
             + 0.12;
    if (cur.gapAfter < need) cur.gapAfter = need;
  }

  /* 구간 총 길이. 베이스가 등속으로 다가오는 연출에 쓴다. */
  var duration = RUN.FIRST_GAP;
  for (var d = 0; d < steps.length - 1; d++) duration += steps[d].gapAfter;
  if (steps.length) duration += RUN.START_DISTANCE / steps[steps.length - 1].speed;

  return {
    level: level, baseIndex: baseIndex,
    budget: budget, used: budget - remaining,
    steps: steps, duration: duration
  };
}

/* node 로 규칙을 검증할 때만 사용 (브라우저에서는 무시된다) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ZONES: ZONES, DANGER_MAP: DANGER_MAP, OBSTACLES: OBSTACLES, PATTERNS: PATTERNS,
    LEVELS: LEVELS, RUN: RUN, BAT_WINDOWS: BAT_WINDOWS, CHANCE_LABEL: CHANCE_LABEL,
    CHANCE_SCORE: CHANCE_SCORE, MAX_CHANCE: MAX_CHANCE, LEG_BUDGET: LEG_BUDGET,
    OPPOSITE_ZONE: OPPOSITE_ZONE, FOUL_LIMIT: FOUL_LIMIT, BASE_NAME: BASE_NAME,
    levelOf: levelOf, buildCourse: buildCourse, legBudget: legBudget
  };
}
