import * as THREE from 'three';

/**
 * What a fold in space looks like from the ship: a portal that opens ahead
 * (a swirling disc with a bright rim), and the tunnel the ship rides through
 * between the two mouths (a long tube streaming past, with the far end
 * glowing). Both are drawn round the viewer, in metres, with the floating
 * origin, so they sit in front of everything else.
 */

const PORTAL_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float time;
uniform float open;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  // a spiral that winds in
  float s = sin(a * 5.0 + 9.0 / (r + 0.15) - time * 6.0);
  float rim = smoothstep(0.78, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float core = 1.0 - smoothstep(0.0, 0.55, r);
  vec3 c = mix(vec3(0.35, 0.12, 0.85), vec3(0.3, 0.85, 1.0), 0.5 + 0.5 * s);
  c = mix(c, vec3(1.0), core * 0.8);
  c += vec3(0.9, 0.7, 1.0) * rim * 2.0;
  float alpha = (0.55 + 0.45 * s * (1.0 - r)) * open;
  c = floor(c * 6.0 + 0.5) / 6.0;
  gl_FragColor = vec4(c, alpha);
}`;

const TUNNEL_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float time;
uniform float fade;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float a = vUv.x * 6.2831853;
  float z = vUv.y;
  // rings racing past and ribs twisting along the tube
  float rings = 0.5 + 0.5 * sin(z * 220.0 + time * 40.0);
  float ribs = 0.5 + 0.5 * sin(a * 8.0 + z * 40.0 - time * 3.0);
  vec3 c = mix(vec3(0.18, 0.05, 0.45), vec3(0.2, 0.75, 1.0), ribs);
  c += vec3(0.9, 0.6, 1.0) * pow(rings, 6.0) * 0.9;
  // the far end glows
  c += vec3(1.0, 0.95, 1.0) * smoothstep(0.75, 1.0, z) * 1.5;
  c = floor(c * 5.0 + 0.5) / 5.0;
  gl_FragColor = vec4(c, fade);
}`;

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

export class WormholeFx {
  readonly portal: THREE.Mesh;
  readonly tunnel: THREE.Mesh;
  private pu: { time: { value: number }; open: { value: number } };
  private tu: { time: { value: number }; fade: { value: number } };

  constructor(scene: THREE.Scene) {
    this.pu = { time: { value: 0 }, open: { value: 0 } };
    this.portal = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.pu, vertexShader: VERT, fragmentShader: PORTAL_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    this.portal.frustumCulled = false;
    this.portal.visible = false;
    this.portal.renderOrder = 5;
    scene.add(this.portal);

    this.tu = { time: { value: 0 }, fade: { value: 0 } };
    // a tube along −z (forward), open, seen from inside
    const g = new THREE.CylinderGeometry(60, 60, 6000, 32, 1, true);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -2400);
    this.tunnel = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.tu, vertexShader: VERT, fragmentShader: TUNNEL_FRAG,
      transparent: true, side: THREE.BackSide, depthWrite: true,
    }));
    this.tunnel.frustumCulled = false;
    this.tunnel.visible = false;
    this.tunnel.renderOrder = 6;
    scene.add(this.tunnel);
  }

  /**
   * draw: `portal` = how open the mouth ahead is (0–1) and how far ahead (m),
   * `tunnel` = how far through the tube (0–1, or null for none); `q` the ship's
   * orientation and `off` where the ship is relative to the viewer (m)
   */
  draw(q: THREE.Quaternion, off: THREE.Vector3, portal: { open: number; dist: number } | null, tunnel: number | null) {
    const t = performance.now() / 1000;
    this.pu.time.value = t;
    this.tu.time.value = t;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    if (portal && portal.open > 0) {
      this.portal.visible = true;
      this.portal.quaternion.copy(q);
      this.portal.position.copy(off).addScaledVector(fwd, portal.dist);
      this.portal.scale.setScalar(Math.max(1, 90 * portal.open));
      this.pu.open.value = Math.min(1, portal.open * 1.5);
    } else this.portal.visible = false;
    if (tunnel !== null) {
      this.tunnel.visible = true;
      this.tunnel.quaternion.copy(q);
      this.tunnel.position.copy(off);
      // fade in at the start and out at the end
      this.tu.fade.value = Math.min(1, tunnel * 8, (1 - tunnel) * 8);
    } else this.tunnel.visible = false;
  }
}
