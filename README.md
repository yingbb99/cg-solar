# 나만의 태양계 — 컴퓨터그래픽스 개인 프로젝트

한 페이지(`index.html`)를 8주에 걸쳐 키워 온 개인 프로젝트입니다.
WebGL2 만 사용하며 외부 3D 라이브러리·빌드 도구가 없습니다.

## 실행 방법

```bash
# 저장소 루트에서
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000/index.html
```

텍스처·스크립트를 `file://` 로 열면 CORS 로 막히므로 반드시 HTTP 서버로 엽니다.
GitHub Pages 에 올리면 `https://<아이디>.github.io/<저장소>/` 로 그대로 동작합니다.

## 저장소 구조

```
index.html                통합 완성본(래스터화 ↔ 광선 추적 전환)
src/
  main.js                 초기화·렌더 루프·UI·HUD
  scene.js                천체 데이터·압축/실제 비율·모델 행렬
  mesh.js                 M4(행렬)·구/회전체/고리 생성·절차적 텍스처
  camera.js               free/track/front/side 카메라
  shaders.js              PBR·Phong·고리·별·광선 추적 셰이더
assets/                   (외부 이미지 없음 — 텍스처는 코드 생성)
docs/verify.md            주차별 검증 절차와 결과
week2/  week3/  week4/  week5/  week6/  week7/   주차별 과제와 보고서
images/                   대표 화면
```

`src/*.js` 는 클래식 스크립트 + `window.CG` 네임스페이스입니다(ES 모듈의 `file://` 문제 회피).

## 주차별 요약

| 주 | 주제 | 산출물 | 보고서 |
|---|---|---|---|
| 2 | 4×4 변환·순서·실제 비율·위성 변환 | `week2/{order,scale,satellite}.html` | `week2/week2.md` |
| 3 | 정점/인덱스·행렬 카메라·보간·확산광·절차적 텍스처 | `week3/task1.html`(떠 있는 공+바닥), `week3/task2.html`(살아 있는 행성) | `week2`·`week3/week3.md` |
| 4 | 관찰 인터페이스 개선 | `week4/baseline`(원본), `week4/improved`(개선판) | `week4/week4.md` |
| 5 | Phong·세 가지 광원·법선 행렬·자체발광 | `week5/task1.html` | `week5/week5.md` |
| 6 | PBR(D·F·G)·UV·밀맵·ARM·법선·환경 반사 | `week6/task1.html`, `week6/task2.html` | `week6/week6.md` |
| 7 | 광선 추적 식 관측기·기기별 성능 프로파일 | `week7/task1.html`, `week7/task2.html` | `week7/week7.md` |
| 8 | 통합 완성본 + 래스터화 ↔ 광선 추적 전환 | `index.html` | `docs/verify.md` |

이번 주(11주차) 개인 점검 범위는 1~7주차이고, `index.html` 이 8주 통합 완성본입니다.

## 통합 완성본 조작

| 입력 | 동작 |
|---|---|
| 모드 버튼 | ① 래스터화 ② Ray tracing(화면 전체 광선 추적) ③ 식 관측기 |
| 카메라 | free / track(행성 추적) / front(정면 직교) / side(측면 직교) |
| `0`~`9` | 태양·수성·금성·지구·달·ISS·화성·목성·이오·토성·천왕성·해왕성 순 선택 |
| `R` / `E` / `P` / `Space` | 광선 추적 전환 / 식 관측기 / 재질(PBR↔Phong) / 일시정지 |
| 슬라이더 | 렌더 해상도, 광선 표본(1~4), 궤도선·별 배경·그림자·거울 반사 |

식 관측기에서는 위성 공전 0~360° 슬라이더로 0°(일식)·180°(월식)을 재현하고,
그림자 광선을 꺼서 두 식의 차이를 비교할 수 있습니다.

## 구현상 중요한 결정

* **비율 두 가지**: 압축 비율 `dist = 7 + 6.6·au^0.62`, `planetR = 0.75·rE^0.5`
  / 실제 비율 `1 AU = 10 단위`, `planetR = (3.2/109.2)·rE`. 버튼 하나로 전환합니다.
* **텍스처는 전부 코드 생성**(`Mesh.makePlanetMaps`): value noise fbm 으로 color/ARM/normal 3종을 만들고
  mipmap + anisotropy 를 적용합니다.
* **그림자는 shadow map 이 아니라 셰이더 안 그림자 광선**: 16개 구체에 대해
  `sunVisibility()` 로 가림을 검사합니다(교육용 근사, 비용이 낮다).
* **광선 추적은 화면 전체 경로**: 구체 배열을 uniform 으로 넘기고 픽셀당 1~4 표본,
  PBR 근사·별 배경·거울 반사까지 한 셰이더에서 처리합니다.
* **삼각형 감기 순서**: 구·회전체 모두 바깥에서 볼 때 반시계가 되도록 감아
  BACK 컬링과 법선 방향을 일치시켰습니다(초기 구현에서 내부면이 렌더되어
  조명이 어둡게 나오던 문제를 이 수정으로 해결).

## 외부 리소스

* 6주차 재질 사진: Poly Haven, CC0 (출처 `week6/assets/week06/sources.json`).
* 4·6·7주차 시작 코드: 강의 제공 starter 를 기반으로 수정·확장했습니다
  (`week4/baseline` 은 수정하지 않은 원본입니다).
