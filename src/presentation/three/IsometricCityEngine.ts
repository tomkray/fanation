/**
 * Não É Um Fã world renderer.
 *
 * City view — a neon night city of 3×3-lot blocks and streets. Every
 * property's building comes from its class (fans) and its finish from the
 * owner's level (XP). Idols' landmarks rise with their fans; neon arcs link an
 * idol to the places where their neighbourhood continued. Only the chunks the
 * camera sees are loaded; everything repeated is instanced.
 *
 * Planet view — zoom far enough out and the city gives way to the planet: one
 * light per ~500 m chunk of the world (height = population, colour = the
 * dominant district) and the names of the cities. The planet grows with the
 * population, so the cities always sit on its cap.
 */

import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { architectureOf, ArchitectureStyleId, isTowerVisual, STYLE_FALLBACK_FILE, styleScale } from '../../core/architecture.js';
import { BLOCK_PITCH_METERS, CHUNK_BLOCKS, LOT_SIZE_METERS } from '../../core/cityLayout.js';
import { CivicSite, plazaBlockOf, venueKindForCity } from '../../core/civic.js';
import { isTowerClass, PropertyClass, towerHeightMeters } from '../../core/property.js';
import type { AdDto, ChunkSummaryDto, CitySummaryDto, PropertyDto, StandingDto, WorldSummaryDto } from '../../shared/apiContract.js';
import { InstancedPart } from './instancedPart.js';
import { createMaterialLibrary, loadModelKit, loadTexturedKit, ModelKit, RuntimeMaterial, TexturedKit } from './modelKit.js';
import { SkyAds } from './skyAds.js';

export type WorldView = 'city' | 'planet';

export interface CityEngineOptions {
  readonly container: HTMLElement;
  readonly modelBaseUrl: string;
  readonly dracoDecoderUrl: string;
  /** Needed when frames are read back (video capture); costs some GPU bandwidth. */
  readonly preserveDrawingBuffer?: boolean;
  /** Profile picture URL for a handle, or null when pictures are off. */
  readonly avatarUrl?: (handle: string) => string | null;
  readonly onSelectProperty?: (plotIndex: number) => void;
  /** A zeppelin, billboard or towed banner was tapped. */
  readonly onSelectAd?: (adId: string) => void;
  /** Manifest of generated models (Tripo); defaults to /assets/catalog/manifest.json. */
  readonly catalogUrl?: string;
  /** Chunk keys the camera currently sees (city view only), nearest first. */
  readonly onVisibleChunks?: (keys: readonly string[]) => void;
  readonly onViewChange?: (view: WorldView) => void;
}

type HouseClass = 'COTTAGE' | 'HOUSE' | 'TOWNHOUSE' | 'VILLA';
const HOUSE_CLASSES: readonly HouseClass[] = ['COTTAGE', 'HOUSE', 'TOWNHOUSE', 'VILLA'];
/** Same material contract, different silhouettes: each property always gets the same one (by its number). */
const HOUSE_FILES: Readonly<Record<HouseClass, readonly string[]>> = {
  COTTAGE: ['tier_4_common.glb', 'home_cottage_round.glb'],
  HOUSE: ['tier_3_uncommon.glb', 'home_house_l.glb'],
  TOWNHOUSE: ['tier_2_rare.glb', 'home_townhouse_shop.glb'],
  VILLA: ['tier_1_epic.glb', 'home_villa_pool.glb'],
};
const TOWER_FILES: readonly string[] = [
  'tower.glb',
  'tower_round.glb',
  'tower_slab.glb',
  'tower_needle.glb',
  'tower_deco.glb',
  'tower_glass.glb',
  'tower_spire.glb',
  'tower_twist.glb',
  'tower_crown.glb',
];
/** Legacy civic venue meshes (kept on disk); Genesis uses the plaza kit only. */
const VENUE_FILES = { GENESIS: 'venue_community.glb' } as const;
/** Title-deed portrait size (CSS pixels; rendered at 2×). */
const PORTRAIT_W = 320;
const PORTRAIT_H = 220;

function isHouseClass(cls: PropertyClass): cls is HouseClass {
  return cls === 'COTTAGE' || cls === 'HOUSE' || cls === 'TOWNHOUSE' || cls === 'VILLA';
}

const PITCH = BLOCK_PITCH_METERS;
const LOT = LOT_SIZE_METERS;
const CHUNK_PITCH = CHUNK_BLOCKS * PITCH;
/** 3 lots plus a 2 m sidewalk ring. */
const BLOCK_SIZE = 3 * LOT + 4;
const PLATFORM_H = 1;
const STREET_HALF = (PITCH - BLOCK_SIZE) / 2;
const PODIUM_H = 3;
/** The block tower model is 30 m wide; on one lot it is scaled to fit the 16 m plot. */
const LABELLED_IDOLS = 24;
/** Generated models are scaled so their larger side fits these widths (m). */
const HOME_FOOTPRINT_M = 13;
const TOWER_FOOTPRINT_M = 13.5;
const LANDMARK_FOOTPRINT_M = 46;
const DEFAULT_CATALOG_URL = '/assets/catalog/manifest.json';

const ISO_POLAR = Math.atan(Math.SQRT2);
const ISO_AZIMUTH = Math.PI / 4;
const CAMERA_BASE_DISTANCE = 1400;
const BASE_FOG_DENSITY = 0.00028;
const FRUSTUM_HEIGHT = 200;
const RISE_MS = 900;
const RELAYOUT_WAVE_WINDOW_MS = 4_000;
const RELAYOUT_WAVE_SPREAD_MS = 900;
const CLICK_SLOP_PX = 5;
const REBUILD_INTERVAL_MS = 300;
const CHUNK_CHECK_MS = 250;
const MAX_VISIBLE_CHUNKS = 64;
/** Below this zoom (relative to the fitted view) trees, lamps, benches, markings and cars are skipped. */
const DETAIL_ZOOM_RATIO = 0.45;
/**
 * Zoom (relative to the whole city fitted on screen) below which the view
 * flips to the planet, and back (hysteresis). Kept very low so thousands of
 * homes stay on the flat map for a long zoom-out before the sphere appears.
 */
const PLANET_ENTER_RATIO = 0.055;
const PLANET_LEAVE_RATIO = 0.09;
/** Planet-view framing: whole planet on screen, and how far out the wheel may go. */
const PLANET_VIEW_RATIO = 0.07;
const PLANET_MIN_RATIO = 0.03;
const OPENING_ZOOM_RATIO = 2.6;

const WALL_PASTELS = ['#c9b8ff', '#ffc4a3', '#a9c2ff', '#bde5cf', '#f7b5d1', '#e3d7c1', '#9fd9e8'].map((c) => new THREE.Color(c));
const ROOF_BASE = new THREE.Color('#23284a');
const GRASS_HOME = new THREE.Color('#46b062');
const GRASS_PARK = new THREE.Color('#33985a');
const GRASS_VACANT = new THREE.Color('#244a3a');
const PLATFORM_BUILT = new THREE.Color('#323a56');
const PLATFORM_VACANT = new THREE.Color('#222840');
const PLATFORM_AVENUE = new THREE.Color('#141a2c');
const CURB_VACANT = new THREE.Color('#2a7fa8');
const AVENUE_NEON = new THREE.Color('#3ad6ff');
const LEAF_GREENS = ['#2f8a52', '#3a9d5c', '#277a49', '#4aa865'].map((c) => new THREE.Color(c));
const CAR_PAINTS = ['#ff5a5f', '#ffd166', '#4cc9f0', '#f72585', '#e9ecef', '#7bd389', '#9b5de5', '#ff9f1c'].map((c) => new THREE.Color(c));
const MEDALS = [new THREE.Color('#ffd60a'), new THREE.Color('#d9dde8'), new THREE.Color('#ff9f45')];
const GOLD = new THREE.Color('#ffd60a');

/** Integer hash → [0, 1). Stable across reloads so the city never reshuffles. */
function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4_294_967_296;
}

/** Owner's level is the finish: brighter neon as they level up, gold trim from level 10. */
function finish(color: THREE.Color, level: number): THREE.Color {
  const f = THREE.MathUtils.clamp((level - 1) / 14, 0, 1);
  const lit = color.clone().multiplyScalar(0.55 + 0.45 * f);
  return level >= 10 ? lit.lerp(GOLD, 0.35) : lit;
}

/** Height of a property's roof line, for labels. */
function propertyTop(footprint: PropertyDto['footprint'], propertyClass: PropertyClass, fans: number): number {
  if (isTowerClass(propertyClass) || footprint === 'BLOCK') {
    return PLATFORM_H + PODIUM_H + towerHeightMeters(fans, footprint);
  }
  return PLATFORM_H + 12;
}

/**
 * The flat city wraps onto the planet's cap (azimuthal equidistant): the
 * centre of the city is the north pole. Coordinates are relative to the
 * planet's centre.
 */
function toPlanet(x: number, z: number, radius: number, lift = 0): THREE.Vector3 {
  const d = Math.hypot(x, z);
  const theta = d / radius;
  const phi = Math.atan2(z, x);
  const r = radius + lift;
  return new THREE.Vector3(r * Math.sin(theta) * Math.cos(phi), r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi));
}

function chunkKeyAt(x: number, z: number): string {
  return `${Math.floor(Math.round(x / PITCH) / CHUNK_BLOCKS)}:${Math.floor(Math.round(z / PITCH) / CHUNK_BLOCKS)}`;
}

interface BlockInfo {
  readonly bx: number;
  readonly bz: number;
  /** `vacant`: unclaimed city block next to the action, waiting for fans. */
  kind: 'homes' | 'landmark' | 'plaza' | 'vacant';
  readonly lots: Map<string, PropertyDto>;
  readonly districtCounts: Map<string, number>;
  landmark: PropertyDto | null;
  plazaColor: THREE.Color | null;
}

interface Label {
  readonly sprite: THREE.Sprite;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  key: string;
}

interface CarLane {
  readonly axis: 'x' | 'z';
  readonly line: number;
  readonly dir: 1 | -1;
  readonly speed: number;
  readonly phase: number;
  readonly paint: THREE.Color;
}

interface RisingSlot {
  readonly part: InstancedPart;
  readonly index: number;
  readonly base: THREE.Matrix4;
}

type Compose = (x: number, y: number, z: number, rotY?: number, sx?: number, sy?: number, sz?: number) => THREE.Matrix4;

/** One hard cut in a reel. Zoom is a multiple of the fitted city zoom. */
interface CinematicShot {
  readonly t0: number;
  readonly t1: number;
  readonly x: number;
  readonly z: number;
  readonly x1: number;
  readonly z1: number;
  readonly zoom: number;
  readonly zoom1: number;
  readonly azimuth: number;
  readonly azimuth1: number;
  readonly polar: number;
  readonly polar1: number;
  /** Which curve this cut uses. Two shots in a row never share one. */
  readonly move: string;
  /** `planet` frames the whole world. Every other cut stays in the city. */
  readonly view: 'planet' | 'city';
}

/** Each move is a different curve, so a reel never feels like one repeated push. */
function shotEase(move: string, u: number): number {
  const t = Math.min(1, Math.max(0, u));
  switch (move) {
    case 'snap':
      return 1 - (1 - t) ** 4;
    case 'drift':
      return t * t;
    case 'orbit':
      return t;
    case 'crane':
      return Math.sin((t * Math.PI) / 2);
    case 'dolly':
      return t < 0.12 ? (t / 0.12) * 0.04 : 0.04 + ((t - 0.12) / 0.88) * 0.96;
    case 'rise':
      return 1 - (1 - t) ** 2;
    case 'hold':
      return t * 0.2;
    case 'truck':
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    default:
      return t * t * (3 - 2 * t);
  }
}

function lerpAngle(from: number, to: number, t: number): number {
  let delta = to - from;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return from + delta * t;
}

export class IsometricCityEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly controls: MapControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly moon: THREE.DirectionalLight;
  private readonly fog = new THREE.FogExp2('#0b1020', BASE_FOG_DENSITY);
  private readonly raycaster = new THREE.Raycaster();
  private readonly world = new THREE.Group();
  private readonly ground: THREE.Mesh;
  private readonly grid: THREE.GridHelper;
  /** Drawn after bloom so labels stay crisp and always on top. */
  private readonly labelScene = new THREE.Scene();
  private readonly materials: Map<string, RuntimeMaterial>;
  private readonly resizeObserver: ResizeObserver;
  private readonly modelsReady: Promise<void>;

  private readonly houseKits = new Map<HouseClass, ModelKit[]>();
  private towerKits: ModelKit[] = [];
  /** Built-in house and tower kits, keyed by filename so a style can find its mesh. */
  private readonly kitsByFile = new Map<string, ModelKit>();
  private readonly venueKits = new Map<string, ModelKit>();
  private portraitRenderer: THREE.WebGLRenderer | null = null;
  private readonly portraitCache = new Map<string, string>();
  /** Generated variants by slot: a property class (COTTAGE…MEGATOWER) or a city id for landmarks. */
  private readonly catalog = new Map<string, TexturedKit[]>();
  private plazaKit: ModelKit | null = null;
  private treeKit: ModelKit | null = null;
  private carKit: ModelKit | null = null;
  private lampKit: ModelKit | null = null;
  private benchKit: ModelKit | null = null;

  private readonly platforms: InstancedPart;
  private readonly curbs: InstancedPart;
  private readonly lots: InstancedPart;
  private readonly markings: InstancedPart;
  private readonly towerBands: InstancedPart;
  private readonly medals: InstancedPart;
  private readonly hologram: THREE.InstancedMesh;
  private readonly hologramGroup = new THREE.Group();
  private readonly links: THREE.LineSegments;
  private readonly beams = new Map<string, THREE.Mesh>();
  private readonly labels = new Map<string, Label>();
  private readonly avatars = new Map<string, HTMLImageElement | null>();
  private readonly avatarTries = new Map<string, number>();

  private readonly planetGroup = new THREE.Group();
  private readonly planetBody: THREE.Group;
  private planetLights: THREE.InstancedMesh | null = null;
  private planetChunks: readonly ChunkSummaryDto[] = [];
  private readonly cityLabels = new Map<string, Label>();
  private planetRadius = 3000;
  private cameraDistance = CAMERA_BASE_DISTANCE;
  private view: WorldView = 'city';

  private readonly skyAds: SkyAds;
  private ads: readonly AdDto[] = [];
  private readonly selection = new THREE.Group();
  private readonly selectionRing: THREE.Mesh;
  private readonly selectionBeam: THREE.Mesh;
  private readonly selectionMarker: THREE.Mesh;
  private selectionTop = PLATFORM_H + 12;
  private selectionRadius = LOT * 0.62;
  /** When the map was last reorganized: the next loaded chunks rebuild themselves in a wave. */
  private relayoutAtMs = Number.NEGATIVE_INFINITY;

  private readonly properties = new Map<number, PropertyDto>();
  private standings: readonly StandingDto[] = [];
  private instagramVerified = new Set<string>();
  private readonly standingByHandle = new Map<string, StandingDto>();
  private cities: readonly CitySummaryDto[] = [];
  private knownChunkKeys = new Set<string>();
  private readonly heights = new Map<number, number>();
  private readonly rising = new Map<number, number>();
  private readonly risingSlots = new Map<number, RisingSlot[]>();
  private carLanes: CarLane[] = [];
  private carBounds = { minX: -PITCH, maxX: PITCH, minZ: -PITCH, maxZ: PITCH };
  private cityRadius = 600;
  private fitZoom = 1;
  private hasFitted = false;
  private dirty = false;
  private lastRebuildMs = 0;
  private builtWithDetail = true;
  private lastChunkCheckMs = 0;
  private lastChunkSignature = '';
  private disposed = false;
  private frameHandle: number | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private cinematicFocus: THREE.Vector3 | null = null;
  /** Hard-cut shot list for a reel. Empty means the original single orbit. */
  private cinematicShots: CinematicShot[] = [];
  /** True only for the cinematic frame currently being drawn. The next live frame clears it. */
  private hideSkyCraft = false;
  /** Bumps on every camera flight so a newer search cancels the one still in the air. */
  private cameraFlight = 0;

  constructor(private readonly options: CityEngineOptions) {
    const { container } = options;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    const aspect = width / height;
    this.camera = new THREE.OrthographicCamera((-FRUSTUM_HEIGHT * aspect) / 2, (FRUSTUM_HEIGHT * aspect) / 2, FRUSTUM_HEIGHT / 2, -FRUSTUM_HEIGHT / 2, 1, 20_000);
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false;
    this.controls.minPolarAngle = ISO_POLAR;
    this.controls.maxPolarAngle = ISO_POLAR;
    this.controls.minZoom = 0.02;
    this.controls.maxZoom = 10;
    this.controls.zoomToCursor = true;
    this.placeCamera(new THREE.Vector3(), ISO_AZIMUTH);

    this.scene.background = new THREE.Color('#0b1020');
    this.scene.fog = this.fog;
    this.scene.add(new THREE.HemisphereLight('#8f9bff', '#1d2236', 1.9));
    this.moon = new THREE.DirectionalLight('#d2d9ff', 2.1);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.6;
    this.scene.add(this.moon, this.moon.target);
    this.scene.add(this.world);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(60_000, 60_000), new THREE.MeshStandardMaterial({ color: '#161b2b', roughness: 0.95 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(PITCH * 240, 480, '#262e47', '#1d2338');
    this.grid.position.y = 0.02;
    this.scene.add(this.grid);

    this.materials = createMaterialLibrary();
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.platforms = new InstancedPart(this.world, new THREE.BoxGeometry(BLOCK_SIZE, PLATFORM_H, BLOCK_SIZE), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), { tinted: true, receiveShadow: true });
    this.curbs = new InstancedPart(this.world, box, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), { tinted: true });
    this.lots = new InstancedPart(this.world, new THREE.BoxGeometry(LOT - 2, 0.3, LOT - 2), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), { tinted: true, receiveShadow: true });
    this.markings = new InstancedPart(this.world, box, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), { tinted: true });
    this.towerBands = new InstancedPart(this.world, new THREE.BoxGeometry(14.6, 0.35, 14.6), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), { tinted: true });
    this.medals = new InstancedPart(this.world, new THREE.TorusGeometry(10.5, 0.6, 8, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), { tinted: true });

    this.links = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.links.frustumCulled = false;
    this.links.raycast = () => undefined;
    this.world.add(this.links);

    // Floating golden-spiral hologram over Genesis: the naoeumfa mark in light.
    const dots = 89;
    this.hologram = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), dots);
    const m = new THREE.Matrix4();
    for (let n = 0; n < dots; n += 1) {
      const angle = n * ((137.50776405003785 * Math.PI) / 180);
      const r = 1.4 * Math.sqrt(n + 1);
      m.makeTranslation(r * Math.cos(angle), 0, r * Math.sin(angle));
      this.hologram.setMatrixAt(n, m);
      this.hologram.setColorAt(n, new THREE.Color().setHSL((n / dots + 0.55) % 1, 0.9, 0.6));
    }
    this.hologramGroup.add(this.hologram);
    this.hologramGroup.position.set(0, PLATFORM_H + 11, 0);
    this.world.add(this.hologramGroup);

    this.skyAds = new SkyAds(this.world);

    const glow = (opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    this.selectionRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 8, 64).rotateX(Math.PI / 2), glow(1));
    this.selectionRing.position.y = PLATFORM_H + 0.6;
    this.selectionBeam = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 1, 20, 1, true).translate(0, 0.5, 0), glow(0.3));
    this.selectionMarker = new THREE.Mesh(new THREE.OctahedronGeometry(9).scale(1, 1.5, 1), glow(0.95));
    for (const mesh of [this.selectionRing, this.selectionBeam, this.selectionMarker]) {
      mesh.raycast = () => undefined;
      mesh.renderOrder = 5;
    }
    this.selection.add(this.selectionRing, this.selectionBeam, this.selectionMarker);
    this.selection.visible = false;
    this.world.add(this.selection);

    this.planetBody = this.createPlanetBody();
    this.planetGroup.add(this.planetBody);
    this.planetGroup.visible = false;
    this.scene.add(this.planetGroup);
    this.applyPlanetRadius(this.planetRadius);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.85, 0.5, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.bindPicking();
    this.modelsReady = this.loadModels();
  }

  get ready(): Promise<void> {
    return this.modelsReady;
  }

  get currentView(): WorldView {
    return this.view;
  }

  /** Rankings, cities and the planet overview; cheap to call on every version. */
  setWorld(summary: WorldSummaryDto): void {
    this.standings = summary.standings;
    this.instagramVerified = new Set((summary.instagramVerified ?? []).map((handle) => handle.toLowerCase()));
    this.standingByHandle.clear();
    for (const s of summary.standings) {
      this.standingByHandle.set(s.fandomHandle, s);
    }
    this.cities = summary.cities;
    this.knownChunkKeys = new Set(summary.chunks.map((c) => c.key));
    this.cityRadius = Math.max(
      600,
      ...summary.chunks.map((c) => Math.hypot(c.x, c.z) + CHUNK_PITCH * 0.75),
      ...summary.cities.map((c) => Math.hypot(c.x, c.z) + PITCH * 4)
    );
    if (summary.planetRadius !== this.planetRadius) {
      this.applyPlanetRadius(summary.planetRadius);
    }
    this.planetChunks = summary.chunks;
    this.rebuildPlanetLights();
    this.skyAds.set(this.ads, this.cities);
    this.updateCityLabels();
    this.updateLabels();
    // The fitted zoom follows the city as it grows; the camera itself only moves the first time.
    this.fitZoom = this.computeFitZoom();
    this.controls.minZoom = Math.min(this.fitZoom * PLANET_MIN_RATIO, this.planetFrameZoom() * 0.8);
    if (!this.hasFitted) {
      // Open on the #1 idol's district, where the city is liveliest; the whole world is one zoom-out away.
      const leader = summary.standings[0];
      this.placeCamera(new THREE.Vector3(leader?.districtX ?? 0, 0, leader?.districtZ ?? 0), ISO_AZIMUTH);
      this.camera.zoom = leader ? this.fitZoom * OPENING_ZOOM_RATIO : this.fitZoom;
      this.camera.updateProjectionMatrix();
      this.hasFitted = true;
    }
    this.dirty = true;
  }

  /**
   * Marks the selected property: a pulsing neon ring on its lot, a light beam
   * and a floating diamond above its roof. Null clears it.
   */
  highlight(target: Pick<PropertyDto, 'x' | 'z' | 'footprint' | 'propertyClass' | 'fans' | 'colorHex'> | null): void {
    if (!target) {
      this.selection.visible = false;
      return;
    }
    const color = new THREE.Color(target.colorHex).lerp(new THREE.Color('#ffffff'), 0.35);
    this.selection.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.MeshBasicMaterial).color.copy(color);
      }
    });
    this.selectionRadius = target.footprint === 'BLOCK' ? BLOCK_SIZE * 0.66 : LOT * 0.85;
    this.selectionTop = propertyTop(target.footprint, target.propertyClass, target.fans);
    this.selection.position.set(target.x, 0, target.z);
    this.selection.visible = true;
  }

  /**
   * A three-quarter "portrait" of one property — the same model, variant and
   * colours as on the map — for its title deed. Rendered once per look on a
   * small separate canvas and cached as a PNG data URL.
   */
  async portrait(p: Pick<PropertyDto, 'plotIndex' | 'footprint' | 'propertyClass' | 'fans' | 'colorHex' | 'level' | 'city'>): Promise<string | null> {
    await this.modelsReady;
    const key = `${p.plotIndex}|${p.propertyClass}|${p.fans}|${p.level}|${p.colorHex}|${p.footprint}`;
    const cached = this.portraitCache.get(key);
    if (cached) {
      return cached;
    }
    const model = this.portraitModel(p);
    if (!model) {
      return null;
    }
    if (!this.portraitRenderer) {
      this.portraitRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.portraitRenderer.setPixelRatio(2);
      this.portraitRenderer.setSize(PORTRAIT_W, PORTRAIT_H);
      this.portraitRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.portraitRenderer.toneMappingExposure = 1.15;
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#c9d1ff', '#262b40', 2.4));
    const sun = new THREE.DirectionalLight('#ffffff', 2.6);
    sun.position.set(40, 80, 60);
    scene.add(sun, model.group);
    // Frame the bounding sphere so the whole building always fits, whatever its proportions.
    const sphere = new THREE.Box3().setFromObject(model.group).getBoundingSphere(new THREE.Sphere());
    const fov = 28;
    const camera = new THREE.PerspectiveCamera(fov, PORTRAIT_W / PORTRAIT_H, 0.1, 5000);
    const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(fov / 2))) * 1.08;
    camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.7, 1.15).normalize().multiplyScalar(distance));
    camera.lookAt(sphere.center);
    this.portraitRenderer.render(scene, camera);
    const url = this.portraitRenderer.domElement.toDataURL('image/png');
    model.dispose();
    this.portraitCache.set(key, url);
    return url;
  }

  /** Assembles the property's model the way rebuildCity places it, as plain meshes. */
  private portraitModel(p: Pick<PropertyDto, 'plotIndex' | 'footprint' | 'propertyClass' | 'fans' | 'colorHex' | 'level' | 'city'>): { readonly group: THREE.Group; readonly dispose: () => void } | null {
    const district = new THREE.Color(p.colorHex);
    const group = new THREE.Group();
    const clones: THREE.Material[] = [];
    const add = (kit: ModelKit, tint: (materialName: string) => THREE.Color | undefined, matrixFor: (part: string) => THREE.Matrix4): void => {
      for (const { group: partGroup, materialName, part } of kit.parts) {
        const color = tint(materialName);
        let material = part.material;
        if (color && (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial)) {
          const clone = material.clone();
          clone.color.copy(color);
          clones.push(clone);
          material = clone;
        }
        const mesh = new THREE.Mesh(part.geometry, material);
        mesh.applyMatrix4(matrixFor(partGroup));
        group.add(mesh);
      }
    };
    const neon = finish(district, p.level);
    const look = architectureOf(p.plotIndex, p.fans, p.footprint);
    if (isTowerVisual(look.visualClass) || p.footprint === 'BLOCK') {
      const kit = this.kitForStyle(look.style.id, look.style.file);
      if (!kit) {
        return null;
      }
      const height = Math.min(160, look.heightMeters);
      const s = styleScale(look.style, p.footprint);
      add(
        kit,
        (m) => (m === 'Neon' ? neon : undefined),
        (part) =>
          part === 'base'
            ? new THREE.Matrix4().makeScale(s, 1, s)
            : part === 'body'
              ? new THREE.Matrix4().makeTranslation(0, PODIUM_H, 0).multiply(new THREE.Matrix4().makeScale(s, height, s))
              : new THREE.Matrix4().makeTranslation(0, PODIUM_H + height, 0).multiply(new THREE.Matrix4().makeScale(s, s, s))
      );
    } else {
      const kit = this.kitForStyle(look.style.id, look.style.file) ?? this.houseKits.get(isHouseClass(p.propertyClass) ? p.propertyClass : 'COTTAGE')?.[0];
      if (!kit) {
        return null;
      }
      const walls = WALL_PASTELS[Math.floor(hash01(p.plotIndex) * WALL_PASTELS.length)];
      const roof = ROOF_BASE.clone().lerp(district, 0.32);
      add(kit, (m) => (m === 'Walls' ? walls : m === 'Roof' ? roof : m === 'Neon' ? neon : undefined), () => new THREE.Matrix4());
    }
    return { group, dispose: () => clones.forEach((m) => m.dispose()) };
  }

  /** Live partner ads; drawn in the city view only. */
  setAds(ads: readonly AdDto[]): void {
    this.ads = ads;
    this.skyAds.set(ads, this.cities);
  }

  /**
   * `load`: a chunk came into view (appears as it is). `live`: the change feed
   * (new homes rise, towers grow). `reset`: the map was reorganized — what is
   * shown is dropped and the chunks that load next rebuild themselves in a wave.
   */
  upsertProperties(list: readonly PropertyDto[], mode: 'load' | 'live' | 'reset'): void {
    const now = performance.now();
    if (mode === 'reset') {
      this.properties.clear();
      this.rising.clear();
      this.relayoutAtMs = now;
    }
    const playing = this.cinematicFocus === null && this.lastRebuildMs > 0;
    const animate = mode === 'live' && playing;
    const wave = mode === 'load' && playing && now - this.relayoutAtMs < RELAYOUT_WAVE_WINDOW_MS;
    for (const property of list) {
      const isNew = !this.properties.has(property.plotIndex);
      this.properties.set(property.plotIndex, property);
      if (isNew && animate) {
        this.rising.set(property.plotIndex, now);
      } else if (isNew && wave) {
        // Staggered so the rebuilt city grows back like a wave instead of popping in at once.
        this.rising.set(property.plotIndex, now + hash01(property.plotIndex, 7) * RELAYOUT_WAVE_SPREAD_MS);
      }
      if (!this.heights.has(property.plotIndex)) {
        this.heights.set(property.plotIndex, isNew && animate ? 4 : towerHeightMeters(property.fans, property.footprint));
      }
    }
    this.dirty = true;
  }

  /** False when the handle is neither ranked nor loaded; the caller then looks it up. */
  focusHandle(handle: string): boolean {
    const standing = this.standingByHandle.get(handle);
    const property = standing ? null : [...this.properties.values()].find((p) => p.minterHandle === handle);
    const x = standing?.districtX ?? property?.x;
    const z = standing?.districtZ ?? property?.z;
    if (x === undefined || z === undefined) {
      return false;
    }
    this.animateCameraTo(new THREE.Vector3(x, 0, z), Math.max(this.camera.zoom, this.fitZoom * 2.4));
    return true;
  }

  focusPoint(x: number, z: number): void {
    this.animateCameraTo(new THREE.Vector3(x, 0, z), Math.max(this.camera.zoom, this.fitZoom * 3));
  }

  /**
   * Flies to one house and rings it, wide enough to read the neighborhood.
   * Returns the chunk the house lives in.
   */
  focusHome(target: Pick<PropertyDto, 'x' | 'z' | 'footprint' | 'propertyClass' | 'fans' | 'colorHex'>): string {
    this.applyView('city');
    this.highlight(target);
    // About three blocks across: the house stays ringed, and the streets around it stay in frame.
    const span = Math.max(150, this.selectionTop * 1.8);
    const zoom = THREE.MathUtils.clamp(FRUSTUM_HEIGHT / span, this.controls.minZoom, this.controls.maxZoom);
    this.animateCameraTo(new THREE.Vector3(target.x, 0, target.z), zoom, true);
    return chunkKeyAt(target.x, target.z);
  }

  setView(view: WorldView): void {
    if (view === 'planet') {
      this.animateCameraTo(new THREE.Vector3(), Math.min(this.fitZoom * PLANET_VIEW_RATIO, this.planetFrameZoom()));
    } else {
      this.animateCameraTo(new THREE.Vector3(), this.fitZoom);
    }
  }

  /**
   * The camera always stays outside the planet: ortho framing does not depend
   * on distance, so it simply backs off, and the fog is thinned to match.
   */
  private applyPlanetRadius(radius: number): void {
    this.planetRadius = radius;
    this.cameraDistance = CAMERA_BASE_DISTANCE + 2.5 * radius;
    this.fog.density = (BASE_FOG_DENSITY * CAMERA_BASE_DISTANCE) / this.cameraDistance;
    this.camera.far = this.cameraDistance + 3 * radius;
    this.camera.updateProjectionMatrix();
    this.placeCamera(this.controls.target.clone(), this.currentAzimuth());
    this.planetBody.scale.setScalar(radius);
    this.planetGroup.position.set(0, -radius, 0);
  }

  /** Zoom at which the whole planet fits the shorter side of the screen. */
  private planetFrameZoom(): number {
    const shorter = Math.min(FRUSTUM_HEIGHT, this.camera.right - this.camera.left);
    return shorter / (this.planetRadius * 2.6);
  }

  start(): void {
    const loop = (): void => {
      this.frameHandle = requestAnimationFrame(loop);
      this.controls.update();
      this.tick(performance.now() / 1000, performance.now());
      this.renderFrame();
    };
    if (this.frameHandle === null) {
      this.frameHandle = requestAnimationFrame(loop);
    }
  }

  /**
   * Cinematic sweep for the video agent. With `manual`, nothing renders on its
   * own: the caller drives deterministic frames through `renderCinematicFrame`.
   */
  enableCinematic(focusHandle: string | null, manual: boolean): void {
    this.controls.enabled = false;
    const s = focusHandle ? this.standingByHandle.get(focusHandle) : undefined;
    this.cinematicFocus = s ? new THREE.Vector3(s.districtX, 0, s.districtZ) : new THREE.Vector3();
    this.rising.clear();
    for (const property of this.properties.values()) {
      this.heights.set(property.plotIndex, towerHeightMeters(property.fans, property.footprint));
    }
    this.rebuildCity(true);
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    if (!manual) {
      const startMs = performance.now();
      const loop = (): void => {
        this.frameHandle = requestAnimationFrame(loop);
        this.renderCinematicFrame((performance.now() - startMs) / 1000);
      };
      this.frameHandle = requestAnimationFrame(loop);
    }
  }

  /** Replaces the single orbit with hard cuts. Each shot eases on its own. */
  setCinematicShots(raw: readonly unknown[]): void {
    if (!Array.isArray(raw)) {
      return;
    }
    const shots: CinematicShot[] = [];
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }
      const source = item as Record<string, unknown>;
      const num = (key: string, fallback: number): number => {
        const value = source[key];
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
      };
      const t0 = num('t0', 0);
      const x = num('x', 0);
      const z = num('z', 0);
      const zoom = num('zoom', 1);
      const azimuth = num('azimuth', ISO_AZIMUTH);
      const polar = num('polar', ISO_POLAR);
      shots.push({
        t0,
        t1: Math.max(t0 + 0.05, num('t1', t0 + 1)),
        x,
        z,
        x1: num('x1', x),
        z1: num('z1', z),
        zoom,
        zoom1: num('zoom1', zoom),
        azimuth,
        azimuth1: num('azimuth1', azimuth),
        polar: THREE.MathUtils.clamp(polar, 0.35, 1.48),
        polar1: THREE.MathUtils.clamp(num('polar1', polar), 0.35, 1.48),
        move: typeof source.move === 'string' ? source.move : 'ease',
        view: source.view === 'planet' ? 'planet' : 'city',
      });
    }
    this.cinematicShots = shots;
  }

  /** Pure function of `tSeconds`: the same t always renders the same frame. */
  renderCinematicFrame(tSeconds: number): void {
    const shot = this.shotAt(tSeconds);
    if (shot) {
      const span = Math.max(0.05, shot.t1 - shot.t0);
      const u = THREE.MathUtils.clamp((tSeconds - shot.t0) / span, 0, 1);
      const ease = shotEase(shot.move, u);
      const punch = shot.move === 'snap' ? Math.exp(-(tSeconds - shot.t0) * 9) * 0.12 : 0;
      if (shot.view === 'planet') {
        this.applyView('planet');
        const center = new THREE.Vector3(0, -this.planetRadius, 0);
        this.placeCamera(center, lerpAngle(shot.azimuth, shot.azimuth1, ease), THREE.MathUtils.lerp(shot.polar, shot.polar1, ease));
        this.camera.zoom = this.planetFrameZoom() * THREE.MathUtils.lerp(shot.zoom, shot.zoom1, ease);
      } else {
        if (this.view !== 'city') {
          this.applyView('city');
        }
        const target = new THREE.Vector3(THREE.MathUtils.lerp(shot.x, shot.x1, ease), 0, THREE.MathUtils.lerp(shot.z, shot.z1, ease));
        this.placeCamera(target, lerpAngle(shot.azimuth, shot.azimuth1, ease), THREE.MathUtils.lerp(shot.polar, shot.polar1, ease));
        this.camera.zoom = this.fitZoom * THREE.MathUtils.lerp(shot.zoom, shot.zoom1, ease) * (1 + punch);
      }
    } else {
      const focus = this.cinematicFocus ?? new THREE.Vector3();
      const eased = 1 - (1 - Math.min(1, tSeconds / 8)) ** 3;
      const target = new THREE.Vector3().lerpVectors(new THREE.Vector3(), focus, eased * 0.85);
      this.placeCamera(target, ISO_AZIMUTH + tSeconds * ((2 * Math.PI) / 28));
      this.camera.zoom = this.fitZoom * (0.9 + 1.3 * eased);
    }
    this.camera.updateProjectionMatrix();
    // A zeppelin looping the district will fill a close lens. Wide shots keep the craft.
    this.hideSkyCraft = shot !== null && shot.view !== 'planet' && this.camera.zoom > this.fitZoom * 16;
    this.tick(tSeconds, tSeconds * 1000);
    this.hideSkyCraft = false;
    this.renderFrame();
  }

  private shotAt(tSeconds: number): CinematicShot | null {
    if (this.cinematicShots.length === 0) {
      return null;
    }
    return this.cinematicShots.find((shot) => tSeconds >= shot.t0 && tSeconds < shot.t1) ?? this.cinematicShots[this.cinematicShots.length - 1];
  }

  dispose(): void {
    this.disposed = true;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
    }
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.skyAds.dispose();
    for (const scene of [this.scene, this.labelScene]) {
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
        }
      });
    }
    for (const label of [...this.labels.values(), ...this.cityLabels.values()]) {
      label.texture.dispose();
      (label.sprite.material as THREE.SpriteMaterial).dispose();
    }
    for (const runtime of this.materials.values()) {
      runtime.material.dispose();
    }
    this.composer.dispose();
    this.renderer.dispose();
    this.portraitRenderer?.dispose();
    this.renderer.domElement.remove();
  }

  private renderFrame(): void {
    this.composer.render();
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.labelScene, this.camera);
    this.renderer.autoClear = true;
  }

  // ---------------------------------------------------------------- loading

  private async loadModels(): Promise<void> {
    const draco = new DRACOLoader();
    draco.setDecoderPath(this.options.dracoDecoderUrl);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    const url = (file: string): string => `${this.options.modelBaseUrl}${file}`;
    const load = async (name: string, file: string, groupOf?: (objectName: string) => string): Promise<ModelKit | null> => {
      try {
        return await loadModelKit(name, url(file), loader, this.world, this.materials, groupOf);
      } catch (err) {
        console.warn(`[naoeumfa] ${file} failed to load; that layer stays empty`, err);
        return null;
      }
    };
    const towerGroup = (objectName: string): string =>
      objectName.startsWith('Podium') ? 'base' : objectName === 'Shaft' || objectName.startsWith('Fin') || objectName.startsWith('Seam') ? 'body' : 'top';

    const venueCities = Object.keys(VENUE_FILES) as (keyof typeof VENUE_FILES)[];
    const [houses, towers, venues, plaza, tree, car, lamp, bench] = await Promise.all([
      Promise.all(HOUSE_CLASSES.map((cls) => Promise.all(HOUSE_FILES[cls].map((file) => load(`${cls}:${file}`, file))))),
      Promise.all(TOWER_FILES.map((file) => load(file, file, towerGroup))),
      Promise.all(venueCities.map((city) => load(`venue:${city}`, VENUE_FILES[city]))),
      load('plaza', 'plaza.glb'),
      load('tree', 'tree.glb'),
      load('car', 'car.glb'),
      load('lamp', 'street_lamp.glb'),
      load('bench', 'bench.glb'),
    ]);
    HOUSE_CLASSES.forEach((cls, i) => {
      const kits = houses[i].filter((k): k is ModelKit => k !== null);
      if (kits.length > 0) {
        this.houseKits.set(cls, kits);
      }
      HOUSE_FILES[cls].forEach((file, fi) => {
        const kit = houses[i][fi];
        if (kit) {
          this.kitsByFile.set(file, kit);
        }
      });
    });
    this.towerKits = towers.filter((k): k is ModelKit => k !== null);
    TOWER_FILES.forEach((file, i) => {
      const kit = towers[i];
      if (kit) {
        this.kitsByFile.set(file, kit);
      }
    });
    venueCities.forEach((city, i) => {
      const kit = venues[i];
      if (kit) {
        this.venueKits.set(city, kit);
      }
    });
    this.plazaKit = plaza;
    this.treeKit = tree;
    this.carKit = car;
    this.lampKit = lamp;
    this.benchKit = bench;
    car?.parts.forEach(({ part }) => {
      part.mesh.frustumCulled = false;
      part.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    });
    await this.loadCatalog(loader);
    draco.dispose();
    this.dirty = true;
  }

  /**
   * Generated models listed in the catalogue manifest. Missing or broken
   * entries are skipped: that class or city simply keeps its built-in model.
   */
  private async loadCatalog(loader: GLTFLoader): Promise<void> {
    const manifestUrl = this.options.catalogUrl ?? DEFAULT_CATALOG_URL;
    let entries: { readonly id: string; readonly slot: string; readonly file: string }[] = [];
    try {
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        return;
      }
      const body: unknown = await response.json();
      const assets = typeof body === 'object' && body !== null ? (body as { assets?: unknown }).assets : undefined;
      entries = (Array.isArray(assets) ? assets : []).filter(
        (a): a is { id: string; slot: string; file: string } =>
          typeof a === 'object' && a !== null && typeof a.id === 'string' && typeof a.slot === 'string' && typeof a.file === 'string' && /^[a-z0-9._-]+\.glb$/i.test(a.file)
      );
    } catch (err) {
      console.warn('[naoeumfa] catalogue manifest unreadable; built-in models only', err);
      return;
    }
    const base = new URL('.', new URL(manifestUrl, window.location.href)).toString();
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const kit = await loadTexturedKit(entry.id, `${base}${entry.file}`, loader, this.world);
          this.catalog.set(entry.slot, [...(this.catalog.get(entry.slot) ?? []), kit]);
        } catch (err) {
          console.warn(`[naoeumfa] ${entry.file} failed to load; ${entry.slot} keeps its built-in model`, err);
        }
      })
    );
    // Load order is not deterministic; variant choice must be.
    for (const [slot, kits] of this.catalog) {
      this.catalog.set(slot, [...kits].sort((a, b) => a.name.localeCompare(b.name)));
    }
  }

  // ---------------------------------------------------------------- city build

  private collectBlocks(): Map<string, BlockInfo> {
    const blocks = new Map<string, BlockInfo>();
    const blockAt = (bx: number, bz: number): BlockInfo => {
      const key = `${bx}:${bz}`;
      let block = blocks.get(key);
      if (!block) {
        block = { bx, bz, kind: 'homes', lots: new Map(), districtCounts: new Map(), landmark: null, plazaColor: null };
        blocks.set(key, block);
      }
      return block;
    };
    for (const city of this.cities) {
      const block = blockAt(Math.round(city.x / PITCH), Math.round(city.z / PITCH));
      block.kind = 'plaza';
      block.plazaColor = new THREE.Color(city.colorHex);
    }
    for (const property of this.properties.values()) {
      const block = blockAt(Math.round(property.x / PITCH), Math.round(property.z / PITCH));
      if (property.footprint === 'BLOCK') {
        block.kind = 'landmark';
        block.landmark = property;
        continue;
      }
      const i = Math.round((property.x - block.bx * PITCH) / LOT);
      const j = Math.round((property.z - block.bz * PITCH) / LOT);
      block.lots.set(`${i}:${j}`, property);
      block.districtCounts.set(property.districtHandle, (block.districtCounts.get(property.districtHandle) ?? 0) + 1);
    }
    // A ring of vacant blocks stitches the districts into one continuous city; the avenues stay open road.
    for (const block of [...blocks.values()]) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bx = block.bx + dx;
          const bz = block.bz + dz;
          const key = `${bx}:${bz}`;
          if (!blocks.has(key) && bx !== 0 && bz !== 0) {
            blocks.set(key, { bx, bz, kind: 'vacant', lots: new Map(), districtCounts: new Map(), landmark: null, plazaColor: null });
          }
        }
      }
    }
    return blocks;
  }

  private rebuildCity(detail: boolean): void {
    const blocks = this.collectBlocks();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const compose: Compose = (x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1) => m.compose(p.set(x, y, z), q.setFromAxisAngle(up, rotY), s.set(sx, sy, sz));

    const pools = [this.platforms, this.curbs, this.lots, this.markings, this.towerBands, this.medals];
    for (const pool of pools) {
      pool.begin();
    }
    const kits = [...this.allBuildingKits(), this.plazaKit, this.treeKit, this.lampKit, this.benchKit];
    for (const kit of kits) {
      kit?.parts.forEach(({ part }) => part.begin());
    }
    this.risingSlots.clear();

    const topTen = new Set(this.standings.filter((st) => st.rankPosition <= 10).map((st) => st.fandomHandle));
    const streets = new Set<string>();
    let minBx = 0;
    let maxBx = 0;
    let minBz = 0;
    let maxBz = 0;

    for (const block of blocks.values()) {
      const cx = block.bx * PITCH;
      const cz = block.bz * PITCH;
      const vacant = block.kind === 'vacant';
      if (!vacant) {
        minBx = Math.min(minBx, block.bx);
        maxBx = Math.max(maxBx, block.bx);
        minBz = Math.min(minBz, block.bz);
        maxBz = Math.max(maxBz, block.bz);
      }
      this.platforms.add(compose(cx, PLATFORM_H / 2, cz), vacant ? PLATFORM_VACANT : PLATFORM_BUILT);

      // Neon curb: the block's dominant district colour, full strength for the top 10.
      let owner = block.landmark?.minterHandle ?? null;
      let ownerColor = block.landmark?.colorHex ?? '#3ad6ff';
      if (!owner) {
        let best = 0;
        for (const [handle, n] of block.districtCounts) {
          if (n > best) {
            best = n;
            owner = handle;
          }
        }
        const sample = owner ? [...block.lots.values()].find((l) => l.districtHandle === owner) : undefined;
        ownerColor = sample?.colorHex ?? ownerColor;
      }
      const curb = block.plazaColor ? block.plazaColor.clone() : vacant ? CURB_VACANT.clone() : new THREE.Color(ownerColor);
      if (!vacant && !block.plazaColor && !(owner && topTen.has(owner))) {
        curb.multiplyScalar(0.8);
      }
      const half = BLOCK_SIZE / 2;
      const [w, h] = vacant ? [0.5, 0.25] : [0.9, 0.4];
      this.curbs.add(compose(cx, PLATFORM_H + 0.15, cz - half, 0, BLOCK_SIZE + w, h, w), curb);
      this.curbs.add(compose(cx, PLATFORM_H + 0.15, cz + half, 0, BLOCK_SIZE + w, h, w), curb);
      this.curbs.add(compose(cx - half, PLATFORM_H + 0.15, cz, 0, w, h, BLOCK_SIZE + w), curb);
      this.curbs.add(compose(cx + half, PLATFORM_H + 0.15, cz, 0, w, h, BLOCK_SIZE + w), curb);

      if (detail) {
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          this.lampKit?.parts.forEach(({ part }) => part.add(compose(cx + sx * (half - 1.2), PLATFORM_H, cz + sz * (half - 1.2), Math.atan2(sx, sz))));
        }
        streets.add(`v:${block.bx}:${block.bz}`).add(`v:${block.bx - 1}:${block.bz}`);
        streets.add(`h:${block.bx}:${block.bz}`).add(`h:${block.bx}:${block.bz - 1}`);
      }

      if (block.kind === 'plaza') {
        this.addCivicPlaza(block.bx, block.bz, cx, cz, block.plazaColor, compose);
        continue;
      }
      if (block.kind === 'landmark' && block.landmark) {
        this.addLandmark(block.landmark, cx, cz, compose, topTen.has(block.landmark.minterHandle));
        continue;
      }
      for (let i = -1; i <= 1; i += 1) {
        for (let j = -1; j <= 1; j += 1) {
          const lx = cx + i * LOT;
          const lz = cz + j * LOT;
          const property = block.lots.get(`${i}:${j}`);
          if (property) {
            const district = new THREE.Color(property.colorHex);
            this.lots.add(compose(lx, PLATFORM_H + 0.15, lz), GRASS_HOME.clone().lerp(district, 0.08), property.plotIndex);
            if (isTowerClass(property.propertyClass)) {
              this.addLotTower(property, lx, lz, compose);
            } else {
              this.addHouse(property, lx, lz, i, j);
            }
          } else {
            this.lots.add(compose(lx, PLATFORM_H + 0.15, lz), vacant ? GRASS_VACANT : GRASS_PARK, null);
            if (detail) {
              this.addPark(block.bx * 7 + i, block.bz * 7 + j, lx, lz, compose, vacant);
            }
          }
        }
      }
    }

    this.addAvenues(minBx, maxBx, minBz, maxBz, compose, detail);
    if (detail) {
      this.addStreetMarkings(streets, compose);
    }
    this.rebuildLinks();
    this.layoutCars(minBx, maxBx, minBz, maxBz, detail);

    for (const pool of pools) {
      pool.end();
    }
    for (const kit of kits) {
      kit?.parts.forEach(({ part }) => part.end());
    }
    const radius = Math.max(200, (Math.max(maxBx - minBx, maxBz - minBz) / 2 + 2) * PITCH);
    const shadow = this.moon.shadow.camera;
    shadow.left = -radius;
    shadow.right = radius;
    shadow.top = radius;
    shadow.bottom = -radius;
    shadow.far = this.cameraDistance + 4000;
    shadow.updateProjectionMatrix();
    this.builtWithDetail = detail;
  }

  /** Built-in mesh for a style; falls back to the previous family's file if the rare GLB is not on disk yet. */
  private kitForStyle(styleId: ArchitectureStyleId, file: string): ModelKit | null {
    return this.kitsByFile.get(file) ?? this.kitsByFile.get(STYLE_FALLBACK_FILE[styleId]) ?? null;
  }

  private addHouse(property: PropertyDto, x: number, z: number, i: number, j: number): void {
    // Homes face the street their side of the block opens onto.
    const facing = i === 0 && j === 0 ? 0 : Math.abs(i) >= Math.abs(j) ? (i > 0 ? Math.PI / 2 : -Math.PI / 2) : j > 0 ? 0 : Math.PI;
    const look = architectureOf(property.plotIndex, property.fans, property.footprint);
    const variant = this.catalogVariant(look.visualClass, property.plotIndex);
    if (variant) {
      this.addCatalogInstance(variant, property.plotIndex, x, z, facing, HOME_FOOTPRINT_M, 1);
      return;
    }
    const kit = this.kitForStyle(look.style.id, look.style.file);
    if (!kit) {
      return;
    }
    const base = new THREE.Matrix4().compose(
      new THREE.Vector3(x, PLATFORM_H + 0.3, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing),
      new THREE.Vector3(1, 1, 1)
    );
    const started = this.rising.get(property.plotIndex);
    const grow = started === undefined ? 1 : Math.max(0.001, Math.min(1, (performance.now() - started) / RISE_MS));
    const matrix = base.clone().multiply(new THREE.Matrix4().makeScale(1, grow, 1));
    const district = new THREE.Color(property.colorHex);
    const walls = WALL_PASTELS[Math.floor(hash01(property.plotIndex) * WALL_PASTELS.length)];
    const roof = ROOF_BASE.clone().lerp(district, 0.32);
    const neon = finish(district, property.level);
    const slots: RisingSlot[] = [];
    for (const { materialName, part } of kit.parts) {
      const color = materialName === 'Walls' ? walls : materialName === 'Roof' ? roof : materialName === 'Neon' ? neon : undefined;
      const index = part.add(matrix, color, property.plotIndex);
      if (started !== undefined) {
        slots.push({ part, index, base });
      }
    }
    if (slots.length > 0) {
      this.risingSlots.set(property.plotIndex, slots);
    }
  }

  /** One of the generated variants for a class or city, always the same one for a given property. */
  private catalogVariant(slot: string, plotIndex: number): TexturedKit | null {
    const variants = this.catalog.get(slot);
    return variants && variants.length > 0 ? variants[Math.floor(hash01(plotIndex, 3) * variants.length)] : null;
  }

  /** Vertical stretch towards the height fans earned, kept gentle so textured models do not distort. */
  private catalogStretch(kit: TexturedKit, footprintM: number, targetHeight: number): number {
    const natural = kit.unitHeight * footprintM;
    return natural > 0 ? THREE.MathUtils.clamp(targetHeight / natural, 0.8, 1.3) : 1;
  }

  /** Places a generated model on a lot or block; returns its roof height. */
  private addCatalogInstance(kit: TexturedKit, owner: number, x: number, z: number, rotY: number, footprintM: number, heightScale: number): number {
    const base = new THREE.Matrix4().compose(
      new THREE.Vector3(x, PLATFORM_H + 0.3, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(footprintM, footprintM * heightScale, footprintM)
    );
    const started = this.rising.get(owner);
    const grow = started === undefined ? 1 : Math.max(0.001, Math.min(1, (performance.now() - started) / RISE_MS));
    const matrix = base.clone().multiply(new THREE.Matrix4().makeScale(1, grow, 1));
    const slots: RisingSlot[] = [];
    for (const { part } of kit.parts) {
      const index = part.add(matrix, undefined, owner);
      if (started !== undefined) {
        slots.push({ part, index, base });
      }
    }
    if (slots.length > 0) {
      this.risingSlots.set(owner, slots);
    }
    return PLATFORM_H + 0.3 + kit.unitHeight * footprintM * heightScale;
  }

  private addTowerModel(owner: number, x: number, z: number, scale: number, height: number, neon: THREE.Color, compose: Compose, kit = this.towerKits[0]): number {
    if (!kit) {
      return PLATFORM_H;
    }
    const bodyBase = PLATFORM_H + PODIUM_H;
    for (const { group, part } of kit.parts) {
      const matrix =
        group === 'base'
          ? compose(x, PLATFORM_H, z, 0, scale, 1, scale)
          : group === 'body'
            ? compose(x, bodyBase, z, 0, scale, height, scale)
            : compose(x, bodyBase + height, z, 0, scale, scale, scale);
      part.add(matrix, neon, owner);
    }
    // The glowing floor bands are sized for the classic square tower only.
    if (kit === this.towerKits[0]) {
      const bandColor = neon.clone().multiplyScalar(0.6);
      for (let y = bodyBase + 7; y < bodyBase + height - 2; y += 7) {
        this.towerBands.add(compose(x, y, z, 0, scale, 1, scale), bandColor, owner);
      }
    }
    return bodyBase + height;
  }

  private allBuildingKits(): ModelKit[] {
    return [...[...this.houseKits.values()].flat(), ...this.towerKits, ...this.venueKits.values(), ...[...this.catalog.values()].flat()];
  }

  private addLotTower(property: PropertyDto, x: number, z: number, compose: Compose): void {
    const look = architectureOf(property.plotIndex, property.fans, property.footprint);
    const height = this.heights.get(property.plotIndex) ?? look.heightMeters;
    const variant = this.catalogVariant(look.visualClass, property.plotIndex);
    if (variant) {
      this.addCatalogInstance(variant, property.plotIndex, x, z, 0, TOWER_FOOTPRINT_M, this.catalogStretch(variant, TOWER_FOOTPRINT_M, height));
      return;
    }
    const kit = this.kitForStyle(look.style.id, look.style.file);
    this.addTowerModel(property.plotIndex, x, z, styleScale(look.style, 'LOT'), height, finish(new THREE.Color(property.colorHex), property.level), compose, kit ?? undefined);
  }

  private addLandmark(property: PropertyDto, x: number, z: number, compose: Compose, lit: boolean): void {
    const look = architectureOf(property.plotIndex, property.fans, property.footprint);
    const color = new THREE.Color(property.colorHex);
    const neon = lit ? color : color.clone().multiplyScalar(0.7);
    const height = this.heights.get(property.plotIndex) ?? look.heightMeters;
    // Idols grow as towers: the style family changes when fans hit the next rarity.
    const variant = this.catalogVariant(look.visualClass, property.plotIndex);
    const kit = this.kitForStyle(look.style.id, look.style.file);
    const top = variant
      ? this.addCatalogInstance(variant, property.plotIndex, x, z, 0, LANDMARK_FOOTPRINT_M, this.catalogStretch(variant, LANDMARK_FOOTPRINT_M, height))
      : this.addTowerModel(property.plotIndex, x, z, styleScale(look.style, 'BLOCK'), height, neon, compose, kit ?? undefined);
    const rank = this.standingByHandle.get(property.minterHandle)?.rankPosition ?? Number.POSITIVE_INFINITY;
    if (rank <= 3) {
      this.medals.add(compose(x, top + 6, z), MEDALS[rank - 1], property.plotIndex);
    }
    this.updateBeam(property.minterHandle, rank === 1, property.colorHex, x, z, top);
  }

  private updateBeam(handle: string, leader: boolean, colorHex: string, x: number, z: number, top: number): void {
    let beam = this.beams.get(handle);
    if (!leader) {
      if (beam) {
        this.world.remove(beam);
        beam.geometry.dispose();
        this.beams.delete(handle);
      }
      return;
    }
    for (const [other, otherBeam] of this.beams) {
      if (other !== handle) {
        this.world.remove(otherBeam);
        otherBeam.geometry.dispose();
        this.beams.delete(other);
      }
    }
    if (!beam) {
      const geometry = new THREE.CylinderGeometry(3.2, 3.2, 900, 16, 1, true).translate(0, 450, 0);
      beam = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      beam.raycast = () => undefined;
      this.beams.set(handle, beam);
      this.world.add(beam);
    }
    beam.position.set(x, top + 14, z);
  }

  private addPark(seedA: number, seedB: number, x: number, z: number, compose: Compose, sparse: boolean): void {
    const trees = sparse ? (hash01(seedA, seedB, 2) < 0.45 ? 1 : 0) : 1 + Math.floor(hash01(seedA, seedB, 1) * 3);
    for (let t = 0; t < trees; t += 1) {
      const ox = (hash01(seedA, seedB, 10 + t) - 0.5) * 9;
      const oz = (hash01(seedA, seedB, 20 + t) - 0.5) * 9;
      const scale = 0.8 + hash01(seedA, seedB, 30 + t) * 0.6;
      const leaves = LEAF_GREENS[Math.floor(hash01(seedA, seedB, 40 + t) * LEAF_GREENS.length)];
      this.treeKit?.parts.forEach(({ materialName, part }) =>
        part.add(compose(x + ox, PLATFORM_H + 0.3, z + oz, hash01(seedA, t) * 6.28, scale, scale, scale), materialName === 'Leaves' ? leaves : undefined)
      );
    }
    if (!sparse && hash01(seedA, seedB, 50) < 0.45) {
      this.benchKit?.parts.forEach(({ part }) => part.add(compose(x, PLATFORM_H + 0.3, z + 4.5, Math.PI)));
    }
  }

  /** The two grand avenues that cross at Genesis — paved as far as the city has grown. */
  private addAvenues(minBx: number, maxBx: number, minBz: number, maxBz: number, compose: Compose, detail: boolean): void {
    const loX = minBx - 1;
    const hiX = maxBx + 1;
    const loZ = minBz - 1;
    const hiZ = maxBz + 1;
    for (let bx = loX; bx <= hiX; bx += 1) {
      this.platforms.add(compose(bx * PITCH, PLATFORM_H / 2, 0), PLATFORM_AVENUE);
    }
    for (let bz = loZ; bz <= hiZ; bz += 1) {
      if (bz !== 0) {
        this.platforms.add(compose(0, PLATFORM_H / 2, bz * PITCH), PLATFORM_AVENUE);
      }
    }

    const edge = PITCH - BLOCK_SIZE / 2 - 3;
    const spanX = [loX * PITCH, hiX * PITCH];
    const spanZ = [loZ * PITCH, hiZ * PITCH];
    const lengthX = spanX[1] - spanX[0];
    const lengthZ = spanZ[1] - spanZ[0];
    const midX = (spanX[0] + spanX[1]) / 2;
    const midZ = (spanZ[0] + spanZ[1]) / 2;
    for (const side of [-1, 1]) {
      this.curbs.add(compose(midX, PLATFORM_H + 0.12, side * edge, 0, lengthX, 0.2, 0.8), AVENUE_NEON);
      this.curbs.add(compose(side * edge, PLATFORM_H + 0.12, midZ, 0, 0.8, 0.2, lengthZ), AVENUE_NEON);
    }
    const dash = AVENUE_NEON.clone().multiplyScalar(0.45);
    for (let t = spanX[0]; t <= spanX[1]; t += 14) {
      this.markings.add(compose(t, PLATFORM_H + 0.08, 0, 0, 6, 0.05, 0.5), dash);
    }
    for (let t = spanZ[0]; t <= spanZ[1]; t += 14) {
      this.markings.add(compose(0, PLATFORM_H + 0.08, t, 0, 0.5, 0.05, 6), dash);
    }
    if (!detail) {
      return;
    }
    const half = BLOCK_SIZE / 2 - 1.2;
    for (let bx = loX; bx <= hiX; bx += 2) {
      for (const side of [-1, 1]) {
        this.lampKit?.parts.forEach(({ part }) => part.add(compose(bx * PITCH, PLATFORM_H, side * half, side > 0 ? 0 : Math.PI)));
      }
    }
    for (let bz = loZ; bz <= hiZ; bz += 2) {
      if (bz === 0) {
        continue;
      }
      for (const side of [-1, 1]) {
        this.lampKit?.parts.forEach(({ part }) => part.add(compose(side * half, PLATFORM_H, bz * PITCH, side > 0 ? Math.PI / 2 : -Math.PI / 2)));
      }
    }
  }

  private addCivicPlaza(bx: number, bz: number, cx: number, cz: number, tint: THREE.Color | null, compose: Compose): void {
    const city = this.cities.find((c) => {
      const plaza = plazaBlockOf(c.id);
      return plaza.bx === bx && plaza.bz === bz;
    });
    const color = tint ?? (city ? new THREE.Color(city.colorHex) : AVENUE_NEON);
    if (!city || city.id === 'GENESIS') {
      this.plazaKit?.parts.forEach(({ part }) => part.add(compose(cx, PLATFORM_H, cz), color));
      return;
    }
    this.addCivicVenue({ kind: venueKindForCity(city.id), bx, bz, city: city.id }, compose);
  }

  private addCivicVenue(site: CivicSite, compose: Compose): void {
    const cx = site.bx * PITCH;
    const cz = site.bz * PITCH;
    const city = site.city;
    const kit = this.venueKits.get(city);
    const tint = new THREE.Color(this.cities.find((c) => c.id === site.city)?.colorHex ?? '#3ad6ff');
    if (!kit) {
      this.plazaKit?.parts.forEach(({ part }) => part.add(compose(cx, PLATFORM_H, cz), tint));
      return;
    }
    kit.parts.forEach(({ part }) => part.add(compose(cx, PLATFORM_H, cz), tint));
  }

  private addStreetMarkings(streets: ReadonlySet<string>, compose: Compose): void {
    const dash = new THREE.Color('#6f6b4f');
    const zebra = new THREE.Color('#6c7186');
    for (const key of streets) {
      const [axis, a, b] = key.split(':');
      const bx = Number(a);
      const bz = Number(b);
      // `v:bx:bz` runs along z between blocks bx and bx+1; `h:bx:bz` runs along x between bz and bz+1.
      const vertical = axis === 'v';
      const along0 = (vertical ? bz : bx) * PITCH;
      const across = ((vertical ? bx : bz) + 0.5) * PITCH;
      for (let t = -BLOCK_SIZE / 2 + 6; t <= BLOCK_SIZE / 2 - 6; t += 8) {
        this.markings.add(vertical ? compose(across, 0.06, along0 + t, 0, 0.35, 0.05, 3) : compose(along0 + t, 0.06, across, 0, 3, 0.05, 0.35), dash);
      }
      for (const end of [-1, 1]) {
        const at = along0 + end * (BLOCK_SIZE / 2 - 2.2);
        for (let k = -2; k <= 2; k += 1) {
          const off = across + k * (STREET_HALF * 0.38);
          this.markings.add(vertical ? compose(off, 0.07, at, 0, 1, 0.05, 3.2) : compose(at, 0.07, off, 0, 3.2, 0.05, 1), zebra);
        }
      }
    }
  }

  /** Neon arcs from an idol to every place their neighbourhood continued. */
  private rebuildLinks(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const segments = 28;
    for (const property of this.properties.values()) {
      if (property.neighbourhoods.length === 0) {
        continue;
      }
      const color = new THREE.Color(property.colorHex);
      const startY = propertyTop(property.footprint, property.propertyClass, property.fans);
      for (const target of property.neighbourhoods) {
        const distance = Math.hypot(target.x - property.x, target.z - property.z);
        const apex = Math.min(420, 30 + distance * 0.2);
        let prev: THREE.Vector3 | null = null;
        for (let k = 0; k <= segments; k += 1) {
          const t = k / segments;
          const point = new THREE.Vector3(
            THREE.MathUtils.lerp(property.x, target.x, t),
            THREE.MathUtils.lerp(startY, PLATFORM_H + 6, t) + Math.sin(Math.PI * t) * apex,
            THREE.MathUtils.lerp(property.z, target.z, t)
          );
          if (prev) {
            positions.push(prev.x, prev.y, prev.z, point.x, point.y, point.z);
            const fade = 0.55 + 0.45 * Math.sin(Math.PI * t);
            colors.push(color.r * fade, color.g * fade, color.b * fade, color.r * fade, color.g * fade, color.b * fade);
          }
          prev = point;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.links.geometry.dispose();
    this.links.geometry = geometry;
  }

  private layoutCars(minBx: number, maxBx: number, minBz: number, maxBz: number, detail: boolean): void {
    if (!detail) {
      this.carLanes = [];
      return;
    }
    const blocks = (maxBx - minBx + 1) * (maxBz - minBz + 1);
    const count = Math.min(90, Math.max(6, Math.round(Math.sqrt(blocks) * 6)));
    const locals: CarLane[] = Array.from({ length: count }, (_, i) => {
      const axis: 'x' | 'z' = hash01(i, 1) < 0.5 ? 'x' : 'z';
      const span = axis === 'z' ? [minBx - 1, maxBx] : [minBz - 1, maxBz];
      const lineIndex = span[0] + Math.floor(hash01(i, 2) * (span[1] - span[0] + 1));
      return {
        axis,
        line: (lineIndex + 0.5) * PITCH,
        dir: (hash01(i, 3) < 0.5 ? 1 : -1) as 1 | -1,
        speed: 10 + hash01(i, 4) * 9,
        phase: hash01(i, 5) * 1000,
        paint: CAR_PAINTS[Math.floor(hash01(i, 6) * CAR_PAINTS.length)],
      };
    });
    const avenueOffset = STREET_HALF * 0.45;
    const avenues: CarLane[] = [
      { axis: 'x', line: avenueOffset, dir: 1, speed: 16, phase: 0, paint: CAR_PAINTS[2] },
      { axis: 'x', line: -avenueOffset, dir: -1, speed: 15, phase: 40, paint: CAR_PAINTS[0] },
      { axis: 'z', line: avenueOffset, dir: 1, speed: 16, phase: 80, paint: CAR_PAINTS[3] },
      { axis: 'z', line: -avenueOffset, dir: -1, speed: 15, phase: 120, paint: CAR_PAINTS[6] },
    ];
    this.carLanes = [...avenues, ...locals];
    this.carBounds = { minX: (minBx - 1) * PITCH, maxX: (maxBx + 1) * PITCH, minZ: (minBz - 1) * PITCH, maxZ: (maxBz + 1) * PITCH };
  }

  // ---------------------------------------------------------------- labels

  private avatarFor(handle: string): HTMLImageElement | null {
    if (this.avatars.has(handle)) {
      return this.avatars.get(handle) ?? null;
    }
    const url = this.options.avatarUrl?.(handle) ?? null;
    if (!url) {
      this.avatars.set(handle, null);
      return null;
    }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      this.avatars.set(handle, img);
      const label = this.labels.get(handle);
      if (label) {
        label.key = '';
        this.updateLabels();
      }
    };
    img.onerror = () => {
      const tries = (this.avatarTries.get(handle) ?? 0) + 1;
      this.avatarTries.set(handle, tries);
      this.avatars.delete(handle);
      if (tries < 6) {
        window.setTimeout(() => this.updateLabels(), 4_000);
        return;
      }
      this.avatars.set(handle, null);
    };
    img.src = url;
    // Pending until it loads; the initials stand in meanwhile.
    this.avatars.set(handle, null);
    return null;
  }

  private createLabel(width: number, height: number): Label | null {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
    sprite.renderOrder = 10;
    sprite.raycast = () => undefined;
    this.labelScene.add(sprite);
    return { sprite, ctx, texture, key: '' };
  }

  private updateLabels(): void {
    const shown = this.standings.slice(0, LABELLED_IDOLS);
    const keep = new Set(shown.map((s) => s.fandomHandle));
    for (const [handle, label] of this.labels) {
      if (!keep.has(handle)) {
        this.labelScene.remove(label.sprite);
        label.texture.dispose();
        this.labels.delete(handle);
      }
    }
    for (const s of shown) {
      let label = this.labels.get(s.fandomHandle);
      if (!label) {
        const created = this.createLabel(760, 176);
        if (!created) {
          continue;
        }
        label = created;
        this.labels.set(s.fandomHandle, label);
      }
      const avatar = this.avatarFor(s.fandomHandle);
      const verified = this.instagramVerified.has(s.fandomHandle) ? 1 : 0;
      const key = `face|${s.rankPosition}|${s.displayName}|${s.fans}|${s.reputationXp}|${s.neonColorHex}|${avatar ? 1 : 0}|${verified}`;
      if (key !== label.key) {
        this.drawIdolLabel(label, s, avatar, verified === 1);
        label.key = key;
      }
    }
  }

  private drawIdolLabel(label: Label, s: StandingDto, avatar: HTMLImageElement | null, instagramVerified: boolean): void {
    const { ctx, texture } = label;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(10, 13, 28, 0.88)';
    ctx.strokeStyle = s.neonColorHex;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(6, 6, width - 12, height - 12, 44);
    ctx.fill();
    ctx.stroke();

    const portrait = 124;
    const portraitX = 24;
    const portraitY = (height - portrait) / 2;
    this.paintOwnerPortrait(ctx, portraitX, portraitY, portrait, s.neonColorHex, s.displayName, avatar);
    this.paintHouseWell(ctx, portraitX + portrait - 40, portraitY + portrait - 40, 36, s.neonColorHex);

    const textX = portraitX + portrait + 22;
    const maxText = width - textX - 34;
    const medal = s.rankPosition <= 3 ? ['#ffd60a', '#d9dde8', '#ff9f45'][s.rankPosition - 1] : s.neonColorHex;
    ctx.fillStyle = medal;
    ctx.font = '800 50px ui-rounded, -apple-system, "SF Pro Rounded", system-ui, sans-serif';
    const rankText = `#${s.rankPosition}`;
    ctx.fillText(rankText, textX, 80);
    const rankWidth = ctx.measureText(rankText).width + 14;
    ctx.fillStyle = '#ffffff';
    const badge = instagramVerified ? 36 : 0;
    ctx.fillText(s.displayName, textX + rankWidth, 80, Math.max(40, maxText - rankWidth - badge));
    if (instagramVerified) {
      const used = Math.min(ctx.measureText(s.displayName).width, Math.max(40, maxText - rankWidth - badge));
      this.paintVerifiedBadge(ctx, textX + rankWidth + used + 10, 52, 28);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.74)';
    ctx.font = '600 32px ui-rounded, -apple-system, system-ui, sans-serif';
    const handleShown = s.displayName === `@${s.fandomHandle}` ? '' : `@${s.fandomHandle} · `;
    const fanWord = s.fans === 1 ? 'fã' : 'fãs';
    ctx.fillText(`${handleShown}${s.fans.toLocaleString('pt-BR')} ${fanWord}`, textX, 134, maxText);
    texture.needsUpdate = true;
  }

  /** The owner's Instagram picture, large and plain, in a district-coloured ring. */
  private paintOwnerPortrait(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
    name: string,
    avatar: HTMLImageElement | null,
  ): void {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 5, 0, Math.PI * 2);
    ctx.clip();
    if (avatar) {
      ctx.drawImage(avatar, cx - (r - 5), cy - (r - 5), (r - 5) * 2, (r - 5) * 2);
    } else {
      ctx.fillStyle = 'rgba(10, 13, 28, 0.9)';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 56px ui-rounded, -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name.replace(/^@/, '').slice(0, 1).toUpperCase(), cx, cy + 2);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }

  /** Small house mark so the card still says "home", without covering the face. */
  private paintHouseWell(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 18);
    ctx.fillStyle = 'rgba(8, 12, 24, 0.92)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
    const cx = x + size / 2;
    const base = y + size * 0.72;
    const w = size * 0.46;
    ctx.beginPath();
    ctx.moveTo(cx, y + size * 0.22);
    ctx.lineTo(cx + w, y + size * 0.4);
    ctx.lineTo(cx - w, y + size * 0.4);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#f4f7fb';
    ctx.fillRect(cx - w * 0.62, y + size * 0.4, w * 1.24, size * 0.32);
    ctx.fillStyle = color;
    ctx.fillRect(cx - w * 0.16, base - size * 0.2, w * 0.32, size * 0.2);
    ctx.restore();
  }

  /** Instagram's blue verified check, drawn on the idol label. */
  private paintVerifiedBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#0095F6';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + size * 0.28, y + size * 0.52);
    ctx.lineTo(x + size * 0.44, y + size * 0.7);
    ctx.lineTo(x + size * 0.74, y + size * 0.32);
    ctx.stroke();
    ctx.restore();
  }

  private updateCityLabels(): void {
    for (const city of this.cities) {
      let label = this.cityLabels.get(city.id);
      if (!label) {
        const created = this.createLabel(640, 150);
        if (!created) {
          continue;
        }
        label = created;
        label.sprite.visible = false;
        this.cityLabels.set(city.id, label);
      }
      const key = `${city.name}|${city.properties}|${city.colorHex}`;
      if (key === label.key) {
        continue;
      }
      const { ctx, texture } = label;
      const { width, height } = ctx.canvas;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(10, 13, 28, 0.82)';
      ctx.strokeStyle = city.colorHex;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.roundRect(5, 5, width - 10, height - 10, 40);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 50px ui-rounded, -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(city.name, width / 2, 72, width - 60);
      ctx.fillStyle = city.colorHex;
      ctx.font = '700 32px ui-rounded, -apple-system, system-ui, sans-serif';
      const homes = city.properties === 1 ? 'casa' : 'casas';
      ctx.fillText(`${city.properties.toLocaleString('pt-BR')} ${homes}`, width / 2, 118, width - 60);
      ctx.textAlign = 'start';
      texture.needsUpdate = true;
      label.key = key;
    }
  }

  // ---------------------------------------------------------------- planet

  /** Night world: ocean, land, ice and distant city glow. The live cities sit on top of this. */
  private paintPlanetMaps(): { readonly color: THREE.CanvasTexture; readonly glow: THREE.CanvasTexture; readonly clouds: THREE.CanvasTexture } {
    const width = 1024;
    const height = 512;
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = width;
    colorCanvas.height = height;
    const colorCtx = colorCanvas.getContext('2d');
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = width;
    glowCanvas.height = height;
    const glowCtx = glowCanvas.getContext('2d');
    const cloudCanvas = document.createElement('canvas');
    cloudCanvas.width = width;
    cloudCanvas.height = height;
    const cloudCtx = cloudCanvas.getContext('2d');
    if (!colorCtx || !glowCtx || !cloudCtx) {
      const blank = new THREE.CanvasTexture(colorCanvas);
      return { color: blank, glow: blank, clouds: blank };
    }
    const ocean = colorCtx.createLinearGradient(0, 0, 0, height);
    ocean.addColorStop(0, '#1a2748');
    ocean.addColorStop(0.18, '#0c1c3a');
    ocean.addColorStop(0.5, '#071428');
    ocean.addColorStop(0.82, '#0c1c3a');
    ocean.addColorStop(1, '#182444');
    colorCtx.fillStyle = ocean;
    colorCtx.fillRect(0, 0, width, height);
    glowCtx.fillStyle = '#000000';
    glowCtx.fillRect(0, 0, width, height);
    for (let i = 0; i < 520; i += 1) {
      const x = hash01(i, 2) * width;
      const y = height * (0.12 + hash01(i, 5) * 0.76);
      const rx = 10 + hash01(i, 8) * 70;
      const ry = rx * (0.35 + hash01(i, 3) * 0.4);
      colorCtx.fillStyle = `rgba(${14 + hash01(i, 1) * 18}, ${36 + hash01(i, 4) * 28}, ${48 + hash01(i, 6) * 20}, ${0.35 + hash01(i, 7) * 0.5})`;
      colorCtx.beginPath();
      colorCtx.ellipse(x, y, rx, ry, hash01(i, 9) * Math.PI, 0, Math.PI * 2);
      colorCtx.fill();
    }
    colorCtx.fillStyle = 'rgba(210, 224, 236, 0.55)';
    colorCtx.fillRect(0, 0, width, 18);
    colorCtx.fillRect(0, height - 18, width, 18);
    for (let i = 0; i < 1400; i += 1) {
      const x = hash01(i, 11) * width;
      const y = height * (0.16 + hash01(i, 12) * 0.68);
      const warm = hash01(i, 13) > 0.72;
      glowCtx.fillStyle = warm ? 'rgba(255, 196, 120, 0.85)' : 'rgba(120, 196, 255, 0.7)';
      glowCtx.fillRect(x, y, hash01(i, 14) > 0.92 ? 2 : 1, 1);
    }
    for (let i = 0; i < 180; i += 1) {
      const x = hash01(i, 21) * width;
      const y = hash01(i, 22) * height;
      cloudCtx.fillStyle = `rgba(255, 255, 255, ${0.08 + hash01(i, 23) * 0.22})`;
      cloudCtx.beginPath();
      cloudCtx.ellipse(x, y, 18 + hash01(i, 24) * 90, 6 + hash01(i, 25) * 16, hash01(i, 26), 0, Math.PI * 2);
      cloudCtx.fill();
    }
    const color = new THREE.CanvasTexture(colorCanvas);
    const glow = new THREE.CanvasTexture(glowCanvas);
    const clouds = new THREE.CanvasTexture(cloudCanvas);
    for (const texture of [color, glow, clouds]) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
    }
    return { color, glow, clouds };
  }

  private createPlanetBody(): THREE.Group {
    const body = new THREE.Group();
    const maps = this.paintPlanetMaps();
    const surface = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 96),
      new THREE.MeshStandardMaterial({
        map: maps.color,
        emissiveMap: maps.glow,
        emissive: '#ffffff',
        emissiveIntensity: 1.1,
        roughness: 0.62,
        metalness: 0.12,
      })
    );
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.018, 96, 64),
      new THREE.MeshStandardMaterial({
        map: maps.clouds,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        roughness: 1,
      })
    );
    clouds.name = 'planet-clouds';
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.045, 80, 56),
      new THREE.MeshBasicMaterial({ color: '#7ad7ff', transparent: true, opacity: 0.22, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    const limb = new THREE.Mesh(
      new THREE.SphereGeometry(1.09, 64, 48),
      new THREE.MeshBasicMaterial({ color: '#3ad6ff', transparent: true, opacity: 0.08, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    for (const obj of [surface, clouds, atmosphere, limb]) {
      obj.raycast = () => undefined;
    }
    // The group pivots on the planet's centre so the inhabited cap can be turned towards the camera.
    body.add(surface, clouds, atmosphere, limb);
    return body;
  }

  private rebuildPlanetLights(): void {
    const chunks = this.planetChunks;
    if (!this.planetLights || this.planetLights.instanceMatrix.count < chunks.length) {
      if (this.planetLights) {
        this.planetGroup.remove(this.planetLights);
        this.planetLights.dispose();
      }
      const capacity = Math.max(64, chunks.length * 2);
      this.planetLights = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.5, 10, 8),
        new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
        capacity
      );
      this.planetLights.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      this.planetLights.frustumCulled = false;
      this.planetGroup.add(this.planetLights);
    }
    const up = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
      const footprint = CHUNK_PITCH * 0.22;
    chunks.forEach((chunk, i) => {
      const position = toPlanet(chunk.x, chunk.z, this.planetRadius, 8 + Math.sqrt(chunk.count));
      q.setFromUnitVectors(up, position.clone().normalize());
      const glow = footprint * (0.55 + Math.min(1.4, Math.sqrt(chunk.count) / 8));
      m.compose(position, q, s.set(glow, glow * 0.45, glow));
      this.planetLights?.setMatrixAt(i, m);
      this.planetLights?.setColorAt(i, new THREE.Color(chunk.colorHex));
    });
    this.planetLights.count = chunks.length;
    this.planetLights.instanceMatrix.needsUpdate = true;
    if (this.planetLights.instanceColor) {
      this.planetLights.instanceColor.needsUpdate = true;
    }
  }

  private applyView(view: WorldView): void {
    if (view === this.view) {
      return;
    }
    this.view = view;
    const planet = view === 'planet';
    this.planetGroup.visible = planet;
    this.world.visible = !planet;
    this.ground.visible = !planet;
    this.grid.visible = !planet;
    this.scene.fog = planet ? null : this.fog;
    for (const [id, label] of this.cityLabels) {
      // Genesis is the planet's centre — show its name from space.
      label.sprite.visible = planet && id === 'GENESIS';
    }
    this.options.onViewChange?.(view);
  }

  // ---------------------------------------------------------------- per frame

  private tick(seconds: number, nowMs: number): void {
    const zoomRatio = this.camera.zoom / Math.max(0.0001, this.fitZoom);
    if (this.cinematicFocus === null && this.hasFitted) {
      if (this.view === 'city' && zoomRatio < PLANET_ENTER_RATIO) {
        this.applyView('planet');
      } else if (this.view === 'planet' && zoomRatio > PLANET_LEAVE_RATIO) {
        this.applyView('city');
      }
    }
    // Planet view: frame the planet's centre and turn its inhabited cap to face the camera.
    const planetView = this.view === 'planet';
    const desired = planetView ? new THREE.Vector3(0, -this.planetRadius, 0) : new THREE.Vector3(this.controls.target.x, 0, this.controls.target.z);
    const shift = desired.sub(this.controls.target).multiplyScalar(0.12);
    if (shift.lengthSq() > 1e-4) {
      this.controls.target.add(shift);
      this.camera.position.add(shift);
    }
    if (planetView) {
      const towardCamera = this.camera.position.clone().sub(this.controls.target).normalize();
      this.planetGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), towardCamera);
      this.planetGroup.updateMatrixWorld(true);
      const clouds = this.planetBody.getObjectByName('planet-clouds');
      if (clouds) {
        clouds.rotation.y = seconds * 0.015;
      }
    }

    const detail = zoomRatio >= DETAIL_ZOOM_RATIO || this.cinematicFocus !== null;

    // Towers ease towards the height their fans earned.
    let moved = false;
    for (const property of this.properties.values()) {
      if (property.footprint !== 'BLOCK' && !isTowerClass(property.propertyClass)) {
        continue;
      }
      const current = this.heights.get(property.plotIndex) ?? 0;
      const target = towerHeightMeters(property.fans, property.footprint);
      if (Math.abs(target - current) > 0.05) {
        this.heights.set(property.plotIndex, current + (target - current) * 0.06);
        moved = true;
      }
    }
    if (moved || detail !== this.builtWithDetail) {
      this.dirty = true;
    }
    if (this.view === 'city' && this.dirty && (nowMs - this.lastRebuildMs >= REBUILD_INTERVAL_MS || this.cinematicFocus !== null)) {
      this.dirty = false;
      this.lastRebuildMs = nowMs;
      this.rebuildCity(detail);
    }

    // New homes rise out of the ground without rebuilding the city.
    for (const [plot, started] of this.rising) {
      const grow = Math.max(0.001, Math.min(1, (performance.now() - started) / RISE_MS));
      for (const slot of this.risingSlots.get(plot) ?? []) {
        slot.part.setMatrix(slot.index, slot.base.clone().multiply(new THREE.Matrix4().makeScale(1, grow, 1)));
      }
      if (grow >= 1) {
        this.rising.delete(plot);
        this.risingSlots.delete(plot);
      }
    }

    this.updateLabelPlacement(zoomRatio);
    if (this.view === 'city' && nowMs - this.lastChunkCheckMs >= CHUNK_CHECK_MS) {
      this.lastChunkCheckMs = nowMs;
      this.reportVisibleChunks();
    }

    this.hologramGroup.rotation.y = seconds * 0.35;
    this.hologramGroup.position.y = PLATFORM_H + 11 + Math.sin(seconds * 1.4) * 0.8;
    if (this.view === 'city') {
      this.updateCars(seconds);
      this.skyAds.update(seconds);
      this.skyAds.setFlyersVisible(!this.hideSkyCraft);
    }
    if (this.selection.visible) {
      const ring = this.selectionRadius * (1 + 0.12 * Math.sin(seconds * 5));
      this.selectionRing.scale.set(ring, 1, ring);
      const markerY = this.selectionTop + 24 + Math.sin(seconds * 2.4) * 4;
      this.selectionMarker.position.y = markerY;
      this.selectionMarker.rotation.y = seconds * 1.6;
      this.selectionBeam.scale.y = Math.max(1, markerY);
    }
  }

  private updateLabelPlacement(zoomRatio: number): void {
    // Labels keep a fixed size on screen (narrower on phones); zooming in reveals more of them.
    const screenWidth = Math.max(1, this.options.container.clientWidth);
    const metersPerPixel = (this.camera.right - this.camera.left) / (this.camera.zoom * screenWidth);
    const planet = this.view === 'planet';
    const labelPixels = THREE.MathUtils.clamp(screenWidth * 0.16, 150, 230) * (planet ? 0.8 : 1);
    const labelScale = (labelPixels * metersPerPixel) / 66;
    // On the planet, idol labels sit one label-height above their city's label on screen.
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).multiplyScalar(15.3 * labelScale * 1.15);
    const maxLabels = this.cinematicFocus === null ? LABELLED_IDOLS : 6;
    // From space the cities speak; only the #1 idol keeps a label.
    const visibleLabels = planet ? 1 : THREE.MathUtils.clamp(Math.round(2.5 * zoomRatio ** 1.4), 3, maxLabels);
    for (const [handle, label] of this.labels) {
      const s = this.standingByHandle.get(handle);
      if (!s) {
        continue;
      }
      label.sprite.visible = s.rankPosition <= visibleLabels;
      label.sprite.renderOrder = 100 - Math.min(99, s.rankPosition);
      label.sprite.scale.set(66 * labelScale, 15.3 * labelScale, 1);
      if (planet) {
        label.sprite.position.copy(this.planetGroup.localToWorld(toPlanet(s.districtX, s.districtZ, this.planetRadius, 40 + 30 * labelScale))).add(screenUp);
      } else {
        const top = propertyTop(s.footprint, s.propertyClass, s.fans);
        label.sprite.position.set(s.districtX, top + 10 + 9 * labelScale, s.districtZ);
      }
    }
    if (planet) {
      for (const city of this.cities) {
        const label = this.cityLabels.get(city.id);
        if (label) {
          label.sprite.scale.set(66 * labelScale, 15.5 * labelScale, 1);
          label.sprite.position.copy(this.planetGroup.localToWorld(toPlanet(city.x, city.z, this.planetRadius, 120 + 60 * labelScale)));
        }
      }
    }
  }

  /** Ground footprint of the view → chunk keys, nearest to the centre first. */
  private reportVisibleChunks(): void {
    if (!this.options.onVisibleChunks) {
      return;
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]] as const) {
      this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
      if (this.raycaster.ray.intersectPlane(plane, hit)) {
        minX = Math.min(minX, hit.x);
        maxX = Math.max(maxX, hit.x);
        minZ = Math.min(minZ, hit.z);
        maxZ = Math.max(maxZ, hit.z);
      }
    }
    if (!Number.isFinite(minX)) {
      return;
    }
    const target = this.controls.target;
    const keys: { key: string; d: number }[] = [];
    for (let x = minX - CHUNK_PITCH / 2; x <= maxX + CHUNK_PITCH; x += CHUNK_PITCH / 2) {
      for (let z = minZ - CHUNK_PITCH / 2; z <= maxZ + CHUNK_PITCH; z += CHUNK_PITCH / 2) {
        const key = chunkKeyAt(x, z);
        if (this.knownChunkKeys.has(key) && !keys.some((k) => k.key === key)) {
          keys.push({ key, d: Math.hypot(x - target.x, z - target.z) });
        }
      }
    }
    keys.sort((a, b) => a.d - b.d);
    const visible = keys.slice(0, MAX_VISIBLE_CHUNKS).map((k) => k.key);
    const signature = visible.join(',');
    if (signature !== this.lastChunkSignature) {
      this.lastChunkSignature = signature;
      this.options.onVisibleChunks(visible);
    }
  }

  private updateCars(seconds: number): void {
    if (!this.carKit) {
      return;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    const { minX, maxX, minZ, maxZ } = this.carBounds;
    this.carKit.parts.forEach(({ part }) => part.begin());
    for (const lane of this.carLanes) {
      const [lo, hi] = lane.axis === 'x' ? [minX, maxX] : [minZ, maxZ];
      const length = Math.max(1, hi - lo);
      const travelled = (lane.phase + lane.speed * seconds) % length;
      const along = lane.dir > 0 ? lo + travelled : hi - travelled;
      const laneOffset = lane.dir * 2.6;
      if (lane.axis === 'x') {
        pos.set(along, 0.1, lane.line + laneOffset);
        q.setFromAxisAngle(up, lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      } else {
        pos.set(lane.line - laneOffset, 0.1, along);
        q.setFromAxisAngle(up, lane.dir > 0 ? 0 : Math.PI);
      }
      m.compose(pos, q, scale);
      this.carKit.parts.forEach(({ materialName, part }) => part.add(m, materialName === 'Body' ? lane.paint : undefined));
    }
    this.carKit.parts.forEach(({ part }) => part.end());
  }

  // ---------------------------------------------------------------- camera & input

  private currentAzimuth(): number {
    const offset = this.camera.position.clone().sub(this.controls.target);
    return Math.atan2(offset.z, offset.x);
  }

  private placeCamera(target: THREE.Vector3, azimuth: number, polar = ISO_POLAR): void {
    const dir = new THREE.Vector3(Math.sin(polar) * Math.cos(azimuth), Math.cos(polar), Math.sin(polar) * Math.sin(azimuth));
    this.camera.position.copy(target).addScaledVector(dir, this.cameraDistance);
    this.camera.lookAt(target);
    this.controls?.target.copy(target);
    if (this.moon) {
      this.moon.target.position.set(target.x, 0, target.z);
      this.moon.position.set(target.x - 260, 520, target.z + 180);
    }
  }

  private computeFitZoom(): number {
    const { clientWidth, clientHeight } = this.options.container;
    const aspect = Math.max(0.1, clientWidth / Math.max(1, clientHeight));
    const diameter = this.cityRadius * 2;
    const zoomByWidth = (FRUSTUM_HEIGHT * aspect) / (diameter * 1.05);
    const zoomByHeight = FRUSTUM_HEIGHT / ((diameter * 0.58 + 160) * 1.1);
    return THREE.MathUtils.clamp(Math.min(zoomByWidth, zoomByHeight), 0.001, 4);
  }

  private animateCameraTo(target: THREE.Vector3, zoom: number, isometric = false): void {
    const flight = ++this.cameraFlight;
    const fromTarget = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(fromTarget);
    const fromZoom = this.camera.zoom;
    const iso =
      isometric
        ? new THREE.Vector3(Math.sin(ISO_POLAR) * Math.cos(ISO_AZIMUTH), Math.cos(ISO_POLAR), Math.sin(ISO_POLAR) * Math.sin(ISO_AZIMUTH))
        : null;
    const start = performance.now();
    const step = (): void => {
      if (flight !== this.cameraFlight || this.disposed) {
        return;
      }
      const t = Math.min(1, (performance.now() - start) / 700);
      const k = 1 - (1 - t) ** 3;
      const current = new THREE.Vector3().lerpVectors(fromTarget, new THREE.Vector3(target.x, 0, target.z), k);
      if (!iso) {
        current.y = this.controls.target.y;
      }
      this.controls.target.copy(current);
      if (iso) {
        this.camera.position.copy(current).addScaledVector(iso, this.cameraDistance);
        this.camera.lookAt(current);
      } else {
        this.camera.position.copy(current).add(offset);
      }
      this.camera.zoom = THREE.MathUtils.lerp(fromZoom, THREE.MathUtils.clamp(zoom, this.controls.minZoom, this.controls.maxZoom), k);
      this.camera.updateProjectionMatrix();
      if (t < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.options.container;
    if (clientWidth === 0 || clientHeight === 0) {
      return;
    }
    const aspect = clientWidth / clientHeight;
    this.camera.left = (-FRUSTUM_HEIGHT * aspect) / 2;
    this.camera.right = (FRUSTUM_HEIGHT * aspect) / 2;
    this.camera.top = FRUSTUM_HEIGHT / 2;
    this.camera.bottom = -FRUSTUM_HEIGHT / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
    this.composer.setSize(clientWidth, clientHeight);
    this.bloom.setSize(clientWidth, clientHeight);
  }

  private pickables(): { meshes: THREE.Object3D[]; owners: Map<THREE.Object3D, readonly (number | string | null)[]> } {
    const owners = new Map<THREE.Object3D, readonly (number | string | null)[]>();
    owners.set(this.lots.mesh, this.lots.owners);
    for (const kit of this.allBuildingKits()) {
      kit?.parts.forEach(({ part }) => owners.set(part.mesh, part.owners));
    }
    return { meshes: [...owners.keys()], owners };
  }

  private bindPicking(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointerup', (e) => {
      const down = this.pointerDown;
      this.pointerDown = null;
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) {
        return;
      }
      const rect = dom.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
      if (this.view === 'planet') {
        // A light on the planet takes you down into that part of the city.
        const hit = this.planetLights ? this.raycaster.intersectObject(this.planetLights, false)[0] : undefined;
        const chunk = hit?.instanceId === undefined ? undefined : this.planetChunks[hit.instanceId];
        if (chunk) {
          this.animateCameraTo(new THREE.Vector3(chunk.x, 0, chunk.z), this.fitZoom * 2);
        }
        return;
      }
      const adId = this.skyAds.pick(this.raycaster);
      if (adId) {
        this.options.onSelectAd?.(adId);
        return;
      }
      const { meshes, owners } = this.pickables();
      for (const hit of this.raycaster.intersectObjects(meshes, false)) {
        const owner = hit.instanceId === undefined ? null : owners.get(hit.object)?.[hit.instanceId] ?? null;
        if (typeof owner === 'number') {
          this.options.onSelectProperty?.(owner);
          return;
        }
      }
    });
  }
}
