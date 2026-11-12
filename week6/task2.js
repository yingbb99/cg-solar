/* 6주차 실습 2: 나만의 행성 표면
 *  - UV 구체에 PBR(D·F·G) 적용
 *  - 프로그램으로 만든 색·ARM·법선 맵 (외부 이미지 없음)
 *  - 두 조건으로 바뀌는 표면 마스크
 *      ① 위도 조건(|N.y|) → 극지 얼음 : 색·roughness·metallic 을 동시에 바꾼다
 *      ② 태양 조건(N·L) → 밤면 도시 불빛 : 발광 성분을 더한다
 */
(() => {
  'use strict';
  const cv = document.querySelector('#cv'), gl = D.context(cv); if (!gl) return;
  const M = CG.Mesh;

  const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aTan;
uniform mat4 uVP;
uniform mat3 uModel3;
out vec3 vP,vN,vT; out vec2 vUV;
void main(){
  vP = uModel3*aPos; vN = normalize(uModel3*aNormal); vT = normalize(uModel3*aTan);
  vUV = aUV;
  gl_Position = uVP*vec4(vP,1.0);
}`;

  const FS = `#version 300 es
precision highp float;
const float PI = 3.14159265359;
in vec3 vP,vN,vT; in vec2 vUV; out vec4 outColor;
uniform sampler2D uColor,uARM,uNormal,uEnv;
uniform vec3 uEye,uLightDir,uIceTint,uNightTint;
uniform float uIceLat,uMaskIce,uMaskNight,uRough,uMetal,uNormalStrength,uPower,uNightGain,uEnvPower,uSpin;

vec3 srgbToLinear(vec3 c){return mix(c/12.92, pow((c+.055)/1.055, vec3(2.4)), step(vec3(.04045), c));}
vec3 linearToSrgb(vec3 c){return mix(12.92*c, 1.055*pow(c, vec3(1./2.4))-.055, step(vec3(.0031308), c));}

float hash(vec2 p){return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453);}

vec3 directPBR(vec3 N,vec3 V,vec3 L,vec3 base,float rough,float metal){
  vec3 H = normalize(V+L);
  float nl = max(dot(N,L),0.0), nv = max(dot(N,V),1e-4);
  float nh = max(dot(N,H),0.0), vh = max(dot(V,H),0.0);
  float a = rough*rough, a2 = a*a;
  float den = nh*nh*(a2-1.0)+1.0;
  float D = a2/max(PI*den*den,1e-6);
  float k = (rough+1.0)*(rough+1.0)/8.0;
  float G = (nl/(nl*(1.0-k)+k))*(nv/(nv*(1.0-k)+k));
  vec3 F0 = mix(vec3(0.04), base, metal);
  vec3 F = F0+(1.0-F0)*pow(1.0-vh,5.0);
  vec3 kd = (1.0-F)*(1.0-metal);
  return (kd*base/PI + D*G*F/max(4.0*nl*nv,1e-4))*nl;
}

void main(){
  vec3 Ng = normalize(vN);
  vec3 V = normalize(uEye-vP);
  vec3 L = normalize(uLightDir);
  vec3 T = normalize(vT - Ng*dot(Ng,vT));
  vec3 B = cross(Ng,T);

  // 접선 공간 법선 맵
  vec3 nm = texture(uNormal, vUV).xyz*2.0-1.0;
  nm.xy *= uNormalStrength; nm = normalize(nm);
  vec3 N = normalize(mat3(T,B,Ng)*nm);

  vec3 c = srgbToLinear(texture(uColor, vUV).rgb);
  vec3 arm = texture(uARM, vUV).rgb;
  float ao = arm.r;
  vec3 base = c;
  float rough = clamp(uRough*arm.g, 0.05, 1.0);
  float metal = clamp(uMetal*arm.b, 0.0, 1.0);

  /* ── 마스크 ①: 위도 조건 ──────────────────────────────
     |N.y| 가 임계값(uIceLat)보다 큰 극지방은 밝은 얼음으로 덮는다.
     색뿐 아니라 roughness·metallic 도 함께 바꾸어 재질 자체가 달라진다. */
  float lat = abs(Ng.y);
  float iceMask = uMaskIce * smoothstep(uIceLat-0.06, uIceLat+0.06, lat)
                  * (0.65 + 0.35*smoothstep(-0.02, 0.10, dot(Ng, L)));
  base = mix(base, uIceTint*(0.86+0.14*sin(9.0*lat+vUV.x*40.0)), iceMask);
  rough = mix(rough, 0.18, iceMask*0.9);
  metal = mix(metal, 0.0, iceMask);

  vec3 color = directPBR(N,V,L,base,rough,metal)*uPower;
  float day = smoothstep(-0.18, 0.10, dot(Ng, L));
  color += base*0.045*ao*(0.15+0.85*day);                 // ambient 도 낮/밤을 구분

  // 환경 반사
  vec3 Rv = reflect(-V,N);
  vec2 envUV = vec2(atan(Rv.z,Rv.x)/(2.0*PI)+0.5, acos(clamp(Rv.y,-1.0,1.0))/PI);
  vec3 F0 = mix(vec3(0.04), base, metal);
  vec3 Fe = F0 + (max(vec3(1.0-rough),F0)-F0)*pow(1.0-max(dot(N,V),0.0),5.0);
  color += srgbToLinear(texture(uEnv, envUV).rgb)*Fe*uEnvPower*(1.0-rough*0.7)*ao*(0.2+0.8*day);

  /* ── 마스크 ②: 태양 조건 ──────────────────────────────
     태양을 등진 밤면(N·L < 0)에만 육지(색의 G가 B보다 큰 영역) 위 도시 불빛이 켜진다. */
  float night = smoothstep(0.06, -0.16, dot(Ng,L));
  float land = smoothstep(0.0, 0.16, c.g - c.b);
  vec2 gp = vec2(vUV.x*180.0+uSpin, vUV.y*90.0);
  vec2 cell = floor(gp), f = fract(gp)-0.5;
  float spark = step(0.80, hash(cell))*smoothstep(0.30,0.08,length(f))*hash(cell+7.3);
  float maskNight = uMaskNight*night*land;
  color += uNightTint*spark*maskNight*0.55*uNightGain;
  color += uNightTint*0.020*maskNight;                     // 밤면 기본 조도

  color = color/(1.0+color);
  outColor = vec4(linearToSrgb(color),1.0);
}`;

  const prog = D.program(gl, VS, FS);
  const U = D.uniforms(gl, prog, ['uVP','uModel3','uEye','uLightDir','uIceTint','uNightTint',
    'uIceLat','uMaskIce','uMaskNight','uRough','uMetal','uNormalStrength','uPower',
    'uNightGain','uEnvPower','uSpin','uColor','uARM','uNormal','uEnv']);

  // ── 정점 데이터: 지구형 행성 맵을 코드로 생성 ──
  const W = 512, H = 256;
  const maps = M.makePlanetMaps('rock', 'earth', W, H);
  function texFrom(data, w, h, srgbLike){
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }
  const texColor = texFrom(maps.color, W, H);
  const texARM = texFrom(maps.arm, W, H);
  const texNormal = texFrom(maps.normal, W, H);
  // 간단한 환경 큐브 대신 등장방형 그라디언트를 코드로 만든다.
  const envData = new Uint8Array(64 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++){
    const i = (y * 64 + x) * 4, v = y / 31;
    const sky = 0.25 + 0.55 * (1 - v);
    envData[i] = 40 + 150 * sky; envData[i + 1] = 60 + 160 * sky; envData[i + 2] = 110 + 145 * sky; envData[i + 3] = 255;
  }
  const texEnv = texFrom(envData, 64, 32);

  const sphere = M.upload(gl, M.createSphere(64, 96));

  document.querySelector('#ui').innerHTML = '';
  const S = D.UI('#ui', [
    { id: 'maskOn', type: 'check', label: '표면 마스크 켬', value: true },
    { id: 'iceLat', label: '극지 얼음 위도 임계값', min: .35, max: .95, step: .01, value: .74, fmt: v => v.toFixed(2) },
    { id: 'sun', label: '태양 방위', min: 0, max: 360, step: 1, value: 35, fmt: v => `${Math.round(v)}°` },
    { id: 'spin', label: '자전 위치', min: 0, max: 1, step: .01, value: 0 },
    { id: 'rough', label: 'roughness 배율', min: .05, max: 1, step: .01, value: 1 },
    { id: 'metal', label: 'metallic 배율', min: 0, max: 1, step: .01, value: 1 },
    { id: 'normal', label: 'normal 강도', min: 0, max: 3, step: .05, value: 1.2 },
    { id: 'power', label: '태양 세기', min: 0, max: 8, step: .1, value: 3.4 },
    { id: 'nightGain', label: '도시 불빛 세기', min: 0, max: 3, step: .05, value: 1 },
  ]);
  const reset = document.querySelector('#reset');
  const cam = D.orbit(cv, { dist: 3.2, pitch: .12 });
  reset.onclick = () => { cam.dist = 3.2; cam.yaw = 0; cam.pitch = .12; S.sun = 35; S.spin = 0; };

  const view = D.M4.create(), proj = D.M4.create(), vp = D.M4.create();
  const model = new Float32Array([1,0,0, 0,1,0, 0,0,1]);
  const status = document.querySelector('#status');
  status.textContent = '내 행성 · UV 구체 64×96 · 코드 생성 512×256 맵';

  document.querySelector('#note').textContent =
    '마스크 ①: |N.y| ≥ ' + S.iceLat.toFixed(2) + ' 인 극지방이 얼음 재질로 바뀝니다(색·roughness·metallic 동시 변경). '
    + '마스크 ②: 태양을 등진 밤면의 육지에만 도시 불빛이 켜집니다. '
    + '태양 방위를 돌리면 낮/밤 경계가 이동하며 두 마스크가 조건에 따라 켜지고 꺼지는 것을 볼 수 있습니다.';

  let visible = true, lastKey = '';
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(cv);

  D.loop(() => {
    if (!visible || document.hidden) return;
    D.fit(cv);
    const key = [cv.width, cv.height, cam.yaw, cam.pitch, cam.dist,
      S.maskOn, S.iceLat, S.sun, S.spin, S.rough, S.metal, S.normal, S.power, S.nightGain].join('|');
    if (key === lastKey) return;
    lastKey = key;

    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0.03, 0.045, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);

    const eye = cam.eye([0, 0, 0]);
    D.M4.lookAt(view, eye, [0, 0, 0], [0, 1, 0]);
    D.M4.perspective(proj, Math.PI / 4, cv.width / cv.height, .1, 100);
    D.M4.multiply(vp, proj, view);

    const a = S.sun * Math.PI / 180;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(U.uVP, false, vp);
    gl.uniformMatrix3fv(U.uModel3, false, model);
    gl.uniform3fv(U.uEye, eye);
    gl.uniform3f(U.uLightDir, Math.cos(a) * 0.9, 0.35, Math.sin(a) * 0.9);
    gl.uniform3f(U.uIceTint, 0.86, 0.93, 1.0);
    gl.uniform3f(U.uNightTint, 1.0, 0.78, 0.42);
    gl.uniform1f(U.uIceLat, S.iceLat);
    gl.uniform1f(U.uMaskIce, S.maskOn ? 1 : 0);
    gl.uniform1f(U.uMaskNight, S.maskOn ? 1 : 0);
    gl.uniform1f(U.uRough, S.rough);
    gl.uniform1f(U.uMetal, S.metal);
    gl.uniform1f(U.uNormalStrength, S.normal);
    gl.uniform1f(U.uPower, S.power);
    gl.uniform1f(U.uNightGain, S.nightGain);
    gl.uniform1f(U.uEnvPower, 0.35);
    gl.uniform1f(U.uSpin, S.spin * 13.0);
    [texColor, texARM, texNormal, texEnv].forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(U[['uColor', 'uARM', 'uNormal', 'uEnv'][i]], i);
    });
    gl.bindVertexArray(sphere.vao);
    gl.drawElements(gl.TRIANGLES, sphere.count, sphere.type, 0);
    gl.bindVertexArray(null);

    document.querySelector('#note').textContent =
      '마스크 ①: |N.y| ≥ ' + S.iceLat.toFixed(2) + ' 극지방 → 얼음 재질. '
      + '마스크 ②: 태양 조건 N·L < 0 인 밤면 육지 → 도시 불빛. '
      + `현재 태양 방위 ${Math.round(S.sun)}°. ` + (S.maskOn ? '마스크 켬' : '마스크 끔(균일 재질)');
  });
})();
