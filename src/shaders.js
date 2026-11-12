/* ------------------------------------------------------------------
   shaders.js — 모든 GLSL 소스
   · planetVS/FS : 래스터화 경로 (Phong / PBR 겸용, 텍스처·법선맵·ARM·그림자 광선)
   · ringVS/FS   : 반투명 고리 (알파 블렌딩, 양면)
   · lineVS/FS   : 궤도선
   · skyVS/FS    : 별 배경 (카메라 광선 방향으로 절차적 별)
   · rayVS/FS    : 화면 사각형 하나로 장면 전체를 광선 추적 (식 관측기)
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  /* =============== 래스터화: 행성 =============== */

  const planetVS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aTangent;

uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormalMat;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec3 vTangent;
out vec3 vLocal;

void main(){
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld   = world.xyz;
  vNormal  = uNormalMat * aNormal;    // 법선 행렬(역전치) — 비균등 스케일에서도 수직 유지
  vTangent = mat3(uModel) * aTangent;
  vUV      = aUV;
  vLocal   = aPos;
  gl_Position = uProj * uView * world;
}`;

  const planetFS = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
in vec3 vTangent;
in vec3 vLocal;

uniform vec3  uCamPos;
uniform vec3  uTint;
uniform float uRough;
uniform float uMetal;
uniform float uNormalStrength;
uniform float uEmissive;
uniform vec3  uEmissiveColor;

uniform sampler2D uColorMap;
uniform sampler2D uARMMap;
uniform sampler2D uNormalMap;

uniform vec3  uSunPos;
uniform vec3  uSunColor;
uniform float uSunPower;
uniform vec3  uStarDir;      // directional 광원이 향하는 방향
uniform vec3  uStarColor;
uniform vec3  uSpotPos;
uniform vec3  uSpotDir;
uniform vec3  uSpotColor;
uniform float uSpotCosIn;
uniform float uSpotCosOut;
uniform float uSpotOn;

uniform int   uUsePBR;
uniform int   uShadow;
uniform int   uShadowCount;
uniform vec4  uOccluders[16];   // xyz = 중심, w = 반지름 (태양 포함)
uniform int   uBodyId;
uniform float uTime;
uniform int   uEnvOn;
uniform int   uDebug;        // 1: 알베도만, 2: 법선만 (검증용)

out vec4 outColor;

const float PI = 3.141592653589793;

float hash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

/* 절차적 환경(하늘) 색 — 금속 반사에 쓸 환경맵 근사 */
vec3 envColor(vec3 d){
  float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 ground = vec3(0.045, 0.05, 0.07);
  vec3 sky    = vec3(0.10, 0.16, 0.30);
  vec3 c = mix(ground, sky, smoothstep(0.0, 0.75, t));
  // 태양 쪽 밝은 후광
  vec3 sunDir = normalize(uSunPos - vec3(0.0));
  float s = max(dot(d, sunDir), 0.0);
  c += vec3(1.0, 0.85, 0.6) * pow(s, 64.0) * 1.2 * uSunPower * 0.06;
  float band = sin(d.y * 42.0 + d.x * 12.0) * 0.5 + 0.5;
  c += vec3(0.02, 0.03, 0.05) * band;
  return c;
}

/* 태양(point) 그림자: 교차점에서 태양까지 다른 천체가 막는지 검사 */
float sunVisibility(vec3 p, vec3 N, vec3 L, float lightDistance){
  if (uShadow == 0) return 1.0;
  vec3 ro = p + N * 0.008;                 // 자기 표면 재교차(shadow acne) 방지
  float visible = 1.0;
  for (int i = 0; i < 16; i++){
    if (i >= uShadowCount) break;
    if (i == uBodyId || i == 0) continue;    // 자기 자신과 광원(태양)은 가리지 않는다
    vec4 o = uOccluders[i];
    vec3 oc = ro - o.xyz;
    float halfB = dot(oc, L);
    float c = dot(oc, oc) - o.w * o.w;
    float disc = halfB * halfB - c;
    if (disc > 0.0){
      float t = -halfB - sqrt(disc);
      if (t > 0.002 && t < lightDistance - 0.004){ visible = 0.25; break; }
    }
  }
  return visible;
}

vec3 phongDirect(vec3 N, vec3 V, vec3 L, vec3 radiance, vec3 base, float shininess, float ks){
  float nl = max(dot(N, L), 0.0);
  vec3  R  = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), shininess) * ks;
  return (base * nl + radiance * 0.0 + spec * radiance) * 0.9;
}

/* 미세면 BRDF: D(분포) · G(가림) · F(Fresnel) */
vec3 pbrDirect(vec3 N, vec3 V, vec3 L, vec3 radiance, vec3 base, float rough, float metal){
  vec3  H  = normalize(V + L);
  float nl = max(dot(N, L), 0.0);
  float nv = max(dot(N, V), 1e-4);
  float nh = max(dot(N, H), 0.0);
  float vh = max(dot(V, H), 0.0);

  float a  = rough * rough;
  float a2 = a * a;
  float den = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / max(PI * den * den, 1e-6);          // 미세면 법선 분포

  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));  // 가림

  vec3 F0 = mix(vec3(0.04), base, metal);
  vec3 F  = F0 + (1.0 - F0) * pow(1.0 - vh, 5.0);    // Fresnel

  vec3 kd = (1.0 - F) * (1.0 - metal);
  return (kd * base / PI + D * G * F / max(4.0 * nl * nv, 1e-4)) * nl * radiance;
}

void main(){
  vec3 base = pow(texture(uColorMap, vUV).rgb, vec3(2.2)) * uTint;  // sRGB → 선형
  vec3 arm  = texture(uARMMap, vUV).rgb;                            // 수치 데이터, 선형 유지
  float ao  = arm.r;
  float rough = clamp(arm.g * (uRough / 0.5), 0.045, 1.0);
  float metal = clamp(arm.b * uMetal * 2.0, 0.0, 1.0);

  vec3 N = normalize(vNormal);
  vec3 T = normalize(vTangent - N * dot(N, vTangent));
  vec3 B = cross(N, T);
  vec3 nm = texture(uNormalMap, vUV).xyz * 2.0 - 1.0;
  nm.xy *= uNormalStrength;
  if (uNormalStrength > 0.0) N = normalize(mat3(T, B, N) * nm);

  vec3 V = normalize(uCamPos - vWorld);

  if (uDebug == 1){ outColor = vec4(pow(base, vec3(1.0 / 2.2)), 1.0); return; }
  if (uDebug == 2){ outColor = vec4(N * 0.5 + 0.5, 1.0); return; }

  if (uEmissive > 0.5){                       // 태양은 조명 계산을 하지 않는다(자체발광)
    vec3 surf = pow(texture(uColorMap, vUV).rgb, vec3(2.2));
    vec3 e = uEmissiveColor * (0.10 + 1.85 * surf) * (1.0 + 0.05 * sin(uTime * 2.3));
    float limb = pow(max(dot(normalize(vNormal), normalize(uCamPos - vWorld)), 0.0), 0.55);
    e *= mix(0.45, 1.0, limb);                // 주연 감광
    e = e / (e + vec3(1.0));                  // 톤 매핑
    outColor = vec4(pow(e, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  vec3 color = vec3(0.0);
  vec3 ambient = vec3(0.055, 0.065, 0.09) * base * ao;   // 간접광 근사 (한 번만)
  color += ambient;

  /* --- 광원 1: 태양 (point) --- */
  vec3  toSun = uSunPos - vWorld;
  float sunDist = length(toSun);
  vec3  Ls = toSun / max(sunDist, 1e-4);
  float att = 1.0 / (1.0 + 0.0025 * sunDist * sunDist);
  float vis = sunVisibility(vWorld, N, Ls, sunDist);
  vec3 sunRad = uSunColor * uSunPower * att;

  if (uDebug == 13){                          // 광원 방향 Ls 를 색으로
    outColor = vec4(Ls * 0.5 + 0.5, 1.0);
    return;
  }
  if (uDebug == 12){                          // N·L 을 색으로 부호화
    outColor = vec4(max(dot(N, Ls), 0.0), max(-dot(N, Ls), 0.0), 0.5, 1.0);
    return;
  }
  if (uDebug == 10){                          // 순수 Lambert
    outColor = vec4(pow(base * max(dot(N, Ls), 0.0) * 1.6, vec3(1.0 / 2.2)), 1.0);
    return;
  }
  if (uDebug == 11){                          // 스페큘러만
    vec3 H = normalize(V + Ls);
    float a = rough * rough, a2 = a * a;
    float nh = max(dot(N, H), 0.0);
    float den = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / max(PI * den * den, 1e-6);
    vec3 c = vec3(D * 0.04);
    outColor = vec4(pow(c / (c + vec3(1.0)), vec3(1.0 / 2.2)), 1.0);
    return;
  }
  if (uDebug >= 3 && uDebug <= 6){
    vec3 c = vec3(0.0);
    if (uDebug == 3) c = pbrDirect(N, V, Ls, sunRad, base, rough, metal) * vis;
    if (uDebug == 4) c = vec3(vis);
    if (uDebug == 5) c = vec3(rough, metal, ao);
    if (uDebug == 6) c = pbrDirect(N, V, Ls, sunRad, base, rough, metal);
    outColor = vec4(pow(c / (c + vec3(1.0)), vec3(1.0 / 2.2)), 1.0);
    return;
  }

  /* --- 광원 2: 먼 항성 (directional) --- */
  vec3 Ld = normalize(-uStarDir);

  /* --- 광원 3: 탐사선 서치라이트 (spot) --- */
  vec3 Lp = vec3(0.0);
  float spotMask = 0.0;
  if (uSpotOn > 0.5){
    vec3 toSpot = uSpotPos - vWorld;
    float sd = length(toSpot);
    Lp = toSpot / max(sd, 1e-4);
    float cosA = dot(normalize(-Lp), normalize(uSpotDir));
    spotMask = smoothstep(uSpotCosOut, uSpotCosIn, cosA) *
               (1.0 / (1.0 + 0.7 * sd * sd));
  }

  if (uUsePBR == 1){
    color += pbrDirect(N, V, Ls, sunRad, base, rough, metal) * vis;
    color += pbrDirect(N, V, Ld, uStarColor, base, rough, metal);
    if (uSpotOn > 0.5) color += pbrDirect(N, V, Lp, uSpotColor * spotMask, base, rough, metal);

    if (uEnvOn == 1){                          // 환경 반사(금속이 하늘을 비춘다)
      vec3 Rv = reflect(-V, N);
      vec3 env = envColor(Rv);
      vec3 F0 = mix(vec3(0.04), base, metal);
      vec3 Fe = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      color += env * Fe * (1.0 - rough * 0.65) * 0.85;
    }
    float nv = max(dot(N, V), 0.0);
    color += vec3(0.9, 0.95, 1.0) * pow(1.0 - nv, 3.0) * 0.10 * ao;  // 대기 산란 근사
  } else {
    float shin = 16.0 + 48.0 * (1.0 - rough);
    color += phongDirect(N, V, Ls, sunRad, base, shin, 0.35) * vis;
    color += phongDirect(N, V, Ld, uStarColor, base, shin, 0.25);
    if (uSpotOn > 0.5) color += phongDirect(N, V, Lp, uSpotColor * spotMask, base, shin, 0.4);
  }

  /* 밤면 도시 불빛 (지구) */
  if (uBodyId == 3 && dot(N, Ls) <= 0.0){
    float g = hash(floor(vLocal * 70.0));
    float lights = smoothstep(0.955, 0.975, g);
    float night = 1.0 - smoothstep(-0.01, 0.28, dot(N, Ls));   // 종결선에서 서서히 사라짐
    color += vec3(1.0, 0.72, 0.28) * lights * night * 0.55;
  }

  /* 노출 → 톤 매핑 → sRGB 출력 */
  color *= 1.15;
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));
  outColor = vec4(color, 1.0);
}`;

  /* =============== 래스터화: 고리 =============== */

  const ringVS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
out vec3 vWorld;
out vec2 vUV;
out vec3 vNormal;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vUV = aUV;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uProj * uView * w;
}`;

  const ringFS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec2 vUV;
in vec3 vNormal;
uniform vec3  uCamPos;
uniform vec3  uSunPos;
uniform vec3  uSunColor;
uniform float uSunPower;
uniform float uTime;
uniform int   uShadow;
uniform int   uShadowCount;
uniform vec4  uOccluders[16];
uniform int   uBodyId;
uniform vec3  uRingColor;
out vec4 outColor;

float hash(float n){ return fract(sin(n) * 43758.5453123); }

void main(){
  /* 고리 밀도: 방사 방향(vUV.y)으로 만든 여러 겹의 띠 + 틈(Cassini division) */
  float r = vUV.y;
  float bands = 0.55 + 0.45 * sin(r * 46.0) * sin(r * 13.0 + 1.7);
  bands = clamp(bands, 0.0, 1.0);
  float gap = smoothstep(0.62, 0.64, r) - smoothstep(0.68, 0.70, r);
  float density = bands * (1.0 - gap * 0.9);
  density *= smoothstep(0.0, 0.04, r) * (1.0 - smoothstep(0.94, 1.0, r));
  float alpha = density * 0.72;
  if (alpha < 0.02) discard;

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  if (dot(N, V) < 0.0) N = -N;                  // 양면 관찰
  vec3 toSun = uSunPos - vWorld;
  float dist = length(toSun);
  vec3 L = toSun / max(dist, 1e-4);

  float vis = 1.0;
  if (uShadow == 1){
    vec3 p = vWorld;
    for (int i = 0; i < 16; i++){
      if (i >= uShadowCount) break;
      if (i == uBodyId || i == 0) continue;
      vec4 o = uOccluders[i];
      vec3 oc = p - o.xyz;
      float halfB = dot(oc, L);
      float c = dot(oc, oc) - o.w * o.w;
      float disc = halfB * halfB - c;
      if (disc > 0.0){
        float t = -halfB - sqrt(disc);
        if (t > 0.002 && t < dist - 0.004){ vis = 0.15; break; }
      }
    }
  }
  float nl = abs(dot(N, L));                  // 얇은 원판은 양면에서 빛을 받는다
  float att = 1.0 / (1.0 + 0.0025 * dist * dist);
  float phase = 0.55 + 0.45 * nl;             // 앞산란 근사
  vec3 col = uRingColor * (0.12 + 1.05 * phase * vis * uSunPower * att);
  col = col / (col + vec3(1.0));
  outColor = vec4(pow(col, vec3(1.0 / 2.2)), alpha);
}`;

  /* =============== 궤도선 =============== */

  const lineVS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform float uOpacity;
out float vFade;
void main(){
  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
  vFade = uOpacity;
}`;

  const lineFS = `#version 300 es
precision highp float;
in float vFade;
uniform vec3 uColor;
out vec4 outColor;
void main(){ outColor = vec4(uColor, vFade); }`;

  /* =============== 별 배경 =============== */

  const skyVS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vNdc;
void main(){ vNdc = aPos; gl_Position = vec4(aPos, 1.0, 1.0); }`;

  const skyFS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
uniform float uTime;
out vec4 outColor;

float hash13(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main(){
  vec4 un = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(un.xyz / un.w - uCamPos);

  /* 성진(은하수) 띠 + 별: 방향을 격자로 나눠 칸마다 별 하나를 찍는다 */
  vec3 bandN = normalize(vec3(0.4, 0.55, -0.72));
  float band = exp(-pow(dot(dir, bandN), 2.0) * 18.0);
  vec3 p1 = dir * 230.0;
  vec3 f1 = fract(p1) - 0.5;
  float s1 = smoothstep(0.30, 0.0, length(f1)) * step(0.978, hash13(floor(p1)));
  vec3 p2 = dir * 640.0 + 3.1;
  vec3 f2 = fract(p2) - 0.5;
  float s2 = smoothstep(0.26, 0.0, length(f2)) * step(0.986, hash13(floor(p2)));
  vec3 col = vec3(0.004, 0.006, 0.014);
  col += vec3(0.028, 0.024, 0.052) * band;
  col += vec3(0.95, 0.97, 1.0) * (s1 * 0.9 + s2 * 0.55);
  outColor = vec4(col, 1.0);
}`;

  /* =============== Ray tracing (화면 전체) =============== */

  const rayVS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const rayFS = `#version 300 es
precision highp float;
uniform vec2  uRes;
uniform vec3  uEye;
uniform vec3  uTarget;
uniform float uFov;
uniform int   uBodyCount;
uniform vec4  uBodies[24];     // xyz = 중심, w = 반지름
uniform vec3  uBodyColors[24];
uniform float uBodyRough[24];
uniform float uBodyMetal[24];
uniform int   uShadow;
uniform int   uSpp;
uniform float uTime;
out vec4 outColor;

const float PI = 3.141592653589793;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 cameraRay(vec2 pixel, vec3 eye, vec3 target, float fov, float aspect){
  vec2 uv = (2.0 * pixel - uRes) / uRes.y;      // 화면 중앙이 (0,0), y 기준 정규화
  vec3 forward = normalize(target - eye);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);
  float tanHalf = tan(radians(fov) * 0.5);
  return normalize(forward + uv.x * right * tanHalf + uv.y * up * tanHalf);
}

/* 광선–구 교차: 가장 가까운 양수 t */
float hitSphere(vec3 ro, vec3 rd, vec3 center, float radius){
  vec3 oc = ro - center;
  float a = dot(rd, rd);
  float halfB = dot(oc, rd);
  float c = dot(oc, oc) - radius * radius;
  float disc = halfB * halfB - a * c;
  if (disc < 0.0) return -1.0;
  float root = sqrt(disc);
  float t = (-halfB - root) / a;
  if (t > 0.002) return t;
  t = (-halfB + root) / a;
  return t > 0.002 ? t : -1.0;
}

float traceScene(vec3 ro, vec3 rd, out int id){
  float nearest = 1e20;
  id = -1;
  for (int i = 0; i < 24; i++){
    if (i >= uBodyCount) break;
    float t = hitSphere(ro, rd, uBodies[i].xyz, uBodies[i].w);
    if (t > 0.0 && t < nearest){ nearest = t; id = i; }
  }
  return nearest;
}

/* 표면 무늬 (텍스처 대신 위치 기반 절차 생성) */
vec3 surfaceColor(int id, vec3 p, vec3 n){
  vec3 base = uBodyColors[id];
  if (id == 0) return base;                      // 태양
  float lat = n.y;
  float bands = 0.5 + 0.5 * sin(lat * (5.0 + float(id)) * 2.0 + float(id));
  vec3 c = base * (0.86 + 0.28 * bands);
  if (id == 3){                                  // 지구: 대륙/바다
    float land = 0.5 + 0.5 * sin(p.x * 2.4) * cos(p.z * 1.9 + 0.4);
    c = mix(vec3(0.04, 0.16, 0.38), vec3(0.16, 0.32, 0.14), smoothstep(0.42, 0.62, land)) * 0.9;
  }
  return c;
}

vec3 skyColor(vec3 d){
  vec3 bandN = normalize(vec3(0.4, 0.55, -0.72));
  float band = exp(-pow(dot(d, bandN), 2.0) * 18.0);
  vec3 p1 = d * 230.0;
  vec3 f1 = fract(p1) - 0.5;
  float s1 = smoothstep(0.30, 0.0, length(f1)) * step(0.975, hash13(floor(p1)));
  vec3 col = vec3(0.004, 0.006, 0.014) + vec3(0.028, 0.024, 0.052) * band;
  col += vec3(0.95, 0.97, 1.0) * s1;
  return col;
}

vec3 shadeRay(vec3 ro, vec3 rd, float t, int id){
  vec3 p = ro + t * rd;
  vec3 N = normalize(p - uBodies[id].xyz);
  vec3 base = surfaceColor(id, p, N);
  float rough = uBodyRough[id];
  float metal = uBodyMetal[id];

  /* 태양은 자체발광 */
  if (id == 0) return uBodyColors[0] * 1.55;

  vec3 toSun = uBodies[0].xyz - p;
  float dist = length(toSun);
  vec3 L = toSun / max(dist, 1e-4);

  float visible = 1.0;
  if (uShadow == 1){
    vec3 so = p + N * 0.006;                     // epsilon: 자기 표면 재교차 방지
    int bid;
    float bt = traceScene(so, L, bid);
    if (bid > 0 && bt < dist - 0.004) visible = 0.0;
  }

  vec3 V = normalize(ro - p);
  vec3 H = normalize(V + L);
  float nl = max(dot(N, L), 0.0);
  float nv = max(dot(N, V), 1e-4);
  float nh = max(dot(N, H), 0.0);
  float vh = max(dot(V, H), 0.0);

  float a = rough * rough; float a2 = a * a;
  float den = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / max(PI * den * den, 1e-6);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
  vec3 F0 = mix(vec3(0.04), base, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - vh, 5.0);
  vec3 kd = (1.0 - F) * (1.0 - metal);

  float att = 1.0 / (1.0 + 0.35 * dist * dist);   // 교육용 감쇠
  vec3 radiance = vec3(6.0, 4.8, 3.4) * att * visible;
  vec3 color = (kd * base / PI + D * G * F / max(4.0 * nl * nv, 1e-4)) * nl * radiance;
  color += base * vec3(0.02, 0.025, 0.035);        // 아주 약한 환경광

  /* 지구 밤면 도시 불빛 */
  if (id == 3 && visible < 0.5){
    float g = hash12(floor(p.xz * 700.0));
    color += vec3(1.0, 0.75, 0.3) * smoothstep(0.88, 0.95, g) * 0.35;
  }
  return color;
}

void main(){
  vec3 eye = uEye;
  float aspect = uRes.x / uRes.y;
  vec3 accum = vec3(0.0);
  int spp = uSpp;
  for (int s = 0; s < 4; s++){
    if (s >= spp) break;
    vec2 jitter = spp == 1 ? vec2(0.0) : (vec2(hash12(gl_FragCoord.xy + float(s)),
                                                  hash12(gl_FragCoord.yx + float(s) * 7.0)) - 0.5);
    vec3 rd = cameraRay(gl_FragCoord.xy + jitter, eye, uTarget, uFov, aspect);
    int id;
    float t = traceScene(eye, rd, id);
    if (id < 0){
      accum += skyColor(rd);
    } else {
      accum += shadeRay(eye, rd, t, id);
    }
  }
  vec3 c = accum / float(max(spp, 1));
  c = c / (c + vec3(1.0));                       // Reinhard 톤 매핑
  outColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;

  global.CG = global.CG || {};
  global.CG.SHADERS = {
    planetVS, planetFS, ringVS, ringFS, lineVS, lineFS, skyVS, skyFS, rayVS, rayFS,
  };
})(window);
