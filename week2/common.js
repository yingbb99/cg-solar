/* 2주차 공통 도구: 작은 렌더러 + 4×4 행렬 출력
   세 페이지가 같은 셰이더/카메라 도구를 쓴다. */
window.CGW = (() => {
  const M = CG.M4, Mesh = CG.Mesh;

  const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uMVP, uModel;
uniform mat3 uNormalMat;
out vec3 vN, vWorld; out vec2 vUV;
void main(){
  vec4 w = uModel*vec4(aPos,1.0);
  vWorld = w.xyz; vN = uNormalMat*aNormal; vUV = aUV;
  gl_Position = uMVP*vec4(aPos,1.0);
}`;

  const FS = `#version 300 es
precision highp float;
in vec3 vN, vWorld; in vec2 vUV;
uniform vec3 uColor, uEye;
uniform float uFlat;
out vec4 outColor;
void main(){
  vec3 N = normalize(vN);
  vec3 L = normalize(vec3(0.5, 0.9, 0.35));
  float ndl = max(dot(N, L), 0.0);
  vec3 base = uColor * (0.28 + 0.72*ndl);
  if (uFlat > 0.5) base = uColor;                 // 바닥은 단색
  vec3 V = normalize(uEye - vWorld);
  vec3 R = reflect(-L, N);
  base += vec3(1.0,0.95,0.85) * pow(max(dot(R,V),0.0), 30.0) * 0.22;
  base = base/(1.0+base);
  outColor = vec4(pow(base, vec3(1.0/2.2)), 1.0);
}`;

  function compile(gl, type, src){
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function make(canvas){
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    const U = {};
    ['uMVP','uModel','uNormalMat','uColor','uEye','uFlat'].forEach(n => U[n] = gl.getUniformLocation(prog, n));
    const sphere = Mesh.upload(gl, Mesh.createSphere(32, 48));
    const quad = Mesh.upload(gl, Mesh.createQuad());
    gl.enable(gl.DEPTH_TEST);

    function draw(items, cam){
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth*dpr), h = Math.round(canvas.clientHeight*dpr);
      if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
      gl.viewport(0,0,w,h);
      gl.clearColor(0.04, 0.055, 0.085, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const eye = cam.eye;
      const view = M.lookAt(eye, cam.target, [0,1,0]);
      const aspect = w/h;
      const proj = cam.ortho
        ? M.ortho(-cam.half*aspect, cam.half*aspect, -cam.half, cam.half, 0.1, 200)
        : M.perspective(cam.fov || 45, aspect, 0.1, 200);
      gl.useProgram(prog);
      gl.uniform3fv(U.uEye, eye);
      for (const it of items){
        const mvp = M.multiply(proj, M.multiply(view, it.model));
        gl.uniformMatrix4fv(U.uMVP, false, mvp);
        gl.uniformMatrix4fv(U.uModel, false, it.model);
        gl.uniformMatrix3fv(U.uNormalMat, false, M.normalMatrix(it.model));
        gl.uniform3fv(U.uColor, it.color);
        gl.uniform1f(U.uFlat, it.flat ? 1 : 0);
        if (it.quad){
          gl.bindVertexArray(quad.vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        } else {
          gl.bindVertexArray(sphere.vao); gl.drawElements(gl.TRIANGLES, sphere.count, sphere.type, 0);
        }
      }
      gl.bindVertexArray(null);
    }
    return { gl, draw };
  }

  /* 4×4 행렬을 사람이 읽을 수 있는 표로 만든다 (열 우선 배열을 행 단위로 재배치) */
  function fmt(m){
    const f = (v) => (Math.abs(v) < 1e-6 ? "0.00" : v.toFixed(2)).padStart(7);
    const out = [];
    for (let r = 0; r < 4; r++){
      out.push([0,1,2,3].map(c => f(m[c*4+r])).join(" "));
    }
    return out.join("\n");
  }

  function orbit(canvas, cam){
    let drag = false, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', e => { drag = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      cam.yaw += (e.clientX-lx)*0.006;
      cam.pitch = Math.max(-0.2, Math.min(1.2, cam.pitch + (e.clientY-ly)*0.004));
      lx = e.clientX; ly = e.clientY;
      if (cam.onChange) cam.onChange();
    });
    canvas.addEventListener('pointerup', e => { drag = false; canvas.releasePointerCapture(e.pointerId); });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      cam.dist = Math.max(2, Math.min(60, cam.dist*(1 + e.deltaY*0.001)));
      if (cam.onChange) cam.onChange();
    }, { passive: false });
  }
  function eyeOf(cam){
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return [Math.sin(cam.yaw)*cp*cam.dist + (cam.center?cam.center[0]:0),
            sp*cam.dist + (cam.center?cam.center[1]:1),
            Math.cos(cam.yaw)*cp*cam.dist + (cam.center?cam.center[2]:0)];
  }
  return { M, Mesh, make, fmt, orbit, eyeOf };
})();
