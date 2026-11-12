/* 5주차 실습: Phong 조명 + 세 가지 광원(점·방향·집광) + 법선 행렬 + 자체발광 태양
 * 키 조작
 *   1 / 2 / 3 : 행성 재질 전환 (바위 / 금속 / 얼음) — 재질마다 base 색·광택·specular 가 다르다
 *   4 / 5 / 6 : 점광원(태양) / 방향광(별빛) / 집광(스포트) 켜고 끄기
 *   0         : 세 광원 모두 켜기
 */
'use strict';

/* ── 1. 메시 ───────────────────────────────────────────────────────────── */
function makeSphere(seg) {
  const positions = [], normals = [], indices = [];
  for (let i = 0; i <= seg; i++) {
    const phi = Math.PI * i / seg;
    for (let j = 0; j <= seg * 2; j++) {
      const th = 2 * Math.PI * j / (seg * 2);
      const x = Math.sin(phi) * Math.cos(th), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(th);
      positions.push(x, y, z);
      normals.push(x, y, z);
    }
  }
  const W = seg * 2 + 1;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < seg * 2; j++) {
      const a = i * W + j, b = a + W;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

function makePlane(size) {
  const s = size / 2;
  return {
    positions: new Float32Array([-s, 0, -s, s, 0, -s, s, 0, s, -s, 0, s]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

/* ── 2. 셰이더 ─────────────────────────────────────────────────────────── */
const VS_SOURCE = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel, uView, uProj;
uniform mat3 uNormalMat;               // transpose(inverse(model)) — 비균일 축척에서도 법선이 살아남는다
out vec3 vWorldPos, vNormal;
void main(){
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorldPos = world.xyz;
  vNormal = uNormalMat * aNormal;      // ★ 법선은 model 의 3×3 으로 직접 바꾸면 왜곡된다
  gl_Position = uProj * uView * world;
}`;

const FS_SOURCE = `#version 300 es
precision highp float;
in vec3 vWorldPos, vNormal;
uniform vec3 uBaseColor, uViewPos, uSunPos, uSunColor, uDirLight, uDirColor,
             uSpotPos, uSpotDir, uSpotColor;
uniform float uShininess, uSpecStrength;
uniform bool uEmissive;
uniform int uLightMask;                // bit0 점, bit1 방향, bit2 집광
out vec4 fragColor;

// 점광원: 거리에 따라 감쇠
vec3 pointLight(vec3 N, vec3 V, vec3 p){
  vec3 d = uSunPos - p;
  float dist = length(d);
  vec3 L = d / max(dist, 1e-4);
  float att = 1.55 / (1.0 + 0.10 * dist * dist);
  float ndl = max(dot(N, L), 0.0);
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), uShininess) * uSpecStrength;
  return (uBaseColor * ndl + uSunColor * spec) * uSunColor * att;
}

// 방향광: 위치 없이 방향만. 감쇠 없음(평행광)
vec3 directionalLight(vec3 N, vec3 V){
  vec3 L = normalize(-uDirLight);
  float ndl = max(dot(N, L), 0.0);
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), uShininess) * uSpecStrength;
  return (uBaseColor * ndl + uDirColor * spec) * uDirColor;
}

// 집광(스포트): 위치 + 방향 + 각도 제한. 안쪽 cos 과 바깥 cos 사이를 부드럽게
vec3 spotLight(vec3 N, vec3 V, vec3 p){
  vec3 d = uSpotPos - p;
  float dist = length(d);
  vec3 L = d / max(dist, 1e-4);
  float cosA = dot(-L, normalize(uSpotDir));
  float cone = smoothstep(0.86, 0.95, cosA);      // 약 30° 안쪽
  if (cone <= 0.0) return vec3(0.0);
  float att = cone / (1.0 + 0.03 * dist * dist);
  float ndl = max(dot(N, L), 0.0);
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), uShininess) * uSpecStrength;
  return (uBaseColor * ndl * 1.6 + uSpotColor * spec * 1.4) * uSpotColor * att;
}

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uViewPos - vWorldPos);

  if (uEmissive){                                  // 태양은 스스로 빛난다
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    fragColor = vec4(uBaseColor * (1.0 + 0.35 * rim), 1.0);
    return;
  }

  vec3 ambient = 0.07 * uBaseColor;                // 환경광(상수)
  vec3 col = ambient;
  if ((uLightMask & 1) != 0) col += pointLight(N, V, vWorldPos);
  if ((uLightMask & 2) != 0) col += directionalLight(N, V);
  if ((uLightMask & 4) != 0) col += spotLight(N, V, vWorldPos);

  col = col / (1.0 + col);                         // 과노출 정리
  fragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

/* ── 3. 행렬 도구 (열 우선) ───────────────────────────────────────────── */
const Mat4 = {
  identity() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
  multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
    }
    return o;
  },
  translate(x, y, z) { const m = Mat4.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
  scale(x, y, z) { const m = Mat4.identity(); m[0] = x; m[5] = y; m[10] = z; return m; },
  rotateY(r) { const m = Mat4.identity(), c = Math.cos(r), s = Math.sin(r); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    const zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
  },
  // 법선 행렬 = transpose(inverse(model)) 의 3×3
  normalFromMat4(m) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a10 = m[4], a11 = m[5], a12 = m[6], a20 = m[8], a21 = m[9], a22 = m[10];
    const b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    det = 1 / det;
    return new Float32Array([
      b01 * det, (-a22 * a01 + a02 * a21) * det, (a12 * a01 - a02 * a11) * det,
      b11 * det, (a22 * a00 - a02 * a20) * det, (-a12 * a00 + a02 * a10) * det,
      b21 * det, (-a21 * a00 + a01 * a20) * det, (a11 * a00 - a01 * a10) * det]);
  },
};

/* ── 4. WebGL 준비 ────────────────────────────────────────────────────── */
const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2');
if (!gl) throw new Error('WebGL2 를 사용할 수 없습니다.');

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, VS_SOURCE));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS_SOURCE));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));

const U = {};
['uModel', 'uView', 'uProj', 'uNormalMat', 'uBaseColor', 'uViewPos', 'uSunPos', 'uSunColor',
  'uDirLight', 'uDirColor', 'uSpotPos', 'uSpotDir', 'uSpotColor', 'uShininess',
  'uSpecStrength', 'uEmissive', 'uLightMask'].forEach((n) => { U[n] = gl.getUniformLocation(program, n); });

function createMesh(mesh) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  function attribute(data, location, size) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }
  attribute(mesh.positions, 0, 3);
  attribute(mesh.normals, 1, 3);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: mesh.indices.length };
}
const sphere = createMesh(makeSphere(40));
const plane = createMesh(makePlane(18));
gl.enable(gl.DEPTH_TEST);

/* ── 5. 카메라 ─────────────────────────────────────────────────────────── */
const cam = { yaw: 0.62, pitch: 0.34, dist: 9.5 };
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  cam.yaw += (e.clientX - lastX) * 0.008;
  cam.pitch = Math.max(-1.3, Math.min(1.4, cam.pitch + (e.clientY - lastY) * 0.006));
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointerup', (e) => { dragging = false; canvas.releasePointerCapture(e.pointerId); });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(4, Math.min(40, cam.dist * (1 + e.deltaY * 0.001))); }, { passive: false });

/* ── 6. 재질과 광원 상태 ─────────────────────────────────────────────── */
const MATERIALS = [
  { name: '바위', color: [0.62, 0.36, 0.26], shininess: 14, spec: 0.25 },
  { name: '금속', color: [0.55, 0.60, 0.68], shininess: 96, spec: 0.95 },
  { name: '얼음', color: [0.70, 0.86, 0.94], shininess: 48, spec: 0.55 },
];
let matIndex = 0;
const lights = { point: true, dir: true, spot: true };
const hud = document.getElementById('hud');
function refreshHud() {
  const m = MATERIALS[matIndex];
  hud.textContent =
    `재질 ${matIndex + 1}/3 : ${m.name}   (shininess ${m.shininess}, spec ${m.spec})\n`
    + `[4] 점광원(태양)  ${lights.point ? 'ON' : 'OFF'}   [5] 방향광(별빛) ${lights.dir ? 'ON' : 'OFF'}`
    + `   [6] 집광(스포트) ${lights.spot ? 'ON' : 'OFF'}\n`
    + '법선 행렬 = transpose(inverse(model)) · 자체발광 태양 + Phong 확산/정반사';
}
window.addEventListener('keydown', (e) => {
  if (e.key === '1' || e.key === '2' || e.key === '3') { matIndex = Number(e.key) - 1; refreshHud(); }
  if (e.key === '4') { lights.point = !lights.point; refreshHud(); }
  if (e.key === '5') { lights.dir = !lights.dir; refreshHud(); }
  if (e.key === '6') { lights.spot = !lights.spot; refreshHud(); }
  if (e.key === '0') { lights.point = lights.dir = lights.spot = true; refreshHud(); }
});
refreshHud();

/* ── 7. 렌더 ─────────────────────────────────────────────────────────── */
function draw(mesh, model, color, shininess, spec, emissive) {
  gl.uniformMatrix4fv(U.uModel, false, model);
  gl.uniformMatrix3fv(U.uNormalMat, false, Mat4.normalFromMat4(model));
  gl.uniform3fv(U.uBaseColor, color);
  gl.uniform1f(U.uShininess, shininess);
  gl.uniform1f(U.uSpecStrength, spec);
  gl.uniform1i(U.uEmissive, emissive ? 1 : 0);
  gl.bindVertexArray(mesh.vao);
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
}

const start = performance.now();
function render() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.035, 0.05, 0.085, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const t = (performance.now() - start) / 1000;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const eye = [Math.sin(cam.yaw) * cp * cam.dist, sp * cam.dist + 1.4, Math.cos(cam.yaw) * cp * cam.dist];
  const view = Mat4.lookAt(eye, [0, 1.4, 0], [0, 1, 0]);
  const proj = Mat4.perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 200);

  // 태양은 행성계 중심에 고정 (점광원 위치 = 태양 위치)
  const sunPos = [0, 1.9, 0];
  // 방향광: 왼쪽 위 뒤에서 오는 차가운 별빛
  const dirLight = [0.55, -0.62, 0.55];
  // 집광: 카메라 뒤쪽에서 장면 중심을 비추는 스포트
  const spotPos = [eye[0] * 1.1, eye[1] + 2.2, eye[2] * 1.1];
  const spotDir = [-eye[0], 1.4 - (eye[1] + 2.2), -eye[2]];

  gl.useProgram(program);
  gl.uniformMatrix4fv(U.uView, false, view);
  gl.uniformMatrix4fv(U.uProj, false, proj);
  gl.uniform3fv(U.uViewPos, eye);
  gl.uniform3fv(U.uSunPos, sunPos);
  gl.uniform3f(U.uSunColor, 1.0, 0.86, 0.62);
  gl.uniform3fv(U.uDirLight, dirLight);
  gl.uniform3f(U.uDirColor, 0.34, 0.46, 0.72);
  gl.uniform3fv(U.uSpotPos, spotPos);
  gl.uniform3fv(U.uSpotDir, spotDir);
  gl.uniform3f(U.uSpotColor, 0.85, 0.95, 1.0);
  gl.uniform1i(U.uLightMask,
    (lights.point ? 1 : 0) | (lights.dir ? 2 : 0) | (lights.spot ? 4 : 0));

  // 바닥
  draw(plane, Mat4.identity(), [0.30, 0.33, 0.40], 10, 0.15, false);

  // 태양 — 자체발광. 조명 계산을 하지 않고 스스로 밝게 보인다
  draw(sphere, Mat4.multiply(Mat4.translate(...sunPos), Mat4.scale(0.55, 0.55, 0.55)), [1.0, 0.80, 0.40], 1, 0, true);

  // 행성 — 태양 둘레를 공전, 선택한 재질 적용
  const orbit = 3.1;
  const ang = t * 0.36;
  const px = Math.cos(ang) * orbit, pz = Math.sin(ang) * orbit;
  const planetPos = [px, 1.9 + Math.sin(t * 0.7) * 0.05, pz];
  const m = MATERIALS[matIndex];
  let pm = Mat4.multiply(Mat4.translate(...planetPos), Mat4.rotateY(t * 0.5));
  pm = Mat4.multiply(pm, Mat4.scale(1.05, 1.05, 1.05));
  draw(sphere, pm, m.color, m.shininess, m.spec, false);

  // 달 — 행성 둘레를 공전. 축척이 다르므로 법선 행렬이 꼭 필요하다
  let mm = Mat4.multiply(Mat4.translate(...planetPos), Mat4.rotateY(t * 1.3));
  mm = Mat4.multiply(mm, Mat4.translate(1.9, 0, 0));
  mm = Mat4.multiply(mm, Mat4.scale(0.36, 0.36, 0.36));
  draw(sphere, mm, [0.70, 0.71, 0.74], 26, 0.3, false);

  gl.bindVertexArray(null);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
