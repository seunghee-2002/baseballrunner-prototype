/* =============================================================
   scene.js — three.js 렌더링 계층
   프리미티브 도형만 쓴다. 캐릭터 3D 애니메이션은 만들지 않는다 (§26).
   장애물 접근은 distance 값 하나를 좌표로 환산해 처리한다 (§25).
   ============================================================= */

var Scene3D = (function () {

  var renderer, scene, camera;
  var player, lean, hipL, hipR, armL, armR, batPivot;
  var laneMarks = [], pitcher, pitchBall, mound, hitRing, approachRing;
  var strikeZone, baseMarker;
  var boost = 0;            // 베이스를 밟고 지나갈 때의 짧은 속도감

  /* 스트라이크존 4칸의 중심 — 공은 이 중 한 곳으로 들어온다 (§8 의 4분면과 같은 배치) */
  var ZONE_POINT = {
    LT: { x: -0.19, y: 1.43 },
    RT: { x:  0.19, y: 1.43 },
    LB: { x: -0.19, y: 1.07 },
    RB: { x:  0.19, y: 1.07 }
  };
  var ZONE_Z = 0.55;
  var obstacles = [];       // { mesh, step, distance } 참조용 (게임 로직은 game.js 소유)

  var mode = 'bat';
  var runSpeed = 0;         // 배경 스크롤 속도 (연출용)
  var runPhase = 0;
  var shakeAmt = 0;
  var flyBall = null;       // 타격 후 날아가는 공
  var baseX = 0;            // 모드별 플레이어 기본 x 위치

  /* 회피 포즈 목표값. 매 프레임 현재값을 목표로 보간한다. */
  var pose = { leanZ: 0, offX: 0, legL: 0, legR: 0, crouch: 0 };
  var cur  = { leanZ: 0, offX: 0, legL: 0, legR: 0, crouch: 0 };
  var poseTimer = 0;

  var camPos = new THREE.Vector3(0, 2.9, 6.4);
  var camLook = new THREE.Vector3(0, 1.5, -14);
  var camPosTarget = camPos.clone();
  var camLookTarget = camLook.clone();

  /* ---------- 스폰 오프셋 (§8 4분면 -> 3D 위치) ----------
     멀리서는 화면 네 귀퉁이에 넓게, 가까워지면 플레이어 몸으로 수렴한다. */
  var SPAWN = {
    LT: { from: { x: -3.6, y: 3.15 }, to: { x: -0.28, y: 1.42 } },
    RT: { from: {  x: 3.6, y: 3.15 }, to: {  x: 0.28, y: 1.42 } },
    LB: { from: { x: -3.1, y: 0.02 }, to: { x: -0.30, y: 0.02 } },
    RB: { from: {  x: 3.1, y: 0.02 }, to: {  x: 0.30, y: 0.02 } }
  };

  var Z_PER_DIST = 0.42;    // distance 100 -> z 약 -42

  /* ---------------------------------------------------------- */

  function box(w, h, d, color) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: color }));
  }
  function ball(r, color, seg) {
    return new THREE.Mesh(new THREE.SphereGeometry(r, seg || 14, seg || 12),
      new THREE.MeshLambertMaterial({ color: color }));
  }

  /* 사람 형상 하나. 프리미티브 조합일 뿐이다. */
  function makeHuman(uniform, skin, helmet) {
    var g = new THREE.Group();
    var t = box(0.52, 0.74, 0.30, uniform); t.position.y = 1.15; g.add(t);
    var h = ball(0.20, skin); h.position.y = 1.68; g.add(h);
    var cap = ball(0.225, helmet); cap.position.y = 1.74; cap.scale.y = 0.72; g.add(cap);
    return g;
  }

  function makeLeg(x, color) {
    var hip = new THREE.Group();
    hip.position.set(x, 0.78, 0);
    var l = box(0.18, 0.74, 0.20, color);
    l.position.y = -0.37;
    hip.add(l);
    return hip;
  }

  function makeArm(x, color) {
    var sh = new THREE.Group();
    sh.position.set(x, 1.42, 0);
    var a = box(0.15, 0.58, 0.16, color);
    a.position.y = -0.29;
    sh.add(a);
    return sh;
  }

  /* ---------------------------------------------------------- */

  function buildPlayer() {
    player = new THREE.Group();

    lean = new THREE.Group();            // 상체 회피용 피벗
    lean.position.y = 0;
    var body = makeHuman(0xf2f4f8, 0xe8b48c, 0x1f4fd8);
    lean.add(body);

    armL = makeArm(-0.35, 0xf2f4f8);
    armR = makeArm(0.35, 0xf2f4f8);
    lean.add(armL); lean.add(armR);

    batPivot = new THREE.Group();
    batPivot.position.set(0.30, 1.30, 0.05);
    var bat = box(0.085, 1.05, 0.085, 0xc08b4a);
    bat.position.y = 0.48;
    bat.rotation.z = 0.35;
    batPivot.add(bat);
    batPivot.rotation.y = -0.9;
    lean.add(batPivot);

    player.add(lean);

    hipL = makeLeg(-0.15, 0x2a3350);
    hipR = makeLeg(0.15, 0x2a3350);
    player.add(hipL); player.add(hipR);

    var sh = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.03;
    player.add(sh);

    scene.add(player);
  }

  function buildField() {
    var grass = new THREE.Mesh(new THREE.PlaneGeometry(90, 340),
      new THREE.MeshLambertMaterial({ color: 0x1d6e39 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.z = -140;
    scene.add(grass);

    var ground = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 340),
      new THREE.MeshLambertMaterial({ color: 0xa9713f }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0.01, -140);
    scene.add(ground);

    /* 속도감을 만드는 라인 마커 (§24) */
    for (var i = 0; i < 30; i++) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 1.6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(i % 2 === 0 ? -2.35 : 2.35, 0.02, -i * 5);
      scene.add(m);
      laneMarks.push(m);
    }

    /* 멀리 있는 관중석 — fog 로 흐려질 정도의 덩어리만 */
    for (var s = -1; s <= 1; s += 2) {
      var stand = box(10, 6, 120, 0x151b2e);
      stand.position.set(s * 16, 3, -70);
      scene.add(stand);
    }

    mound = new THREE.Mesh(new THREE.CircleGeometry(2.4, 22),
      new THREE.MeshLambertMaterial({ color: 0xb9814c }));
    mound.rotation.x = -Math.PI / 2;
    mound.position.set(0, 0.03, -19);
    scene.add(mound);

    pitcher = makeHuman(0xd8dde8, 0xe8b48c, 0x8a1420);
    pitcher.position.set(0, 0, -19);
    pitcher.add(makeLeg(-0.15, 0x35406a));
    pitcher.add(makeLeg(0.15, 0x35406a));
    scene.add(pitcher);

    pitchBall = ball(0.13, 0xffffff, 12);
    pitchBall.visible = false;
    scene.add(pitchBall);

    /* 스트라이크존 4분할 격자 — 공이 어느 칸으로 오는지 보여야 한다.
       주루의 4분면과 같은 배치라 손이 헷갈리지 않는다 (§8). */
    strikeZone = new THREE.Group();
    var lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.30 });
    var W = 0.76, H = 0.72, T = 0.014;
    var gy, gx;
    for (gy = -1; gy <= 1; gy++) {
      var hbar = new THREE.Mesh(new THREE.BoxGeometry(W, T, T), lineMat);
      hbar.position.set(0, 1.25 + gy * (H / 2), 0);
      strikeZone.add(hbar);
    }
    for (gx = -1; gx <= 1; gx++) {
      var vbar = new THREE.Mesh(new THREE.BoxGeometry(T, H, T), lineMat);
      vbar.position.set(gx * (W / 2), 1.25, 0);
      strikeZone.add(vbar);
    }
    strikeZone.position.z = ZONE_Z;
    scene.add(strikeZone);

    /* 타격 타이밍 큐 — 접근 링이 고정 링과 겹치는 순간이 PERFECT 다.
       링은 공이 들어올 칸 위에 뜬다: 타이밍과 코스를 한 곳에서 읽게 (§30 Q1). */
    var ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    hitRing = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 24), ringMat);
    hitRing.position.set(0, 1.25, ZONE_Z + 0.02);
    scene.add(hitRing);

    approachRing = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.038, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.85 }));
    approachRing.position.copy(hitRing.position);
    approachRing.visible = false;
    scene.add(approachRing);

    /* 베이스 — 주루 중 발밑으로 다가와 지나간다 */
    baseMarker = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    baseMarker.rotation.x = -Math.PI / 2;
    baseMarker.rotation.z = Math.PI / 4;
    baseMarker.position.set(0, 0.04, -40);
    baseMarker.visible = false;
    scene.add(baseMarker);
  }

  function buildLights() {
    scene.add(new THREE.HemisphereLight(0x9fc0ff, 0x24313f, 0.95));
    var d = new THREE.DirectionalLight(0xffffff, 0.85);
    d.position.set(6, 14, 6);
    scene.add(d);
    var d2 = new THREE.DirectionalLight(0x8fb2ff, 0.35);
    d2.position.set(-8, 9, -6);
    scene.add(d2);
  }

  /* ---------------------------------------------------------- */

  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a1020);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a1020, 26, 78);

    camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);

    buildLights();
    buildField();
    buildPlayer();
    resize();
  }

  /* 매 프레임 호출해도 되도록 크기가 바뀔 때만 실제로 적용한다.
     (첫 프레임에 레이아웃이 아직 0 인 경우를 그냥 흡수한다) */
  var lastW = 0, lastH = 0;
  function resize() {
    if (!renderer) return;
    var el = renderer.domElement;
    var w = el.clientWidth, h = el.clientHeight;
    if (!w || !h || (w === lastW && h === lastH)) return;
    lastW = w; lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ---------------------------------------------------------- */

  function setMode(m) {
    mode = m;
    if (m === 'bat') {
      camPosTarget.set(0, 2.9, 6.4);
      camLookTarget.set(0, 1.5, -14);
      batPivot.visible = true;
      pitcher.visible = true;
      mound.visible = true;
      hitRing.visible = true;
      strikeZone.visible = true;
      baseMarker.visible = false;
      player.rotation.y = 0;
    } else {
      camPosTarget.set(0, 2.55, 4.7);
      camLookTarget.set(0, 1.30, -8);
      batPivot.visible = false;
      pitcher.visible = false;
      mound.visible = false;
      hitRing.visible = false;
      approachRing.visible = false;
      strikeZone.visible = false;
      pitchBall.visible = false;
    }
  }

  function setRunning(on) { runSpeed = on ? 15 : 0; }

  /* ---------- 회피 포즈 ----------
     무엇을 했는지 눈에 보여야 한다 (§37).
       상체 : 입력한 방향으로 몸을 기울여 피한다.
       하체 : 입력한 쪽 다리를 들어 태클을 넘긴다. 몸은 반대로 살짝 기울어 균형을 잡는다. */
  function dodge(zone) {
    if (zone === 'LT')      { pose.leanZ =  0.62; pose.offX = -0.45; pose.legL = 0; pose.legR = 0; }
    else if (zone === 'RT') { pose.leanZ = -0.62; pose.offX =  0.45; pose.legL = 0; pose.legR = 0; }
    else if (zone === 'LB') { pose.leanZ = -0.20; pose.offX =  0.10; pose.legL = 1.0; pose.legR = 0; }
    else if (zone === 'RB') { pose.leanZ =  0.20; pose.offX = -0.10; pose.legR = 1.0; pose.legL = 0; }
    poseTimer = 0.42;
  }

  function clearPose() {
    pose.leanZ = 0; pose.offX = 0; pose.legL = 0; pose.legR = 0; pose.crouch = 0;
  }

  function hitReaction() {
    pose.crouch = 0.28;
    poseTimer = 0.45;
    shake(0.42);
  }

  function shake(a) { shakeAmt = Math.max(shakeAmt, a); }

  /* ---------- 타격 ---------- */

  var swingT = -1;
  function swing() { swingT = 0; }

  /* p: 0(릴리스) -> 1(타격 지점), zone: 공이 들어올 스트라이크존 칸 */
  function setPitch(p, zone) {
    var t = ZONE_POINT[zone] || ZONE_POINT.LT;

    /* 코스는 일찍 드러나야 한다. 늦게 갈리면 "보고 칠 수 없는" 운이 된다 (§13-3). */
    var ease = Math.pow(p, 0.7);
    pitchBall.visible = true;
    pitchBall.position.set(
      t.x * ease,
      1.80 + (t.y - 1.80) * ease,
      -18.2 + (18.2 + ZONE_Z) * p
    );
    var s = 0.9 + p * 0.5;
    pitchBall.scale.set(s, s, s);

    /* 링은 그 칸 위에 뜬다. 접근 링이 고정 링과 겹치는 순간이 타격 타이밍이다. */
    hitRing.position.set(t.x, t.y, ZONE_Z + 0.02);
    approachRing.position.copy(hitRing.position);
    approachRing.visible = true;
    var rs = 3.6 + (1.0 - 3.6) * p;
    if (rs < 0.35) rs = 0.35;
    approachRing.scale.set(rs, rs, 1);
    approachRing.material.opacity = Math.min(0.9, 0.25 + p * 0.8);
  }

  function hidePitch() {
    pitchBall.visible = false;
    approachRing.visible = false;
  }

  function launchHitBall(power) {
    flyBall = {
      pos: pitchBall.position.clone(),
      vel: new THREE.Vector3((Math.random() - 0.5) * 6, 7 + power * 4, -22 - power * 12),
      life: 1.6
    };
    pitchBall.visible = true;
    approachRing.visible = false;
  }

  /* ---------- 장애물 (§25) ---------- */

  function addObstacle(step) {
    var g;
    if (step.def.type === 'ball') {
      g = new THREE.Group();
      var b = ball(0.17, 0xfdfdfd, 14);
      g.add(b);
      var glow = new THREE.Mesh(new THREE.SphereGeometry(0.30, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.18 }));
      g.add(glow);
      g.userData.glow = glow;
      g.userData.kind = 'ball';
    } else {
      g = makeHuman(0x2a3a8c, 0xe8b48c, 0x101a3a);
      var lgl = makeLeg(-0.15, 0x1a234a); lgl.rotation.x = 0.7;
      var lgr = makeLeg(0.15, 0x1a234a); lgr.rotation.x = -0.5;
      g.add(lgl); g.add(lgr);
      g.rotation.x = 0.5;                 // 상체가 플레이어 쪽으로 기운 태클 자세
      var mark = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xff5a4d, transparent: true, opacity: 0.12 }));
      mark.position.y = 1.1;
      g.add(mark);
      g.userData.glow = mark;
      g.userData.kind = 'fielder';
    }
    scene.add(g);
    obstacles.push(g);
    return g;
  }

  /* distance 하나로 위치·크기를 모두 만든다 (§25).
     distance 0 = 플레이어 몸 중심(z=0) 이어야 눈에 보이는 충돌과 판정이 일치한다. */
  function placeObstacle(mesh, step, distance) {
    var sp = SPAWN[step.def.spawn];
    var t = 1 - distance / RUN.START_DISTANCE;
    if (t < 0) t = 0;
    /* 궤적이 마지막에 훅 꺾이면 언제 닿을지 읽을 수 없다. 완만하게 수렴시킨다. */
    var ease = Math.pow(t, 1.25);
    mesh.position.x = sp.from.x + (sp.to.x - sp.from.x) * ease;
    mesh.position.y = sp.from.y + (sp.to.y - sp.from.y) * ease;
    mesh.position.z = -distance * Z_PER_DIST;
    if (step.def.type === 'ball') {
      mesh.rotation.x += 0.25;
      mesh.rotation.y += 0.18;
    }
  }

  /* ---------- 베이스 ----------
     progress: 0(구간 시작) -> 1(베이스 통과). 발밑으로 다가온다. */
  function setBaseApproach(progress) {
    if (progress < 0) progress = 0;
    baseMarker.visible = true;
    baseMarker.position.z = -40 * (1 - Math.min(1.06, progress)) + 1.4;
  }

  function hideBase() { baseMarker.visible = false; }

  /* 베이스를 밟고 지나가는 순간 — 짧게만 (§36 의 정신: 연출은 짧게) */
  function passBase() {
    shake(0.30);
    boost = 0.75;
  }

  /* 입력 유효 창에 들어왔다는 신호 — 지금부터 눌러도 된다는 뜻이다 (§37) */
  function armObstacle(mesh) {
    var gl = mesh.userData.glow;
    if (!gl) return;
    gl.material.opacity = mesh.userData.kind === 'ball' ? 0.60 : 0.40;
    gl.scale.set(1.45, 1.45, 1.45);
  }

  function removeObstacle(mesh) {
    scene.remove(mesh);
    var i = obstacles.indexOf(mesh);
    if (i >= 0) obstacles.splice(i, 1);
  }

  function clearObstacles() {
    while (obstacles.length) removeObstacle(obstacles[0]);
  }

  function resetPlayer() {
    clearPose();
    poseTimer = 0;
    cur.leanZ = cur.offX = cur.legL = cur.legR = cur.crouch = 0;
    player.position.set(0, 0, 0);
    flyBall = null;
    swingT = -1;
    boost = 0;
    baseMarker.visible = false;
    batPivot.rotation.y = -0.9;
    hidePitch();
  }

  /* ---------------------------------------------------------- */

  function update(dt) {
    resize();

    /* 포즈 유지 시간이 끝나면 달리기 자세로 복귀 */
    if (poseTimer > 0) {
      poseTimer -= dt;
      if (poseTimer <= 0) clearPose();
    }

    var k = Math.min(1, dt * 16);
    cur.leanZ  += (pose.leanZ  - cur.leanZ)  * k;
    cur.offX   += (pose.offX   - cur.offX)   * k;
    cur.legL   += (pose.legL   - cur.legL)   * k;
    cur.legR   += (pose.legR   - cur.legR)   * k;
    cur.crouch += (pose.crouch - cur.crouch) * k;

    /* 달리기 — sin 스윙과 상하 바운스뿐이다 (§26) */
    var running = runSpeed > 0.1;
    if (running) runPhase += dt * 11;
    var sw = running ? Math.sin(runPhase) : 0;
    var bounce = running ? Math.abs(Math.sin(runPhase)) * 0.055 : 0;

    /* 다리를 드는 동안에는 그 다리의 달리기 스윙을 죽이고 무릎을 앞·옆으로 올린다.
       rotation.x 양수 = 발이 진행 방향(-z)으로, rotation.z 는 바깥쪽으로 벌린다. */
    hipL.rotation.x = sw * 0.85 * (1 - cur.legL) + cur.legL * 1.00;
    hipR.rotation.x = -sw * 0.85 * (1 - cur.legR) + cur.legR * 1.00;
    hipL.rotation.z = -cur.legL * 1.15;
    hipR.rotation.z =  cur.legR * 1.15;

    if (mode === 'run') {
      armL.rotation.x = -sw * 0.75;
      armR.rotation.x = sw * 0.75;
    } else {
      armL.rotation.x = -0.5;
      armR.rotation.x = -0.5;
    }

    /* 타석에서는 타자를 옆으로 비켜 세워 공의 궤적이 가려지지 않게 한다 */
    var wantBaseX = (mode === 'bat') ? -0.62 : 0;
    baseX += (wantBaseX - baseX) * Math.min(1, dt * 5);

    lean.rotation.z = cur.leanZ;
    lean.position.y = bounce - cur.crouch * 0.5;
    player.position.x = baseX + cur.offX;
    /* 다리를 들면 몸이 살짝 떠오른다 — 태클을 넘는 그림 */
    player.position.y = -cur.crouch * 0.25 + Math.max(cur.legL, cur.legR) * 0.14;

    /* 스윙 */
    if (swingT >= 0) {
      swingT += dt;
      var p = Math.min(1, swingT / 0.28);
      batPivot.rotation.y = -0.9 + p * 2.9;
      lean.rotation.y = -0.15 + p * 0.6;
      if (swingT > 0.62) { swingT = -1; batPivot.rotation.y = -0.9; lean.rotation.y = 0; }
    }

    /* 배경 스크롤 — 베이스를 밟은 직후 잠깐 빨라진다 */
    if (boost > 0.001) boost *= Math.pow(0.02, dt);
    if (running) {
      var scrollSpeed = runSpeed * (1 + boost);
      for (var i = 0; i < laneMarks.length; i++) {
        var m = laneMarks[i];
        m.position.z += scrollSpeed * dt;
        if (m.position.z > 8) m.position.z -= 150;
      }
    }

    /* 타격된 공 */
    if (flyBall) {
      flyBall.vel.y -= 18 * dt;
      flyBall.pos.addScaledVector(flyBall.vel, dt);
      pitchBall.position.copy(flyBall.pos);
      flyBall.life -= dt;
      if (flyBall.life <= 0) { flyBall = null; pitchBall.visible = false; }
    }

    /* 카메라 */
    var ck = Math.min(1, dt * 4.5);
    camPos.lerp(camPosTarget, ck);
    camLook.lerp(camLookTarget, ck);
    camera.position.copy(camPos);
    if (shakeAmt > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shakeAmt;
      camera.position.y += (Math.random() - 0.5) * shakeAmt;
      shakeAmt *= Math.pow(0.02, dt);
    }
    camera.lookAt(camLook);
  }

  function render() { renderer.render(scene, camera); }

  return {
    init: init, resize: resize, setMode: setMode, setRunning: setRunning,
    dodge: dodge, hitReaction: hitReaction, shake: shake,
    swing: swing, setPitch: setPitch, hidePitch: hidePitch, launchHitBall: launchHitBall,
    addObstacle: addObstacle, placeObstacle: placeObstacle, armObstacle: armObstacle,
    setBaseApproach: setBaseApproach, hideBase: hideBase, passBase: passBase,
    removeObstacle: removeObstacle, clearObstacles: clearObstacles,
    resetPlayer: resetPlayer, update: update, render: render
  };
})();
