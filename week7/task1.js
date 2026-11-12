/* 7주차 실습 1: ray tracing 식 관측기
 * TODO 1~3 구현 완료본.
 *   · 픽셀 → 카메라 광선
 *   · 광선–구 교차 (가장 가까운 양수 t)
 *   · 별 직접광 + 그림자 광선(가림 검사)
 * 그림자를 끄고 켜서 0°(일식)와 180°(월식)에서 무엇이 달라지는지 비교한다.
 */
(() => {
  'use strict';
  const cv = document.querySelector('#cv'), gl = D.context(cv);
  if (!gl) return;

  const VS = `#version 300 es
  layout(location=0) in vec2 aPos;
  void main(){gl_Position=vec4(aPos,0.0,1.0);}`;

  const FS = `#version 300 es
  precision highp float;
  uniform vec2 uRes;
  uniform vec3 uEye;
  uniform int uShadow;
  uniform vec4 uBodies[3];   // xyz = 중심, w = 반지름
  uniform vec3 uColors[3];
  out vec4 outColor;

  /* TODO 1: 화면 픽셀에서 출발하는 카메라 광선의 방향
     - 픽셀 좌표를 화면 비율에 맞춰 -1~1 로 정규화한다.
     - 카메라 기준축(forward/right/up)과 화각으로 방향을 만든다. */
  vec3 cameraRay(vec2 pixel, vec3 eye){
    vec3 target = vec3(0.0, 0.0, -2.0);          // 카메라가 바라보는 지점
    vec2 ndc = (2.0 * pixel - uRes) / uRes.y;    // y 기준으로 정규화(종횡비 유지)
    vec3 forward = normalize(target - eye);
    vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, forward);
    float tanHalf = tan(radians(45.0) * 0.5);
    return normalize(forward + ndc.x * right * tanHalf + ndc.y * up * tanHalf);
  }

  /* TODO 2: 광선과 구의 가장 가까운 양수 교차 거리
     - |ro + t·rd - c|² = r² 를 t 에 대해 푼다(rd 는 단위 벡터).
     - 판별식이 음수면 -1, 두 근 중 가까운 양수 t 를 돌려준다. */
  float hitSphere(vec3 ro, vec3 rd, vec3 center, float radius){
    vec3 oc = ro - center;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - radius * radius;
    float disc = b * b - c;
    if (disc < 0.0) return -1.0;
    float sq = sqrt(disc);
    float t0 = -b - sq;
    float t1 = -b + sq;
    if (t0 > 0.002) return t0;
    return t1 > 0.002 ? t1 : -1.0;
  }

  float traceScene(vec3 ro, vec3 rd, out int hitId){
    float nearest = 1e20;
    hitId = -1;
    for (int i = 0; i < 3; i++){
      float t = hitSphere(ro, rd, uBodies[i].xyz, uBodies[i].w);
      if (t > 0.0 && t < nearest){ nearest = t; hitId = i; }
    }
    // 넓은 관측실: 바닥(3)과 뒷벽(4)도 광선으로 직접 교차한다.
    if (abs(rd.y) > 0.0001){
      float t = (-1.12 - ro.y) / rd.y;
      vec3 p = ro + t * rd;
      if (t > 0.002 && t < nearest && abs(p.x) < 3.0 && p.z > -4.5 && p.z < 0.8){ nearest = t; hitId = 3; }
    }
    if (abs(rd.z) > 0.0001){
      float t = (-4.5 - ro.z) / rd.z;
      vec3 p = ro + t * rd;
      if (t > 0.002 && t < nearest && abs(p.x) < 3.0 && p.y > -1.12 && p.y < 1.85){ nearest = t; hitId = 4; }
    }
    return nearest;
  }

  vec3 surfaceColor(int id, vec3 p){
    if (id == 1){
      float bands = 0.76 + 0.24 * sin(18.0 * p.y + 2.0 * sin(4.0 * p.x));
      return uColors[1] * bands;
    }
    if (id == 3){
      float tile = mod(floor(p.x * 3.0) + floor(p.z * 3.0), 2.0);
      return mix(vec3(0.13, 0.18, 0.24), vec3(0.56, 0.63, 0.69), tile);
    }
    if (id == 4) return vec3(0.33, 0.39, 0.48);
    return uColors[id];
  }

  /* TODO 3: 별의 직접광 + 그림자 광선
     - 교차점에서 별 방향으로 다시 광선을 쏘아, 그 사이에 다른 천체가 있으면 가린다.
     - Lambert 확산 + Blinn-Phong 하이라이트로 색을 만든다. */
  vec3 shade(vec3 ro, vec3 rd, float t, int id){
    vec3 p = ro + t * rd;

    if (id == 0) return uColors[0] * 1.35;                // 별은 자체발광

    vec3 N;
    if (id <= 2) N = normalize(p - uBodies[id].xyz);      // 구의 법선
    else if (id == 3) N = vec3(0.0, 1.0, 0.0);            // 바닥
    else N = vec3(0.0, 0.0, 1.0);                         // 뒷벽

    vec3 base = surfaceColor(id, p);
    vec3 toStar = uBodies[0].xyz - p;
    float dist = length(toStar);
    vec3 L = toStar / max(dist, 1e-4);

    // 그림자 광선: 자기 표면 재교차를 피하려고 법선 방향으로 살짝 띄운다.
    float vis = 1.0;
    if (uShadow == 1){
      vec3 so = p + N * 0.006;
      int hid;
      float bt = traceScene(so, L, hid);
      // hid==0 은 광원(별) 자체이므로 가림으로 세지 않는다.
      if (hid > 0 && hid != id && bt < dist - 0.004) vis = 0.0;
    }

    float nl = max(dot(N, L), 0.0);
    vec3 V = normalize(ro - p);
    vec3 H = normalize(V + L);
    float spec = pow(max(dot(N, H), 0.0), 42.0) * 0.30 * step(0.0001, nl);

    float att = 1.0 / (1.0 + 0.30 * dist * dist);          // 교육용 감쇠
    vec3 radiance = vec3(1.0, 0.86, 0.62) * 5.2 * att;

    vec3 color = base * (0.045 + nl) * radiance * vis * 0.62;
    color += spec * radiance * vis * 0.5;
    return color;
  }

  vec3 displayColor(vec3 c){ return pow(c / (1.0 + c), vec3(1.0 / 2.2)); }

  void main(){
    vec3 ro = uEye;
    vec3 rd = cameraRay(gl_FragCoord.xy, ro);
    int id;
    float t = traceScene(ro, rd, id);
    if (id < 0){
      float sky = 0.5 + 0.5 * rd.y;
      outColor = vec4(vec3(0.015, 0.025, 0.05) + sky * vec3(0.035, 0.055, 0.09), 1.0);
      return;
    }
    outColor = vec4(displayColor(shade(ro, rd, t, id)), 1.0);
  }`;

  const program = D.program(gl, VS, FS);
  const U = D.uniforms(gl, program, ['uRes', 'uEye', 'uShadow', 'uBodies', 'uColors']);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const S = D.UI('#ui', [
    { id: 'shadow', type: 'check', label: '그림자 광선', value: true },
    { id: 'orbit', label: '위성 공전 위치', min: 0, max: 360, step: 1, value: 0, fmt: (v) => `${Math.round(v)}°` },
    { id: 'scale', label: '렌더 해상도', min: 0.4, max: 1, step: 0.1, value: 1 },
  ]);
  const cam = D.orbit(cv, { dist: 5.8, yaw: 0.48, pitch: 0.20, min: 3.8, max: 9 });
  document.querySelector('#reset').onclick = () => { cam.dist = 5.8; cam.yaw = 0.48; cam.pitch = 0.20; };

  const bodies = new Float32Array([
    -2.10, 1.00, 0.70, 0.42,     // 0 별: 광원 겸 발광 구
     0.45, -0.12, -2.00, 0.78,   // 1 행성
     0.00, 0.00, 0.00, 0.29,     // 2 위성: 매 프레임 행성 주위를 공전
  ]);
  const colors = new Float32Array([4.0, 2.7, 0.8, 0.50, 0.71, 0.95, 0.82, 0.85, 0.88]);

  // 0°: 별—위성—행성(일식), 180°: 별—행성—위성(월식).
  const delta = [bodies[0] - bodies[4], bodies[1] - bodies[5], bodies[2] - bodies[6]];
  const deltaLength = Math.hypot(...delta);
  const starward = delta.map((v) => v / deltaLength);
  const sideLength = Math.hypot(starward[0], starward[2]);
  const sideways = [starward[2] / sideLength, 0, -starward[0] / sideLength];

  function updateMoon(degrees){
    const a = degrees * Math.PI / 180;
    for (let i = 0; i < 3; i++){
      bodies[8 + i] = bodies[4 + i] + 1.50 * (Math.cos(a) * starward[i] + Math.sin(a) * sideways[i]);
    }
  }

  const orbitInput = document.querySelector('.ctl[data-id="orbit"] input');
  const orbitValue = document.querySelector('.ctl[data-id="orbit"] .val');
  const playButton = document.querySelector('#play');
  let playing = false;
  orbitInput.addEventListener('input', () => { playing = false; playButton.textContent = '공전 재생'; });

  function setOrbit(degrees){
    S.orbit = (degrees + 360) % 360;
    orbitInput.value = Math.round(S.orbit);
    orbitValue.textContent = `${Math.round(S.orbit)}°`;
  }
  document.querySelector('#solar').onclick = () => {
    playing = false; playButton.textContent = '공전 재생'; setOrbit(0);
    cam.yaw = -0.20; cam.pitch = 0.20; cam.dist = 5.8;
  };
  document.querySelector('#lunar').onclick = () => {
    playing = false; playButton.textContent = '공전 재생'; setOrbit(180);
    cam.yaw = 1.22; cam.pitch = 0.28; cam.dist = 5.8;
  };
  playButton.onclick = () => { playing = !playing; playButton.textContent = playing ? '공전 일시정지' : '공전 재생'; };

  let lastKey = '', visible = true;
  new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }).observe(cv);

  D.loop((now, dt) => {
    if (!visible || document.hidden) return;
    if (playing) setOrbit(S.orbit + 30 * Math.min(dt, 0.05));
    updateMoon(S.orbit);
    D.fit(cv, S.scale);
    const key = [cv.width, cv.height, S.shadow, S.orbit, cam.yaw, cam.pitch, cam.dist].join('|');
    if (key === lastKey) return;
    lastKey = key;

    gl.viewport(0, 0, cv.width, cv.height);
    gl.useProgram(program);
    gl.uniform2f(U.uRes, cv.width, cv.height);
    gl.uniform3fv(U.uEye, cam.eye([0, 0, -2]));
    gl.uniform1i(U.uShadow, S.shadow ? 1 : 0);
    gl.uniform4fv(U.uBodies, bodies);
    gl.uniform3fv(U.uColors, colors);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

    const angle = S.orbit;
    const event = angle < 18 || angle > 342 ? '일식: 위성 그림자가 행성에 생깁니다.'
      : angle > 162 && angle < 198 ? '월식: 위성이 행성 그림자에 들어갑니다.'
        : '식이 아닌 공전 위치입니다.';
    document.querySelector('#status').textContent =
      `${event} 카메라 광선 → 구 교차 → 그림자 순서로 확인하세요.`;
  });
})();
