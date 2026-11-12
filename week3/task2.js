/* 3주차 실습 2: 살아 있는 행성
 *  · 하나의 셰이더를 두 행성이 공유하고 uniform 만으로 구분한다
 *  · uTime 이 자전·공전을 진행시킨다 (CPU 에서 시간을 넣어 준다)
 *  · 태양 방향과 법선의 내적으로 낮/밤 경계(터미네이터)를 만든다
 *  · 절차적 텍스처: 기체 행성은 위도 줄무늬, 암석 행성은 잡음 반점
 */
(() => {
  'use strict';
  const cv = document.querySelector('#cv');
  const gl = cv.getContext('webgl2', { antialias: true });
  if (!gl) return;
  const M = CG.M4, Mesh = CG.Mesh;

  const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uMVP, uModel;
uniform mat3 uNormalMat;
out vec3 vN, vWorld; out vec2 vUV;
void main(){
  vec4 w = uModel*vec4(aPos,1.0);
  vWorld = w.xyz; vN = uNormalMat*aNormal; vUV = aUV;
  gl_Position = uMVP*vec4(aPos,1.0);
}`;

  const FS = `#version 300 es
precision highp float;
in vec3 vN, vWorld; in vec2 vUV;
uniform vec3 uTint, uSunPos, uEye, uAtmo;
uniform float uTime, uKind;      // uKind 0=암석, 1=기체
uniform float uSpec;
out vec4 outColor;

float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}

void main(){
  vec3 N = normalize(vN);
  vec3 L = normalize(uSunPos - vWorld);
  float ndl = dot(N, L);

  // ── 절차적 표면 ────────────────────────────────────────────────
  vec3 base;
  if (uKind > 0.5){
    // 기체 행성: 위도 줄무늬 + 살짝 흔들리는 난류
    float band = sin(vUV.y*26.0 + noise(vUV*vec2(8.0,3.0))*2.4 + uTime*0.15);
    base = uTint * (0.78 + 0.22*band);
    base += vec3(0.09,0.07,0.03) * smoothstep(0.6,1.0,band);
  } else {
    // 암석 행성: 잡음 반점 + 극지 밝기
    float n = noise(vUV*vec2(10.0,6.0)) * 0.6 + noise(vUV*vec2(28.0,18.0)) * 0.4;
    base = uTint * (0.62 + 0.55*n);
    base = mix(base, base*vec3(0.82,0.9,1.05), smoothstep(0.55,0.95,abs(N.y)));
  }

  // ── 낮/밤 ─────────────────────────────────────────────────────
  float day = smoothstep(-0.22, 0.28, ndl);           // 부드러운 터미네이터
  vec3 col = base * (0.045 + 1.05*max(ndl,0.0));

  // 정반사 (바다/얼음 느낌)
  vec3 V = normalize(uEye - vWorld);
  vec3 H = normalize(V + L);
  col += vec3(1.0,0.94,0.82) * pow(max(dot(N,H),0.0), 42.0) * uSpec * day;

  // 대기 산란: 경계 근처가 살짝 밝다
  float rim = pow(1.0 - max(dot(N,V),0.0), 3.0);
  col += uAtmo * rim * (0.25 + 0.75*day);

  col = col/(1.0+col);
  outColor = vec4(pow(col, vec3(1.0/2.2)), 1.0);
}`;

  function compile(t, src) {
    const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U = {};
  ['uMVP','uModel','uNormalMat','uTint','uSunPos','uEye','uAtmo','uTime','uKind','uSpec']
    .forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

  const sphere = Mesh.upload(gl, Mesh.createSphere(40, 56));

  /* ── 두 행성: 같은 셰이더, 다른 uniform ───────────────────────────── */
  const PLANETS = [
    { name: 'A', tint: [0.86, 0.52, 0.30], kind: 0, size: 1.0, orbit: 3.2, period: 26, spin: 1.0, spec: 0.20, atmo: [0.25, 0.16, 0.09] },
    { name: 'B', tint: [0.55, 0.72, 0.92], kind: 1, size: 1.45, orbit: 5.4, period: 46, spin: 0.4, spec: 0.45, atmo: [0.14, 0.22, 0.34] },
  ];
  const moon = { size: 0.30, orbit: 1.9, period: 9 };

  const S = { t: 0, speed: 1, spinA: 1, spinB: 0.4, paused: false };
  const cam = { yaw: 0.55, pitch: 0.30, dist: 11 };

  function bind(id, key, fmt, out) {
    const el = document.querySelector('#' + id), lab = document.querySelector('#' + out);
    if (!el) return;
    el.addEventListener('input', () => { S[key] = Number(el.value); if (lab) lab.textContent = fmt(S[key]); });
  }
  bind('time', 't', (v) => v.toFixed(1) + ' s', 'tVal');
  bind('speed', 'speed', (v) => v.toFixed(1) + '×', 'sVal');
  bind('spinA', 'spinA', (v) => v.toFixed(1) + '×', 'raVal');
  bind('spinB', 'spinB', (v) => v.toFixed(1) + '×', 'rbVal');
  document.querySelector('#pause').onclick = (e) => {
    S.paused = !S.paused;
    e.target.textContent = S.paused ? '재생' : '일시정지';
    e.target.classList.toggle('on', S.paused);
  };
  document.querySelector('#reset').onclick = () => { S.t = 0; document.querySelector('#time').value = 0; document.querySelector('#tVal').textContent = '0.0 s'; };

  let drag = false, lx = 0, ly = 0;
  cv.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.yaw += (e.clientX - lx) * 0.006;
    cam.pitch = Math.max(-0.4, Math.min(1.2, cam.pitch + (e.clientY - ly) * 0.004));
    lx = e.clientX; ly = e.clientY;
  });
  cv.addEventListener('pointerup', (e) => { drag = false; cv.releasePointerCapture(e.pointerId); });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(6, Math.min(26, cam.dist * (1 + e.deltaY * 0.001))); }, { passive: false });

  const matEl = document.querySelector('#mat');
  function fmt(m) {
    const f = (v) => (Math.abs(v) < 1e-6 ? '0.00' : v.toFixed(2)).padStart(6);
    const rows = [];
    for (let r = 0; r < 4; r++) rows.push([0,1,2,3].map((c) => f(m[c*4+r])).join(' '));
    return rows.join('\n');
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!S.paused) {
      S.t += dt * S.speed;
      const el = document.querySelector('#time');
      if (el) el.value = String(Math.min(120, S.t));
      document.querySelector('#tVal').textContent = S.t.toFixed(1) + ' s';
    }

    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.015, 0.025, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const eye = [Math.sin(cam.yaw) * cp * cam.dist, 2.2 + sp * cam.dist, Math.cos(cam.yaw) * cp * cam.dist];
    const view = M.lookAt(eye, [0, 1.4, 0], [0, 1, 0]);
    const proj = M.perspective(45, w / h, 0.1, 200);

    gl.useProgram(prog);
    gl.uniform3fv(U.uEye, eye);
    gl.uniform3f(U.uSunPos, 0.0, 5.5, 0.0);       // 태양은 위쪽에 있다
    gl.uniform1f(U.uTime, S.t);

    const bodies = [];
    PLANETS.forEach((p, i) => {
      const ang = (S.t / p.period) * Math.PI * 2 + i * 2.1;
      const pos = [Math.cos(ang) * p.orbit, 1.6, Math.sin(ang) * p.orbit];
      const spin = S.t * (i === 0 ? S.spinA : S.spinB) * 0.9;
      let model = M.multiply(M.translate(pos[0], pos[1], pos[2]), M.rotateY(spin));
      model = M.multiply(model, M.rotateX(0.12 * i));       // 축 기울기
      model = M.multiply(model, M.scale(p.size, p.size, p.size));
      bodies.push({ p, model });
      if (i === 0) {
        const ma = (S.t / moon.period) * Math.PI * 2;
        let mm = M.multiply(M.translate(pos[0], pos[1], pos[2]), M.rotateY(ma));
        mm = M.multiply(mm, M.translate(moon.orbit, 0, 0));
        mm = M.multiply(mm, M.scale(moon.size, moon.size, moon.size));
        bodies.push({ moon: true, model: mm });
      }
    });

    let first = null;
    for (const b of bodies) {
      const mvp = M.multiply(proj, M.multiply(view, b.model));
      gl.uniformMatrix4fv(U.uMVP, false, mvp);
      gl.uniformMatrix4fv(U.uModel, false, b.model);
      gl.uniformMatrix3fv(U.uNormalMat, false, M.normalMatrix(b.model));
      if (b.moon) {
        gl.uniform3f(U.uTint, 0.72, 0.72, 0.74);
        gl.uniform1f(U.uKind, 0);
        gl.uniform1f(U.uSpec, 0.12);
        gl.uniform3f(U.uAtmo, 0.05, 0.05, 0.06);
      } else {
        gl.uniform3fv(U.uTint, b.p.tint);
        gl.uniform1f(U.uKind, b.p.kind);
        gl.uniform1f(U.uSpec, b.p.spec);
        gl.uniform3fv(U.uAtmo, b.p.atmo);
      }
      gl.bindVertexArray(sphere.vao);
      gl.drawElements(gl.TRIANGLES, sphere.count, sphere.type, 0);
      if (!first && !b.moon) first = b.model;
    }
    gl.bindVertexArray(null);
    if (first) matEl.textContent = fmt(first);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
