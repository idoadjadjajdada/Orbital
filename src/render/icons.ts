import * as THREE from 'three';
import type { Body } from '../physics/body';
import { planetMaterial, starMaterial, lights, glowTexture, starColor } from './bodies';

/** Renders a body to a small image with the same shaders the sim uses. */
export class IconRenderer {
  private r: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
  private sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32));
  private ring: THREE.Mesh;
  private glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false }));

  constructor(size = 96) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    this.r = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.r.setClearColor(0, 0);
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.cam.position.set(0, -4.4, 1.2);
    this.cam.up.set(0, 0, 1);
    this.cam.lookAt(0, 0, 0);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 2.1, 96), new THREE.MeshBasicMaterial({ color: 0xd8c8a0, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    this.scene.add(this.sphere, this.ring, this.glow);
  }

  render(b: Pick<Body, 'look' | 'heat' | 'cls' | 'star' | 'tilt'>): string {
    const saved = { n: lights.uNLights.value, p: lights.uLightPos.value[0].clone(), c: lights.uLightCol.value[0].clone() };
    lights.uNLights.value = 1;
    lights.uLightPos.value[0].set(-30, -20, 18);
    lights.uLightCol.value[0].set(2.3, 2.2, 2.1);
    let mat: THREE.Material;
    this.glow.visible = false;
    this.ring.visible = !!b.look.rings;
    this.sphere.scale.setScalar(b.look.rings ? 0.62 : 1);
    this.ring.scale.setScalar(b.look.rings ? 0.62 : 1);
    this.ring.rotation.set(1.15, 0.25, 0);
    if (b.cls === 'star') {
      mat = starMaterial(b.star?.teff ?? 5772, b.star?.phase === 'giant' || b.star?.phase === 'agb', b.look.seed);
      this.glow.visible = true;
      this.glow.scale.setScalar(3.4);
      this.glow.material.color.copy(starColor(b.star?.teff ?? 5772)).multiplyScalar(0.8);
      this.sphere.scale.setScalar(0.7);
    } else if (b.cls === 'wd' || b.cls === 'ns') {
      mat = starMaterial(b.cls === 'ns' ? 1e5 : 25000, false, 1);
      this.sphere.scale.setScalar(b.cls === 'ns' ? 0.3 : 0.45);
      this.glow.visible = true; this.glow.scale.setScalar(2.6);
      this.glow.material.color.set(b.cls === 'ns' ? 0x9fc0ff : 0xe0e8ff);
    } else if (b.cls === 'bh') {
      mat = new THREE.MeshBasicMaterial({ color: 0 });
      this.ring.visible = true;
      this.ring.scale.setScalar(0.78);
      this.ring.rotation.set(1.35, 0, 0);
      (this.ring.material as THREE.MeshBasicMaterial).color.set(0xffa040);
      this.sphere.scale.setScalar(0.62);
      this.glow.visible = true; this.glow.scale.setScalar(2.4); this.glow.material.color.set(0x603010);
    } else {
      mat = planetMaterial(b, 0.06);
      (this.ring.material as THREE.MeshBasicMaterial).color.set(b.look.rings?.color ?? 0xd8c8a0);
    }
    this.sphere.material = mat;
    this.sphere.rotation.set(-b.tilt * 0.5, 0, 0.6);
    this.r.render(this.scene, this.cam);
    const url = this.r.domElement.toDataURL();
    mat.dispose();
    (this.ring.material as THREE.MeshBasicMaterial).color.set(0xd8c8a0);
    lights.uNLights.value = saved.n;
    lights.uLightPos.value[0].copy(saved.p);
    lights.uLightCol.value[0].copy(saved.c);
    return url;
  }
}
