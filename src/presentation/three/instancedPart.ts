/**
 * A growable InstancedMesh: one draw call for every copy of a model part.
 * Each instance can carry an owner (plot index or fandom handle) for picking.
 */

import * as THREE from 'three';

export interface InstancedPartOptions {
  readonly tinted: boolean;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  /** Moving instances (cars) skip bounding-sphere culling. */
  readonly dynamic?: boolean;
}

const INITIAL_CAPACITY = 32;

export class InstancedPart {
  mesh: THREE.InstancedMesh;
  readonly owners: (number | string | null)[] = [];
  private capacity = INITIAL_CAPACITY;
  private count = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    readonly geometry: THREE.BufferGeometry,
    readonly material: THREE.Material,
    private readonly options: InstancedPartOptions
  ) {
    this.mesh = this.createMesh(this.capacity);
    parent.add(this.mesh);
  }

  begin(): void {
    this.count = 0;
    this.owners.length = 0;
  }

  add(matrix: THREE.Matrix4, color?: THREE.Color, owner: number | string | null = null): number {
    if (this.count >= this.capacity) {
      this.grow(this.capacity * 2);
    }
    const index = this.count;
    this.mesh.setMatrixAt(index, matrix);
    if (this.options.tinted && color) {
      this.mesh.setColorAt(index, color);
    }
    this.owners[index] = owner;
    this.count += 1;
    return index;
  }

  setMatrix(index: number, matrix: THREE.Matrix4): void {
    this.mesh.setMatrixAt(index, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
    if (!this.options.dynamic && this.count > 0) {
      this.mesh.computeBoundingSphere();
    }
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }

  private createMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    if (this.options.tinted) {
      // Present from the first frame so the shader is compiled with instance colours.
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    }
    mesh.count = 0;
    mesh.castShadow = this.options.castShadow ?? false;
    mesh.receiveShadow = this.options.receiveShadow ?? false;
    mesh.frustumCulled = !this.options.dynamic;
    mesh.instanceMatrix.setUsage(this.options.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    return mesh;
  }

  private grow(capacity: number): void {
    const next = this.createMesh(capacity);
    next.instanceMatrix.array.set(this.mesh.instanceMatrix.array);
    if (this.mesh.instanceColor && next.instanceColor) {
      next.instanceColor.array.set(this.mesh.instanceColor.array);
    }
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.parent.add(next);
    this.mesh = next;
    this.capacity = capacity;
  }
}
