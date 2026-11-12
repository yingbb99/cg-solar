/* ------------------------------------------------------------------
   scene.js — 천체 데이터와 계층 변환
   · 실제 수치(반지름·궤도 반지름·공전 주기·자전 주기·축 기울기)를 보관하고
     화면용 배율로 변환한다.
   · 계층 변환: 행성의 자전은 위성의 위치에 물려주지 않는다(자전과 공전을 분리).
   · eclipseRig(): 7주차 「식 관측기」용 교육 배치(별—행성—위성)
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';
  const M4 = global.CG.M4;

  const AU = 1;                    // 거리 단위: 1 = 1 AU (표시 배율은 아래에서 결정)
  const EARTH_R = 1;               // 크기 단위: 1 = 지구 반지름

  /* 실제 값 ( sources: NASA Planetary Fact Sheet ) */
  const BODIES = [
    { key: 'sun', name: '태양', kind: 'sun', palette: 'sun', rE: 109.2, au: 0,
      periodY: 0, rotD: 25.4, tilt: 7.25, rough: 1.0, metal: 0.0, emissive: true },
    { key: 'mercury', name: '수성', kind: 'rock', palette: 'mercury', rE: 0.383, au: 0.387,
      periodY: 0.241, rotD: 58.6, tilt: 0.03, rough: 0.85, metal: 0.0, incl: 7.0, phase: 0.31 },
    { key: 'venus', name: '금성', kind: 'rock', palette: 'venus', rE: 0.949, au: 0.723,
      periodY: 0.615, rotD: -243, tilt: 177.4, rough: 0.6, metal: 0.0, incl: 3.4, phase: 1.9 },
    { key: 'earth', name: '지구', kind: 'rock', palette: 'earth', rE: 1.0, au: 1.0,
      periodY: 1.0, rotD: 1.0, tilt: 23.44, rough: 0.55, metal: 0.0, incl: 0.0, phase: 3.4,
      moons: [
        { key: 'moon', name: '달', rE: 0.273, orbitR: 60.3, periodD: 27.32, tidal: true },
        { key: 'iss', name: '인공위성 (ISS)', rE: 0.0000171, orbitR: 1.063, periodD: 0.064,
          tidal: false, incl: 51.6, metal: true },
      ] },
    { key: 'mars', name: '화성', kind: 'rock', palette: 'mars', rE: 0.532, au: 1.524,
      periodY: 1.881, rotD: 1.026, tilt: 25.19, rough: 0.8, metal: 0.0, incl: 1.85, phase: 5.1 },
    { key: 'jupiter', name: '목성', kind: 'gas', palette: 'jupiter', rE: 11.21, au: 5.203,
      periodY: 11.86, rotD: 0.414, tilt: 3.13, rough: 0.75, metal: 0.0, incl: 1.30, phase: 2.2,
      moons: [{ key: 'io', name: '이오', rE: 0.286, orbitR: 421.7, periodD: 1.77, tidal: true }] },
    { key: 'saturn', name: '토성', kind: 'gas', palette: 'saturn', rE: 9.45, au: 9.537,
      periodY: 29.45, rotD: 0.445, tilt: 26.73, rough: 0.8, metal: 0.0, incl: 2.49, phase: 4.0,
      ring: { inner: 1.25, outer: 2.28, color: [0.92, 0.86, 0.72] } },
    { key: 'uranus', name: '천왕성', kind: 'ice', palette: 'uranus', rE: 4.01, au: 19.19,
      periodY: 84.02, rotD: -0.718, tilt: 97.77, rough: 0.35, metal: 0.0, incl: 0.77, phase: 0.8 },
    { key: 'neptune', name: '해왕성', kind: 'ice', palette: 'neptune', rE: 3.88, au: 30.07,
      periodY: 164.8, rotD: 0.671, tilt: 28.32, rough: 0.3, metal: 0.0, incl: 1.77, phase: 5.8 },
  ];

  const DEG = Math.PI / 180;

  function createScene() {
    const paths = [];                       // draw 목록 (계층 순서)
    BODIES.forEach((b, i) => {
      paths.push({ body: b, parent: null, index: i });
      if (b.moons) b.moons.forEach((m) => paths.push({ body: m, parent: b, index: i }));
    });

    let scaleMode = 'explore';
    const S = {
      /* 압축 비율: 거리는 √압축, 크기는 √과장 — 한 화면에 담기 위한 표현 선택 */
      explore: {
        dist: (au) => 7 + 6.6 * Math.pow(au, 0.62),
        planetR: (rE) => 0.75 * Math.pow(rE, 0.5),
        moonOrbit: (rE_orbit) => 2.4 * Math.log10(1 + rE_orbit),
        sunR: 3.2,
      },
      /* 실제 비율: 1 AU = 10 단위, 태양 반지름 3.2 단위 기준 */
      real: {
        dist: (au) => 10 * au,
        planetR: (rE) => (3.2 / 109.2) * rE,
        moonOrbit: (rE_orbit) => (3.2 / 109.2) * rE_orbit,   // 실제 비율 유지
        sunR: 3.2,
      },
    };

    function sc() { return S[scaleMode]; }
    function setScale(mode) { scaleMode = mode; }

    /** 천체의 화면용 반지름 */
    function radiusOf(b) {
      if (b.key === 'sun') return sc().sunR;
      if (b.orbitR !== undefined) {
        // 위성은 행성보다 작은 비율을 살린다(√과장은 작은 천체를 너무 키운다)
        return Math.max(sc().planetR(b.rE) * 0.62, b.metal ? 0.022 : 0.014);
      }
      return Math.max(sc().planetR(b.rE), 0.012);
    }

    /* 관찰을 위한 시간 압축: 실제 주기의 비율은 유지하되 지수로 완만하게 만든다.
       (t 는 초 단위 애니메이션 시간) */
    const ORBIT_BASE = 40, SPIN_BASE = 4, MOON_BASE = 6;

    function orbitAngle(b, t) {
      if (!b.periodY || b.au === 0) return 0;
      return 2 * Math.PI * t / (ORBIT_BASE * Math.pow(b.periodY, 0.35)) + (b.phase || 0);
    }

    function spinAngle(b, t) {
      if (!b.rotD) return 0;
      const dir = b.rotD < 0 ? -1 : 1;
      return dir * 2 * Math.PI * t / (SPIN_BASE * Math.pow(Math.abs(b.rotD), 0.3));
    }

    function moonAngle(b, t) {
      return 2 * Math.PI * t / (MOON_BASE * Math.pow(b.periodD, 0.35));
    }

    function planetWorldPos(b, t) {
      const R = sc().dist(b.au);
      const a = orbitAngle(b, t);
      const incl = (b.incl || 0) * DEG;
      // 궤도면 기울기: x 축 회전을 적용한 뒤 원 위에 놓는다
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      return [x, -Math.sin(incl) * z, Math.cos(incl) * z];
    }

    /** 한 천체의 모델 행렬 */
    function modelOf(b, t) {
      if (b.key === 'sun') {
        return M4.chain(
          M4.rotateX((b.tilt || 0) * DEG),
          M4.rotateY(spinAngle(b, t) * 0.4),
          M4.scale(sc().sunR)
        );
      }
      if (b.orbitR !== undefined) {
        /* 위성: 부모 행성 기준 */
        const parent = BODIES.find((p) => p.moons && p.moons.indexOf(b) >= 0);
        const pp = planetWorldPos(parent, t);
        const orbitR = Math.max(sc().moonOrbit(b.orbitR), radiusOf(parent) * 1.45);
        const a = moonAngle(b, t);
        const incl = (b.incl || 0) * DEG;
        const spin = b.tidal ? a : spinAngle(b, t);
        return M4.chain(
          M4.translate(pp[0], pp[1], pp[2]),
          M4.rotateX((parent.tilt || 0) * DEG * 0.4),
          M4.rotateX(incl),
          M4.rotateY(a),
          M4.translate(orbitR, 0, 0),
          M4.rotateY(spin),          // 자전은 자기 위치에서만 — 행성 자전을 물려받지 않는다
          M4.scale(radiusOf(b))
        );
      }
      return M4.chain(
        M4.translate(...planetWorldPos(b, t)),
        M4.rotateX((b.tilt || 0) * DEG),
        M4.rotateY(spinAngle(b, t)),
        M4.scale(radiusOf(b))
      );
    }

    /** 고리 행렬 (행성 자전과 같은 축) */
    function ringModelOf(b, t) {
      const pos = planetWorldPos(b, t);
      const R = radiusOf(b);
      return M4.chain(
        M4.translate(pos[0], pos[1], pos[2]),
        M4.rotateX((b.tilt || 0) * DEG),
        M4.rotateY(spinAngle(b, t)),
        M4.scale(R)
      );
    }

    /** 현재 장면의 천체 목록(위치·반지름) — 그림자 광선과 ray tracing 에 쓴다 */
    function collectBodies(t, onlyMajor) {
      const out = [];
      const sun = BODIES[0];
      out.push({ key: 'sun', pos: [0, 0, 0], r: sc().sunR, color: [4.2, 3.1, 1.3],
                 rough: 1, metal: 0 });
      for (let i = 1; i < BODIES.length; i++) {
        const b = BODIES[i];
        const p = planetWorldPos(b, t);
        out.push({
          key: b.key, pos: p, r: radiusOf(b),
          color: paletteColor(b.palette), rough: b.rough, metal: b.metal,
        });
        if (!onlyMajor && b.moons) {
          for (const m of b.moons) {
            const mm = modelOf(m, t);
            out.push({
              key: m.key, pos: [mm[12], mm[13], mm[14]], r: radiusOf(m),
              color: paletteColor(m.metal ? 'station' : 'moon'), rough: 0.75, metal: m.metal ? 0.85 : 0,
            });
          }
        }
      }
      return out;
    }

    /** 7주차 식 관측기용 교육 배치: 별(광원) — 행성 — 공전하는 위성 */
    function eclipseRig(angleDeg) {
      const sunC = [-2.10, 1.00, 0.70], sunR = 0.42;
      const planetC = [0.45, -0.12, -2.00], planetR = 0.78;
      const delta = [sunC[0] - planetC[0], sunC[1] - planetC[1], sunC[2] - planetC[2]];
      const dl = Math.hypot(...delta);
      const toStar = delta.map((v) => v / dl);
      const sideLen = Math.hypot(toStar[0], toStar[2]) || 1;
      const side = [toStar[2] / sideLen, 0, -toStar[0] / sideLen];
      const a = angleDeg * DEG;
      const moonR = 0.29;
      const moonC = [0, 0, 0].map((_, i) =>
        planetC[i] + 1.50 * (Math.cos(a) * toStar[i] + Math.sin(a) * side[i]));
      return [
        { pos: sunC, r: sunR, color: [4.2, 3.1, 1.0], rough: 1, metal: 0, emissive: true },
        { pos: planetC, r: planetR, color: [0.50, 0.71, 0.95], rough: 0.55, metal: 0 },
        { pos: moonC, r: moonR, color: [0.82, 0.85, 0.88], rough: 0.8, metal: 0 },
      ];
    }

    return {
      BODIES, paths, setScale, get scaleMode() { return scaleMode; },
      radiusOf, planetWorldPos, modelOf, ringModelOf, collectBodies,
      eclipseRig, sc, orbitAngle, moonAngle,
      /** UI 목록: 태양 + 행성 + 위성 */
      list() {
        const out = [];
        BODIES.forEach((b) => {
          out.push({ key: b.key, name: b.name, color: paletteColor(b.palette), rE: b.rE, au: b.au, main: true });
          if (b.moons) b.moons.forEach((m) => out.push({
            key: m.key, name: m.name, color: paletteColor(m.metal ? 'station' : 'moon'),
            rE: m.rE, au: 0, main: false,
          }));
        });
        return out;
      },
    };
  }

  function paletteColor(name) {
    const P = {
      sun: [1.0, 0.72, 0.28], mercury: [0.62, 0.58, 0.54], venus: [0.95, 0.86, 0.62],
      earth: [0.28, 0.48, 0.78], moon: [0.72, 0.72, 0.70], mars: [0.76, 0.36, 0.20],
      jupiter: [0.88, 0.80, 0.68], saturn: [0.92, 0.84, 0.64],
      uranus: [0.58, 0.82, 0.86], neptune: [0.28, 0.44, 0.82], station: [0.80, 0.82, 0.88],
    };
    return P[name] || [0.8, 0.8, 0.8];
  }

  global.CG = global.CG || {};
  global.CG.createScene = createScene;
  global.CG.BODIES = BODIES;
})(window);
