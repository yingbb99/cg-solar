# 6주차 보고서 — PBR 과 텍스처

## 실습 1 (`week6/task1.html`) — TODO 1~5
| TODO | 내용 | 구현 |
|---|---|---|
| 1 | 색 텍스처 sRGB→선형 | `srgbToLinear()` (0.04045 기준 piecewise). ARM·노멀에는 적용하지 않음 |
| 2 | 직접광 PBR | D=GGX, G=Smith-Schlick(k=(r+1)²/8), F=Schlick(F0=0.04↔base, 금속이면 base) |
| 3 | ARM 맵 | R=AO, G=roughness, B=metallic. 슬라이더는 배율로 사용 |
| 4 | 접선 공간 법선 | `dFdx/dFdy` 로 T·B 구성, `cross(dpdu,dpdv)` 부호로 화면 뒤집힘 보정 |
| 5 | 환경 반사 | 반사 벡터 → 등장방형 UV, Fresnel 가중, 거칠면 약하게 |

출력은 Reinhard + sRGB 로 감마 보정. 재질 3종(Poly Haven CC0) 전환 가능.

## 실습 2 (`week6/task2.html`) — 나의 행성
* UV 구(40×56)에 코드 생성 512×256 맵(color/ARM/normal)을 입혔다(외부 이미지 없음).
* **마스크 ①(위도 조건)**: `|N.y| ≥ uIceLat` 인 극지방을 얼음으로.
  색만 바꾸는 것이 아니라 roughness 0.18, metallic 0 으로 **재질 자체**를 바꾼다.
* **마스크 ②(태양 조건)**: `dot(N,L) < 0` 인 밤면 + 육지(`c.g > c.b`)에만 도시 불빛(발광).
  해시 격자 + 원형 감쇠로 점광을 만든다.
* 마스크를 끄면 같은 행성이 균일 재질로 보여 차이가 분명해진다.

## 확인
`week6/images/task1-metal.png`, `task1-wood.png`, `task2-day.png`, `task2-night.png`.
태양 방위 35°→200° 로 돌리면 낮/밤 경계가 이동하며 도시 불빛이 켜지고 꺼진다.
