/**
 * AgentSamEngineerEngine
 * Standalone Three.js engine for CITY and FLY modes.
 * No Cannon-es. No voxels. Owns its own canvas + RAF loop.
 * Mounts into whatever container div DesignStudioPage hands it.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ProjectType,
  CityConfig, FlyConfig, CityStyle, CityStats, FlyHud,
  DEFAULT_CITY_CONFIG, DEFAULT_FLY_CONFIG,
} from '../types';

// ─── Hash + PRNG ───────────────────────────────────────────────────────────

function fnvHash(cfg: CityConfig): number {
  const s = [
    cfg.seed, cfg.citySize, cfg.density, cfg.blockSize, cfg.streetPattern,
    cfg.cityStyle, cfg.terrainStyle, cfg.commercial, cfg.residential, cfg.industrial,
    cfg.averageHeight, cfg.heightVariance, cfg.parksPercentage,
    cfg.riverProbability, cfg.terrainRoughness,
  ].join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// ─── Palettes ──────────────────────────────────────────────────────────────

interface Palette {
  sky: string; fog: string; terrain: string; road: string; water: string; park: string;
  residential: string[]; commercial: string[]; industrial: string[];
  roof: string[]; glass: string; glow: string; sun: string;
}

const PALETTES: Record<CityStyle, Palette> = {
  modernGlass: {
    sky: '#071015', fog: '#0f2c34', terrain: '#1c2a24', road: '#15191d',
    water: '#123d4f', park: '#2c6a42',
    residential: ['#788891', '#8d9aa3', '#66757e', '#a6b0b5'],
    commercial: ['#8cc8d5', '#6fb3c5', '#a5d7df', '#5b8794'],
    industrial: ['#5d6568', '#74716a', '#4d5659', '#817462'],
    roof: ['#22292e', '#2b363b', '#3a4146'],
    glass: '#9fdff2', glow: '#63e7ff', sun: '#f8d28b',
  },
  european: {
    sky: '#111619', fog: '#263838', terrain: '#243629', road: '#2b2824',
    water: '#1e5365', park: '#426b3c',
    residential: ['#c4aa82', '#d3bea1', '#b98e66', '#e0d0b4'],
    commercial: ['#d9c693', '#cbb77b', '#b69e6b', '#e7d9b2'],
    industrial: ['#7d746b', '#8e8578', '#75665c', '#5f6a65'],
    roof: ['#8b3f2f', '#a84f35', '#6f332a'],
    glass: '#b7d2d3', glow: '#ffd17c', sun: '#f3bf76',
  },
  tokyoDense: {
    sky: '#080c12', fog: '#20243a', terrain: '#202421', road: '#181a21',
    water: '#183b5a', park: '#31593a',
    residential: ['#d7d1c5', '#b6bec5', '#e5dfd0', '#9ba8b0'],
    commercial: ['#b8d5f0', '#d6eef7', '#f6f0dd', '#a9c9df'],
    industrial: ['#686d73', '#7f7d72', '#5c626c', '#7c6c66'],
    roof: ['#32363c', '#4c5159', '#6d3f4b'],
    glass: '#b7e6ff', glow: '#ff4f9a', sun: '#ffdd92',
  },
  cyberpunk: {
    sky: '#050711', fog: '#25123a', terrain: '#171d24', road: '#080b12',
    water: '#111f55', park: '#27574c',
    residential: ['#334255', '#4a526d', '#2d3a62', '#5a5779'],
    commercial: ['#4df0ff', '#f24dff', '#6a8dff', '#d7fff8'],
    industrial: ['#3d3b49', '#585064', '#4a3f55', '#66546b'],
    roof: ['#161b2b', '#2d183d', '#182b3d'],
    glass: '#40f6ff', glow: '#ff3df2', sun: '#ffd36b',
  },
  brutalist: {
    sky: '#0b0e10', fog: '#252b2f', terrain: '#252d28', road: '#171717',
    water: '#244652', park: '#3a5a40',
    residential: ['#8d8a82', '#a19d93', '#77766f', '#b1aba1'],
    commercial: ['#aeb3b0', '#8f9a98', '#c2c4bb', '#798681'],
    industrial: ['#68645d', '#575a58', '#7d756a', '#494d4e'],
    roof: ['#3a3a36', '#4a4a45', '#2b2b29'],
    glass: '#c8c8c0', glow: '#ffb347', sun: '#ffe0a0',
  },
  desert: {
    sky: '#0a0806', fog: '#2a1f14', terrain: '#2e2216', road: '#1a1410',
    water: '#1a3040', park: '#3a5030',
    residential: ['#c8a870', '#d4b880', '#b89060', '#e0c890'],
    commercial: ['#e8c870', '#d4b050', '#f0d890', '#c8a840'],
    industrial: ['#786050', '#8a7060', '#685040', '#9a8070'],
    roof: ['#c06030', '#a04020', '#e08050'],
    glass: '#d4b870', glow: '#ff8030', sun: '#ffcc60',
  },
};

// ─── City generation ────────────────────────────────────────────────────────

type District = 'residential' | 'commercial' | 'industrial';
type RoofType = 'flat' | 'pitched' | 'spire' | 'stack';

interface Building {
  x: number; z: number; w: number; d: number; h: number;
  district: District; color: number; roofColor: number; accent: number;
  roof: RoofType; isLandmark: boolean;
}
interface Park { x: number; z: number; size: number; }
interface Road { x: number; z: number; len: number; width: number; rot: number; }

function hexInt(hex: string): number { return parseInt(hex.replace('#', ''), 16); }

function blendHex(hex: string, rng: () => number, v: number): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const d = (rng() - 0.5) * v * 255;
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (c(r + d) << 16) | (c(g + d * 0.8) << 8) | c(b + d * 0.6);
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function generateCity(cfg: CityConfig) {
  const rng = makePrng(fnvHash(cfg));
  const pal = PALETTES[cfg.cityStyle];
  const buildings: Building[] = [];
  const parks: Park[] = [];
  const roads: Road[] = [];
  const c = cfg.citySize, h = cfg.blockSize, p = (c - 1) * h / 2;
  const total = cfg.commercial + cfg.residential + cfg.industrial || 1;
  const wC = cfg.commercial / total, wR = cfg.residential / total;
  const hasRiver = rng() * 100 < cfg.riverProbability;
  const riverOff = (rng() - 0.5) * h * 2;
  const roadLen = c * h + h * 3.2;
  const roadW = clamp(h * 0.22, 1.2, 3.3);

  // Roads
  if (cfg.streetPattern === 'radial') {
    for (let i = 0; i < 12; i++)
      roads.push({ x: 0, z: 0, len: roadLen, width: roadW * (i % 3 === 0 ? 1.2 : 0.84), rot: Math.PI * 2 * i / 12 });
  } else {
    for (let i = 0; i < c; i++) {
      const pos = i * h - p;
      const jit = cfg.streetPattern === 'organic' ? Math.sin(i * 1.7) * h * 0.16 : 0;
      roads.push({ x: jit, z: pos, len: roadLen, width: i % 4 === 0 ? roadW * 1.26 : roadW, rot: Math.PI / 2 });
      roads.push({ x: pos, z: jit, len: roadLen, width: i % 5 === 0 ? roadW * 1.22 : roadW, rot: 0 });
    }
  }

  // Buildings + parks
  for (let row = 0; row < c; row++) {
    for (let col = 0; col < c; col++) {
      let wx = col * h - p, wz = row * h - p;
      const dist = Math.sqrt(wx * wx + wz * wz) / Math.max(p, 1);

      if (cfg.streetPattern === 'organic') { wx += (rng() - 0.5) * h * 0.23; wz += (rng() - 0.5) * h * 0.23; }
      if (cfg.streetPattern === 'radial') {
        const ang = Math.atan2(wz, wx), d2 = Math.sqrt(wx * wx + wz * wz);
        wx += Math.cos(ang * 3) * h * 0.14 * dist;
        wz += Math.sin(ang * 4) * h * 0.14 * dist;
        if (d2 < h * 1.25) { parks.push({ x: wx, z: wz, size: h * 1.2 }); continue; }
      }
      if (hasRiver) {
        const rd = Math.abs(wz - Math.sin(wx * 0.045) * h * 1.2 - riverOff);
        if (rd < (cfg.streetPattern === 'canal' ? h * 0.72 : h * 0.42)) continue;
      }
      if (rng() * 100 > cfg.density) continue;
      if (rng() * 100 < cfg.parksPercentage) { parks.push({ x: wx, z: wz, size: h * (0.7 + rng() * 0.35) }); continue; }

      let district: District = 'residential';
      if (dist < 0.35 && rng() < 0.55) district = 'commercial';
      else { const r = rng(); if (r < wC) district = 'commercial'; else if (r < wC + wR) district = 'residential'; else district = 'industrial'; }

      const isLandmark = district === 'commercial' && rng() * 100 < cfg.landmarkChance;
      const hBase: Record<District, number> = { commercial: 0.76, industrial: 0.58, residential: 0.42 };
      const sm = cfg.cityStyle === 'tokyoDense' || cfg.cityStyle === 'cyberpunk' ? 1.18 : cfg.cityStyle === 'european' ? 0.58 : 1;
      const bh = clamp((cfg.averageHeight * hBase[district] + (rng() - 0.48) * cfg.heightVariance + Math.max(0, 1 - dist) * cfg.averageHeight * 0.8) * sm * (isLandmark ? 1.72 : 1), 5, 138);
      const fb = district === 'industrial' ? 0.82 : district === 'commercial' ? 0.64 : 0.58;
      const bw = h * clamp(fb + (rng() - 0.5) * 0.24, 0.42, 0.9);
      const bd = h * clamp(fb + (rng() - 0.5) * 0.24, 0.42, 0.92);
      const dc = pal[district]; const bc = dc[Math.floor(rng() * dc.length)];
      const rc = pal.roof[Math.floor(rng() * pal.roof.length)];
      const roof: RoofType = cfg.cityStyle === 'european' && district !== 'commercial' ? 'pitched' : isLandmark ? 'spire' : district === 'industrial' ? 'stack' : 'flat';

      buildings.push({
        x: wx, z: wz, w: bw, d: bd, h: bh, district, isLandmark, roof,
        color: blendHex(bc, rng, 0.12),
        roofColor: hexInt(rc),
        accent: district === 'commercial' ? hexInt(pal.glass) : hexInt(pal.glow),
      });
    }
  }

  return {
    buildings, parks, roads, hasRiver, pal,
    stats: { structures: buildings.length, parks: parks.length, styleName: cfg.cityStyle } as CityStats,
  };
}

// ─── Fly viewpoints ────────────────────────────────────────────────────────

const FLY_VPS = [
  { pos: new THREE.Vector3(0, 56, -236), tgt: new THREE.Vector3(0, 38, -20) },
  { pos: new THREE.Vector3(82, 112, -72), tgt: new THREE.Vector3(0, 92, 38) },
  { pos: new THREE.Vector3(-34, 146, -110), tgt: new THREE.Vector3(0, 106, 24) },
  { pos: new THREE.Vector3(220, 112, -330), tgt: new THREE.Vector3(0, 76, 20) },
];

// ─── Engine class ──────────────────────────────────────────────────────────

export class AgentSamEngineerEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls | null = null;
  private raf: number | null = null;
  private clock = new THREE.Clock();
  private ro: ResizeObserver;

  private mode: ProjectType.CITY | ProjectType.FLY;
  private cityConfig: CityConfig = { ...DEFAULT_CITY_CONFIG };
  private onCityStats?: (s: CityStats) => void;

  private flyConfig: FlyConfig = { ...DEFAULT_FLY_CONFIG };
  private flyKeys = new Set<string>();
  private flyYaw = 0; private flyPitch = 0;
  private pointerLocked = false;
  private autopilotT = 0;
  private waterUniforms: { uTime: { value: number } } | null = null;
  private onFlyHud?: (h: FlyHud) => void;

  constructor(
    container: HTMLElement,
    mode: ProjectType.CITY | ProjectType.FLY,
    cb?: { onCityStats?: (s: CityStats) => void; onFlyHud?: (h: FlyHud) => void },
  ) {
    this.container = container;
    this.mode = mode;
    this.onCityStats = cb?.onCityStats;
    this.onFlyHud = cb?.onFlyHud;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const canvas = this.renderer.domElement;
    canvas.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%';
    container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 3000);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    if (mode === ProjectType.CITY) this.buildCity(this.cityConfig);
    else this.buildFly();

    this.tick();
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = this.clock.getDelta();
    if (this.mode === ProjectType.FLY) this.updateFly(dt);
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  };

  // ── City ──────────────────────────────────────────────────────────────────

  private clearScene() {
    const toRemove = [...this.scene.children];
    for (const o of toRemove) {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else (o.material as THREE.Material)?.dispose();
      }
      this.scene.remove(o);
    }
  }

  private buildCity(cfg: CityConfig) {
    this.clearScene();
    this.controls?.dispose(); this.controls = null;

    const data = generateCity(cfg);
    const pal = data.pal;

    this.scene.background = new THREE.Color(pal.sky);
    this.scene.fog = new THREE.FogExp2(pal.fog, 0.0032);
    this.renderer.toneMappingExposure = cfg.exposure / 100;

    const ambient = new THREE.AmbientLight(0xffffff, (cfg.ambientFill / 100) * 1.4);
    const sun = new THREE.DirectionalLight(new THREE.Color(pal.sun), (cfg.sunPower / 100) * 2);
    sun.position.set(cfg.sunHeight * 0.8, cfg.sunHeight, cfg.sunHeight * 0.4);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(2048);
    const hb = cfg.citySize * cfg.blockSize;
    sun.shadow.camera.left = -hb; sun.shadow.camera.right = hb;
    sun.shadow.camera.top = hb; sun.shadow.camera.bottom = -hb;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = hb * 4;
    this.scene.add(ambient, sun);

    const g = new THREE.Group();

    // Ground
    const gMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(hb * 3, hb * 3),
      new THREE.MeshStandardMaterial({ color: pal.terrain, roughness: 0.9, metalness: 0 }),
    );
    gMesh.rotation.x = -Math.PI / 2; gMesh.receiveShadow = true; g.add(gMesh);

    // Water
    if (data.hasRiver) {
      const wm = new THREE.Mesh(
        new THREE.PlaneGeometry(hb * 0.55, hb * 3),
        new THREE.MeshStandardMaterial({ color: pal.water, roughness: 0.08, metalness: 0.45, transparent: true, opacity: 0.88 }),
      );
      wm.rotation.x = -Math.PI / 2; wm.position.y = 0.05; g.add(wm);
    }

    // Roads
    const rMat = new THREE.MeshStandardMaterial({ color: pal.road, roughness: 1, metalness: 0 });
    for (const road of data.roads) {
      const rm = new THREE.Mesh(new THREE.PlaneGeometry(road.len, road.width), rMat);
      rm.rotation.x = -Math.PI / 2; rm.rotation.z = road.rot;
      rm.position.set(road.x, 0.02, road.z);
      rm.receiveShadow = true; g.add(rm);
    }

    // Parks
    const pkMat = new THREE.MeshStandardMaterial({ color: pal.park, roughness: 0.8 });
    for (const pk of data.parks) {
      const pkm = new THREE.Mesh(new THREE.PlaneGeometry(pk.size, pk.size), pkMat);
      pkm.rotation.x = -Math.PI / 2; pkm.position.set(pk.x, 0.03, pk.z);
      pkm.receiveShadow = true; g.add(pkm);
    }

    // Buildings — instanced per color
    const byColor = new Map<number, Building[]>();
    for (const b of data.buildings) {
      if (!byColor.has(b.color)) byColor.set(b.color, []);
      byColor.get(b.color)!.push(b);
    }
    const dummy = new THREE.Object3D();
    const isGlass = cfg.cityStyle === 'modernGlass' || cfg.cityStyle === 'tokyoDense';
    for (const [color, grp] of byColor) {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: isGlass ? 0.15 : 0.75, metalness: isGlass ? 0.45 : 0.05 });
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, grp.length);
      mesh.castShadow = true; mesh.receiveShadow = true;
      grp.forEach((b, i) => {
        dummy.position.set(b.x, b.h / 2, b.z);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      g.add(mesh);
    }

    // Roof details
    for (const b of data.buildings) {
      if (b.roof === 'flat') continue;
      const rMat2 = new THREE.MeshStandardMaterial({ color: b.roofColor, roughness: 0.8 });
      let rm: THREE.Mesh;
      if (b.roof === 'spire') {
        rm = new THREE.Mesh(new THREE.ConeGeometry(Math.min(b.w, b.d) * 0.18, b.h * 0.45, 4), rMat2);
        rm.position.set(b.x, b.h + b.h * 0.225, b.z);
      } else if (b.roof === 'pitched') {
        rm = new THREE.Mesh(new THREE.ConeGeometry(Math.min(b.w, b.d) * 0.52, b.h * 0.22, 4), rMat2);
        rm.position.set(b.x, b.h + b.h * 0.11, b.z);
        rm.rotation.y = Math.PI / 4;
      } else {
        rm = new THREE.Mesh(new THREE.CylinderGeometry(b.w * 0.14, b.w * 0.17, b.h * 0.14, 8), rMat2);
        rm.position.set(b.x, b.h + b.h * 0.07, b.z);
      }
      rm.castShadow = true; g.add(rm);
    }

    this.scene.add(g);
    this.setupCityCamera(cfg);
    this.onCityStats?.(data.stats);
  }

  private setupCityCamera(cfg: CityConfig, vp?: string) {
    const preset = vp ?? cfg.viewPreset;
    const dist = cfg.citySize * cfg.blockSize * 0.72;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);
    switch (preset) {
      case 'overhead':    this.camera.position.set(0, dist * 1.9, 0.1); this.controls.maxPolarAngle = Math.PI * 0.08; break;
      case 'isometric':  this.camera.position.set(dist, dist * 0.8, dist); break;
      case 'street':     this.camera.position.set(dist * 0.18, 8, dist * 0.42); this.controls.maxPolarAngle = Math.PI * 0.52; break;
      case 'cinematic':  this.camera.position.set(dist * 0.3, dist * 0.22, dist * 0.7); break;
      default:           this.camera.position.set(dist * 0.6, dist * 0.5, dist * 0.8);
    }
    this.camera.fov = 48; this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  updateCityConfig(patch: Partial<CityConfig>) {
    this.cityConfig = { ...this.cityConfig, ...patch };
    if (Object.keys(patch).length === 1 && patch.viewPreset !== undefined) {
      this.controls?.dispose(); this.controls = null;
      this.setupCityCamera(this.cityConfig, patch.viewPreset);
    } else {
      this.buildCity(this.cityConfig);
    }
  }

  regenerateCity() {
    this.cityConfig = { ...this.cityConfig, seed: Math.floor(Math.random() * 99999) };
    this.buildCity(this.cityConfig);
  }

  getCityConfig(): CityConfig { return { ...this.cityConfig }; }

  // ── Fly ───────────────────────────────────────────────────────────────────

  private buildFly() {
    this.clearScene();
    this.controls?.dispose(); this.controls = null;

    this.scene.background = new THREE.Color('#b8cdd8');
    this.scene.fog = new THREE.FogExp2('#c0d0dc', 0.0007);

    const ambient = new THREE.AmbientLight(0xffffff, 0.86);
    const sun = new THREE.DirectionalLight(0xffd4a0, 2.2);
    sun.position.set(200, 300, 100); sun.castShadow = true; sun.shadow.mapSize.setScalar(2048);
    this.scene.add(ambient, sun);

    // Ground
    const gm = new THREE.Mesh(
      new THREE.PlaneGeometry(5000, 5000),
      new THREE.MeshStandardMaterial({ color: '#8a9c6a', roughness: 1 }),
    );
    gm.rotation.x = -Math.PI / 2; gm.receiveShadow = true; this.scene.add(gm);

    // Hills
    for (const [hx, hz, hr, hh] of [[0, -900, 350, 80], [-300, -700, 200, 55], [300, -750, 250, 65]] as number[][]) {
      const hill = new THREE.Mesh(
        new THREE.SphereGeometry(hr, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
        new THREE.MeshStandardMaterial({ color: '#7a8f5a', roughness: 0.9 }),
      );
      hill.position.set(hx, hh * 0.18, hz); hill.scale.y = 0.28; hill.receiveShadow = true; this.scene.add(hill);
    }

    // Water — GLSL
    this.waterUniforms = { uTime: { value: 0 } };
    const waterMat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      vertexShader: `
        uniform float uTime; varying vec2 vUv; varying vec3 vWorld; varying float vWave;
        void main(){
          vUv=uv; vec3 pos=position;
          float wA=sin(pos.x*0.025+uTime*0.65)*0.78;
          float wB=sin((pos.x+pos.y)*0.014-uTime*0.42)*0.48;
          float wC=sin(pos.y*0.04+uTime*0.85)*0.18;
          vWave=wA+wB+wC; pos.z+=vWave;
          vec4 world=modelMatrix*vec4(pos,1.0); vWorld=world.xyz;
          gl_Position=projectionMatrix*viewMatrix*world;
        }`,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv; varying vec3 vWorld; varying float vWave;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
        void main(){
          vec3 deep=vec3(0.025,0.125,0.16); vec3 shelf=vec3(0.06,0.24,0.27); vec3 horizon=vec3(0.58,0.66,0.66);
          float ripple=sin(vUv.x*900.+uTime*2.)*sin(vUv.y*620.-uTime*1.35);
          float sparkle=pow(max(0.,ripple),30.)*0.22;
          float foam=smoothstep(0.76,1.,hash(floor((vUv+uTime*0.0008)*210.)))*0.06;
          float waveTone=smoothstep(-1.2,2.3,vWave);
          vec3 color=mix(deep,shelf,waveTone);
          color+=vec3(0.95,0.62,0.28)*sparkle+vec3(0.85,0.92,0.88)*foam;
          float fog=smoothstep(160.,980.,length(vWorld.xz));
          gl_FragColor=vec4(mix(color,horizon,fog*0.72),1.);
        }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 2200, 80, 80), waterMat);
    water.rotation.x = -Math.PI / 2; water.position.set(180, 0.5, 0); this.scene.add(water);

    // Distant skyline
    for (let i = 0; i < 18; i++) {
      const bh = 20 + Math.random() * 60;
      const bm = new THREE.Mesh(
        new THREE.BoxGeometry(8 + Math.random() * 14, bh, 8 + Math.random() * 14),
        new THREE.MeshStandardMaterial({ color: '#9aadb8', roughness: 0.8 }),
      );
      bm.position.set(-400 + i * 48 + Math.random() * 20, bh / 2, -350 + Math.random() * 40);
      this.scene.add(bm);
    }

    this.buildBridge();

    this.camera.fov = this.flyConfig.fov;
    this.camera.near = 0.1; this.camera.far = 2000;
    this.camera.updateProjectionMatrix();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
    document.addEventListener('pointerlockchange', this.onPLChange);
    document.addEventListener('mousemove', this.onMouseMove);

    this.jumpViewpoint(this.flyConfig.viewpoint);
  }

  private buildBridge() {
    const SPAN = 540, DECK_Y = 38.25, TOWER_H = 122;
    const matOrange = new THREE.MeshStandardMaterial({ color: 0xc95735, roughness: 0.55, metalness: 0.2 });
    const matDark   = new THREE.MeshStandardMaterial({ color: 0x843120, roughness: 0.7, metalness: 0.15 });
    const matConc   = new THREE.MeshStandardMaterial({ color: 0xc8b896, roughness: 0.9, metalness: 0 });
    const matRoad   = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 1 });

    const deck = new THREE.Mesh(new THREE.BoxGeometry(SPAN, 2.2, 22), matRoad);
    deck.position.set(0, DECK_Y, 0); deck.castShadow = true; deck.receiveShadow = true; this.scene.add(deck);

    for (const sz of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(SPAN, 1.2, 1.4), matOrange);
      curb.position.set(0, DECK_Y + 0.7, sz * 11); this.scene.add(curb);
    }

    for (const side of [-1, 1]) {
      const tx = side * (SPAN * 0.28);
      for (const leg of [-1, 1]) {
        const legM = new THREE.Mesh(new THREE.BoxGeometry(5.5, TOWER_H, 6.5), matOrange);
        legM.position.set(tx, TOWER_H / 2, leg * 7.5); legM.castShadow = true; this.scene.add(legM);
        const top = new THREE.Mesh(new THREE.BoxGeometry(4.5, TOWER_H * 0.15, 5.5), matOrange);
        top.position.set(tx, TOWER_H * 0.92, leg * 7.5); this.scene.add(top);
      }
      for (const by of [DECK_Y + 10, DECK_Y + 46, TOWER_H * 0.86]) {
        const xb = new THREE.Mesh(new THREE.BoxGeometry(3.5, 4.5, 23), matDark);
        xb.position.set(tx, by, 0); this.scene.add(xb);
      }
      const found = new THREE.Mesh(new THREE.BoxGeometry(20, 14, 34), matConc);
      found.position.set(tx, -7, 0); this.scene.add(found);
    }

    for (const sz of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let t = 0; t <= 60; t++) {
        const tt = t / 60;
        const cx = (SPAN / 2 + 70) - (SPAN + 140) * tt;
        const cy = TOWER_H - Math.pow((tt - 0.5) * 2, 2) * (TOWER_H - DECK_Y - 8);
        pts.push(new THREE.Vector3(cx, cy, sz * 7.5));
      }
      const cable = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.4, 6, false),
        matOrange,
      );
      this.scene.add(cable);
    }

    for (let hx = -SPAN / 2 + 22; hx <= SPAN / 2 - 22; hx += 13) {
      const fullSpanT = (hx + (SPAN / 2 + 70)) / (SPAN + 140);
      const cableY = TOWER_H - Math.pow((fullSpanT - 0.5) * 2, 2) * (TOWER_H - DECK_Y - 8);
      const hangerH = cableY - DECK_Y;
      if (hangerH < 1) continue;
      for (const sz of [-1, 1]) {
        const hng = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, hangerH, 4), matOrange);
        hng.position.set(hx, DECK_Y + hangerH / 2, sz * 7.5); this.scene.add(hng);
      }
    }

    for (const side of [-1, 1]) {
      const anc = new THREE.Mesh(new THREE.BoxGeometry(40, 18, 28), matConc);
      anc.position.set(side * (SPAN / 2 + 55), -4, 0); this.scene.add(anc);
    }
  }

  private jumpViewpoint(idx: number) {
    const vp = FLY_VPS[Math.max(0, Math.min(idx, 3))];
    this.camera.position.copy(vp.pos);
    this.camera.lookAt(vp.tgt);
    const dir = new THREE.Vector3().subVectors(vp.tgt, vp.pos).normalize();
    this.flyYaw = Math.atan2(dir.x, dir.z);
    this.flyPitch = Math.asin(-dir.y);
    this.flyConfig = { ...this.flyConfig, viewpoint: idx };
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (this.flyConfig.mode !== 'manual') return;
    this.flyKeys.add(e.code.toLowerCase());
  };
  private readonly onKeyUp = (e: KeyboardEvent) => { this.flyKeys.delete(e.code.toLowerCase()); };
  private readonly onCanvasClick = () => {
    if (this.flyConfig.mode === 'manual' && !this.pointerLocked)
      void this.renderer.domElement.requestPointerLock();
  };
  private readonly onPLChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
  };
  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked || this.flyConfig.mode !== 'manual') return;
    this.flyYaw -= e.movementX * 0.0018;
    this.flyPitch = Math.max(-1.3, Math.min(1.3, this.flyPitch - e.movementY * 0.0018));
  };

  private updateFly(dt: number) {
    if (this.waterUniforms) this.waterUniforms.uTime.value += dt;

    if (this.flyConfig.mode === 'autopilot') {
      this.autopilotT += dt * 0.038;
      const a = (this.autopilotT % 1) * Math.PI * 2;
      const tx = Math.sin(a) * 290, tz = Math.cos(a) * 210 - 70, ty = 58 + Math.sin(a * 2) * 28;
      this.camera.position.lerp(new THREE.Vector3(tx, ty, tz), 0.012);
      this.camera.lookAt(0, 38, 0);
    } else {
      const spd = this.flyKeys.has('shiftleft') || this.flyKeys.has('shiftright') ? 130 : 45;
      const fwd = new THREE.Vector3(
        -Math.sin(this.flyYaw) * Math.cos(this.flyPitch),
        Math.sin(this.flyPitch),
        -Math.cos(this.flyYaw) * Math.cos(this.flyPitch),
      );
      const rgt = new THREE.Vector3(Math.cos(this.flyYaw), 0, -Math.sin(this.flyYaw));
      const mv = new THREE.Vector3();
      if (this.flyKeys.has('keyw')) mv.addScaledVector(fwd, spd * dt);
      if (this.flyKeys.has('keys')) mv.addScaledVector(fwd, -spd * dt);
      if (this.flyKeys.has('keya')) mv.addScaledVector(rgt, -spd * dt);
      if (this.flyKeys.has('keyd')) mv.addScaledVector(rgt, spd * dt);
      if (this.flyKeys.has('space')) mv.y += spd * dt;
      if (this.flyKeys.has('keyq')) mv.y -= spd * dt;
      this.camera.position.add(mv);
      this.camera.lookAt(this.camera.position.clone().add(fwd));
    }

    const alt = Math.round(this.camera.position.y * 3.28084);
    const fwd2 = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    const deg = ((Math.atan2(fwd2.x, fwd2.z) * 180 / Math.PI) + 360) % 360;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    this.onFlyHud?.({
      mode: this.flyConfig.mode === 'autopilot' ? 'Auto Pilot' : 'Manual',
      altitude: alt,
      heading: `${Math.round(deg)} ${dirs[Math.round(deg / 45) % 8]}`,
    });
  }

  updateFlyConfig(patch: Partial<FlyConfig>) {
    this.flyConfig = { ...this.flyConfig, ...patch };
    if (patch.mode === 'autopilot' && this.pointerLocked) document.exitPointerLock();
    if (patch.viewpoint !== undefined) this.jumpViewpoint(patch.viewpoint);
    if (patch.fov !== undefined) { this.camera.fov = patch.fov; this.camera.updateProjectionMatrix(); }
  }

  getFlyConfig(): FlyConfig { return { ...this.flyConfig }; }

  cleanup() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls?.dispose();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
    document.removeEventListener('pointerlockchange', this.onPLChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    if (this.pointerLocked) document.exitPointerLock();
    this.clearScene();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container)
      this.container.removeChild(this.renderer.domElement);
  }
}
