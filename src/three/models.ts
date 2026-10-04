import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * The modelled things: the bases' buildings (a dome habitat, a modular
 * outpost, a vault hangar — each a body and a roof that lifts off to show
 * the rooms inside) and the trees (oak, birch, maple, palm, pine). Baked by
 * tools/pack-models.py, fetched the first time something asks for one and
 * never again; until then whoever asked draws its own simple stand-in.
 */
const URLS = {
  'dome-habitat': new URL('./models/dome-habitat.glb', import.meta.url).href,
  'modular-outpost': new URL('./models/modular-outpost.glb', import.meta.url).href,
  'vault-hangar': new URL('./models/vault-hangar.glb', import.meta.url).href,
  oak: new URL('./models/oak.glb', import.meta.url).href,
  birch: new URL('./models/birch.glb', import.meta.url).href,
  maple: new URL('./models/maple.glb', import.meta.url).href,
  palm: new URL('./models/palm.glb', import.meta.url).href,
  pine: new URL('./models/pine.glb', import.meta.url).href,
};
export type ModelName = keyof typeof URLS;
export const TREES: ModelName[] = ['oak', 'birch', 'maple', 'palm', 'pine'];

const got = new Map<ModelName, THREE.Group>();
const asked = new Map<ModelName, Promise<THREE.Group | null>>();
let loader: GLTFLoader | null = null;

/** a model, once it is in (null until then; asking starts the fetch) */
export function model(name: ModelName): THREE.Group | null {
  const m = got.get(name);
  if (m) return m;
  load(name);
  return null;
}

/** fetch a model, once */
export function load(name: ModelName): Promise<THREE.Group | null> {
  let p = asked.get(name);
  if (p) return p;
  if (typeof window === 'undefined') { p = Promise.resolve(null); asked.set(name, p); return p; }
  loader ??= new GLTFLoader();
  p = loader.loadAsync(URLS[name]).then(g => {
    const root = g.scene;
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // flat-lit, low-poly look; the glow strips glow; glass is glass
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
      for (const mt of mats) {
        mt.metalness = Math.min(mt.metalness, 0.3);
        if (mt.name === 'glow') { mt.emissive = new THREE.Color(1, 1, 1); mt.emissiveMap = mt.map; mt.emissiveIntensity = 1.2; }
        if (mt.name === 'glass') { mt.depthWrite = false; mt.side = THREE.DoubleSide; }
        if (mt.name.endsWith('foliage')) { mt.side = THREE.DoubleSide; mt.alphaTest = mt.transparent ? 0.5 : 0; }
      }
    });
    got.set(name, root);
    return root;
  }).catch(() => null);
  asked.set(name, p);
  return p;
}

/** the meshes of a model, each with its geometry and material in the model's own frame (for instancing) */
export function parts(root: THREE.Group): { geo: THREE.BufferGeometry; mat: THREE.Material; name: string }[] {
  const out: { geo: THREE.BufferGeometry; mat: THREE.Material; name: string }[] = [];
  root.updateMatrixWorld(true);
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    out.push({ geo, mat: m.material as THREE.Material, name: `${m.name}:${(m.material as THREE.Material).name}` });
  });
  return out;
}
