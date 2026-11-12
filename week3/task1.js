/* 3주차 실습 1: 떠 있는 공 + 바닥
 *   · 정점/인덱스 배열로 만든 구와 평면
 *   · 행렬 카메라 (모델·뷰·투영) — 화면에 MVP 를 읽을 수 있게 출력
 *   · 정점 색 보간 + 절차적 텍스처
 *   · 확산광(Lambert)과 바닥 그림자(평면 위로 구를 투영)
 *   · 원근/직교 투영 전환, 카메라 자동 이동
 */
(() => {
  'use strict';
  const cv = document.querySelector('#cv');
  const gl = cv.getContext('webgl2', { antialias: true });
  if (!gl) return;
  const M = CG.M4                 // 행렬
  const Mesh = CG.Mesh;           // 메시·업로드

  const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uMVP, uModel;
uniform mat3 uNormalMat;
out vec3 vN, vWorld; out vec2 vUV;
void main(){
  vec4 w = uModel*vec4(aPos,1.0);
  vWorld = w.xyz;
  vN = uNormalMat*aNormal;
  vUV = aUV;
  gl_Position = uMVP*vec4(aPos,1.0);
}`;

  const FS = `#version 300 es
precision highp float;
in vec3 vN, vWorld; in vec2 vUV;
uniform vec3 uColor, uLightPos, uEye;
uniform float uDiffuse, uTiles, uShadow;   // uShadow: 0 바닥, 1 그림자
out vec4 outColor;
void main(){
  if (uShadow > 0.5){ outColor = vec4(0.0, 0.0, 0.0, 0.42); return; }   // 그림자 패스
  vec3 N = normalize(vN);
  // 절차적 텍스처: 자체 좌표로 만든 격자 (UV 를 이용, 이미지 없음)
  float chk = mod(floor(vUV.x*uTiles) + floor(vUV.y*uTiles), 2.0);
  vec3 base = uColor * mix(1.0, 0.72, chk);
  // 정점 색 보간: 위치에 따라 색이 부드럽게 변한다
  base = mix(base, base * (0.65 + 0.7*normalize(vWorld).y), 0.25);

  vec3 L = normalize(uLightPos - vWorld);
  float ndl = max(dot(N, L), 0.0);
  vec3 V = normalize(uEye - vWorld);
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), 24.0) * 0.25;

  vec3 col = base * (0.16 + uDiffuse * ndl) + vec3(1.0, 0.92, 0.78) * spec;
  col = col / (1.0 + col);
  outColor = vec4(pow(col, vec3(1.0/2.2)), 1.0);
}`;

  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U = {};
  ['uMVP', 'uModel', 'uNormalMat', 'uColor', 'uLightPos', 'uEye', 'uDiffuse', 'uTiles', 'uShadow']
    .forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

  const sphere = Mesh.upload(gl, Mesh.createSphere(28, 40));
  const floorMesh = Mesh.upload(gl, Mesh.createQuad());   // y=0 평면 (모델 행렬로 회전)
  const shadowMesh = Mesh.upload(gl, Mesh.createCircleLine(1.0, 48));

  /* ── 상태 ───────────────────────────────────────────────────────────── */
  const S = { ortho: false, move: false, fov: 45, height: 1.6, diffuse: 1, tiles: 8 };
  const cam = { yaw: 0.7, pitch: 0.28, dist: 6.2 };
  const panelBtn = { persp: document.querySelector('#btnPersp'), ortho: document.querySelector('#btnOrtho'), move: document.querySelector('#btnMove') };
  panelBtn.persp.onclick = () => { S.ortho = false; panelBtn.persp.classList.add('on'); panelBtn.ortho.classList.remove('on'); };
  panelBtn.ortho.onclick = () => { S.ortho = true; panelBtn.ortho.classList.add('on'); panelBtn.persp.classList.remove('on'); };
  panelBtn.move.onclick = () => {
    S.move = !S.move;
    panelBtn.move.classList.toggle('on', S.move);
    panelBtn.move.textContent = S.move ? '자동 회전 끄기' : '자동 회전 켜기';
    document.querySelector('#moveVal').textContent = S.move ? '자동 회전' : '정지';
  };
  function bindRange(id, key, fmt, out) {
    const el = document.querySelector('#' + id), lab = document.querySelector('#' + out);
    el.addEventListener('input', () => { S[key] = Number(el.value); lab.textContent = fmt(S[key]); });
  }
  bindRange('fov', 'fov', (v) => v.toFixed(0) + '°', 'fovVal');
  bindRange('height', 'height', (v) => v.toFixed(2), 'hVal');
  bindRange('diffuse', 'diffuse', (v) => v.toFixed(2), 'dVal');
  bindRange('tex', 'tiles', (v) => '격자 ' + v + '×' + v, 'texVal');

  /* ── 카메라 ───────────────────────────────────────────────────────── */
  let drag = false, lx = 0, ly = 0;
  cv.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.yaw += (e.clientX - lx) * 0.007;
    cam.pitch = Math.max(-0.05, Math.min(1.2, cam.pitch + (e.clientY - ly) * 0.005));
    lx = e.clientX; ly = e.clientY;
  });
  cv.addEventListener('pointerup', (e) => { drag = false; cv.releasePointerCapture(e.pointerId); });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(3, Math.min(14, cam.dist * (1 + e.deltaY * 0.001))); }, { passive: false });

  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const matrixEl = document.querySelector('#matrix');

  function fmtMatrix(m) {
    const f = (v) => (Math.abs(v) < 1e-6 ? '0.00' : v.toFixed(2)).padStart(6);
    const rows = [];
    for (let r = 0; r < 4; r++) rows.push([0, 1, 2, 3].map((c) => f(m[c * 4 + r])).join(' '));
    return rows.join('\n');
  }

  let last = performance.now(), angle = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.move) cam.yaw += dt * 0.45;
    angle += dt * 0.5;

    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.045, 0.06, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const eye = [Math.sin(cam.yaw) * cp * cam.dist, sp * cam.dist + 1.1, Math.cos(cam.yaw) * cp * cam.dist];
    const view = M.lookAt(eye, [0, 1.2, 0], [0, 1, 0]);
    const aspect = w / h;
    const proj = S.ortho ? M.ortho(-2.4 * aspect, 2.4 * aspect, -2.4, 2.4, 0.1, 60)
      : M.perspective(S.fov, aspect, 0.1, 60);

    gl.useProgram(prog);
    gl.uniform3fv(U.uEye, eye);
    gl.uniform3f(U.uLightPos, 3.2, 4.6, 2.4);
    gl.uniform1f(U.uDiffuse, S.diffuse);
    gl.uniform1i(U.uShadow, 0);

    // 바닥 (평면을 y=0 으로 눕힌다)
    const floorModel = M.multiply(M.rotateX(Math.PI / 2), M.scale(14, 14, 14));
    const floorMVP = M.multiply(proj, M.multiply(view, floorModel));
    gl.uniformMatrix4fv(U.uMVP, false, floorMVP);
    gl.uniformMatrix4fv(U.uModel, false, floorModel);
    gl.uniformMatrix3fv(U.uNormalMat, false, M.normalMatrix(floorModel));
    gl.uniform3f(U.uColor, 0.42, 0.46, 0.54);
    gl.uniform1f(U.uTiles, S.tiles);
    gl.bindVertexArray(floorMesh.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);        // createQuad 는 인덱스 없이 4개 정점

    // 공 (떠서 회전)
    let model = M.translate(0, S.height, 0);
    model = M.multiply(model, M.rotateY(angle));
    model = M.multiply(model, M.scale(1.0, 1.0, 1.0));
    const mvp = M.multiply(proj, M.multiply(view, model));
    gl.uniformMatrix4fv(U.uMVP, false, mvp);
    gl.uniformMatrix4fv(U.uModel, false, model);
    gl.uniformMatrix3fv(U.uNormalMat, false, M.normalMatrix(model));
    gl.uniform3f(U.uColor, 0.95, 0.62, 0.38);
    gl.bindVertexArray(sphere.vao);
    gl.drawElements(gl.TRIANGLES, sphere.count, sphere.type, 0);

    // 그림자: 바닥에 구의 단면을 원으로 그린다 (구 중심을 바닥에 투영)
    const shadowModel = M.multiply(M.translate(-0.40, 0.003, -0.30), M.scale(0.62, 0.62, 0.62));
    const shadowMVP = M.multiply(proj, M.multiply(view, shadowModel));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniformMatrix4fv(U.uMVP, false, shadowMVP);
    gl.uniform1i(U.uShadow, 1);
    gl.bindVertexArray(shadowMesh.vao);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, shadowMesh.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.uniform1i(U.uShadow, 0);
    gl.bindVertexArray(null);

    matrixEl.textContent = fmtMatrix(mvp);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
