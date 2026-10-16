/**
 * Partner advertising in the world (Axiom A9): zeppelins that circle each
 * city with the creative on both flanks, billboards inside each city (never on the avenues),
 * and small planes towing a banner. Creatives are drawn by the game from text
 * and colours only, so nothing foreign is ever loaded into the scene; every ad
 * prints the partner's real @handle and a "Sponsored" mark.
 */

import * as THREE from 'three';
import type { AdDto, CitySummaryDto } from '../../shared/apiContract.js';

const BANNER_W = 1024;
const BANNER_H = 256;
const ZEPPELIN_ALTITUDE = 210;
const BANNER_PLANE_ALTITUDE = 120;
/** Game scale, not real scale: an ad has to read from the city view. */
const ZEPPELIN_SCALE = 2.2;
const BANNER_PLANE_SCALE = 2;
const BILLBOARD_SCALE = 1.8;
/** Two blocks off a city plaza, so a billboard sits in the city and never on the avenue. */
const BILLBOARD_STEP_M = 124;
const BILLBOARD_FACING = Math.PI / 4;

interface Flyer {
  readonly group: THREE.Group;
  readonly centreX: number;
  readonly centreZ: number;
  readonly radius: number;
  readonly altitude: number;
  readonly phase: number;
  /** Radians per second; the sign sets the direction of the loop. */
  readonly speed: number;
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, start: number, maxWidth: number): number {
  let size = start;
  do {
    ctx.font = `${weight} ${size}px ui-rounded, -apple-system, "SF Pro Rounded", system-ui, sans-serif`;
    size -= 4;
  } while (ctx.measureText(text).width > maxWidth && size > 18);
  return size + 4;
}

function drawCreative(ad: AdDto): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = BANNER_W;
  canvas.height = BANNER_H;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (!ctx) {
    return texture;
  }
  ctx.fillStyle = ad.backgroundHex;
  ctx.fillRect(0, 0, BANNER_W, BANNER_H);
  ctx.strokeStyle = ad.accentHex;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.roundRect(10, 10, BANNER_W - 20, BANNER_H - 20, 36);
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = ad.accentHex;
  ctx.shadowBlur = 24;
  fitFont(ctx, ad.headline, 800, 108, BANNER_W - 96);
  ctx.fillText(ad.headline, 48, 128);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
  fitFont(ctx, ad.tagline, 600, 46, BANNER_W - 96);
  ctx.fillText(ad.tagline, 50, 186);
  ctx.fillStyle = ad.accentHex;
  const mark = ad.house ? `@${ad.partnerHandle} · Advertise here` : `@${ad.partnerHandle} · Sponsored`;
  fitFont(ctx, mark, 700, 34, BANNER_W - 96);
  ctx.fillText(mark, 50, 230);
  texture.needsUpdate = true;
  return texture;
}

/** Ads for one placement: partners for this city first, then partners for every city, then house inventory. */
function pickFor(ads: readonly AdDto[], cityId: string | null, index: number): AdDto | undefined {
  const local = ads.filter((a) => !a.house && a.city === cityId);
  const global = ads.filter((a) => !a.house && a.city === 'ALL');
  const house = ads.filter((a) => a.house && (a.city === cityId || a.city === 'ALL'));
  const pool = local.length > 0 ? local : global.length > 0 ? global : house;
  return pool.length > 0 ? pool[index % pool.length] : undefined;
}

export class SkyAds {
  private readonly root = new THREE.Group();
  private readonly flyers: Flyer[] = [];
  private readonly textures = new Map<string, THREE.CanvasTexture>();
  private readonly hull = new THREE.SphereGeometry(1, 40, 20);
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly bannerPlane = new THREE.PlaneGeometry(1, 1);
  private readonly hullMaterial = new THREE.MeshStandardMaterial({ color: '#c9ced8', metalness: 0.35, roughness: 0.42, emissive: '#1a2033', emissiveIntensity: 0.6 });
  private readonly darkMaterial = new THREE.MeshStandardMaterial({ color: '#2a3045', roughness: 0.6 });
  private readonly windowMaterial = new THREE.MeshBasicMaterial({ color: '#ffe8a3', toneMapped: false });
  private signature = '';

  constructor(parent: THREE.Object3D) {
    this.root.name = 'sky-ads';
    parent.add(this.root);
  }

  /** Rebuilds only when the ads or the cities actually changed. */
  set(ads: readonly AdDto[], cities: readonly CitySummaryDto[]): void {
    // City size only matters in coarse steps (loop radius), so ordinary growth does not redraw every creative.
    const signature = JSON.stringify([
      ads.map((a) => [a.id, a.headline, a.tagline, a.backgroundHex, a.accentHex]),
      cities.map((c) => [c.id, c.x, c.z, Math.round(Math.sqrt(c.properties) / 4)]),
    ]);
    if (signature === this.signature) {
      return;
    }
    this.signature = signature;
    this.clear();
    const zeppelins = ads.filter((a) => a.placement === 'ZEPPELIN');
    const billboards = ads.filter((a) => a.placement === 'BILLBOARD');
    const banners = ads.filter((a) => a.placement === 'SKY_BANNER');

    cities.forEach((city, i) => {
      const ad = pickFor(zeppelins, city.id, 0);
      if (!ad) {
        return;
      }
      const radius = city.id === 'CAPITAL' ? 900 : THREE.MathUtils.clamp(Math.sqrt(Math.max(1, city.properties)) * 9, 200, 1400);
      this.addFlyer(this.zeppelin(ad), city.x, city.z, radius, ZEPPELIN_ALTITUDE + i * 22, i * 1.3, (i % 2 === 0 ? 1 : -1) * (24 / radius));
    });
    cities
      .filter((c) => c.id !== 'CAPITAL')
      .slice(0, 2)
      .forEach((city, i) => {
        const ad = pickFor(banners, city.id, i);
        if (ad) {
          const radius = THREE.MathUtils.clamp(Math.sqrt(Math.max(1, city.properties)) * 12, 260, 1600);
          this.addFlyer(this.bannerPlaneTow(ad), city.x, city.z, radius, BANNER_PLANE_ALTITUDE, i * 2.1 + 0.6, 30 / radius);
        }
      });

    cities
      .filter((c) => c.id !== 'CAPITAL')
      .forEach((city, cityIndex) => {
        const sx = Math.sign(city.x) || 1;
        const sz = Math.sign(city.z) || 1;
        const spots: readonly [number, number][] = [
          [city.x + sx * BILLBOARD_STEP_M, city.z + sz * BILLBOARD_STEP_M * 0.35],
          [city.x + sx * BILLBOARD_STEP_M * 0.35, city.z + sz * BILLBOARD_STEP_M],
        ];
        spots.forEach(([x, z], i) => {
          const ad = pickFor(billboards, city.id, cityIndex * 2 + i);
          if (ad) {
            this.billboard(ad, x, z);
          }
        });
      });
  }

  update(seconds: number): void {
    for (const f of this.flyers) {
      const angle = f.phase + seconds * f.speed;
      f.group.position.set(f.centreX + Math.cos(angle) * f.radius, f.altitude + Math.sin(seconds * 0.4 + f.phase) * 3, f.centreZ + Math.sin(angle) * f.radius);
      // Nose along the direction of travel: local +x follows the tangent of the loop.
      f.group.rotation.y = -(angle + (f.speed >= 0 ? Math.PI / 2 : -Math.PI / 2));
    }
  }

  /** The ad under the pointer, if any. */
  pick(raycaster: THREE.Raycaster): string | null {
    for (const hit of raycaster.intersectObject(this.root, true)) {
      let node: THREE.Object3D | null = hit.object;
      while (node && node !== this.root) {
        const adId: unknown = node.userData.adId;
        if (typeof adId === 'string') {
          return adId;
        }
        node = node.parent;
      }
    }
    return null;
  }

  dispose(): void {
    this.clear();
    for (const g of [this.hull, this.box, this.bannerPlane]) {
      g.dispose();
    }
    for (const m of [this.hullMaterial, this.darkMaterial, this.windowMaterial]) {
      m.dispose();
    }
    this.root.parent?.remove(this.root);
  }

  // ---------------------------------------------------------------- builders

  private texture(ad: AdDto): THREE.CanvasTexture {
    let texture = this.textures.get(ad.id);
    if (!texture) {
      texture = drawCreative(ad);
      this.textures.set(ad.id, texture);
    }
    return texture;
  }

  private creativePanel(ad: AdDto, width: number, height: number): THREE.Group {
    const material = new THREE.MeshBasicMaterial({ map: this.texture(ad), toneMapped: false, side: THREE.FrontSide });
    material.color.setScalar(0.82);
    const front = new THREE.Mesh(this.bannerPlane, material);
    front.scale.set(width, height, 1);
    const back = front.clone();
    back.rotation.y = Math.PI;
    const panel = new THREE.Group();
    panel.add(front, back);
    return panel;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  }

  private zeppelin(ad: AdDto): THREE.Group {
    const g = new THREE.Group();
    g.userData.adId = ad.id;
    const accent = new THREE.MeshBasicMaterial({ color: ad.accentHex, toneMapped: false });
    g.add(this.mesh(this.hull, this.hullMaterial, 0, 0, 0, 36, 9.5, 9.5));
    // Tail fins (top, bottom, both sides) and the neon nose ring in the partner's colour.
    g.add(this.mesh(this.box, this.darkMaterial, -30, 7, 0, 10, 8, 0.8));
    g.add(this.mesh(this.box, this.darkMaterial, -30, -7, 0, 10, 8, 0.8));
    g.add(this.mesh(this.box, this.darkMaterial, -30, 0, 7, 10, 0.8, 8));
    g.add(this.mesh(this.box, this.darkMaterial, -30, 0, -7, 10, 0.8, 8));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8.4, 0.5, 8, 40), accent);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = 24;
    g.add(ring);
    g.add(this.mesh(this.box, this.darkMaterial, 2, -10.5, 0, 14, 3.6, 5));
    g.add(this.mesh(this.box, this.windowMaterial, 2, -10.4, 0, 11, 1.2, 5.2));
    for (const side of [1, -1]) {
      const panel = this.creativePanel(ad, 50, 12.5);
      panel.position.set(0, 0.5, side * 9.7);
      panel.rotation.y = side > 0 ? 0 : Math.PI;
      g.add(panel);
    }
    const beacon = this.mesh(new THREE.SphereGeometry(1, 12, 8), accent, 0, 9.8, 0, 0.9, 0.9, 0.9);
    g.add(beacon);
    g.scale.setScalar(ZEPPELIN_SCALE);
    return g;
  }

  private bannerPlaneTow(ad: AdDto): THREE.Group {
    const g = new THREE.Group();
    g.userData.adId = ad.id;
    const accent = new THREE.MeshBasicMaterial({ color: ad.accentHex, toneMapped: false });
    g.add(this.mesh(this.box, this.hullMaterial, 0, 0, 0, 9, 2.2, 2.2));
    g.add(this.mesh(this.box, this.hullMaterial, 0.5, 0.2, 0, 2.4, 0.4, 14));
    g.add(this.mesh(this.box, this.darkMaterial, -4, 1.4, 0, 1.8, 2.4, 0.4));
    g.add(this.mesh(this.box, accent, -6, 0, 0, 3, 0.15, 0.15));
    const panel = this.creativePanel(ad, 40, 10);
    panel.position.set(-29, -1, 0);
    g.add(panel);
    g.scale.setScalar(BANNER_PLANE_SCALE);
    return g;
  }

  private billboard(ad: AdDto, x: number, z: number): void {
    const g = new THREE.Group();
    g.userData.adId = ad.id;
    g.position.set(x, 0, z);
    g.rotation.y = BILLBOARD_FACING;
    g.scale.setScalar(BILLBOARD_SCALE);
    const accent = new THREE.MeshBasicMaterial({ color: ad.accentHex, toneMapped: false });
    g.add(this.mesh(this.box, this.darkMaterial, -14, 20, 0, 1.6, 40, 1.6));
    g.add(this.mesh(this.box, this.darkMaterial, 14, 20, 0, 1.6, 40, 1.6));
    g.add(this.mesh(this.box, this.darkMaterial, 0, 47, 0, 50, 15, 1.2));
    g.add(this.mesh(this.box, accent, 0, 55, 0, 50.6, 0.6, 1.4));
    g.add(this.mesh(this.box, accent, 0, 39, 0, 50.6, 0.6, 1.4));
    const panel = this.creativePanel(ad, 48, 12);
    panel.position.set(0, 47, 0);
    g.add(panel);
    this.root.add(g);
  }

  private addFlyer(group: THREE.Group, centreX: number, centreZ: number, radius: number, altitude: number, phase: number, speed: number): void {
    this.root.add(group);
    this.flyers.push({ group, centreX, centreZ, radius, altitude, phase, speed });
  }

  private clear(): void {
    this.flyers.length = 0;
    for (const child of [...this.root.children]) {
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const material = obj.material as THREE.Material;
          if (material !== this.hullMaterial && material !== this.darkMaterial && material !== this.windowMaterial) {
            material.dispose();
          }
          if (obj.geometry !== this.hull && obj.geometry !== this.box && obj.geometry !== this.bannerPlane) {
            obj.geometry.dispose();
          }
        }
      });
      this.root.remove(child);
    }
    for (const texture of this.textures.values()) {
      texture.dispose();
    }
    this.textures.clear();
  }
}
