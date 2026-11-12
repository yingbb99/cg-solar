# 5주차 보고서 — Phong 조명과 세 가지 광원

## 목표
빛이 없어 납작하게 보이던 장면(강의 `w5-start.html`)에 조명을 넣는다.
확산·환경·정반사·감쇠를 단계별로 적용하고, 점광원·방향광·집광을 각각 구현한다.

## 파일
`week5/task1.html`, `week5/task1.js`

## 구현
* **셰이더**: `pointLight`, `directionalLight`, `spotLight` 세 함수를 각각 두고
  `uLightMask` 비트로 켜고 끈다(키 4/5/6).
  * 점광원: 태양 위치, `att = 1.55/(1+0.10 d²)` — 거리 감쇠 있음.
  * 방향광: `L = normalize(-uDirLight)`, 감쇠 없음 — 평행광.
  * 집광: `smoothstep(0.86, 0.95, dot(-L, uSpotDir))` 로 약 30° 원뿔, 감쇠 동시 적용.
* **정반사**: Phong `reflect(-L,N)·V` 의 `uShininess` 승.
* **법선 행렬**: `transpose(inverse(model))` 를 CPU 에서 계산해 넘긴다(비균일 축척에서도 유지).
* **자체발광**: 태양은 조명 계산을 건너뛰고 `uEmissive` 분기에서 rim 만 더해 스스로 밝다.
* **재질 1/2/3**: 바위(14, 0.25) / 금속(96, 0.95) / 얼음(48, 0.55) — shininess 와 specular 세기.

## 확인
`week5/images/material-rock.png`, `material-metal.png`.
금속에서 하이라이트가 작고 밝게 맺히고, 바위에서는 넓게 퍼진다.
키 4 로 점광원을 끄면 태양 쪽 음영이 사라지고 방향광·집광만 남는다.

## 해석
세 광원을 모두 켜면 광원마다 그림자 유무가 달라 장면이 평평해 보이므로,
8주 통합본에서는 태양을 주광, 나머지를 보조광으로 낮은 세기로 두었다.
