import * as THREE from 'three';
import { blackbody } from '../physics/stellar';
import { NOISE } from './shaders';

/**
 * The sky at infinity: a few thousand stars with a realistic spread of
 * colours and brightnesses, and a faint galactic band. Drawn with its own
 * camera that only rotates, so it never parallaxes.
 */
export function buildSky(scene: THREE.Scene) {
  const n = 9000;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  // galactic plane tilted ~60° to the ecliptic, as ours is
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0.3, 0).normalize(), 1.05);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const disc = rnd() < 0.55;
    const z = disc ? (rnd() - 0.5) * 0.35 * Math.pow(rnd(), 2) : 2 * rnd() - 1;
    const p = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
    v.set(r * Math.cos(p), r * Math.sin(p), z).applyQuaternion(tilt);
    pos.set([v.x * 5, v.y * 5, v.z * 5], i * 3);
    // most stars are cool and faint; a few are hot and bright
    const T = 2600 + 9000 * Math.pow(rnd(), 2.2) + (rnd() < 0.04 ? 15000 * rnd() : 0);
    const [cr, cg, cb] = blackbody(T);
    const mag = Math.pow(rnd(), 5);
    const b = 0.18 + 2.2 * mag;
    col.set([cr * b, cg * b, cb * b], i * 3);
    size[i] = 1.2 + 2.6 * mag;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    vertexShader: `attribute float size; varying vec3 vC; void main(){ vC = color; gl_PointSize = size * ${Math.min(2, window.devicePixelRatio || 1).toFixed(1)}; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vC * a * a, 1.0); }`,
    vertexColors: true, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(g, m));

  // the diffuse band
  const band = new THREE.Mesh(new THREE.SphereGeometry(6, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, transparent: true, blending: THREE.AdditiveBlending,
    uniforms: { uQ: { value: new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(tilt.clone().invert())) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform mat3 uQ; varying vec3 vD; ${NOISE}
      void main(){
        vec3 d = uQ * normalize(vD);
        float lat = d.z;
        float core = exp(-lat * lat / 0.012);
        float bulge = exp(-pow(length(d - vec3(1.0, 0.0, 0.0)), 2.0) / 0.12);
        float dust = smoothstep(0.35, 0.7, fbm(d * 6.0)) * exp(-lat * lat / 0.002);
        float n = fbm(d * 3.0 + 7.0);
        float a = (core * (0.5 + n) + bulge * 0.8) * (1.0 - 0.75 * dust);
        vec3 c = mix(vec3(0.55, 0.6, 0.85), vec3(1.0, 0.85, 0.65), bulge);
        gl_FragColor = vec4(c * a * 0.055, 1.0);
      }`,
  }));
  scene.add(band);
}
