/* ------------------------------------------------------------------
   mesh.js — 4×4 행렬 유틸리티와 메시 생성
   · M4        : 열벡터 규약(column-major). M4.multiply(a,b) 는 a·b, 즉 b 가 먼저 적용된다.
   · createSphere / createRevolution : 정점·법선·UV·접선·인덱스 배열
   · createRing / createCircleLine / createQuad
   · upload      : VAO 생성
   · makePlanetMaps : 색·ARM·법선 맵을 코드로 생성 (외부 이미지 없음)
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  /* ============ 4×4 행렬 ============ */
  const M4 = {
    identity() {
      const m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return m;
    },
    multiply(a, b) {                       // out = a · b  (b가 정점에 먼저)
      const out = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          let s = 0;
          for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
          out[c * 4 + r] = s;
        }
      }
      return out;
    },
    chain(...ms) {                         // 왼쪽부터 곱한다
      return ms.reduce((acc, m) => M4.multiply(acc, m), M4.identity());
    },
    translate(x, y, z) {
      const m = M4.identity();
      m[12] = x; m[13] = y; m[14] = z;
      return m;
    },
    scale(x, y, z) {
      const m = M4.identity();
      m[0] = x; m[5] = y === undefined ? x : y; m[10] = z === undefined ? x : z;
      return m;
    },
    rotateX(a) {
      const m = M4.identity(), c = Math.cos(a), s = Math.sin(a);
      m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
      return m;
    },
    rotateY(a) {
      const m = M4.identity(), c = Math.cos(a), s = Math.sin(a);
      m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
      return m;
    },
    rotateZ(a) {
      const m = M4.identity(), c = Math.cos(a), s = Math.sin(a);
      m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
      return m;
    },
    perspective(fovyDeg, aspect, near, far) {
      const f = 1 / Math.tan((fovyDeg * Math.PI / 180) / 2);
      const m = new Float32Array(16);
      m[0] = f / aspect; m[5] = f;
      m[10] = (far + near) / (near - far);
      m[11] = -1;
      m[14] = (2 * far * near) / (near - far);
      return m;
    },
    ortho(l, r, b, t, n, f) {
      const m = new Float32Array(16);
      m[0] = 2 / (r - l);
      m[5] = 2 / (t - b);
      m[10] = -2 / (f - n);
      m[12] = -(r + l) / (r - l);
      m[13] = -(t + b) / (t - b);
      m[14] = -(f + n) / (f - n);
      m[15] = 1;
      return m;
    },
    lookAt(eye, center, up) {
      let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
      let l = Math.hypot(zx, zy, zz) || 1;
      zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy;
      let xy = up[2] * zx - up[0] * zz;
      let xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz);
      if (l < 1e-6) { xx = 1; xy = 0; xz = 0; l = 1; }
      xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy;
      const yy = zz * xx - zx * xz;
      const yz = zx * xy - zy * xx;
      const m = new Float32Array(16);
      m[0] = xx; m[4] = xy; m[8] = xz;
      m[1] = yx; m[5] = yy; m[9] = yz;
      m[2] = zx; m[6] = zy; m[10] = zz;
      m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      m[15] = 1;
      return m;
    },
    invert(m) {
      const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
      const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
      const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
      const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
      const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
      const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
      const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
      const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return M4.identity();
      det = 1 / det;
      const o = new Float32Array(16);
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return o;
    },
    /** 모델 행렬의 선형 부분(3×3)의 역전치 → 법선 행렬 (mat3, column-major) */
    normalMatrix(model) {
      const a = model[0], b = model[1], c = model[2];
      const d = model[4], e = model[5], f = model[6];
      const g = model[8], h = model[9], i = model[10];
      const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
      let det = a * A + b * B + c * C;
      if (Math.abs(det) < 1e-12) det = 1e-12;
      const inv = 1 / det;
      // 역행렬의 전치 = 여인수 행렬 / det
      return new Float32Array([
        A * inv, B * inv, C * inv,
        (c * h - b * i) * inv, (a * i - c * g) * inv, (b * g - a * h) * inv,
        (b * f - c * e) * inv, (c * d - a * f) * inv, (a * e - b * d) * inv,
      ]);
    },
    point(m, p) {
      return [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      ];
    },
  };

  /* ============ 메시 ============ */

  /** 위경도 구. u = 경도 방향, v = 위도. 둘레의 마지막 정점을 한 번 더 만들어 UV 이음매를 맞춘다. */
  function createSphere(latSeg = 32, lonSeg = 48) {
    const pos = [], nrm = [], uv = [], tan = [], idx = [];
    for (let i = 0; i <= latSeg; i++) {
      const v = i / latSeg;
      const theta = v * Math.PI;                 // 0 = 북극
      const y = Math.cos(theta);
      const r = Math.sin(theta);
      for (let j = 0; j <= lonSeg; j++) {
        const u = j / lonSeg;
        const phi = u * Math.PI * 2;
        const x = r * Math.cos(phi), z = r * Math.sin(phi);
        pos.push(x, y, z);
        nrm.push(x, y, z);
        uv.push(u, 1 - v);
        tan.push(-Math.sin(phi), 0, Math.cos(phi));   // +u(경도) 접선
      }
    }
    const stride = lonSeg + 1;
    for (let i = 0; i < latSeg; i++) {
      for (let j = 0; j < lonSeg; j++) {
        const a = i * stride + j, b = a + stride;
        // 바깥에서 볼 때 반시계(CCW)가 되도록 감는다 → 기본 BACK 컬링과 일치
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    return pack(pos, nrm, uv, tan, idx);
  }

  /**
   * 회전체(revolve): 프로파일 [[r,y], ...] 을 y축 둘레로 회전.
   * 법선은 프로파일 접선 (dr,dy) 를 +90° 돌린 (-dy, dr) — 바깥을 향한다.
   */
  function createRevolution(profile, seg = 48) {
    const pos = [], nrm = [], uv = [], tan = [], idx = [];
    const rows = profile.length;
    for (let i = 0; i < rows; i++) {
      const r = profile[i][0], y = profile[i][1];
      const pp = profile[Math.max(i - 1, 0)];
      const pn = profile[Math.min(i + 1, rows - 1)];
      const dr = pn[0] - pp[0], dy = pn[1] - pp[1];
      const nl = Math.hypot(dr, dy) || 1;
      const nr = -dy / nl, ny = dr / nl;
      for (let j = 0; j <= seg; j++) {
        const t = (j / seg) * Math.PI * 2;
        const c = Math.cos(t), s = Math.sin(t);
        pos.push(r * c, y, r * s);
        nrm.push(nr * c, ny, nr * s);
        uv.push(j / seg, 1 - i / (rows - 1));
        tan.push(-s, 0, c);
      }
    }
    const stride = seg + 1;
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = i * stride + j, b = a + stride;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    return pack(pos, nrm, uv, tan, idx);
  }

  /** 고리: 안쪽·바깥쪽 반지름을 가진 평평한 원판. vUV.y = 0(안쪽)~1(바깥쪽) */
  function createRing(inner, outer, seg = 128) {
    const pos = [], nrm = [], uv = [], tan = [], idx = [];
    for (let i = 0; i <= 1; i++) {
      const r = i ? outer : inner;
      for (let j = 0; j <= seg; j++) {
        const u = j / seg, t = u * Math.PI * 2;
        const c = Math.cos(t), s = Math.sin(t);
        pos.push(r * c, 0, r * s);
        nrm.push(0, 1, 0);
        uv.push(u, i);
        tan.push(-s, 0, c);
      }
    }
    const stride = seg + 1;
    for (let j = 0; j < seg; j++) {
      const a = j, b = a + stride;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return pack(pos, nrm, uv, tan, idx);
  }

  /** 궤도선: 닫힌 원 (LINE_STRIP 대신 LINES 로 그린다) */
  function createCircleLine(radius, seg = 160) {
    const pos = [];
    for (let j = 0; j <= seg; j++) {
      const t = (j / seg) * Math.PI * 2;
      pos.push(Math.cos(t) * radius, 0, Math.sin(t) * radius);
    }
    const idx = [];
    for (let j = 0; j < seg; j++) idx.push(j, j + 1);
    return {
      pos: new Float32Array(pos), nrm: null, uv: null, tan: null,
      idx: new Uint16Array(idx), count: idx.length,
    };
  }

  function createQuad() {
    return {
      pos: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      nrm: null, uv: null, tan: null, idx: null, count: 4,
    };
  }

  function pack(pos, nrm, uv, tan, idx) {
    return {
      pos: new Float32Array(pos),
      nrm: new Float32Array(nrm),
      uv: new Float32Array(uv),
      tan: new Float32Array(tan),
      idx: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
      count: idx.length,
      vertexCount: pos.length / 3,
    };
  }

  /** 메시를 GPU 버퍼에 올리고 VAO 를 돌려준다 */
  function upload(gl, mesh) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    if (mesh.nrm && mesh.nrm.length) {
      const nBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, nBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.nrm, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    }
    if (mesh.uv && mesh.uv.length) {
      const uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.uv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    }
    if (mesh.tan && mesh.tan.length) {
      const tBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, tBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.tan, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
    }

    let ibo = null;
    if (mesh.idx && mesh.idx.length) {
      ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
    }
    gl.bindVertexArray(null);
    return {
      vao, ibo, count: mesh.count,
      type: mesh.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      triangles: mesh.idx ? mesh.idx.length / 3 : 0,
    };
  }

  /* ============ 절차적 텍스처 ============ */

  function hash3(x, y, z) {
    let h = x * 374761393 + y * 668265263 + z * 2147483647;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = smooth(xf), v = smooth(yf), w = smooth(zf);
    function h(dx, dy, dz) { return hash3(xi + dx, yi + dy, zi + dz); }
    const c00 = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * u;
    const c10 = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * u;
    const c01 = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * u;
    const c11 = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * u;
    const c0 = c00 + (c10 - c00) * v;
    const c1 = c01 + (c11 - c01) * v;
    return c0 + (c1 - c0) * w;
  }
  function fbm(x, y, z, oct = 4) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += a * vnoise(x * f, y * f, z * f);
      norm += a;
      f *= 2; a *= 0.5;
    }
    return sum / norm;
  }

  const PALETTES = {
    sun:     { a: [1.0, 0.95, 0.72], b: [1.0, 0.62, 0.16], c: [1.0, 0.35, 0.06] },
    mercury: { a: [0.52, 0.48, 0.44], b: [0.33, 0.30, 0.28], c: [0.20, 0.18, 0.17] },
    venus:   { a: [0.94, 0.85, 0.62], b: [0.80, 0.66, 0.40], c: [0.58, 0.45, 0.26] },
    earth:   { a: [0.10, 0.28, 0.52], b: [0.14, 0.42, 0.18], c: [0.62, 0.58, 0.48] },
    moon:    { a: [0.62, 0.62, 0.60], b: [0.40, 0.40, 0.39], c: [0.24, 0.24, 0.24] },
    mars:    { a: [0.66, 0.31, 0.18], b: [0.47, 0.22, 0.14], c: [0.30, 0.16, 0.12] },
    jupiter: { a: [0.86, 0.78, 0.66], b: [0.66, 0.50, 0.36], c: [0.45, 0.30, 0.22] },
    saturn:  { a: [0.90, 0.83, 0.64], b: [0.74, 0.63, 0.42], c: [0.50, 0.42, 0.28] },
    uranus:  { a: [0.62, 0.84, 0.88], b: [0.44, 0.70, 0.78], c: [0.30, 0.54, 0.62] },
    neptune: { a: [0.28, 0.44, 0.82], b: [0.18, 0.30, 0.66], c: [0.10, 0.16, 0.44] },
    station: { a: [0.78, 0.80, 0.86], b: [0.55, 0.58, 0.64], c: [0.26, 0.28, 0.32] },
  };

  /**
   * 행성 표면 맵을 코드로 만든다. (색 / ARM / 법선)
   * kind: 'gas' | 'rock' | 'ice' | 'sun' | 'metal'
   */
  function makePlanetMaps(kind, palette, w = 256, h = 128) {
    const pal = PALETTES[palette] || PALETTES.moon;
    const color = new Uint8Array(w * h * 4);
    const arm = new Uint8Array(w * h * 4);
    const normal = new Uint8Array(w * h * 4);
    const height = new Float32Array(w * h + w);

    const mix3 = (p, q, t) => [
      p[0] + (q[0] - p[0]) * t,
      p[1] + (q[1] - p[1]) * t,
      p[2] + (q[2] - p[2]) * t,
    ];

    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      const lat = Math.cos(v * Math.PI);            // +1 북극 ~ -1 남극
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const lon = u * Math.PI * 2;
        // 이음매가 없도록 3D 좌표로 잡음
        const sx = Math.cos(lon) * Math.sqrt(Math.max(1 - lat * lat, 0));
        const sz = Math.sin(lon) * Math.sqrt(Math.max(1 - lat * lat, 0));
        const sy = lat;
        let t;
        if (kind === 'gas' || kind === 'ice') {
          const bands = 0.5 + 0.5 * Math.sin(lat * 14 + 2.4 * fbm(sx * 2, sy * 2, sz * 2, 2));
          const swirl = fbm(sx * 5 + 3, sy * 5, sz * 5, 4);
          t = bands * 0.82 + swirl * 0.18;
        } else if (kind === 'sun') {
          t = fbm(sx * 6, sy * 6, sz * 6, 4);
          t = Math.pow(t, 1.6);
        } else if (kind === 'metal') {
          t = 0.55 + 0.45 * fbm(sx * 8, sy * 8, sz * 8, 3);
        } else {
          const cont = fbm(sx * 3.2, sy * 3.2, sz * 3.2, 5);
          t = cont;
        }
        height[y * w + x] = t;

        let c;
        if (palette === 'earth') {
          const land = t > 0.52;
          const ice = Math.abs(lat) > 0.78;
          c = ice ? [0.92, 0.95, 0.98]
            : land ? mix3(pal.b, pal.c, Math.min(1, (t - 0.52) * 3.2))
                   : mix3(pal.a, [0.02, 0.06, 0.16], 1 - t);
        } else if (kind === 'sun') {
          c = mix3(pal.b, pal.a, t);
        } else {
          c = t < 0.5 ? mix3(pal.c, pal.b, t * 2) : mix3(pal.b, pal.a, (t - 0.5) * 2);
        }

        const i4 = (y * w + x) * 4;
        color[i4] = c[0] * 255; color[i4 + 1] = c[1] * 255; color[i4 + 2] = c[2] * 255;
        color[i4 + 3] = 255;

        // ARM: R=AO, G=roughness, B=metallic
        const ao = kind === 'gas' ? 1.0 : 0.55 + 0.45 * Math.min(1, t * 1.6);
        const rough = kind === 'gas' ? 0.75 : kind === 'ice' ? 0.25 :
                      kind === 'metal' ? 0.35 : 0.62 + 0.35 * (1 - t);
        arm[i4] = ao * 255;
        arm[i4 + 1] = rough * 255;
        arm[i4 + 2] = 0;

        // 법선 맵: 높이의 기울기로 접선 공간 노멀을 만든다
        const xl = Math.max(x - 2, 0), xr = Math.min(x + 2, w - 1);
        const yl = Math.max(y - 2, 0), yr = Math.min(y + 2, h - 1);
        const dhdu = (height[y * w + xr] - height[y * w + xl]);
        const dhdv = (height[yr * w + x] - height[yl * w + x]);
        let nx = -dhdu * 0.55, ny = -dhdv * 0.55, nz = 1;   // 기울기를 약하게: 요철만 남긴다
        const len = Math.hypot(nx, ny, nz);
        normal[i4] = (nx / len * 0.5 + 0.5) * 255;
        normal[i4 + 1] = (ny / len * 0.5 + 0.5) * 255;
        normal[i4 + 2] = (nz / len * 0.5 + 0.5) * 255;
        normal[i4 + 3] = 255;
      }
    }
    return { color, arm, normal, width: w, height: h };
  }

  global.CG = global.CG || {};
  global.CG.M4 = M4;
  global.CG.Mesh = {
    createSphere, createRevolution, createRing, createCircleLine, createQuad,
    upload, makePlanetMaps,
  };
})(window);
