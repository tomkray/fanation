/**
 * Turns a Blender GLB into instanced parts: meshes are baked into model space
 * and merged per (group, material), so a whole city of copies costs one draw
 * call per part. Material names are the contract with the Blender script.
 */

import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { InstancedPart } from './instancedPart.js';

export interface RuntimeMaterial {
  readonly material: THREE.Material;
  /** Instances carry their own colour (fandom tint, pastel walls, car paint…). */
  readonly tinted: boolean;
  readonly castShadow: boolean;
}

export interface KitPart {
  readonly group: string;
  readonly materialName: string;
  readonly part: InstancedPart;
}

export interface ModelKit {
  readonly name: string;
  readonly parts: readonly KitPart[];
  /** Model-space bounds, before any instance transform. */
  readonly bounds: THREE.Box3;
}

const standard = (color: string, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra });
const glow = (color: string): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color, toneMapped: false });

/** One shared material per Blender material name. */
export function createMaterialLibrary(): Map<string, RuntimeMaterial> {
  const lib = new Map<string, RuntimeMaterial>();
  const put = (name: string, material: THREE.Material, tinted = false, castShadow = true) =>
    lib.set(name, { material, tinted, castShadow });

  put('Walls', standard('#ffffff', { roughness: 0.85 }), true);
  put('Roof', standard('#ffffff', { roughness: 0.6 }), true);
  put('Neon', glow('#ffffff'), true, false);
  put('Window', glow('#ffb24d'), false, false);
  put('Door', standard('#3b2b33'));
  put('Chimney', standard('#2a2e44'));
  put('Podium', standard('#272c42', { roughness: 0.55 }));
  put('Shaft', standard('#151a2e', { metalness: 0.55, roughness: 0.3, flatShading: false }));
  put('Antenna', standard('#8a90a8', { roughness: 0.4 }));
  put('Trunk', standard('#4a3326'));
  put('Leaves', standard('#ffffff'), true);
  put('Body', standard('#ffffff', { metalness: 0.35, roughness: 0.35 }), true);
  put('Glass', standard('#0e1320', { roughness: 0.1 }));
  put('Wheel', standard('#0a0a0c'));
  put('Headlight', glow('#fff6dc'), false, false);
  put('Taillight', glow('#ff2a3a'), false, false);
  put('Pole', standard('#363a4f', { roughness: 0.4 }));
  put('LampGlow', glow('#ffd59a'), false, false);
  put('Pitch', standard('#2f8f47', { roughness: 0.95 }));
  put('Pool', glow('#3fb8ff'), false, false);
  put('Wood', standard('#8d5b3a'));
  put('Metal', standard('#2c3040', { roughness: 0.4 }));
  return lib;
}

const FALLBACK_MATERIAL: RuntimeMaterial = {
  material: standard('#8a8f9f'),
  tinted: false,
  castShadow: true,
};

/** Only positions and normals survive: the city is flat-coloured, so UVs would only block merging. */
function cleanGeometry(source: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal') {
      geometry.deleteAttribute(name);
    }
  }
  geometry.applyMatrix4(matrix);
  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }
  return geometry;
}

export async function loadModelKit(
  name: string,
  url: string,
  loader: GLTFLoader,
  parent: THREE.Object3D,
  materials: ReadonlyMap<string, RuntimeMaterial>,
  groupOf: (objectName: string) => string = () => 'all'
): Promise<ModelKit> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);

  type Bucket = { group: string; materialName: string; geometries: THREE.BufferGeometry[] };
  const buckets = new Map<string, Bucket>();
  const bounds = new THREE.Box3();
  gltf.scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) {
      return;
    }
    const materialName = Array.isArray(obj.material) ? 'Unknown' : obj.material.name || 'Unknown';
    // Multi-primitive meshes get child names; the Blender object is then the parent.
    const objectName = obj.name.includes('_') && obj.parent && obj.parent !== gltf.scene ? obj.parent.name : obj.name;
    const group = groupOf(objectName);
    const key = `${group}|${materialName}`;
    const geometry = cleanGeometry(obj.geometry as THREE.BufferGeometry, obj.matrixWorld);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      bounds.union(geometry.boundingBox);
    }
    const bucket: Bucket = buckets.get(key) ?? { group, materialName, geometries: [] };
    bucket.geometries.push(geometry);
    buckets.set(key, bucket);
  });

  const parts: KitPart[] = [];
  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geometries, false);
    if (!merged) {
      console.warn(`[fanation] could not merge ${name}/${bucket.materialName}`);
      continue;
    }
    const runtime = materials.get(bucket.materialName) ?? FALLBACK_MATERIAL;
    parts.push({
      group: bucket.group,
      materialName: bucket.materialName,
      part: new InstancedPart(parent, merged, runtime.material, {
        tinted: runtime.tinted,
        castShadow: runtime.castShadow,
        receiveShadow: true,
      }),
    });
  }
  return { name, parts, bounds };
}

/** A Tripo-style asset: keeps its own PBR materials and textures, normalised to a 1 × 1 footprint. */
export interface TexturedKit extends ModelKit {
  /** Height of the model when its footprint is 1 unit wide. */
  readonly unitHeight: number;
}

const TEXTURED_ATTRIBUTES = ['position', 'normal', 'uv'] as const;

/**
 * Loads a textured GLB as instanced parts (one per material). The model is
 * re-based so its footprint is centred on the origin, sits on y = 0 and is
 * 1 unit wide on its larger side: callers scale it to the lot or block size.
 */
export async function loadTexturedKit(name: string, url: string, loader: GLTFLoader, parent: THREE.Object3D): Promise<TexturedKit> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new THREE.Vector3());
  const footprint = Math.max(size.x, size.z) || 1;
  const normalize = new THREE.Matrix4()
    .makeScale(1 / footprint, 1 / footprint, 1 / footprint)
    .multiply(new THREE.Matrix4().makeTranslation(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2));

  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  gltf.scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || Array.isArray(obj.material)) {
      return;
    }
    const source = obj.geometry as THREE.BufferGeometry;
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    for (const attribute of Object.keys(geometry.attributes)) {
      if (!(TEXTURED_ATTRIBUTES as readonly string[]).includes(attribute)) {
        geometry.deleteAttribute(attribute);
      }
    }
    if (!geometry.attributes.uv) {
      // Every geometry of a merge must share attributes; an untextured piece gets neutral UVs.
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    }
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalize, obj.matrixWorld));
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }
    const list = buckets.get(obj.material) ?? [];
    list.push(geometry);
    buckets.set(obj.material, list);
  });

  const parts: KitPart[] = [];
  for (const [material, geometries] of buckets) {
    const merged = mergeGeometries(geometries, false);
    if (!merged) {
      console.warn(`[fanation] could not merge ${name}/${material.name || 'material'}`);
      continue;
    }
    if (material instanceof THREE.MeshStandardMaterial) {
      // Imported glow would bloom the whole city white: keep only painted emission maps, softly.
      if (material.emissiveMap) {
        material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.6);
      } else {
        material.emissive.set(0x000000);
      }
    }
    parts.push({
      group: 'all',
      materialName: material.name || 'textured',
      part: new InstancedPart(parent, merged, material, { tinted: false, castShadow: true, receiveShadow: true }),
    });
  }
  return { name, parts, bounds: new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, size.y / footprint, 0.5)), unitHeight: size.y / footprint };
}
