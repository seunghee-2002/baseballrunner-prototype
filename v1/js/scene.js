/* =============================================================
   scene.js — three.js 렌더링 계층
   프리미티브 도형만 쓴다. 캐릭터 3D 애니메이션은 만들지 않는다 (§26).
   장애물은 스냅숏의 distance 값 하나를 좌표로 환산한다 (§25).
   공격자·수비자 화면이 같은 함수로 같은 장면을 그린다.
   ============================================================= */

var Scene3D = (function () {

  var renderer, scene, camera;
  var player, lean, hipL, hipR, armL, armR, batPivot, aura;
  var laneMarks = [], pitcher, pitchBall, mound, strikeZone, baseMarker;
  var boost = 0;            // 베이스를 밟고 지나갈 때의 짧은 속도감

  /* 스트라이크존 4칸의 중심 — 화면 4분할과 같은 배치 (§8) */
  var ZONE_POINT = {
    LT: { x: -0.19, y: 1.43 },
    RT: { x:  0.19, y: 1.43 },
    LB: { x: -0.19, y: 1.07 },
    RB: { x:  0.19, y: 1.07 }
  };
  var ZONE_Z = 0.55;

  var mode = 'bat';
  var runSpeed = 0;
  var runPhase = 0;
  var shakeAmt = 0;
  var flyBall = null;
  var baseX = 0;

  var pose = { leanZ: 0, offX: 0, legL: 0, legR: 0, crouch: 0 };
  var cur  = { leanZ: 0, offX: 0, legL: 0, legR: 0, crouch: 0 };
  var poseTimer = 0;

  var camPos = new THREE.Vector3(0, 2.9, 6.4);
  var camLook = new THREE.Vector3(0, 1.5, -14);
  var camPosTarget = camPos.clone();
  var camLookTarget = camLook.clone();

  /* 4분면 -> 3D 위치. 멀리서는 화면 네 귀퉁이에 넓게, 가까워지면 몸으로 수렴한다. */
  var SPAWN = {
    LT: { from: { x: -3.6, y: 3.15 }, to: { x: -0.28, y: 1.42 } },
    RT: { from: {  x: 3.6, y: 3.15 }, to: {  x: 0.28, y: 1.42 } },
    LB: { from: { x: -3.1, y: 0.02 }, to: { x: -0.30, y: 0.02 } },
    RB: { from: {  x: 3.1, y: 0.02 }, to: {  x: 0.30, y: 0.02 } }
  };

  var Z_PER_DIST = 0.42;    // distance 100 -> z 약 -42
  var SWITCH_TIME = 0.18;   // C03·C04 가 옆 칸으로 옮겨가는 데 걸리는 시간 — 순간이동하면 눈으로 못 따라간다

  var GLOW = { ball: 0xffe14d, fielder: 0xff5a4d, fan: 0x7ef2c0, card: 0xff7a1a };

  var obMeshes = {};        // 스냅숏 장애물 id -> mesh

  /* ---------------------------------------------------------- */

  function box(w, h, d, color) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: color }));
  }
  function ball(r, color, seg) {
    return new THREE.Mesh(new THREE.SphereGeometry(r, seg || 14, seg || 12),
      new THREE.MeshLambertMaterial({ color: color }));
  }
  function glowSphere(r, color, opacity) {
    return new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity }));
  }

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

  function disposeTree(obj) {
    obj.traverse(function (n) {
      if (n.geometry) n.geometry.dispose();
      if (n.material) n.material.dispose();
    });
  }

  /* ---------------------------------------------------------- */

  function buildPlayer() {
    player = new THREE.Group();

    lean = new THREE.Group();
    lean.add(makeHuman(0xf2f4f8, 0xe8b48c, 0x1f4fd8));
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

    /* 피버 무적 표시 */
    aura = glowSphere(1.05, 0xff5ad0, 0.0);
    aura.position.y = 1.0;
    aura.scale.y = 1.25;
    aura.visible = false;
    player.add(aura);

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

    /* 스트라이크존 4분할 격자 — 타이밍 링은 없다. 공의 궤적만 보고 친다. */
    strikeZone = new THREE.Group();
    var lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.30 });
    var W = 0.76, H = 0.72, T = 0.014, g;
    for (g = -1; g <= 1; g++) {
      var hbar = new THREE.Mesh(new THREE.BoxGeometry(W, T, T), lineMat);
      hbar.position.set(0, 1.25 + g * (H / 2), 0);
      strikeZone.add(hbar);
      var vbar = new THREE.Mesh(new THREE.BoxGeometry(T, H, T), lineMat);
      vbar.position.set(g * (W / 2), 1.25, 0);
      strikeZone.add(vbar);
    }
    strikeZone.position.z = ZONE_Z;
    scene.add(strikeZone);

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
    if (mode === m) return;
    mode = m;
    var bat = m === 'bat';
    if (bat) {
      camPosTarget.set(0, 2.9, 6.4);
      camLookTarget.set(0, 1.5, -14);
      player.rotation.y = 0;
    } else {
      camPosTarget.set(0, 2.55, 4.7);
      camLookTarget.set(0, 1.30, -8);
      pitchBall.visible = false;
    }
    batPivot.visible = bat;
    pitcher.visible = bat;
    mound.visible = bat;
    strikeZone.visible = bat;
    if (bat) baseMarker.visible = false;
  }

  /* mul: 0 = 멈춤, 1 = 주루, 그 이상 = 피버 돌진 */
  function setRunning(mul) { runSpeed = 15 * (mul || 0); }

  /* ---------- 회피 포즈 ----------
     상체 : 입력한 방향으로 몸을 기울여 피한다.
     하체 : 입력한 쪽 다리를 들어 태클을 넘긴다. */
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

  function setAura(on) { aura.visible = !!on; }

  /* ---------- 타격 ---------- */

  var swingT = -1;
  function swing() { swingT = 0; }

  /* pitch: { start, end, type, dur, t } — 변화구는 비행 BREAK_AT 지점부터 도착 칸으로 휜다 */
  function setPitch(pitch) {
    var p = Math.min(1.12, pitch.t / pitch.dur);
    var s = ZONE_POINT[pitch.start], e = ZONE_POINT[pitch.end];
    var bend = 0;
    if (pitch.type === 'BREAK' && p > PITCH.BREAK_AT) {
      var k = Math.min(1, (p - PITCH.BREAK_AT) / (1 - PITCH.BREAK_AT));
      bend = k * k * (3 - 2 * k);
    }
    var tx = s.x + (e.x - s.x) * bend;
    var ty = s.y + (e.y - s.y) * bend;
    var ease = Math.pow(p, 0.7);
    pitchBall.visible = true;
    pitchBall.position.set(tx * ease, 1.80 + (ty - 1.80) * ease, -18.2 + (18.2 + ZONE_Z) * p);
    var sc = 0.9 + p * 0.5;
    pitchBall.scale.set(sc, sc, sc);
  }

  function hidePitch() { pitchBall.visible = false; }

  function launchHitBall(power) {
    flyBall = {
      pos: pitchBall.position.clone(),
      vel: new THREE.Vector3((Math.random() - 0.5) * 6, 7 + power * 4, -22 - power * 12),
      life: 1.6
    };
    pitchBall.visible = true;
  }

  /* ---------- 장애물 (§25) ---------- */

  function makeObstacle(o) {
    var g = new THREE.Group(), glow;
    var color = o.card ? GLOW.card : GLOW[o.kind];

    if (o.kind === 'ball') {
      g.add(ball(0.17, 0xfdfdfd, 14));
      glow = glowSphere(0.30, color, 0.18);
    } else if (o.kind === 'fielder') {
      var body = makeHuman(o.card ? 0x8c2a2a : 0x2a3a8c, 0xe8b48c, 0x101a3a);
      var lgl = makeLeg(-0.15, 0x1a234a); lgl.rotation.x = 0.7;
      var lgr = makeLeg(0.15, 0x1a234a); lgr.rotation.x = -0.5;
      body.add(lgl); body.add(lgr);
      body.rotation.x = 0.5;                  // 상체가 플레이어 쪽으로 기운 태클 자세
      g.add(body);
      glow = glowSphere(0.55, color, 0.12);
      glow.position.y = 1.1;
    } else {
      /* 관객: 위쪽에서 몸을 날려 뛰어든다. 공과 같은 높이지만 사람 모양이라 구분된다. */
      var fan = makeHuman(0xffc83d, 0xe8b48c, 0xd8286a);
      fan.position.y = -1.2;
      var holder = new THREE.Group();
      holder.add(fan);
      holder.rotation.z = o.zone === 'LT' ? -Math.PI / 2 : Math.PI / 2;
      holder.scale.set(0.8, 0.8, 0.8);
      g.add(holder);
      glow = glowSphere(0.6, color, 0.14);
    }
    g.add(glow);
    g.userData.glow = glow;
    g.userData.kind = o.kind;
    return g;
  }

  function pathPoint(zone, t) {
    var sp = SPAWN[zone];
    var ease = Math.pow(t, 1.25);   // 마지막에 훅 꺾이지 않게 완만하게 수렴
    return { x: sp.from.x + (sp.to.x - sp.from.x) * ease, y: sp.from.y + (sp.to.y - sp.from.y) * ease };
  }

  /* distance 0 = 플레이어 몸 중심(z=0) 이어야 눈에 보이는 충돌과 판정이 일치한다 */
  function place(mesh, o) {
    var t = Math.max(0, 1 - o.distance / RUN.START_DISTANCE);
    var p = pathPoint(o.zone, t);
    if (o.switched) {
      var k = Math.min(1, Math.max(0, (o.switchDist - o.distance) / (o.speed * SWITCH_TIME)));
      var q = pathPoint(o.fromZone, t), e = k * k * (3 - 2 * k);
      p = { x: q.x + (p.x - q.x) * e, y: q.y + (p.y - q.y) * e };
    }
    mesh.position.set(p.x, p.y, -o.distance * Z_PER_DIST);
  }

  /* 스냅숏 장애물 목록과 장면을 맞춘다. 새 id 는 만들고, 사라진 id 는 지운다. */
  function syncObstacles(list) {
    var seen = {}, id;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var m = obMeshes[o.id];
      if (!m) { m = obMeshes[o.id] = makeObstacle(o); scene.add(m); }
      seen[o.id] = true;
      place(m, o);
      if (m.userData.kind === 'ball') { m.rotation.x += 0.25; m.rotation.y += 0.18; }

      /* 유효 창에 들어오면 빛난다 — 지금 누르면 받아진다는 신호 (§37) */
      var armed = !o.resolved && o.distance > 0 && o.distance / o.speed <= o.window;
      var gl = m.userData.glow;
      gl.material.opacity = o.resolved ? 0 : (armed ? (m.userData.kind === 'ball' ? 0.6 : 0.4) : 0.15);
      var s = armed ? 1.45 : 1;
      gl.scale.set(s, s, s);
    }
    for (id in obMeshes) {
      if (!seen[id]) {
        scene.remove(obMeshes[id]);
        disposeTree(obMeshes[id]);
        delete obMeshes[id];
      }
    }
  }

  function clearObstacles() { syncObstacles([]); }

  /* ---------- 베이스 ---------- */

  function setBaseApproach(progress) {
    if (progress < 0) progress = 0;
    baseMarker.visible = true;
    baseMarker.position.z = -40 * (1 - Math.min(1.06, progress)) + 1.4;
  }

  function hideBase() { baseMarker.visible = false; }

  function passBase() {
    shake(0.30);
    boost = 0.75;
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
    aura.visible = false;
    hidePitch();
    clearObstacles();
  }

  /* ---------------------------------------------------------- */

  function update(dt) {
    resize();

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
    if (running) runPhase += dt * 11 * Math.max(1, runSpeed / 15);
    var sw = running ? Math.sin(runPhase) : 0;
    var bounce = running ? Math.abs(Math.sin(runPhase)) * 0.055 : 0;

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
    player.position.y = -cur.crouch * 0.25 + Math.max(cur.legL, cur.legR) * 0.14;

    if (aura.visible) aura.material.opacity = 0.16 + Math.abs(Math.sin(runPhase * 0.5)) * 0.14;

    if (swingT >= 0) {
      swingT += dt;
      var p = Math.min(1, swingT / 0.28);
      batPivot.rotation.y = -0.9 + p * 2.9;
      lean.rotation.y = -0.15 + p * 0.6;
      if (swingT > 0.62) { swingT = -1; batPivot.rotation.y = -0.9; lean.rotation.y = 0; }
    }

    if (boost > 0.001) boost *= Math.pow(0.02, dt);
    if (running) {
      var scrollSpeed = runSpeed * (1 + boost);
      for (var i = 0; i < laneMarks.length; i++) {
        var m = laneMarks[i];
        m.position.z += scrollSpeed * dt;
        if (m.position.z > 8) m.position.z -= 150;
      }
    }

    if (flyBall) {
      flyBall.vel.y -= 18 * dt;
      flyBall.pos.addScaledVector(flyBall.vel, dt);
      pitchBall.position.copy(flyBall.pos);
      flyBall.life -= dt;
      if (flyBall.life <= 0) { flyBall = null; pitchBall.visible = false; }
    }

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
    dodge: dodge, hitReaction: hitReaction, shake: shake, setAura: setAura,
    swing: swing, setPitch: setPitch, hidePitch: hidePitch, launchHitBall: launchHitBall,
    syncObstacles: syncObstacles, clearObstacles: clearObstacles,
    setBaseApproach: setBaseApproach, hideBase: hideBase, passBase: passBase,
    resetPlayer: resetPlayer, update: update, render: render
  };
})();
