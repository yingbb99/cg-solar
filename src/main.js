/* ------------------------------------------------------------------
   main.js — 초기화와 렌더 루프
   · WebGL2 프로그램/버퍼/텍스처 준비
   · 래스터화 경로: 별 배경 → 궤도선 → 천체 → 고리
   · Ray tracing 경로: 화면 사각형 하나로 장면 전체를 광선 추적
   · 식 관측기: 7주차 교육 배치(별—행성—위성)를 ray tracing 으로 그린다
   ------------------------------------------------------------------ */
(function () {
  'use strict';
  const CG = window.CG;
  const SH = CG.SHADERS, M4 = CG.M4, Mesh = CG.Mesh;
  const scene = CG.createScene();

  const canvas = document.getElementById('cv');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true });
  if (!gl) {
    document.body.insertAdjacentHTML('beforeend',
      '<p style="color:#fff;padding:24px;font:14px sans-serif">이 브라우저에서 WebGL2 를 사용할 수 없습니다.</p>');
    return;
  }

  /* ---------------- GL 도우미 ---------------- */
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('셰이더 컴파일 실패:', gl.getShaderInfoLog(s), src.slice(0, 400));
      throw new Error('shader');
    }
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('프로그램 링크 실패:', gl.getProgramInfoLog(p));
      throw new Error('link');
    }
    return p;
  }
  function uniforms(p, names) {
    const u = {};
    names.forEach((n) => {
      const key = n.replace(/\[0\]$/, '');       // 배열 유니폼은 첫 원소 위치로 조회
      u[key] = gl.getUniformLocation(p, n);
    });
    return u;
  }

  const progPlanet = program(SH.planetVS, SH.planetFS);
  const progRing = program(SH.ringVS, SH.ringFS);
  const progLine = program(SH.lineVS, SH.lineFS);
  const progSky = program(SH.skyVS, SH.skyFS);
  const progRay = program(SH.rayVS, SH.rayFS);

  const U = {
    planet: uniforms(progPlanet, [
      'uProj', 'uView', 'uModel', 'uNormalMat', 'uCamPos', 'uTint', 'uRough', 'uMetal',
      'uNormalStrength', 'uEmissive', 'uEmissiveColor', 'uColorMap', 'uARMMap', 'uNormalMap',
      'uSunPos', 'uSunColor', 'uSunPower', 'uStarDir', 'uStarColor',
      'uSpotPos', 'uSpotDir', 'uSpotColor', 'uSpotCosIn', 'uSpotCosOut', 'uSpotOn',
      'uUsePBR', 'uShadow', 'uShadowCount', 'uOccluders[0]', 'uBodyId', 'uTime', 'uEnvOn', 'uDebug',
    ]),
    ring: uniforms(progRing, [
      'uProj', 'uView', 'uModel', 'uCamPos', 'uSunPos', 'uSunColor', 'uSunPower', 'uTime',
      'uShadow', 'uShadowCount', 'uOccluders[0]', 'uBodyId', 'uRingColor',
    ]),
    line: uniforms(progLine, ['uProj', 'uView', 'uModel', 'uColor', 'uOpacity']),
    sky: uniforms(progSky, ['uInvVP', 'uCamPos', 'uTime']),
    ray: uniforms(progRay, [
      'uRes', 'uEye', 'uTarget', 'uFov', 'uBodyCount', 'uBodies[0]', 'uBodyColors[0]',
      'uBodyRough[0]', 'uBodyMetal[0]', 'uShadow', 'uSpp', 'uTime',
    ]),
  };

  /* ---------------- 버퍼 / 메시 ---------------- */
  function makeVao2() {                            // 화면 사각형 (aPos vec2)
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }
  const quadVao = makeVao2();

  const meshPlanet = Mesh.upload(gl, Mesh.createSphere(48, 72));
  const meshMoon = Mesh.upload(gl, Mesh.createSphere(20, 30));
  const meshRing = Mesh.upload(gl, Mesh.createRing(1.25, 2.28, 160));
  const meshStation = Mesh.upload(gl, Mesh.createRevolution([
    [0.0, -0.9], [0.35, -0.7], [0.8, -0.2], [0.9, 0.2], [0.4, 0.55], [0.0, 0.6],
  ], 12));

  const orbitMeshes = {};
  function orbitMesh(radius) {
    const key = radius.toFixed(3);
    if (!orbitMeshes[key]) orbitMeshes[key] = Mesh.upload(gl, Mesh.createCircleLine(radius, 192));
    return orbitMeshes[key];
  }

  /* ---------------- 텍스처 ---------------- */
  const maxAniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const aniso = maxAniso
    ? Math.min(gl.getParameter(maxAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT), 8) : 0;

  function texFrom(data, w, h, srgb) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, maxAniso.TEXTURE_MAX_ANISOTROPY_EXT, aniso);
    return t;
  }

  const textures = {};
  function ensureTextures(b) {
    const key = b.key;
    if (textures[key]) return textures[key];
    const size = key === 'earth' || key === 'jupiter' ? [512, 256] : [256, 128];
    const maps = Mesh.makePlanetMaps(b.kind, b.palette, size[0], size[1]);
    textures[key] = {
      color: texFrom(maps.color, maps.width, maps.height),
      arm: texFrom(maps.arm, maps.width, maps.height),
      normal: texFrom(maps.normal, maps.width, maps.height),
    };
    return textures[key];
  }
  // 첫 프레임이 멈추지 않도록 주요 천체만 미리 만든다 (나머지는 그릴 때 생성)
  ['earth', 'moon', 'mars', 'jupiter', 'saturn', 'sun'].forEach((k) => {
    const b = CG.BODIES.find((x) => x.key === k) ||
              (CG.BODIES[3].moons || []).find((x) => x.key === k);
    if (b) ensureTextures(b);
  });

  /* ---------------- 상태 ---------------- */
  const state = {
    mode: 'raster',
    time: 0,                 // 애니메이션 시간(초)
    speed: 1,
    paused: false,
    selected: 'sun',
    pbr: true,
    env: false,
    orbits: true,
    stars: true,
    shadow: true,
    scale: 'explore',
    res: 1,
    spp: 1,
    debug: Number(new URLSearchParams(location.search).get('debug') || 0),
    occl: new URLSearchParams(location.search).get('occl'),
    ns: new URLSearchParams(location.search).get('ns'),
    eclipseAngle: 0,
  };
  const camera = CG.createCamera(canvas);
  let dirCache = { yaw: 1e9 };

  function findBody(key) {
    for (const b of CG.BODIES) {
      if (b.key === key) return b;
      if (b.moons) for (const m of b.moons) if (m.key === key) return m;
    }
    return null;
  }

  /* ---------------- 천체 목록 UI ---------------- */
  const listHost = document.getElementById('bodyList');
  scene.list().forEach((item) => {
    const btn = document.createElement('button');
    btn.dataset.key = item.key;
    btn.innerHTML = `<span class="dot" style="background:#${hex(item.color)};color:#${hex(item.color)}"></span>` +
      `<span>${item.name}</span><span class="meta">${item.au ? item.au.toFixed(2) + ' AU' : ''}</span>`;
    btn.addEventListener('click', () => selectBody(item.key));
    listHost.appendChild(btn);
  });
  function hex(c) {
    return c.map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255)
      .toString(16).padStart(2, '0')).join('');
  }
  function selectBody(key) {
    state.selected = key;
    [...listHost.children].forEach((el) => el.classList.toggle('on', el.dataset.key === key));
    const idx = scene.list().findIndex((x) => x.key === key);
    if (idx >= 0) setCamMode('track');
  }
  listHost.children[0].classList.add('on');

  /* ---------------- UI 연결 ---------------- */
  const modeSeg = document.getElementById('modeSeg');
  modeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setMode(b.dataset.mode);
    [...modeSeg.children].forEach((x) => x.classList.toggle('on', x === b));
  });
  const camSeg = document.getElementById('camSeg');
  camSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setCamMode(b.dataset.cam);
    [...camSeg.children].forEach((x) => x.classList.toggle('on', x === b));
  });
  function setCamMode(m) {
    camera.setMode(m);
    camera.cam.mode = m;
    [...camSeg.children].forEach((x) => x.classList.toggle('on', x.dataset.cam === m));
    if (m === 'free') {
      camera.cam.target = [0, 0, 0];
      camera.cam.dist = 34;
    }
    if (m === 'front' || m === 'side') {
      const b = findBody(state.selected);
      if (b) {
        const pos = b.key === 'sun' ? [0, 0, 0] : bodyPos(b);
        camera.cam.target = pos;
        camera.cam.dist = Math.max(scene.radiusOf(b) * 8, 6);
      }
    }
  }
  const timeSeg = document.getElementById('timeSeg');
  timeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = Number(b.dataset.speed);
    state.speed = s;
    state.paused = (s === 0);
    [...timeSeg.children].forEach((x) => x.classList.toggle('on', x === b));
  });
  document.getElementById('optOrbit').addEventListener('change', (e) => { state.orbits = e.target.checked; });
  document.getElementById('optStars').addEventListener('change', (e) => { state.stars = e.target.checked; });
  document.getElementById('optShadow').addEventListener('change', (e) => { state.shadow = e.target.checked; });
  document.getElementById('optMaterial').addEventListener('change', (e) => { state.pbr = e.target.value === 'pbr'; });
  document.getElementById('optEnv').addEventListener('change', (e) => { state.env = e.target.checked; });
  document.getElementById('optScale').addEventListener('change', (e) => {
    state.scale = e.target.value;
    scene.setScale(state.scale);
    document.getElementById('scaleNote').textContent = state.scale === 'explore'
      ? '압축 비율: 행성 크기를 √과장하고 궤도 간격을 √압축해 한 화면에 담습니다. 실제 비율로 바꾸면 행성이 점처럼 작아집니다.'
      : '실제 비율: 1 AU = 10 단위, 행성 반지름은 태양 반지름 기준 실제 비율입니다. 천체 추적 모드로 확대해 보세요.';
    camera.cam.dist = state.scale === 'explore' ? 34 : 120;
  });
  const resSlider = document.getElementById('optRes');
  resSlider.addEventListener('input', () => {
    state.res = Number(resSlider.value);
    document.getElementById('valRes').textContent = Math.round(state.res * 100) + '%';
  });
  const sppSlider = document.getElementById('optSpp');
  sppSlider.addEventListener('input', () => {
    state.spp = Number(sppSlider.value);
    document.getElementById('valSpp').textContent = state.spp;
  });

  /* 식 관측기 전용 패널 */
  const eclipsePanel = document.createElement('div');
  eclipsePanel.style.display = 'none';
  eclipsePanel.innerHTML = `
    <div class="title" style="margin-top:10px">식 관측기</div>
    <div class="row"><label>위성 공전 위치</label><span class="val" id="eclVal">0°</span></div>
    <div class="row"><input type="range" id="eclAngle" min="0" max="360" step="1" value="0" style="width:100%"></div>
    <div class="row" style="gap:6px">
      <button class="btn" id="solarView" style="flex:1;background:#16233c;border:1px solid rgba(120,160,220,.3);color:#dae6f7;border-radius:6px;padding:5px;font:inherit;font-size:11px;cursor:pointer">일식 보기</button>
      <button class="btn" id="lunarView" style="flex:1;background:#16233c;border:1px solid rgba(120,160,220,.3);color:#dae6f7;border-radius:6px;padding:5px;font:inherit;font-size:11px;cursor:pointer">월식 보기</button>
    </div>`;
  document.getElementById('right').appendChild(eclipsePanel);

  /* ---------------- 모드 ---------------- */
  function setMode(m) {
    state.mode = m;
    eclipsePanel.style.display = m === 'eclipse' ? 'block' : 'none';
    document.getElementById('modeLabel').textContent =
      m === 'raster' ? '래스터화' : m === 'ray' ? 'Ray tracing' : '식 관측기 (ray tracing)';
    document.getElementById('optSpp').parentElement.style.display = m === 'raster' ? 'none' : '';
    document.getElementById('optSpp').parentElement.previousElementSibling.style.display =
      m === 'raster' ? 'none' : '';
    if (m === 'eclipse') {
      camera.cam.dist = 5.8;
      camera.cam.yaw = -0.2;
      camera.cam.pitch = 0.2;
      camera.cam.target = [0.45, -0.12, -2];
    }
  }

  document.getElementById('eclAngle').addEventListener('input', (e) => {
    state.eclipseAngle = Number(e.target.value);
    document.getElementById('eclVal').textContent = Math.round(state.eclipseAngle) + '°';
  });
  document.getElementById('solarView').addEventListener('click', () => {
    state.eclipseAngle = 0; syncEclipse(0); camera.cam.yaw = -0.2; camera.cam.pitch = 0.2; camera.cam.dist = 5.8;
  });
  document.getElementById('lunarView').addEventListener('click', () => {
    state.eclipseAngle = 180; syncEclipse(180); camera.cam.yaw = 1.22; camera.cam.pitch = 0.28; camera.cam.dist = 5.8;
  });
  function syncEclipse(v) {
    document.getElementById('eclAngle').value = v;
    document.getElementById('eclVal').textContent = Math.round(v) + '°';
  }

  /* 키보드: 0~9 천체, R ray, E 식 관측, Space 일시정지, P 재질 */
  const keys = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'moon'];
  window.addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9') selectBody(keys[Number(e.key)]);
    else if (e.key === 'r' || e.key === 'R') setMode(state.mode === 'ray' ? 'raster' : 'ray');
    else if (e.key === 'e' || e.key === 'E') setMode(state.mode === 'eclipse' ? 'raster' : 'eclipse');
    else if (e.key === ' ') { state.paused = !state.paused; e.preventDefault(); }
    else if (e.key === 'p' || e.key === 'P') {
      state.pbr = !state.pbr;
      document.getElementById('optMaterial').value = state.pbr ? 'pbr' : 'phong';
    }
  });

  /* ---------------- 렌더 ---------------- */
  const occluders = new Float32Array(16 * 4);
  const bodyPosCache = new Map();

  function bodyPos(b) {
    const m = M4.chain(M4.identity(), scene.modelOf(b, state.time));
    return [m[12], m[13], m[14]];
  }

  function fillOccluders() {
    const bodies = scene.collectBodies(state.time, false).slice(0, 16);
    bodies.forEach((b, i) => {
      occluders[i * 4] = b.pos[0];
      occluders[i * 4 + 1] = b.pos[1];
      occluders[i * 4 + 2] = b.pos[2];
      occluders[i * 4 + 3] = b.r;
    });
    return bodies;
  }

  let tris = 0, draws = 0;
  function drawMesh(mesh, count) {
    if (!mesh) return;
    gl.bindVertexArray(mesh.vao);
    if (mesh.ibo) gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, 4);
    tris += mesh.triangles || 0;
    draws++;
  }

  const SUN_POS = [0, 0, 0];
  const sunColor = [1.0, 0.86, 0.62];
  const starDir = normalize([-0.45, 0.35, 0.7]);
  const starColor = [0.10, 0.14, 0.26];

  function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function drawRaster(proj, view, camEye, aspect) {
    const useShadow = state.shadow ? 1 : 0;
    const bodies = useShadow ? fillOccluders() : [];

    gl.clearColor(0.004, 0.006, 0.014, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    /* 별 배경: 깊이 검사를 끄고 먼저 그린다 */
    if (state.stars) {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(progSky);
      const invVP = M4.invert(M4.multiply(proj, view));
      gl.uniformMatrix4fv(U.sky.uInvVP, false, invVP);
      gl.uniform3fv(U.sky.uCamPos, camEye);
      gl.uniform1f(U.sky.uTime, state.time);
      gl.bindVertexArray(quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
      draws++;
    }

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    /* 궤도선 */
    if (state.orbits) {
      gl.useProgram(progLine);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniformMatrix4fv(U.line.uProj, false, proj);
      gl.uniformMatrix4fv(U.line.uView, false, view);
      CG.BODIES.forEach((b) => {
        if (!b.au) return;
        const R = scene.sc().dist(b.au);
        const mesh = orbitMesh(R);
        const model = M4.rotateX((b.incl || 0) * Math.PI / 180);
        gl.uniformMatrix4fv(U.line.uModel, false, model);
        gl.uniform3fv(U.line.uColor, [0.35, 0.55, 0.85]);
        gl.uniform1f(U.line.uOpacity, 0.35);
        gl.bindVertexArray(mesh.vao);
        gl.drawElements(gl.LINES, mesh.count, mesh.type, 0);
        draws++;
      });
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    /* 천체 */
    gl.useProgram(progPlanet);
    gl.uniformMatrix4fv(U.planet.uProj, false, proj);
    gl.uniformMatrix4fv(U.planet.uView, false, view);
    gl.uniform3fv(U.planet.uCamPos, camEye);
    gl.uniform3fv(U.planet.uSunPos, SUN_POS);
    gl.uniform3fv(U.planet.uSunColor, sunColor);
    gl.uniform1f(U.planet.uSunPower, 9.4);
    gl.uniform3fv(U.planet.uStarDir, starDir);
    gl.uniform3fv(U.planet.uStarColor, starColor);
    gl.uniform3fv(U.planet.uSpotPos, camEye);
    const fwd = normalize([camera.cam.target[0] - camEye[0],
      camera.cam.target[1] - camEye[1], camera.cam.target[2] - camEye[2]]);
    gl.uniform3fv(U.planet.uSpotDir, fwd);
    gl.uniform3fv(U.planet.uSpotColor, [0.55, 0.62, 0.78]);
    gl.uniform1f(U.planet.uSpotCosIn, Math.cos(0.16));
    gl.uniform1f(U.planet.uSpotCosOut, Math.cos(0.30));
    gl.uniform1f(U.planet.uSpotOn, 0.0);
    gl.uniform1i(U.planet.uUsePBR, state.pbr ? 1 : 0);
    gl.uniform1i(U.planet.uShadow, useShadow);
    const ocl = state.occl !== null ? Math.min(Number(state.occl), bodies.length) : Math.min(bodies.length, 16);
    gl.uniform1i(U.planet.uShadowCount, ocl);
    if (bodies.length) gl.uniform4fv(U.planet.uOccluders, occluders);
    gl.uniform1i(U.planet.uEnvOn, state.env ? 1 : 0);
    gl.uniform1i(U.planet.uDebug, state.debug);
    gl.uniform1f(U.planet.uTime, state.time);
    gl.uniform1i(U.planet.uColorMap, 0);
    gl.uniform1i(U.planet.uARMMap, 1);
    gl.uniform1i(U.planet.uNormalMap, 2);

    CG.BODIES.forEach((b, i) => {
      const model = scene.modelOf(b, state.time);
      const nm = M4.normalMatrix(model);
      const tx = ensureTextures(b);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tx.color);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tx.arm);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tx.normal);
      gl.uniformMatrix4fv(U.planet.uModel, false, model);
      gl.uniformMatrix3fv(U.planet.uNormalMat, false, nm);
      gl.uniform1i(U.planet.uBodyId, i);
      gl.uniform1f(U.planet.uEmissive, b.emissive ? 1 : 0);
      gl.uniform3fv(U.planet.uEmissiveColor, [3.1, 1.85, 0.65]);
      gl.uniform3fv(U.planet.uTint, [1, 1, 1]);
      gl.uniform1f(U.planet.uRough, b.rough || 0.7);
      gl.uniform1f(U.planet.uMetal, b.metal || 0);
      const ns = state.ns !== null ? Number(state.ns)
        : (b.kind === 'gas' || b.kind === 'ice' ? 0.22 : 0.38);
      gl.uniform1f(U.planet.uNormalStrength, ns);
      drawMesh(meshPlanet, 0);

      /* 위성 */
      if (b.moons) {
        b.moons.forEach((m, j) => {
          const mModel = scene.modelOf(m, state.time);
          const mtx = ensureTextures(m);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mtx.color);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mtx.arm);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mtx.normal);
          gl.uniformMatrix4fv(U.planet.uModel, false, mModel);
          gl.uniformMatrix3fv(U.planet.uNormalMat, false, M4.normalMatrix(mModel));
          gl.uniform1i(U.planet.uBodyId, 0);            // 위성은 그림자 castee 로만
          gl.uniform1f(U.planet.uEmissive, 0);
          gl.uniform3fv(U.planet.uTint, [1, 1, 1]);
          gl.uniform1f(U.planet.uRough, m.metal ? 0.3 : 0.8);
          gl.uniform1f(U.planet.uMetal, m.metal ? 1.0 : 0.0);
          gl.uniform1f(U.planet.uNormalStrength, 0.3);
          drawMesh(m.metal ? meshStation : meshMoon, 0);
        });
      }

      /* 고리: 반투명, 마지막에 그린다 */
      if (b.ring) {
        const rm = scene.ringModelOf(b, state.time);
        gl.useProgram(progRing);
        gl.uniformMatrix4fv(U.ring.uProj, false, proj);
        gl.uniformMatrix4fv(U.ring.uView, false, view);
        gl.uniformMatrix4fv(U.ring.uModel, false, rm);
        gl.uniform3fv(U.ring.uCamPos, camEye);
        gl.uniform3fv(U.ring.uSunPos, SUN_POS);
        gl.uniform3fv(U.ring.uSunColor, sunColor);
        gl.uniform1f(U.ring.uSunPower, 9.4);
        gl.uniform1f(U.ring.uTime, state.time);
        gl.uniform1i(U.ring.uShadow, useShadow);
        gl.uniform1i(U.ring.uShadowCount, Math.min(bodies.length, 16));
        if (bodies.length) gl.uniform4fv(U.ring.uOccluders, occluders);
        gl.uniform1i(U.ring.uBodyId, i);
        gl.uniform3fv(U.ring.uRingColor, b.ring.color);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        drawMesh(meshRing, 0);
        gl.depthMask(true);
        gl.enable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
        gl.useProgram(progPlanet);
      }
    });
  }

  function drawRay(camEye, target, proj, view) {
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(progRay);
    const bodies = state.mode === 'eclipse'
      ? scene.eclipseRig(state.eclipseAngle)
      : scene.collectBodies(state.time, false);

    const n = Math.min(bodies.length, 24);
    const bp = new Float32Array(24 * 4);
    const bc = new Float32Array(24 * 3);
    const br = new Float32Array(24);
    const bm = new Float32Array(24);
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      bp[i * 4] = b.pos[0]; bp[i * 4 + 1] = b.pos[1]; bp[i * 4 + 2] = b.pos[2];
      bp[i * 4 + 3] = b.r;
      bc[i * 3] = b.color[0]; bc[i * 3 + 1] = b.color[1]; bc[i * 3 + 2] = b.color[2];
      br[i] = b.rough; bm[i] = b.metal;
    }
    gl.uniform2f(U.ray.uRes, canvas.width, canvas.height);
    gl.uniform3fv(U.ray.uEye, camEye);
    gl.uniform3fv(U.ray.uTarget, target);
    gl.uniform1f(U.ray.uFov, 45);
    gl.uniform1i(U.ray.uBodyCount, n);
    gl.uniform4fv(U.ray.uBodies, bp);
    gl.uniform3fv(U.ray.uBodyColors, bc);
    gl.uniform1fv(U.ray.uBodyRough, br);
    gl.uniform1fv(U.ray.uBodyMetal, bm);
    gl.uniform1i(U.ray.uShadow, state.shadow ? 1 : 0);
    gl.uniform1i(U.ray.uSpp, state.spp);
    gl.uniform1f(U.ray.uTime, state.time);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    draws++;
  }

  /* ---------------- 루프 ---------------- */
  let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsShown = 0;
  let lastStat = 0;

  let loggedError = false;
  function frame(now) {
    try { return frameInner(now); }
    catch (e) {
      if (!loggedError) { console.error('frame error:', e && (e.stack || e.message || e)); loggedError = true; }
      requestAnimationFrame(frame);
    }
  }
  function frameInner(now) {
    const dt = Math.max(Math.min((now - last) / 1000, 0.1), 0);
    last = now;
    if (!state.paused && state.speed > 0) state.time += dt * state.speed;

    /* 화면 크기와 해상도 배율 */
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * state.res;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    const aspect = w / h;

    /* 추적 모드: 선택한 천체를 중심으로 */
    if (camera.cam.mode === 'track') {
      const b = findBody(state.selected) || CG.BODIES[0];
      const pos = b.key === 'sun' ? [0, 0, 0] : bodyPos(b);
      camera.cam.target = pos;
      if (!camera.cam.userDist) camera.cam.dist = Math.max(scene.radiusOf(b) * 6.5, 1.2);
    }

    const camEye = camera.eye();
    const view = camera.view();
    const proj = camera.proj(aspect);

    gl.viewport(0, 0, w, h);
    gl.clearColor(0.004, 0.006, 0.014, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    tris = 0; draws = 0;

    if (state.mode === 'raster') drawRaster(proj, view, camEye, aspect);
    else drawRay(camEye, camera.cam.target, proj, view);

    /* 이벤트 문구 */
    if (state.mode === 'eclipse') {
      const a = ((state.eclipseAngle % 360) + 360) % 360;
      document.getElementById('event').textContent =
        a < 18 || a > 342 ? '일식: 위성이 행성 앞을 지나며 그림자를 드리웁니다.'
          : a > 162 && a < 198 ? '월식: 위성이 행성의 그림자 속으로 들어갑니다.'
            : '식이 아닌 공전 위치입니다.';
    } else {
      const b = findBody(state.selected);
      document.getElementById('event').textContent =
        `${b ? b.name : ''} 기준 시점 · ${state.scale === 'explore' ? '압축 비율' : '실제 비율'}`;
    }

    /* 통계 */
    fpsAcc += 1 / Math.max(dt, 1e-4); fpsN++;
    if (now - lastStat > 500) {
      fpsShown = fpsAcc / fpsN;
      fpsAcc = 0; fpsN = 0; lastStat = now;
      document.getElementById('fps').textContent = fpsShown.toFixed(0);
      document.getElementById('tris').textContent = tris.toLocaleString();
      document.getElementById('draws').textContent = draws;
      let el = state.time;
      const mm = Math.floor(el / 60), ss = Math.floor(el % 60);
      document.getElementById('simDate').textContent =
        `T+ ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
    requestAnimationFrame(frame);
  }

  setMode('raster');
  requestAnimationFrame(frame);
  window.CG.app = { state, camera, scene, gl, frameInner, drawRaster, drawRay, get stats(){return {tris, draws};} };
})();
