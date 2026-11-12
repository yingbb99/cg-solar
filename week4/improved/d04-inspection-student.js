/* 4주차 과제: 기본 트랙볼 뷰어를 "관찰 인터페이스"로 개선한 구현
 *
 * 개선 내용
 *   · P1~P6 표지 관찰: 버튼 또는 키 1~6 → 표지 정면으로 카메라 자동 정렬(법선 방향 + 거리 자동)
 *   · O1·O2 직교 비교: 전면/측면 두 뷰를 한 화면에 나란히, 두 뷰가 같은 축척(halfHeight)을 공유
 *   · 숨은 벽: 뒤쪽 벽·천장·난간·칸막이를 숨겨 내부를 관찰
 *   · 전체 보기: 언제든 개요로 복귀(Home / Esc)
 *   · 읽기 확인 체크리스트: 표지 6건의 판독 결과를 화면에서 바로 확인
 */
(() => {
  'use strict';
  const V = window.InspectionViewer;
  if (!V) return;
  const { model, controls, hidden, canvas } = V;

  const state = { mode: 'overview', poi: null, compare: null, zoom: 1, wallsHidden: false };

  /* ── 벽/천장/난간/칸막이 id ───────────────────────────────────────────── */
  const WALL_IDS = model.boxes
    .filter((b) => /^(back-|partition-|roof-|rail-)/.test(b.id))
    .map((b) => b.id);

  function setWallsHidden(on) {
    state.wallsHidden = on;
    wallsButton.textContent = on ? '벽·천장 숨김 ON' : '벽·천장 숨기기';
    wallsButton.classList.toggle('on', on);
    updateVisibility();
  }

  /* 비교 모드에서는 비교 대상만 남기고 나머지 구조물·표지를 숨겨
     두 뷰의 차이가 대상 물체에만 집중되게 한다. */
  const compareHidden = new Set();
  function updateVisibility() {
    for (const id of compareHidden) hidden.delete(id);
    compareHidden.clear();
    for (const id of WALL_IDS) hidden.delete(id);

    const keep = state.mode === 'compare'
      ? (state.compare === 'both' ? ['comparison-front', 'comparison-side']
        : [state.compare === 'O1' ? 'comparison-front' : 'comparison-side'])
      : null;
    if (keep) {
      for (const b of model.boxes) if (!keep.includes(b.group)) { hidden.add(b.id); compareHidden.add(b.id); }
      for (const s of model.signs) if (!keep.includes(s.group)) { hidden.add(s.id); compareHidden.add(s.id); }
    } else if (state.wallsHidden) {
      for (const id of WALL_IDS) hidden.add(id);
    }
  }

  /* ── 표지 정면 정렬 ───────────────────────────────────────────────────── */
  function normalOf(yaw) { return [Math.sin(yaw), 0, Math.cos(yaw)]; }
  function quatFromTo(a, b) {
    const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const q = [cross[0], cross[1], cross[2], 1 + (a[0] * b[0] + a[1] * b[1] + a[2] * b[2])];
    const n = Math.hypot(...q) || 1;
    return q.map((v) => v / n);
  }
  function focusSign(sign) {
    if (!sign) return;
    state.mode = 'poi';
    state.poi = sign.id;
    const n = normalOf(sign.yaw);
    const need = Math.max(sign.size[0], sign.size[1]);
    controls.state.target = [...sign.position];
    controls.state.distance = Math.max(0.9, need * 2.2);
    controls.state.rotation = quatFromTo([0, 0, 1], n);
    controls.state.fov = 45;
    updateVisibility();
    refresh();
  }

  /* ── 직교 비교 뷰: 두 뷰가 같은 halfHeight 를 쓴다 ───────────────────── */
  function groupBounds(group) {
    const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    for (const b of model.boxes.filter((q) => q.group === group)) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], b.position[i] - b.size[i] / 2);
        max[i] = Math.max(max[i], b.position[i] + b.size[i] / 2);
      }
    }
    return { min, max };
  }
  const COMPARE = {
    O1: { name: '전면 직교 (O1)', group: 'comparison-front', dir: [0, 0, 1], hAxis: 0, vAxis: 1 },
    O2: { name: '측면 직교 (O2)', group: 'comparison-side', dir: [1, 0, 0], hAxis: 2, vAxis: 1 },
  };
  function sharedHalfHeight(aspectEach) {
    let need = 0;
    for (const key of ['O1', 'O2']) {
      const c = COMPARE[key], b = groupBounds(c.group);
      const halfH = (b.max[c.vAxis] - b.min[c.vAxis]) / 2;
      const halfW = (b.max[c.hAxis] - b.min[c.hAxis]) / 2;
      need = Math.max(need, halfH * 1.7, (halfW * 1.7) / aspectEach);
    }
    return need / state.zoom;
  }
  function compareCamera(key, halfHeight) {
    const c = COMPARE[key], b = groupBounds(c.group);
    const center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const far = 60;
    return {
      eye: [center[0] + c.dir[0] * far, center[1] + c.dir[1] * far, center[2] + c.dir[2] * far],
      target: center, up: [0, 1, 0], orthographic: true, halfHeight, near: 0.02, far: 200,
    };
  }

  /* ── 라벨 오버레이와 렌더 콜백 ───────────────────────────────────────── */
  const labels = document.createElement('div');
  labels.className = 'view-labels';
  canvas.parentElement.appendChild(labels);

  function clearAll() {
    const gl = V.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, V.canvas.width, V.canvas.height);
    gl.clearColor(0.06, 0.075, 0.10, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
  /* 두 뷰가 같은 축척임을 화면에서 증명하는 1m 기준선.
     halfHeight(화면 세로 절반이 담는 미터)로부터 1m 당 픽셀 수를 구해 같은 길이로 그린다. */
  function scaleBars(half, ch, halfHeight) {
    const gl = V.gl, pxPerMeter = (ch / 2) / halfHeight;
    for (let i = 0; i < 2; i++) {
      const x0 = i * half + 26;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x0, 28, Math.round(pxPerMeter), 6);
      gl.clearColor(0.95, 0.80, 0.35, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.scissor(x0, 26, 2, 10);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.scissor(x0 + Math.round(pxPerMeter) - 2, 26, 2, 10);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);
    }
  }

  V.render = (v) => {
    const cw = v.canvas.width, ch = v.canvas.height;
    clearAll();
    if (state.mode === 'compare') {
      const keys = state.compare === 'both' ? ['O1', 'O2'] : [state.compare];
      const half = Math.floor(cw / keys.length);
      const aspectEach = half / ch;
      const hh = sharedHalfHeight(aspectEach);
      keys.forEach((key, i) => v.drawView(compareCamera(key, hh), [i * half, 0, half, ch]));
      scaleBars(half, ch, hh);
      labels.innerHTML = keys.map((key, i) =>
        `<span style="left:${(i * 100 / keys.length).toFixed(2)}%;width:${(100 / keys.length).toFixed(2)}%">`
        + `${COMPARE[key].name} · 공통 축척 halfHeight ${hh.toFixed(2)} m · 1 m 기준선</span>`).join('');
    } else {
      v.drawView(controls.camera());
      labels.innerHTML = state.mode === 'poi'
        ? `<span style="left:0;width:100%">${state.poi} 정면 관찰 · 거리 ${controls.state.distance.toFixed(2)} m`
          + `${state.wallsHidden ? ' · 벽 숨김' : ''}</span>`
        : '';
    }
  };

  /* ── UI ──────────────────────────────────────────────────────────────── */
  const ui = document.querySelector('#student-ui');
  ui.innerHTML = `
    <style>
      .w4 h2{font-size:.92rem;margin:14px 0 6px}
      .w4 .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
      .w4 button{padding:6px 4px;font-size:11px;cursor:pointer;border:1px solid #c8d2dc;background:#fff;border-radius:6px}
      .w4 button.on{background:#123c5a;color:#fff;border-color:#123c5a}
      .w4 button.sel{background:#ffd28a;border-color:#c99b3e}
      .w4 .row{display:flex;gap:6px;margin:6px 0}
      .w4 .row button{flex:1}
      .w4 label.z{display:block;font-size:12px;margin-top:8px}
      .view-labels{position:absolute;inset:0;pointer-events:none;font:11px/1.5 monospace;color:#fff}
      .view-labels span{position:absolute;top:0;padding:6px 8px;background:rgba(8,12,18,.65);box-sizing:border-box}
    </style>
    <div class="w4">
      <h2>관찰 대상 (P1~P6)</h2>
      <div class="grid" id="poi"></div>
      <h2>직교 비교 (공통 축척)</h2>
      <div class="row"><button data-cmp="O1">전면 O1</button><button data-cmp="O2">측면 O2</button><button data-cmp="both">둘 다</button></div>
      <h2>보조</h2>
      <div class="row"><button id="walls">벽·천장 숨기기</button><button id="overview">전체 보기</button></div>
      <label class="z">직교 뷰 확대 <span id="zoomval">1.00×</span>
        <input id="zoom" type="range" min="0.5" max="2.5" step="0.05" value="1" style="width:100%"></label>
      <h2>읽기 확인</h2>
      <div id="checks" style="font-size:12px"></div>
    </div>`;
  const wallsButton = ui.querySelector('#walls');
  const poiBox = ui.querySelector('#poi');
  for (const p of model.poi) {
    const b = document.createElement('button');
    b.textContent = `${p.id}·${p.name}`;
    b.dataset.poi = p.id;
    b.onclick = () => focusSign(model.signs.find((s) => s.id === p.id));
    poiBox.appendChild(b);
  }
  ui.querySelectorAll('[data-cmp]').forEach((b) => {
    b.onclick = () => { state.mode = 'compare'; state.compare = b.dataset.cmp; updateVisibility(); refresh(); };
  });
  wallsButton.onclick = () => setWallsHidden(!state.wallsHidden);
  ui.querySelector('#overview').onclick = () => goOverview();
  const zoomInput = ui.querySelector('#zoom'), zoomVal = ui.querySelector('#zoomval');
  zoomInput.addEventListener('input', () => {
    state.zoom = Number(zoomInput.value);
    zoomVal.textContent = state.zoom.toFixed(2) + '×';
  });

  function goOverview() {
    state.mode = 'overview'; state.poi = null; state.compare = null;
    controls.home();
    updateVisibility();
    refresh();
  }
  function refresh() {
    ui.querySelectorAll('[data-poi]').forEach((b) => b.classList.toggle('sel', b.dataset.poi === state.poi));
    ui.querySelectorAll('[data-cmp]').forEach((b) => {
      b.classList.toggle('sel', state.compare ? (b.dataset.cmp === state.compare) : false);
    });
    ui.querySelector('#overview').classList.toggle('on', state.mode === 'overview');
  }

  const checks = ui.querySelector('#checks');
  for (const p of model.poi) {
    const row = document.createElement('label');
    row.style.display = 'block';
    row.style.margin = '3px 0';
    row.innerHTML = `<input type="checkbox" data-check="${p.id}"> ${p.id} ${p.name}`;
    checks.appendChild(row);
  }
  checks.addEventListener('change', (e) => {
    if (e.target.matches('[data-check]')) e.target.parentElement.style.color = e.target.checked ? '#1c6b2f' : '';
  });

  window.addEventListener('keydown', (e) => {
    const idx = Number(e.key);
    if (idx >= 1 && idx <= model.poi.length) {
      focusSign(model.signs.find((s) => s.id === model.poi[idx - 1].id));
      return;
    }
    if (e.key === 'o' || e.key === 'O') { state.mode = 'compare'; state.compare = 'O1'; updateVisibility(); refresh(); }
    if (e.key === 'p' || e.key === 'P') { state.mode = 'compare'; state.compare = 'O2'; updateVisibility(); refresh(); }
    if (e.key === 'b' || e.key === 'B') { state.mode = 'compare'; state.compare = 'both'; updateVisibility(); refresh(); }
    if (e.key === 'w' || e.key === 'W') setWallsHidden(!state.wallsHidden);
    if (e.key === 'Escape') goOverview();
  });
  updateVisibility();
  refresh();
})();
