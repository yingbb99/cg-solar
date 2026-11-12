/* ------------------------------------------------------------------
   camera.js — 카메라 모드와 투영
   · free  : 원근, 자유 회전(트랙볼)
   · track : 원근, 선택한 천체를 중심으로 회전
   · front : 전면 직교 (+z → -z, up = +y) — 정렬·높이 비교용
   · side  : 오른쪽 측면 직교 (+x → -x, up = +y) — 돌출 비교용
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';
  const M4 = global.CG.M4;
  const DEG = Math.PI / 180;

  function createCamera(canvas) {
    const cam = {
      yaw: 0.6, pitch: 0.42, dist: 34,
      minDist: 0.4, maxDist: 900,
      target: [0, 0, 0],
      mode: 'free',
      fov: 45,
      dragging: false,
      lastX: 0, lastY: 0,
      panning: false,
    };

    function eye() {
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      return [
        cam.target[0] + cam.dist * cp * Math.sin(cam.yaw),
        cam.target[1] + cam.dist * sp,
        cam.target[2] + cam.dist * cp * Math.cos(cam.yaw),
      ];
    }

    function view() {
      let up = [0, 1, 0];
      let e;
      if (cam.mode === 'front') e = [cam.target[0], cam.target[1], cam.target[2] + cam.dist];
      else if (cam.mode === 'side') e = [cam.target[0] + cam.dist, cam.target[1], cam.target[2]];
      else e = eye();
      return M4.lookAt(e, cam.target, up);
    }

    function proj(aspect) {
      if (cam.mode === 'front' || cam.mode === 'side') {
        const h = cam.dist * 0.62;
        const w = h * aspect;
        return M4.ortho(-w, w, -h, h, -cam.dist * 8, cam.dist * 8);
      }
      return M4.perspective(cam.fov, aspect, Math.max(cam.dist * 0.004, 0.01), cam.dist * 60 + 4000);
    }

    /* ---- 입력 ---- */
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      cam.dragging = true;
      cam.panning = e.shiftKey || e.button === 2 || e.button === 1;
      cam.lastX = e.clientX; cam.lastY = e.clientY;
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!cam.dragging) return;
      const dx = e.clientX - cam.lastX, dy = e.clientY - cam.lastY;
      cam.lastX = e.clientX; cam.lastY = e.clientY;
      if (cam.panning) {
        // 화면 기준 오른쪽·위쪽으로 관찰 중심을 옮긴다
        const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
        const up = [0, 1, 0];
        const k = cam.dist * 0.0016;
        cam.target[0] += (-dx * right[0] + dy * up[0]) * k;
        cam.target[1] += (-dx * right[1] + dy * up[1]) * k;
        cam.target[2] += (-dx * right[2] + dy * up[2]) * k;
        cam.userTarget = true;
      } else {
        cam.yaw -= dx * 0.0055;
        cam.pitch = Math.min(Math.max(cam.pitch + dy * 0.0045, -1.55), 1.55);
      }
    });
    const endDrag = (e) => {
      cam.dragging = false;
      canvas.classList.remove('dragging');
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.dist = Math.min(Math.max(cam.dist * Math.exp(e.deltaY * 0.0011), cam.minDist), cam.maxDist);
    }, { passive: false });

    /** 선택한 천체로 카메라를 붙인다 */
    function focus(pos, radius) {
      cam.target = pos.slice();
      cam.dist = Math.max(radius * 6.5, 0.35);
      cam.minDist = radius * 1.6;
      cam.maxDist = Math.max(radius * 400, 40);
    }
    return {
      cam, eye, view, proj, focus,
      setMode(m) { cam.mode = m; },
      setTarget(p) { cam.target = p.slice(); },
    };
  }

  global.CG = global.CG || {};
  global.CG.createCamera = createCamera;
})(window);
