/* 6주차 실습 1: PBR + 텍스처 (TODO 1~5 완성)
 * TODO 1 색 텍스처(sRGB → 선형)
 * TODO 2 D(GGX)·F(Schlick)·G(Smith-Schlick) 직접광 PBR
 * TODO 3 ARM 맵(R=AO, G=roughness, B=metallic)
 * TODO 4 접선 공간 법선 맵(dFdx/dFdy 로 TBN 구성)
 * TODO 5 환경 파노라마 반사
 */
(() => {
  'use strict';
  const cv = document.querySelector('#cv'), gl = D.context(cv); if (!gl) return;

  const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uVP;
out vec3 vP,vN; out vec2 vUV;
void main(){vP=aPos;vN=aNormal;vUV=aUV;gl_Position=uVP*vec4(aPos,1.);}`;

  const FS = `#version 300 es
precision highp float;
const float PI=3.14159265;
in vec3 vP,vN; in vec2 vUV; out vec4 outColor;
uniform sampler2D uColor,uNormal,uARM,uEnv;
uniform vec3 uEye,uLight,uTint;
uniform float uRough,uMetal,uNormalStrength,uPower,uAmbient,uEnvPower;

vec3 srgbToLinear(vec3 c){
 return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));
}
vec3 linearToSrgb(vec3 c){
 return mix(12.92*c,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));
}

/* TODO 2: 직접광 PBR — 미세면 분포 D, 가림 G, Fresnel F */
vec3 directPBR(vec3 N,vec3 V,vec3 L,vec3 base,float rough,float metal){
  vec3  H  = normalize(V + L);
  float nl = max(dot(N, L), 0.0);
  float nv = max(dot(N, V), 1e-4);
  float nh = max(dot(N, H), 0.0);
  float vh = max(dot(V, H), 0.0);

  // D: GGX (Trowbridge–Reitz)
  float a  = rough * rough;
  float a2 = a * a;
  float den = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / max(PI * den * den, 1e-6);

  // G: Smith–Schlick (k = (rough+1)²/8)
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));

  // F: Schlick, 유전체는 0.04, 금속은 base 색을 정반사색으로
  vec3 F0 = mix(vec3(0.04), base, metal);
  vec3 F  = F0 + (1.0 - F0) * pow(1.0 - vh, 5.0);

  vec3 kd = (1.0 - F) * (1.0 - metal);          // 금속은 확산이 없다
  return (kd * base / PI + D * G * F / max(4.0 * nl * nv, 1e-4)) * nl;
}

void main(){
  vec3 N = normalize(vN), V = normalize(uEye - vP), L = normalize(uLight);

  /* TODO 1: 색 텍스처는 sRGB → 선형. 수치 맵(ARM/노멀)에는 적용하지 않는다. */
  vec3 base = uTint * srgbToLinear(texture(uColor, vUV).rgb);

  /* TODO 3: ARM 맵 — R=AO, G=roughness, B=metallic. 슬라이더는 배율로 쓴다. */
  vec3 arm = texture(uARM, vUV).rgb;
  float ao    = arm.r;
  float rough = clamp(uRough * arm.g, 0.045, 1.0);
  float metal = clamp(uMetal * arm.b, 0.0, 1.0);

  /* TODO 4: 접선 공간 법선. dFdx/dFdy 로 탄젠트·종법선을 만든다. */
  vec3 Ng = normalize(vN);
  if (uNormalStrength > 0.0){
    vec3 dpdu = dFdx(vP);
    vec3 dpdv = dFdy(vP);
    vec3 T = normalize(dpdu - Ng * dot(Ng, dpdu));
    vec3 B = cross(Ng, T);
    float sgn = dot(cross(dpdu, dpdv), Ng) < 0.0 ? -1.0 : 1.0;   // 화면 뒤집힘 보정
    vec3 nm = texture(uNormal, vUV).xyz * 2.0 - 1.0;
    nm.xy *= uNormalStrength;
    nm = normalize(nm);
    N = normalize(mat3(T, B * sgn, Ng) * nm);
  }

  float nl = max(dot(N, L), 0.0);
  vec3 radiance = vec3(1.0) * uPower;
  vec3 color = directPBR(N, V, L, base, rough, metal) * radiance * step(0.0001, nl);
  color += base * uAmbient * ao;                 // 상수 ambient(환경맵과 별개)

  /* TODO 5: 환경 파노라마 반사 — 반사 방향으로 조회, 금속은 base 색을 곱한다 */
  vec3 Rv = reflect(-V, N);
  float cosT = max(dot(N, V), 0.0);
  vec3 F0 = mix(vec3(0.04), base, metal);
  vec3 Fe = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - cosT, 5.0);
  vec2 envUV = vec2(atan(Rv.z, Rv.x) / (2.0 * PI) + 0.5, acos(clamp(Rv.y, -1.0, 1.0)) / PI);
  vec3 env = srgbToLinear(texture(uEnv, envUV).rgb);
  color += env * Fe * uEnvPower * (1.0 - rough * 0.75) * ao;

  color = max(color, vec3(0.0));
  color = color / (1.0 + color);                 // HDR → 표시 범위
  outColor = vec4(linearToSrgb(color), 1.0);
}`;

  const prog = D.program(gl, VS, FS), U = D.uniforms(gl, prog, [
    'uVP', 'uEye', 'uLight', 'uTint', 'uRough', 'uMetal', 'uNormalStrength',
    'uPower', 'uAmbient', 'uEnvPower', 'uColor', 'uNormal', 'uARM', 'uEnv',
  ]);
  const mesh = D.upload(gl, D.cube(1.9));

  const assets = {
    wood_planks: ['Diffuse', 'nor_gl', 'arm'],
    rusty_metal_04: ['Diffuse', 'nor_gl', 'arm'],
    rock_boulder_dry: ['Diffuse', 'nor_gl', 'arm'],
  };
  const textures = {}, jobs = []; let failed = false;
  function load(name) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([128, 128, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    jobs.push(new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        resolve();
      };
      img.onerror = () => { failed = true; resolve(); };
      img.src = 'assets/week06/' + name + (name.endsWith('_arm') ? '.png' : '.jpg');
    }));
    return tex;
  }
  for (const [asset, kinds] of Object.entries(assets)) textures[asset] = kinds.map((k) => load(asset + '_' + k));
  const envTex = load('studio_small_09_tonemapped');
  Promise.all(jobs).then(() => {
    document.querySelector('#status').textContent = failed
      ? '텍스처 로딩 실패: HTTP 서버와 파일 경로 확인'
      : '텍스처 로딩 완료 · TODO 1~5 적용 상태';
  });

  document.querySelector('#ui').innerHTML = '';
  const S = D.UI('#ui', [
    { id: 'material', type: 'select', label: '재질 선택', value: 'rusty_metal_04', options: [
      { value: 'rusty_metal_04', label: '녹슨 금속' }, { value: 'wood_planks', label: '나무' },
      { value: 'rock_boulder_dry', label: '돌' }] },
    { id: 'rough', label: 'roughness 배율', min: .05, max: 1, step: .01, value: 1 },
    { id: 'metal', label: 'metallic 배율', min: 0, max: 1, step: .01, value: 1 },
    { id: 'normal', label: 'normal 강도', min: 0, max: 10, step: .1, value: 5 },
    { id: 'power', label: '직접광 세기', min: 0, max: 8, step: .1, value: 4 },
    { id: 'ambient', label: '상수 ambient', min: 0, max: 1, step: .01, value: .15 },
    { id: 'env', label: '환경맵 반사 세기', min: 0, max: 3, step: .1, value: 1.5 },
  ]);

  const cam = D.orbit(cv, { dist: 3.7, pitch: .15 });
  document.querySelector('#reset').onclick = () => { cam.dist = 3.7; cam.yaw = 0; cam.pitch = .15; };
  const view = D.M4.create(), proj = D.M4.create(), vp = D.M4.create();
  document.querySelector('#note').textContent =
    'TODO 1~5 적용: sRGB 색 텍스처 · GGX/Smith/Schlick PBR · ARM 맵 · 접선 공간 법선 · 환경 반사. '
    + '환경맵을 0으로, ambient를 0으로 두면 직접광만 남아 D·F·G 의 효과를 비교할 수 있습니다.';

  let visible = true;
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(cv);
  D.loop(() => {
    if (!visible || document.hidden) return;
    D.fit(cv);
    gl.viewport(0, 0, cv.width, cv.height);
    D.clearColor(gl);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const eye = cam.eye([0, 0, 0]);
    D.M4.lookAt(view, eye, [0, 0, 0], [0, 1, 0]);
    D.M4.perspective(proj, Math.PI / 4, cv.width / cv.height, .1, 100);
    D.M4.multiply(vp, proj, view);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(U.uVP, false, vp);
    gl.uniform3fv(U.uEye, eye);
    gl.uniform3fv(U.uLight, [.6, .7, 1.]);
    gl.uniform3fv(U.uTint, [1, 1, 1]);
    for (const [key, value] of Object.entries({
      uRough: S.rough, uMetal: S.metal, uNormalStrength: S.normal,
      uPower: S.power, uAmbient: S.ambient, uEnvPower: S.env,
    })) gl.uniform1f(U[key], value);
    [...textures[S.material], envTex].forEach((tex, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(U[['uColor', 'uNormal', 'uARM', 'uEnv'][i]], i);
    });
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  });
})();
