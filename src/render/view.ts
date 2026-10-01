import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LENS_FRAG } from './shaders';

export type Vec3 = { x: number; y: number; z: number };

/**
 * Renderer, camera and the floating origin.
 *
 * Positions are kept in double precision by the simulation and converted to
 * scene space by subtracting `origin` (also double) before they reach the
 * GPU's single-precision floats, so a moon next to a planet 30 AU out is
 * placed to a few metres. The physics frame is z-up (the ecliptic is z = 0).
 */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sky = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly skyCamera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  readonly lens: ShaderPass;

  /** world position (AU, double) that maps to scene (0,0,0) */
  origin = { x: 0, y: 0, z: 0 };

  // camera rig around the origin
  dist = 10;
  distGoal = 10;
  az = -Math.PI / 2;
  el = 0.9;
  /** smooth glide of the origin when focus changes */
  glide = { x: 0, y: 0, z: 0 };

  width = 1;
  height = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.autoClear = false;

    this.camera = new THREE.PerspectiveCamera(50, 1, 1e-6, 1e6);
    this.camera.up.set(0, 0, 1);
    this.skyCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    this.skyCamera.up.set(0, 0, 1);

    this.composer = new EffectComposer(this.renderer);
    const rp = new RenderPass(this.scene, this.camera);
    rp.clear = false;
    this.composer.addPass(rp);
    this.lens = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uHoles: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, uN: { value: 0 }, uAspect: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: LENS_FRAG,
    });
    this.composer.addPass(this.lens);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // the sky is drawn into the composer's first buffer before the scene
    const sky = this.sky, skyCam = this.skyCamera;
    rp.render = function (renderer, _w, readBuffer) {
      renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(sky, skyCam);
      renderer.clearDepth();
      renderer.render(this.scene, this.camera);
    };

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = this.skyCamera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.skyCamera.updateProjectionMatrix();
    this.lens.uniforms.uAspect.value = w / h;
  }

  /** scene coordinates of a world position */
  toScene(p: Vec3, out = new THREE.Vector3()) {
    return out.set(p.x - this.origin.x, p.y - this.origin.y, p.z - this.origin.z);
  }

  /** world-units per pixel at a given scene-space distance from the camera */
  pixelWorld(d: number) {
    return (2 * d * Math.tan((this.camera.fov * Math.PI) / 360)) / this.height;
  }

  updateCamera(dtReal: number) {
    const k = 1 - Math.exp(-dtReal * 8);
    this.dist *= Math.pow(this.distGoal / this.dist, k);
    const g = Math.exp(-dtReal * 5);
    this.glide.x *= g; this.glide.y *= g; this.glide.z *= g;
    const ce = Math.cos(this.el);
    const off = new THREE.Vector3(ce * Math.cos(this.az), ce * Math.sin(this.az), Math.sin(this.el)).multiplyScalar(this.dist);
    const target = new THREE.Vector3(this.glide.x, this.glide.y, this.glide.z);
    this.camera.position.copy(target).add(off);
    this.camera.near = this.dist * 1e-6;
    this.camera.far = this.dist * 1e7;
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.skyCamera.quaternion.copy(this.camera.quaternion);
  }

  /** Project a scene point to CSS pixels; z > 1 means behind the camera. */
  project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.width, y: (-p.y * 0.5 + 0.5) * this.height, z: p.z, behind: p.z > 1 };
  }

  /** Where a screen point meets the plane z = zPlane (scene space). */
  rayToPlane(sx: number, sy: number, zPlane = this.glide.z): THREE.Vector3 | null {
    const ndc = new THREE.Vector3((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    if (Math.abs(dir.z) < 1e-9) return null;
    const t = (zPlane - this.camera.position.z) / dir.z;
    if (t <= 0) return null;
    return this.camera.position.clone().addScaledVector(dir, t);
  }

  render() {
    this.composer.render();
  }
}
