/**
 * AgentSamEngine — IAM 3D viewport (CAD, GLB spawn, chess, voxels, physics).
 * @license SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';
import { MOUSE } from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { AppState, GameEntity, ProjectType, SceneConfig, CADTool, VoxelData, CADPlane, ArtStyle } from '../types';
import { chessPieceGlbPath, normalizeGlbUrl } from '@inneranimalmedia/client-3d-runtime/assets';
import { createPlatformGltfLoader, cloneGltfScene, loadCachedGltf } from '@inneranimalmedia/client-3d-runtime/gltf-loader';
import { AgentSamSceneConfig } from '../utils/agentSamConstants';
import {
  AgentSamGenerators,
  AGENT_SAM_GENERATOR_KEYS,
  AGENT_SAM_STYLE_GENERATORS,
  type AgentSamGeneratorKey,
} from '../utils/agentSamGenerators';
import { parseFenPlacement, positionToSquare, squareToPosition } from '@inneranimalmedia/client-3d-runtime/squares';
import { createChessBoard } from '@inneranimalmedia/client-3d-runtime/board';
import { applyChessPieceMaterials, setupChessEnvironment } from '@inneranimalmedia/client-3d-runtime/materials';
import {
  applySourceOrientation,
  applyPlacementOffsetMm,
  bottomCenterModel,
  buildSpatialSnapshot,
  createAxesHelper,
  resolveSpawnProfile,
  worldBoxFromObject,
  eulerDegFromObject,
  boxToSnapshot,
} from './agentSamSpatial';
import type { EntitySpatialSnapshot } from '../lib/cadPlacement';
import {
  fetchPlacementSidecarForGlb,
  spawnMetadataFromSidecar,
} from '../lib/cadPlacement';
import { ViewportGyroscope } from './viewportGyroscope';

const CHESS_PIECES = ['bishop', 'king', 'knight', 'pawn', 'queen', 'rook'] as const;

function buildChessModels(): Record<'black' | 'white', Record<string, string>> {
  const out: Record<'black' | 'white', Record<string, string>> = { black: {}, white: {} };
  for (const color of ['black', 'white'] as const) {
    for (const piece of CHESS_PIECES) {
      out[color][piece] = chessPieceGlbPath(color, piece);
    }
  }
  return out;
}

const CHESS_MODELS = buildChessModels();
const VOXEL_UNIT = Math.max(0.1, AgentSamSceneConfig.VOXEL_SIZE * 0.95);

export class AgentSamEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private perspectiveCamera: THREE.PerspectiveCamera;
  private orthoCamera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private gltfLoader: ReturnType<typeof createPlatformGltfLoader>;
  private resizeObserver: ResizeObserver;
  
  private ambientLight: THREE.AmbientLight;
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;

  private world: CANNON.World;
  private entities: Map<string, { 
    mesh?: THREE.InstancedMesh, 
    model?: THREE.Group,
    data: GameEntity, 
    body?: CANNON.Body 
  }> = new Map();
  private groundBody: CANNON.Body;

  private draggedEntityId: string | null = null;
  private dragOffset = new THREE.Vector3();
  private viewTool: 'select' | 'move' | 'rotate' | 'scale' = 'select';
  private dragIndicator: THREE.Mesh | null = null;
  private cadTool: CADTool = CADTool.NONE;
  private cadPlane: CADPlane = CADPlane.XZ;
  private extrusion: number = 1;

  private physicsDebug: boolean = false;
  private debugGroup: THREE.Group = new THREE.Group();

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private gridHelper: THREE.GridHelper | null = null;
  private worldSpatialAxes: THREE.Group | null = null;
  private modelSpatialAxes: THREE.Group | null = null;
  private spatialOverlaysEnabled = true;
  private selectedSpatialEntityId: string | null = null;
  private highlightedEntityId: string | null = null;
  private pointerDownClient = { x: 0, y: 0 };
  private gyroscope: ViewportGyroscope | null = null;
  private drawingPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private startPoint: THREE.Vector3 | null = null;
  private previewMesh: THREE.InstancedMesh | null = null;
  private drawingColor: number = 0xffffff;
  private isMouseDown: boolean = false;

  private onCountChange: (count: number) => void;
  private onEntityCreated: ((entity: GameEntity) => void) | null = null;
  private onEntitySelected: ((id: string | null) => void) | null = null;
  private onChessMove: ((from: string, to: string) => void) | null = null;
  private dragFromSquare: string | null = null;
  private animationId: number = 0;
  private dummy = new THREE.Object3D();
  private projectType: ProjectType = ProjectType.SANDBOX;

  constructor(
    container: HTMLElement, 
    onStateChange: (state: AppState) => void,
    onCountChange: (count: number) => void
  ) {
    this.container = container;
    this.onCountChange = onCountChange;

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.gltfLoader = createPlatformGltfLoader(dracoLoader);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f111a);
    this.scene.fog = new THREE.FogExp2(0x0f111a, 0.015);
    this.scene.add(this.debugGroup);

    const aspect = window.innerWidth / window.innerHeight;
    this.perspectiveCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    this.perspectiveCamera.position.set(15, 15, 15);
    
    const d = 30;
    this.orthoCamera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
    this.orthoCamera.position.set(0, 100, 0);
    this.orthoCamera.lookAt(0, 0, 0);

    this.camera = this.perspectiveCamera;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setClearColor(0x373a3f, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    const applyContainerSize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        this.handleResizeDimensions(width, height);
        return true;
      }
      return false;
    };

    if (!applyContainerSize()) {
      requestAnimationFrame(() => {
        if (!applyContainerSize()) {
          requestAnimationFrame(() => applyContainerSize());
        }
      });
    }

    this.resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
            const { width, height } = entry.contentRect;
            this.handleResizeDimensions(width, height);
        }
    });
    this.resizeObserver.observe(container);

    this.world = new CANNON.World();
    this.world.gravity.set(0, -9.82, 0);
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;

    this.setupLights();
    this.setupGrid();
    this.setupPhysicsGround();
    this.setupDragIndicator();

    container.addEventListener('mousedown', this.onMouseDown.bind(this));
    container.addEventListener('mousemove', this.onMouseMove.bind(this));
    container.addEventListener('mouseup', this.onMouseUp.bind(this));

    this.animate = this.animate.bind(this);
    this.animate();
  }

  public setOnEntityCreated(cb: (entity: GameEntity) => void) {
    this.onEntityCreated = cb;
  }

  public setOnEntitySelected(cb: ((id: string | null) => void) | null) {
    this.onEntitySelected = cb;
  }

  public setOnChessMove(cb: ((from: string, to: string) => void) | null) {
    this.onChessMove = cb;
  }

  /** Move a chess piece entity between algebraic squares (used by multiplayer sync). */
  public movePiece(from: string, to: string): boolean {
    const fromPos = squareToPosition(from);
    const toPos = squareToPosition(to);
    if (!fromPos || !toPos) return false;

    let movingId: string | null = null;
    let capturedId: string | null = null;

    for (const [id, ent] of this.entities.entries()) {
      if (ent.data.type !== 'piece') continue;
      const sq = (ent.data.behavior.metadata?.square as string | undefined) ?? '';
      if (sq === to) capturedId = id;
      if (sq === from) movingId = id;
    }

    if (!movingId) {
      for (const [id, ent] of this.entities.entries()) {
        if (ent.data.type !== 'piece') continue;
        const visual = ent.mesh || ent.model;
        if (!visual) continue;
        if (positionToSquare(visual.position.x, visual.position.z) === from) {
          movingId = id;
          break;
        }
      }
    }

    if (capturedId && capturedId !== movingId) this.removeEntity(capturedId);
    if (!movingId) return false;

    const ent = this.entities.get(movingId);
    if (!ent) return false;
    const visual = ent.mesh || ent.model;
    if (visual) {
      visual.position.set(toPos.x, toPos.y, toPos.z);
      if (ent.body) {
        ent.body.position.set(toPos.x, toPos.y, toPos.z);
        ent.body.velocity.set(0, 0, 0);
      }
    }
    ent.data.position = { x: toPos.x, y: toPos.y, z: toPos.z };
    ent.data.behavior = {
      ...ent.data.behavior,
      metadata: { ...(ent.data.behavior.metadata || {}), square: to },
    };
    return true;
  }

  /** Rebuild chess pieces from a FEN string (keeps the voxel board). */
  public async syncBoardFromFen(fen: string): Promise<void> {
    if (this.projectType !== ProjectType.CHESS) return;
    for (const id of Array.from(this.entities.keys())) {
      if (id === 'chess_board') continue;
      const ent = this.entities.get(id);
      if (ent?.data.type === 'piece') this.removeEntity(id);
    }
    const placements = parseFenPlacement(fen);
    for (const p of placements) {
      const pos = squareToPosition(p.square);
      if (!pos) continue;
      const modelUrl = CHESS_MODELS[p.color][p.piece] || CHESS_MODELS[p.color].pawn;
      await this.spawnEntity({
        id: `piece_${p.square}`,
        name: `${p.color} ${p.piece}`,
        type: 'piece',
        modelUrl,
        scale: 0.8,
        position: pos,
        behavior: {
          type: 'chess_piece',
          metadata: { square: p.square, color: p.color, piece: p.piece, fenChar: p.fenChar },
        },
      });
    }
  }

  private setupDragIndicator() {
    const geo = new THREE.BoxGeometry(1.05, 1.05, 1.05);
    const mat = new THREE.MeshBasicMaterial({ 
      color: 0x00ffff, 
      transparent: true, 
      opacity: 0.2,
      wireframe: true
    });
    this.dragIndicator = new THREE.Mesh(geo, mat);
    this.dragIndicator.visible = false;
    this.scene.add(this.dragIndicator);
  }

  private setupPhysicsGround() {
    this.groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
    });
    this.groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(this.groundBody);
  }

  private setupLights() {
    // A soft ambient base
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    // Hemisphere light adds an excellent sky-to-ground gradient contrast
    const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x222233, 1.0);
    hemiLight.position.set(0, 50, 0);
    this.hemiLight = hemiLight;
    this.scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sunLight.position.set(30, 50, -20);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.left = -50;
    this.sunLight.shadow.camera.right = 50;
    this.sunLight.shadow.camera.top = 50;
    this.sunLight.shadow.camera.bottom = -50;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
  }

  public updateLighting(config: SceneConfig) {
    this.ambientLight.intensity = config.ambientIntensity;
    this.sunLight.color.set(config.sunColor);
    this.sunLight.castShadow = config.castShadows;
    this.setPhysicsDebug(config.showPhysicsDebug);
    this.drawingColor = new THREE.Color(config.sunColor).getHex();
  }

  public setPhysicsDebug(enabled: boolean) {
    this.physicsDebug = enabled;
    this.debugGroup.visible = enabled;
  }

  private syncPhysicsDebug() {
    if (!this.physicsDebug) return;
    this.debugGroup.clear();
    this.world.bodies.forEach(body => {
      body.shapes.forEach((shape, i) => {
        let mesh: THREE.Mesh | null = null;
        if (shape instanceof CANNON.Box) {
          const geom = new THREE.BoxGeometry(shape.halfExtents.x * 2, shape.halfExtents.y * 2, shape.halfExtents.z * 2);
          mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true }));
        }
        if (mesh) {
          mesh.position.copy(body.position as any);
          mesh.quaternion.copy(body.quaternion as any);
          this.debugGroup.add(mesh);
        }
      });
    });
  }

  private setupGrid() {
    const grid = new THREE.GridHelper(100, 100, 0x666688, 0x222233);
    grid.position.y = -0.01;
    this.gridHelper = grid;
    this.scene.add(grid);

    this.worldSpatialAxes = createAxesHelper(3, 0.9);
    this.worldSpatialAxes.name = 'iam_world_axes';
    this.worldSpatialAxes.position.set(0, 0.001, 0);
    this.scene.add(this.worldSpatialAxes);

    this.modelSpatialAxes = createAxesHelper(2, 1);
    this.modelSpatialAxes.name = 'iam_model_axes';
    this.modelSpatialAxes.visible = false;
    this.scene.add(this.modelSpatialAxes);
  }

  public setSpatialOverlaysEnabled(enabled: boolean) {
    this.spatialOverlaysEnabled = enabled;
    if (this.worldSpatialAxes) this.worldSpatialAxes.visible = enabled;
    this.syncModelSpatialAxes();
  }

  private syncModelSpatialAxes() {
    if (!this.modelSpatialAxes) return;
    if (!this.spatialOverlaysEnabled || !this.selectedSpatialEntityId) {
      this.modelSpatialAxes.visible = false;
      return;
    }
    const ent = this.entities.get(this.selectedSpatialEntityId);
    const visual = ent?.model || ent?.mesh;
    if (!visual) {
      this.modelSpatialAxes.visible = false;
      return;
    }
    const box = worldBoxFromObject(visual);
    const size = new THREE.Vector3();
    box.getSize(size);
    const axisLen = Math.max(0.5, Math.min(12, Math.max(size.x, size.y, size.z) * 0.35));
    this.modelSpatialAxes.clear();
    this.modelSpatialAxes.add(createAxesHelper(axisLen, 1));
    this.modelSpatialAxes.position.set(visual.position.x, visual.position.y, visual.position.z);
    this.modelSpatialAxes.visible = true;
  }

  public setSelectedSpatialEntity(id: string | null) {
    this.selectedSpatialEntityId = id;
    this.syncSelectionHighlight(id);
    this.syncModelSpatialAxes();
  }

  private syncSelectionHighlight(id: string | null) {
    if (this.highlightedEntityId && this.highlightedEntityId !== id) {
      this.applyEntityMaterial(this.highlightedEntityId, { emissive: false });
    }
    this.highlightedEntityId = id;
    if (id) {
      this.applyEntityMaterial(id, { emissive: true });
    }
  }

  private resolveEntityIdFromObject(obj: THREE.Object3D | null): string | null {
    let current: THREE.Object3D | null = obj;
    while (current) {
      const id = current.userData?.iamEntityId;
      if (typeof id === 'string' && id) return id;
      current = current.parent;
    }
    return null;
  }

  private getSelectableRoots(): THREE.Object3D[] {
    const roots: THREE.Object3D[] = [];
    for (const [id, ent] of this.entities.entries()) {
      if (id === 'chess_board') continue;
      const root = ent.model || ent.mesh;
      if (root) roots.push(root);
    }
    return roots;
  }

  private pickEntityAtPointer(): string | null {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.getSelectableRoots(), true);
    if (!hits.length) return null;
    return this.resolveEntityIdFromObject(hits[0].object);
  }

  private setupGyroscopeOverlay() {
    if (this.gyroscope) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'iam-viewport-gyro';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = 72;
    canvas.height = 72;
    this.container.appendChild(canvas);
    this.gyroscope = new ViewportGyroscope(canvas);
  }

  /** Raycast targets for CAD voxel/paint — grid + entity roots (GLB pivots + voxels). */
  private getCadRaycastTargets(voxelOnly = false): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    if (!voxelOnly && this.gridHelper) targets.push(this.gridHelper);
    for (const ent of this.entities.values()) {
      if (ent.mesh) targets.push(ent.mesh);
      else if (ent.model) targets.push(ent.model);
    }
    return targets;
  }

  private raycastCadSurfaces(voxelOnly = false): THREE.Intersection[] {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const targets = this.getCadRaycastTargets(voxelOnly);
    if (targets.length === 0) return [];
    return this.raycaster.intersectObjects(targets, false);
  }

  public setCADTool(tool: CADTool) {
    this.cadTool = tool;
    this.container.style.cursor = tool !== CADTool.NONE ? 'crosshair' : 'default';
    this.syncOrbitForCadInteraction();
    if (this.dragIndicator) this.dragIndicator.visible = tool === CADTool.VOXEL;
  }

  /** Blender-style viewport tools (Design Studio menu bar). */
  public setViewTool(tool: 'select' | 'move' | 'rotate' | 'scale') {
    this.viewTool = tool;
    this.cadTool = CADTool.NONE;
    this.container.style.cursor = tool === 'select' ? 'default' : 'grab';
    this.syncOrbitForCadInteraction();
  }

  private syncOrbitForCadInteraction() {
    const cadIdle = this.projectType === ProjectType.CAD && this.cadTool === CADTool.NONE;
    this.controls.enableRotate = !cadIdle || this.viewTool === 'select';
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
  }

  private beginCadEntityDrag(id: string) {
    const ent = this.entities.get(id);
    const visual = ent?.model || ent?.mesh;
    if (!ent || !visual) return false;
    this.draggedEntityId = id;
    this.setSelectedSpatialEntity(id);
    this.onEntitySelected?.(id);
    this.controls.enabled = false;
    const ground = this.getMousePoint();
    if (ground) {
      this.dragOffset.copy(visual.position).sub(ground);
    } else {
      this.dragOffset.set(0, 0, 0);
    }
    return true;
  }

  public setCADPlane(plane: CADPlane) {
    this.cadPlane = plane;
    switch (plane) {
      case CADPlane.XZ: this.drawingPlane.set(new THREE.Vector3(0, 1, 0), 0); break;
      case CADPlane.XY: this.drawingPlane.set(new THREE.Vector3(0, 0, 1), 0); break;
      case CADPlane.YZ: this.drawingPlane.set(new THREE.Vector3(1, 0, 0), 0); break;
    }
  }

  public setExtrusion(depth: number) { this.extrusion = depth; }

  private updateMouse(e: MouseEvent) {
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onMouseDown(e: MouseEvent) {
    this.updateMouse(e);
    this.isMouseDown = true;
    this.pointerDownClient.x = e.clientX;
    this.pointerDownClient.y = e.clientY;
    
    if (this.projectType === ProjectType.CHESS) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.scene.children, true);
      for (const intersect of intersects) {
        let current: THREE.Object3D | null = intersect.object;
        while (current) {
          for (const [id, entity] of this.entities.entries()) {
            if ((entity.model === current || entity.mesh === current) && entity.data.type === 'piece') {
              this.draggedEntityId = id;
              const visual = entity.mesh || entity.model;
              this.dragFromSquare =
                (entity.data.behavior.metadata?.square as string | undefined) ??
                (visual ? positionToSquare(visual.position.x, visual.position.z) : null);
              this.controls.enabled = false;
              if (entity.body) entity.body.type = CANNON.Body.KINEMATIC;
              return;
            }
          }
          current = current.parent;
        }
      }
    }

    if (this.cadTool === CADTool.VOXEL) {
      this.placeBlockAtMouse();
      return;
    }

    if (this.cadTool === CADTool.PAINT) {
      this.paintAtMouse();
      return;
    }

    if (
      this.projectType === ProjectType.CAD &&
      this.cadTool === CADTool.NONE &&
      (this.viewTool === 'select' || this.viewTool === 'move')
    ) {
      const picked = this.pickEntityAtPointer();
      if (picked && this.beginCadEntityDrag(picked)) return;
    }

    if (this.cadTool !== CADTool.NONE && this.projectType === ProjectType.CAD) {
      this.startPoint = this.getMousePoint();
    }
  }

  private onMouseMove(e: MouseEvent) {
    this.updateMouse(e);
    
    if (this.draggedEntityId) {
      const point = this.getMousePoint();
      if (point) {
        const ent = this.entities.get(this.draggedEntityId);
        if (ent) {
          const visual = ent.mesh || ent.model;
          if (visual) {
            if (this.projectType === ProjectType.CHESS) {
              visual.position.lerp(new THREE.Vector3(point.x, 1.2, point.z), 0.2);
            } else {
              visual.position.set(
                point.x + this.dragOffset.x,
                visual.position.y,
                point.z + this.dragOffset.z,
              );
              ent.data.position = {
                x: visual.position.x,
                y: visual.position.y,
                z: visual.position.z,
              };
              this.syncModelSpatialAxes();
            }
          }
        }
      }
    }

    if (this.cadTool === CADTool.VOXEL) {
        const buildPoint = this.getBuildPoint();
        if (buildPoint && this.dragIndicator) {
            this.dragIndicator.position.copy(buildPoint);
            this.dragIndicator.visible = true;
        } else if (this.dragIndicator) {
            this.dragIndicator.visible = false;
        }
    }

    if (this.isMouseDown && this.cadTool === CADTool.PAINT) {
      this.paintAtMouse();
    }

    if (this.startPoint && this.cadTool !== CADTool.NONE) {
      const currentPoint = this.getMousePoint();
      if (currentPoint) this.updatePreview(this.startPoint, currentPoint);
    }
  }

  private onMouseUp(e: MouseEvent) {
    this.updateMouse(e);
    this.isMouseDown = false;

    if (
      this.projectType === ProjectType.CAD &&
      this.cadTool === CADTool.NONE &&
      !this.draggedEntityId
    ) {
      const dx = e.clientX - this.pointerDownClient.x;
      const dy = e.clientY - this.pointerDownClient.y;
      if (dx * dx + dy * dy <= 36) {
        const picked = this.pickEntityAtPointer();
        this.setSelectedSpatialEntity(picked);
        this.onEntitySelected?.(picked);
      }
    }

    if (this.draggedEntityId) {
      const ent = this.entities.get(this.draggedEntityId);
      const fromSquare = this.dragFromSquare;
      if (ent && this.projectType === ProjectType.CHESS) {
        const visual = ent.mesh || ent.model;
        if (visual) {
          const x = Math.floor(visual.position.x) + 0.5;
          const z = Math.floor(visual.position.z) + 0.5;
          visual.position.set(x, 0.5, z);
          if (ent.body) {
            ent.body.type = CANNON.Body.DYNAMIC;
            ent.body.position.set(x, 0.5, z);
            ent.body.velocity.set(0, 0, 0);
          }
          const toSquare = positionToSquare(x, z);
          if (toSquare) {
            ent.data.behavior = {
              ...ent.data.behavior,
              metadata: { ...(ent.data.behavior.metadata || {}), square: toSquare },
            };
            ent.data.position = { x, y: 0.5, z };
            if (fromSquare && toSquare !== fromSquare && this.onChessMove) {
              this.onChessMove(fromSquare, toSquare);
            }
          }
        }
      } else if (ent && this.projectType === ProjectType.CAD) {
        this.refreshEntitySpatialMetadata(this.draggedEntityId);
      }
      this.draggedEntityId = null;
      this.dragFromSquare = null;
      this.controls.enabled = true;
    }

    if (this.startPoint && this.cadTool !== CADTool.NONE) {
      const endPoint = this.getMousePoint();
      if (endPoint) this.finalizeDrawing(this.startPoint, endPoint);
      this.startPoint = null;
      if (this.previewMesh) { this.scene.remove(this.previewMesh); this.previewMesh = null; }
    }
  }

  private getBuildPoint(): THREE.Vector3 | null {
    const intersects = this.raycastCadSurfaces();
    if (intersects.length > 0) {
        const intersect = intersects[0];
        const point = intersect.point.clone();
        const normal = intersect.face?.normal.clone() || new THREE.Vector3(0, 1, 0);
        normal.applyQuaternion(intersect.object.quaternion);
        
        point.add(normal.multiplyScalar(0.5));
        return new THREE.Vector3(Math.round(point.x), Math.round(point.y), Math.round(point.z));
    }
    const planeHit = this.getMousePoint();
    if (planeHit) {
      return new THREE.Vector3(Math.round(planeHit.x), Math.round(planeHit.y), Math.round(planeHit.z));
    }
    return null;
  }

  private placeBlockAtMouse() {
    const point = this.getBuildPoint();
    if (!point) return;

    const entity: GameEntity = {
      id: `block_${Date.now()}`,
      name: 'Voxel Block',
      type: 'prop',
      voxels: [{ x: 0, y: 0, z: 0, color: this.drawingColor }],
      position: { x: point.x, y: point.y, z: point.z },
      behavior: { type: 'static' }
    };
    this.spawnEntity(entity);
    if (this.onEntityCreated) this.onEntityCreated(entity);
  }

  private paintAtMouse() {
    const intersects = this.raycastCadSurfaces(true);
    if (intersects.length === 0) return;
    const mesh = intersects[0].object as THREE.Mesh;
    if (mesh.isMesh) {
        if (!(mesh.material as any).color) return;
        (mesh.material as any).color.setHex(this.drawingColor);
    }
  }

  private getMousePoint(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersect = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.drawingPlane, intersect) ? intersect.clone() : null;
  }

  private updatePreview(start: THREE.Vector3, end: THREE.Vector3) {
    if (this.previewMesh) this.scene.remove(this.previewMesh);
    const voxels = this.rasterizeShape(start, end);
    if (voxels.length === 0) return;
    const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const material = new THREE.MeshBasicMaterial({ color: this.drawingColor, transparent: true, opacity: 0.5 });
    this.previewMesh = new THREE.InstancedMesh(geometry, material, voxels.length);
    voxels.forEach((v, i) => {
      this.dummy.position.set(v.x, v.y, v.z);
      this.dummy.updateMatrix();
      this.previewMesh!.setMatrixAt(i, this.dummy.matrix);
    });
    this.scene.add(this.previewMesh);
  }

  private finalizeDrawing(start: THREE.Vector3, end: THREE.Vector3) {
    const voxels = this.rasterizeShape(start, end);
    if (voxels.length === 0) return;
    const entity: GameEntity = {
      id: 'cad_' + Date.now(),
      name: `CAD ${this.cadTool}`,
      type: 'prop',
      voxels,
      position: { x: 0, y: 0, z: 0 },
      behavior: { type: 'static' }
    };
    this.spawnEntity(entity);
    if (this.onEntityCreated) this.onEntityCreated(entity);
  }

  private rasterizeShape(start: THREE.Vector3, end: THREE.Vector3): VoxelData[] {
    const voxels: VoxelData[] = [];
    let s = { a: Math.round(start.x), b: Math.round(start.z), fixed: Math.round(start.y) };
    let e = { a: Math.round(end.x), b: Math.round(end.z), fixed: Math.round(end.y) };
    if (this.cadPlane === CADPlane.XY) {
        s = { a: Math.round(start.x), b: Math.round(start.y), fixed: Math.round(start.z) };
        e = { a: Math.round(end.x), b: Math.round(end.y), fixed: Math.round(end.z) };
    } else if (this.cadPlane === CADPlane.YZ) {
        s = { a: Math.round(start.y), b: Math.round(start.z), fixed: Math.round(start.x) };
        e = { a: Math.round(end.y), b: Math.round(end.z), fixed: Math.round(end.x) };
    }

    const addVoxel = (a: number, b: number, c: number) => {
      let x, y, z;
      if (this.cadPlane === CADPlane.XZ) { x = a; y = c; z = b; }
      else if (this.cadPlane === CADPlane.XY) { x = a; y = b; z = c; }
      else { x = c; y = a; z = b; }
      voxels.push({ x, y, z, color: this.drawingColor });
    };

    if (this.cadTool === CADTool.LINE) {
        this.rasterizeLine2D(s.a, s.b, e.a, e.b, (a, b) => {
            for (let c = 0; c < this.extrusion; c++) addVoxel(a, b, s.fixed + c);
        });
    } else if (this.cadTool === CADTool.RECTANGLE) {
        this.rasterizeRect2D(s.a, s.b, e.a, e.b, (a, b) => {
            for (let c = 0; c < this.extrusion; c++) addVoxel(a, b, s.fixed + c);
        });
    } else if (this.cadTool === CADTool.CUBE) {
        const minA = Math.min(s.a, e.a), maxA = Math.max(s.a, e.a);
        const minB = Math.min(s.b, e.b), maxB = Math.max(s.b, e.b);
        for (let a = minA; a <= maxA; a++) for (let b = minB; b <= maxB; b++) for (let c = 0; c < this.extrusion; c++) addVoxel(a, b, s.fixed + c);
    } else if (this.cadTool === CADTool.CIRCLE) {
        const centerA = s.a;
        const centerB = s.b;
        const radius = Math.max(1, Math.round(Math.hypot(e.a - s.a, e.b - s.b)));
        this.rasterizeCircle2D(centerA, centerB, radius, (a, b) => {
            for (let c = 0; c < this.extrusion; c++) addVoxel(a, b, s.fixed + c);
        });
    } else if (this.cadTool === CADTool.SPHERE) {
        const radius = Math.max(1, Math.round(Math.hypot(e.a - s.a, e.b - s.b, e.fixed - s.fixed)));
        this.rasterizeSphere3D(s.a, s.b, s.fixed, radius, (a, b, c) => addVoxel(a, b, c));
    } else if (this.cadTool === CADTool.CONE) {
        const baseRadius = Math.max(1, Math.round(Math.hypot(e.a - s.a, e.b - s.b)));
        this.rasterizeCone(s.a, s.b, s.fixed, baseRadius, this.extrusion, (a, b, c) => addVoxel(a, b, c));
    }
    return voxels;
  }

  private rasterizeCircle2D(centerA: number, centerB: number, radius: number, add: (a: number, b: number) => void) {
    const r2 = radius * radius;
    for (let a = centerA - radius; a <= centerA + radius; a++) {
      for (let b = centerB - radius; b <= centerB + radius; b++) {
        const da = a - centerA;
        const db = b - centerB;
        if (da * da + db * db <= r2) add(a, b);
      }
    }
  }

  private rasterizeSphere3D(cx: number, cy: number, cz: number, radius: number, add: (a: number, b: number, c: number) => void) {
    const r2 = radius * radius;
    for (let a = cx - radius; a <= cx + radius; a++) {
      for (let b = cy - radius; b <= cy + radius; b++) {
        for (let c = cz - radius; c <= cz + radius; c++) {
          const da = a - cx;
          const db = b - cy;
          const dc = c - cz;
          if (da * da + db * db + dc * dc <= r2) add(a, b, c);
        }
      }
    }
  }

  private rasterizeCone(
    baseA: number,
    baseB: number,
    baseFixed: number,
    baseRadius: number,
    height: number,
    add: (a: number, b: number, c: number) => void,
  ) {
    const h = Math.max(1, height);
    for (let step = 0; step < h; step++) {
      const t = step / h;
      const r = Math.max(0, Math.round(baseRadius * (1 - t)));
      if (r === 0) {
        add(baseA, baseB, baseFixed + step);
        continue;
      }
      const r2 = r * r;
      for (let a = baseA - r; a <= baseA + r; a++) {
        for (let b = baseB - r; b <= baseB + r; b++) {
          const da = a - baseA;
          const db = b - baseB;
          if (da * da + db * db <= r2) add(a, b, baseFixed + step);
        }
      }
    }
  }

  private rasterizeLine2D(a0: number, b0: number, a1: number, b1: number, add: (a: number, b: number) => void) {
    let da = Math.abs(a1 - a0), db = Math.abs(b1 - b0), sa = a0 < a1 ? 1 : -1, sb = b0 < b1 ? 1 : -1, err = da - db;
    while (true) { add(a0, b0); if (a0 === a1 && b0 === b1) break; let e2 = 2 * err; if (e2 > -db) { err -= db; a0 += sa; } if (e2 < da) { err += da; b0 += sb; } }
  }

  private rasterizeRect2D(a1: number, b1: number, a2: number, b2: number, add: (a: number, b: number) => void) {
    const minA = Math.min(a1, a2), maxA = Math.max(a1, a2), minB = Math.min(b1, b2), maxB = Math.max(b1, b2);
    for (let a = minA; a <= maxA; a++) { add(a, minB); add(a, maxB); }
    for (let b = minB + 1; b < maxB; b++) { add(minA, b); add(maxA, b); }
  }

  public setProjectType(type: ProjectType) {
    this.projectType = type;
    this.clearWorld();
    if (type === ProjectType.CAD) {
      this.camera = this.perspectiveCamera;
      this.controls.enableRotate = true;
      this.controls.enablePan = true;
      this.controls.enableZoom = true;
      const bg = 0x373a3f;
      this.scene.background = new THREE.Color(bg);
      this.scene.fog = null;
      this.world.gravity.set(0, 0, 0);
      this.setupGyroscopeOverlay();
    }
    else if (type === ProjectType.CHESS) {
      this.camera = this.perspectiveCamera;
      this.scene.background = new THREE.Color(0x121218);
      this.scene.fog = null;
      this.world.gravity.set(0, -20, 0);
      setupChessEnvironment(this.renderer, this.scene);
      this.controls.enableRotate = false;
      this.controls.enablePan = false;
      this.controls.enableZoom = false;
      this.setupChessBoard();
    }
    else {
      this.controls.enableRotate = true;
      this.controls.enablePan = true;
      this.controls.enableZoom = true;
      this.camera = this.perspectiveCamera;
      const bg = AgentSamSceneConfig.BG_COLOR;
      this.scene.background = new THREE.Color(bg);
      this.scene.fog = new THREE.FogExp2(bg, 0.015);
      this.world.gravity.set(0, -9.82, 0);
    }
    this.controls.object = this.camera;
  }

  private setupChessBoard() {
    this.spawnProceduralChessBoard();
    if (this.projectType === ProjectType.CHESS) {
      this.controls.minPolarAngle = THREE.MathUtils.degToRad(15);
      this.controls.maxPolarAngle = THREE.MathUtils.degToRad(75);
      this.perspectiveCamera.position.set(0, 10, 9);
      this.controls.target.set(0, 0, 0);
    }
  }

  private spawnProceduralChessBoard() {
    if (this.entities.has('chess_board')) this.removeEntity('chess_board');
    const board = createChessBoard();
    board.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).castShadow = true;
        (o as THREE.Mesh).receiveShadow = true;
      }
    });
    this.scene.add(board);
    this.entities.set('chess_board', {
      model: board,
      data: {
        id: 'chess_board',
        name: 'Board',
        type: 'prop',
        position: { x: 0, y: 0, z: 0 },
        behavior: { type: 'static' },
      },
    });
  }

  /** @deprecated GLB board fallback removed — procedural board only. */
  private async spawnChessBoardGlb(): Promise<void> {
    this.spawnProceduralChessBoard();
  }

  public async spawnEntity(entity: GameEntity) {
    if (this.entities.has(entity.id)) this.removeEntity(entity.id);

    let visual: THREE.Object3D | undefined;
    if (entity.modelUrl) {
      try {
        let spawnEntity = entity;
        const metaSeed = { ...(entity.behavior?.metadata ?? {}) } as Record<string, unknown>;
        if (!metaSeed.placement_sidecar) {
          const fetchedSidecar = await fetchPlacementSidecarForGlb(entity.modelUrl);
          if (fetchedSidecar) {
            spawnEntity = {
              ...entity,
              behavior: {
                ...entity.behavior,
                metadata: { ...metaSeed, ...spawnMetadataFromSidecar(fetchedSidecar) },
              },
            };
          }
        }

        const gltf = await this.loadModel(spawnEntity.modelUrl!);
        const model = cloneGltfScene(gltf);
        const spawnMeta = { ...(spawnEntity.behavior?.metadata ?? {}) } as Record<string, unknown>;
        const { profile, sidecar, fitToViewport, unitScale } = resolveSpawnProfile(spawnEntity);

        applySourceOrientation(model, sidecar, spawnMeta);

        const boxBeforeScale = new THREE.Box3().setFromObject(model);
        const sizeBefore = new THREE.Vector3();
        boxBeforeScale.getSize(sizeBefore);
        bottomCenterModel(model);

        const pivot = new THREE.Group();
        pivot.userData.iamEntityId = spawnEntity.id;
        pivot.add(model);

        let appliedScale: number;
        if (fitToViewport) {
          appliedScale =
            entity.scale && entity.scale > 0
              ? entity.scale
              : 5 / Math.max(sizeBefore.x, sizeBefore.y, sizeBefore.z, 0.001);
        } else if (entity.scale && entity.scale > 0) {
          appliedScale = entity.scale * unitScale;
        } else {
          appliedScale = unitScale;
        }
        pivot.scale.set(appliedScale, appliedScale, appliedScale);
        applyPlacementOffsetMm(pivot, sidecar, unitScale);

        const pieceColor = (spawnEntity.behavior.metadata?.color as 'white' | 'black' | undefined)
          ?? (spawnEntity.name?.toLowerCase().startsWith('white')
            ? 'white'
            : spawnEntity.name?.toLowerCase().startsWith('black') || spawnEntity.name?.toLowerCase().startsWith('orange')
              ? 'black'
              : undefined);
        const isChessPiece =
          pieceColor &&
          (spawnEntity.type === 'piece' ||
            spawnEntity.behavior.type === 'chess_piece' ||
            Boolean(spawnEntity.modelUrl?.includes('chess_')));
        if (isChessPiece && pieceColor) {
          applyChessPieceMaterials(pivot, pieceColor);
        }
        
        visual = pivot;
        this.scene.add(visual);
        const meta = { ...(spawnEntity.behavior.metadata ?? {}) } as Record<string, unknown>;
        meta.spawn_profile = profile;
        meta.visual_scale = appliedScale;
        spawnEntity.behavior = { ...spawnEntity.behavior, metadata: meta };
        entity = spawnEntity;
        this.entities.set(entity.id, { model: pivot, data: entity });

        const spatial = buildSpatialSnapshot(entity, pivot, profile, meta);
        meta.spatial = spatial;
        entity.behavior.metadata = meta;

        console.log(`Successfully spawned model: ${entity.name} profile=${profile} scale=${appliedScale}`);
        this.frameCameraOnObject(visual);
      } catch (err) {
        console.error(`Failed to load model: ${entity.modelUrl}`, err);
        if (entity.type === 'piece' || entity.behavior.type === 'chess_piece') {
          return;
        }
        throw err;
      }
    } else if (entity.voxels) {
      if (entity.type === 'piece' || entity.behavior.type === 'chess_piece') {
        console.error('[AgentSamEngine] Refusing voxel fallback for chess piece:', entity.name);
        return;
      }
      visual = this.buildVoxelInstancedMesh(entity.voxels);
      visual.userData.iamEntityId = entity.id;
      this.scene.add(visual);
      this.entities.set(entity.id, { mesh: visual, data: entity });
    }

    if (visual) {
      visual.position.set(entity.position.x, entity.position.y, entity.position.z);
      if (entity.rotation) {
        visual.rotation.set(
          THREE.MathUtils.degToRad(entity.rotation.x ?? 0),
          THREE.MathUtils.degToRad(entity.rotation.y ?? 0),
          THREE.MathUtils.degToRad(entity.rotation.z ?? 0),
        );
      }
      if (entity.behavior.type === 'dynamic') {
        const box = new THREE.Box3().setFromObject(visual);
        const size = new THREE.Vector3();
        box.getSize(size);
        const body = new CANNON.Body({
          mass: entity.behavior.mass || 1,
          shape: new CANNON.Box(new CANNON.Vec3(size.x/2, size.y/2, size.z/2)),
          position: new CANNON.Vec3(entity.position.x, entity.position.y + size.y/2, entity.position.z)
        });
        this.world.addBody(body);
        const entRef = this.entities.get(entity.id);
        if (entRef) entRef.body = body;
      }
      const spawnProf = entity.behavior?.metadata?.spawn_profile;
      if (spawnProf === 'bim') {
        this.setEntityGroundY(entity.id, 0);
      }
    }
    this.updateEntityCount();
  }

  /** Built-in procedural voxel presets (Eagle, Cat, Rabbit, Twins). */
  public listProceduralModels(): AgentSamGeneratorKey[] {
    return [...AGENT_SAM_GENERATOR_KEYS];
  }

  /** Spawn a built-in AgentSamGenerators preset into the viewport. */
  public async spawnProceduralModel(
    key: AgentSamGeneratorKey,
    opts?: {
      position?: { x: number; y: number; z: number };
      name?: string;
      id?: string;
    },
  ): Promise<GameEntity | null> {
    const generate = AgentSamGenerators[key];
    if (!generate) return null;

    const voxels = generate();
    if (!voxels.length) return null;

    const entity: GameEntity = {
      id: opts?.id ?? `proc_${key}_${Date.now()}`,
      name: opts?.name ?? key,
      type: 'prop',
      voxels,
      position: opts?.position ?? { x: 0, y: 0, z: 0 },
      behavior: {
        type: 'static',
        metadata: { procedural: key, source: 'AgentSamGenerators' },
      },
    };

    await this.spawnEntity(entity);
    this.onEntityCreated?.(entity);
    return entity;
  }

  /** Map viewport art style → default procedural preset. */
  public async spawnFromArtStyle(style: ArtStyle): Promise<GameEntity | null> {
    const key = AGENT_SAM_STYLE_GENERATORS[style];
    if (!key) return null;
    return this.spawnProceduralModel(key, { name: `${style} · ${key}` });
  }

  private buildVoxelInstancedMesh(voxels: VoxelData[]): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(VOXEL_UNIT, VOXEL_UNIT, VOXEL_UNIT);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.8 });
    const mesh = new THREE.InstancedMesh(geometry, material, voxels.length);
    voxels.forEach((v, i) => {
      this.dummy.position.set(v.x, v.y, v.z);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, new THREE.Color(v.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private isCanonicalChessPieceUrl(url: string): boolean {
    return url.includes('assets.inneranimalmedia.com/chess-pieces/');
  }

  private async loadModel(url: string): Promise<import('three/addons/loaders/GLTFLoader.js').GLTF> {
    const src = this.isCanonicalChessPieceUrl(url) ? url : normalizeGlbUrl(url);
    return loadCachedGltf(this.gltfLoader, src);
  }

  /** Serializable entity list for scene_snapshots / R2. */
  public exportEntities(): GameEntity[] {
    return Array.from(this.entities.values()).map((e) => {
      const d = { ...e.data };
      if (d.modelUrl) d.modelUrl = normalizeGlbUrl(d.modelUrl);
      return d;
    });
  }

  /** Replace scene contents from saved entities (skips chess_board id on chess project). */
  public async loadEntities(entities: GameEntity[], opts?: { keepBoard?: boolean }): Promise<void> {
    const keepBoard = opts?.keepBoard ?? this.projectType === ProjectType.CHESS;
    const preserve = keepBoard ? ['chess_board'] : [];
    for (const id of Array.from(this.entities.keys())) {
      if (!preserve.includes(id)) this.removeEntity(id);
    }
    for (const entity of entities) {
      if (preserve.includes(entity.id)) continue;
      const normalized: GameEntity = {
        ...entity,
        modelUrl: entity.modelUrl ? normalizeGlbUrl(entity.modelUrl) : entity.modelUrl,
      };
      await this.spawnEntity(normalized);
    }
  }

  public removeEntity(id: string) {
    const ent = this.entities.get(id);
    if (ent) {
      if (ent.mesh) this.scene.remove(ent.mesh);
      if (ent.model) this.scene.remove(ent.model);
      if (ent.body) this.world.removeBody(ent.body);
      this.entities.delete(id);
      if (this.selectedSpatialEntityId === id) {
        this.selectedSpatialEntityId = null;
        this.syncModelSpatialAxes();
      }
      if (this.highlightedEntityId === id) {
        this.highlightedEntityId = null;
      }
      this.updateEntityCount();
    }
  }

  private updateEntityCount() {
    let total = 0;
    this.entities.forEach(e => { total += (e.data.voxels ? e.data.voxels.length : 1); });
    this.onCountChange(total);
  }

  public clearWorld() {
    Array.from(this.entities.keys()).forEach(id => this.removeEntity(id));
  }

  private animate() {
    this.animationId = requestAnimationFrame(this.animate);
    this.world.fixedStep();
    this.controls.update();
    this.syncPhysicsDebug();
    if (this.gyroscope && this.projectType === ProjectType.CAD) {
      this.gyroscope.syncFromCamera(this.camera);
    }
    this.entities.forEach((ent) => {
      const visual = ent.mesh || ent.model;
      if (visual && ent.body) {
        visual.position.copy(ent.body.position as any);
        visual.quaternion.copy(ent.body.quaternion as any);
      }
    });
    this.renderer.render(this.scene, this.camera);
  }

  public handleResizeDimensions(width: number, height: number) {
    if (width === 0 || height === 0) return;
    const aspect = width / height;
    
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();

    const d = 30;
    this.orthoCamera.left = -d * aspect;
    this.orthoCamera.right = d * aspect;
    this.orthoCamera.top = d;
    this.orthoCamera.bottom = -d;
    this.orthoCamera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
  }

  /** Fit perspective camera to an object (or whole scene when omitted). */
  public frameCameraOnObject(target?: THREE.Object3D, padding = 1.45) {
    if (this.camera !== this.perspectiveCamera) return;

    const box = new THREE.Box3();
    if (target) {
      box.setFromObject(target);
    } else {
      this.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          box.expandByObject(obj);
        }
      });
    }
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim <= 0) return;

    const fovRad = (this.perspectiveCamera.fov * Math.PI) / 180;
    let distance = maxDim / (2 * Math.tan(fovRad / 2));
    distance *= padding;

    const offset = new THREE.Vector3(1, 0.75, 1).normalize().multiplyScalar(distance);
    this.controls.target.copy(center);
    this.perspectiveCamera.position.copy(center.clone().add(offset));
    this.controls.update();
  }

  public handleResize() {
    const rect = this.container.getBoundingClientRect();
    this.handleResizeDimensions(rect.width, rect.height);
  }

  public ensureViewportNavigation() {
    this.cadTool = CADTool.NONE;
    this.controls.enabled = true;
    this.controls.enableRotate = true;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.setPanNavigation(false);
  }

  public zoomViewport(factor: number) {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const dist = offset.length();
    if (dist <= 0) return;
    const next = Math.max(0.35, Math.min(800, dist * factor));
    offset.normalize().multiplyScalar(next);
    this.camera.position.copy(this.controls.target).add(offset);
    if (this.camera === this.orthoCamera) {
      this.orthoCamera.zoom = Math.max(0.05, Math.min(40, this.orthoCamera.zoom * factor));
      this.orthoCamera.updateProjectionMatrix();
    }
    this.controls.update();
  }

  public setPanNavigation(active: boolean) {
    this.controls.mouseButtons = active
      ? { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
      : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
  }

  public resetViewportCamera() {
    this.controls.target.set(0, 0, 0);
    if (this.camera === this.perspectiveCamera) {
      this.perspectiveCamera.position.set(15, 15, 15);
    } else {
      this.orthoCamera.position.set(0, 100, 0);
      this.orthoCamera.lookAt(0, 0, 0);
    }
    this.controls.update();
  }

  public exportForBlender(): void {
    const payload = this.exportEntities();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentsam-scene-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }


  // ── Inspector Panel engine methods ─────────────────────────────────────

  public setBackground(hexColor: string) {
    this.scene.background = new THREE.Color(hexColor);
    // Keep fog color in sync if fog is active
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color = new THREE.Color(hexColor);
    }
  }

  public setFog(enabled: boolean, density = 0.015) {
    const bg = this.scene.background instanceof THREE.Color
      ? '#' + this.scene.background.getHexString()
      : '#0f111a';
    this.scene.fog = enabled ? new THREE.FogExp2(new THREE.Color(bg).getHex(), density) : null;
  }

  public setFogDensity(density: number) {
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = Math.max(0, density);
    } else if (density > 0) {
      this.setFog(true, density);
    }
  }

  public updateSceneEnvironment(patch: {
    ambientIntensity?: number;
    sunColor?: string;
    castShadows?: boolean;
    exposure?: number;
    sunPower?: number;
    sunHeight?: number;
    fogDensity?: number;
    fogEnabled?: boolean;
  }) {
    if (patch.ambientIntensity !== undefined) {
      this.ambientLight.intensity = patch.ambientIntensity;
    }
    if (patch.sunColor !== undefined) {
      this.sunLight.color.set(patch.sunColor);
    }
    if (patch.castShadows !== undefined) {
      this.sunLight.castShadow = patch.castShadows;
    }
    if (patch.exposure !== undefined) {
      this.renderer.toneMappingExposure = Math.max(0.05, patch.exposure);
    }
    if (patch.sunPower !== undefined) {
      this.sunLight.intensity = Math.max(0, patch.sunPower);
    }
    if (patch.sunHeight !== undefined) {
      const rad = THREE.MathUtils.degToRad(patch.sunHeight);
      const dist = 55;
      this.sunLight.position.set(Math.cos(rad) * dist * 0.6, Math.sin(rad) * dist + 12, -22);
    }
    if (patch.fogEnabled !== undefined) {
      const density =
        patch.fogDensity ??
        (this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog.density : 0.015);
      this.setFog(patch.fogEnabled, density);
    } else if (patch.fogDensity !== undefined) {
      this.setFogDensity(patch.fogDensity);
    }
  }

  public applyEntityMaterial(
    id: string,
    patch: {
      color?: string;
      roughness?: number;
      metalness?: number;
      opacity?: number;
      wireframe?: boolean;
      emissive?: boolean;
    },
  ) {
    const ent = this.entities.get(id);
    if (!ent) return;
    const root = ent.model || ent.mesh;
    if (!root) return;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const raw of materials) {
        if (!raw || !('color' in raw)) continue;
        const mat = raw as THREE.MeshStandardMaterial;
        if (patch.color !== undefined) mat.color.set(patch.color);
        if (patch.roughness !== undefined) mat.roughness = patch.roughness;
        if (patch.metalness !== undefined) mat.metalness = patch.metalness;
        if (patch.opacity !== undefined) {
          mat.opacity = patch.opacity;
          mat.transparent = patch.opacity < 0.999;
        }
        if (patch.wireframe !== undefined) mat.wireframe = patch.wireframe;
        if (patch.emissive !== undefined) {
          if (patch.emissive) {
            mat.emissive.copy(mat.color);
            mat.emissiveIntensity = 1.2;
          } else {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }
        mat.needsUpdate = true;
      }
    });
  }

  public getEntityMeshStats(id: string): { verts: number; edges: number; faces: number; tris: number } {
    const ent = this.entities.get(id);
    if (!ent) return { verts: 0, edges: 0, faces: 0, tris: 0 };
    if (ent.data.voxels?.length) {
      const v = ent.data.voxels.length;
      return { verts: v * 8, edges: v * 12, faces: v * 6, tris: v * 12 };
    }
    const root = ent.model || ent.mesh;
    if (!root) return { verts: 0, edges: 0, faces: 0, tris: 0 };
    let verts = 0;
    let tris = 0;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      if (pos) verts += pos.count;
      if (geo.index) tris += geo.index.count / 3;
      else if (pos) tris += pos.count / 3;
    });
    const faces = Math.round(tris);
    return { verts, edges: faces * 2, faces, tris: Math.round(tris) };
  }

  private refreshEntitySpatialMetadata(id: string) {
    const ent = this.entities.get(id);
    const visual = ent?.model || ent?.mesh;
    if (!ent || !visual) return null;
    const meta = { ...(ent.data.behavior.metadata ?? {}) } as Record<string, unknown>;
    const profile = meta.spawn_profile === 'bim' ? 'bim' : 'preview';
    const spatial = buildSpatialSnapshot(ent.data, visual, profile, meta);
    meta.spatial = spatial;
    ent.data.behavior = { ...ent.data.behavior, metadata: meta };
    return spatial;
  }

  public getEntitySpatialInfo(id: string): EntitySpatialSnapshot | null {
    const ent = this.entities.get(id);
    const cached = ent?.data.behavior.metadata?.spatial as EntitySpatialSnapshot | undefined;
    if (cached) return cached;
    return this.refreshEntitySpatialMetadata(id);
  }

  public snapEntityToGridOrigin(id: string) {
    const ent = this.entities.get(id);
    const visual = ent?.model || ent?.mesh;
    if (!ent || !visual) return;
    const box = worldBoxFromObject(visual);
    const center = new THREE.Vector3();
    box.getCenter(center);
    ent.data.position = {
      x: ent.data.position.x - center.x,
      y: ent.data.position.y - box.min.y,
      z: ent.data.position.z - center.z,
    };
    visual.position.set(ent.data.position.x, ent.data.position.y, ent.data.position.z);
    this.refreshEntitySpatialMetadata(id);
    this.syncModelSpatialAxes();
  }

  public setEntityGroundY(id: string, groundY: number) {
    const ent = this.entities.get(id);
    const visual = ent?.model || ent?.mesh;
    if (!ent || !visual) return;
    const box = worldBoxFromObject(visual);
    const delta = groundY - box.min.y;
    ent.data.position = {
      ...ent.data.position,
      y: ent.data.position.y + delta,
    };
    visual.position.y = ent.data.position.y;
    this.refreshEntitySpatialMetadata(id);
    this.syncModelSpatialAxes();
  }

  public patchEntityDimensions(id: string, dims: { w?: number; h?: number; d?: number }) {
    const ent = this.entities.get(id);
    if (!ent) return;
    const visual = ent.model || ent.mesh;
    if (!visual) return;

    type BaseSize = { x: number; y: number; z: number };
    if (!visual.userData.baseSize) {
      const saved = visual.scale.clone();
      visual.scale.set(1, 1, 1);
      const box = new THREE.Box3().setFromObject(visual);
      const size = new THREE.Vector3();
      box.getSize(size);
      visual.userData.baseSize = {
        x: Math.max(size.x, 0.001),
        y: Math.max(size.y, 0.001),
        z: Math.max(size.z, 0.001),
      } satisfies BaseSize;
      visual.scale.copy(saved);
    }

    const base = visual.userData.baseSize as BaseSize;
    visual.scale.set(
      dims.w !== undefined ? dims.w / base.x : visual.scale.x,
      dims.h !== undefined ? dims.h / base.y : visual.scale.y,
      dims.d !== undefined ? dims.d / base.z : visual.scale.z,
    );
    ent.data.scale = (visual.scale.x + visual.scale.y + visual.scale.z) / 3;
  }

  public setGridVisible(visible: boolean) {
    this.scene.children.forEach((c) => {
      if (c instanceof THREE.GridHelper) c.visible = visible;
    });
  }

  /** Euler degrees for CSS view-cube — inverse camera rotation (world axes from camera POV). */
  public getViewCubeOrientation(): { x: number; y: number; z: number } {
    this.camera.updateMatrixWorld();
    const q = new THREE.Quaternion();
    this.camera.getWorldQuaternion(q);
    q.invert();
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    return {
      x: THREE.MathUtils.radToDeg(e.x),
      y: THREE.MathUtils.radToDeg(e.y),
      z: THREE.MathUtils.radToDeg(e.z),
    };
  }

  public toggleOrtho(ortho: boolean) {
    this.camera = ortho ? this.orthoCamera : this.perspectiveCamera;
    this.controls.object = this.camera;
    this.controls.update();
  }

  public snapViewTo(face: 'top' | 'front' | 'right' | 'left' | 'back' | 'bottom') {
    const box = new THREE.Box3();
    this.scene.traverse((obj) => {
      if (obj === this.debugGroup) return;
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.Group).isGroup) {
        if ((obj as THREE.Mesh).isMesh) box.expandByObject(obj);
      }
    });

    const center = box.isEmpty() ? new THREE.Vector3(0, 0, 0) : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? new THREE.Vector3(2, 2, 2) : box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.5);

    let distance = maxDim * 2.2;
    if (this.camera === this.perspectiveCamera) {
      const fovRad = (this.perspectiveCamera.fov * Math.PI) / 180;
      distance = (maxDim / (2 * Math.tan(fovRad / 2))) * 1.55;
    }

    const directions: Record<string, THREE.Vector3> = {
      top: new THREE.Vector3(0, 1, 0.001),
      bottom: new THREE.Vector3(0, -1, 0.001),
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(1, 0, 0),
      left: new THREE.Vector3(-1, 0, 0),
    };
    const dir = directions[face] ?? directions.front;
    const position = center.clone().add(dir.clone().normalize().multiplyScalar(distance));

    this.controls.target.copy(center);
    this.camera.position.copy(position);
    this.camera.lookAt(center);

    if (this.camera === this.orthoCamera) {
      const rect = this.container.getBoundingClientRect();
      const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
      const d = distance * 0.55;
      this.orthoCamera.left = -d * aspect;
      this.orthoCamera.right = d * aspect;
      this.orthoCamera.top = d;
      this.orthoCamera.bottom = -d;
      this.orthoCamera.updateProjectionMatrix();
    }

    this.controls.update();
  }

  public patchEntityPosition(id: string, pos: { x?: number; y?: number; z?: number }) {
    const ent = this.entities.get(id);
    if (!ent) return;
    const visual = ent.model || ent.mesh;
    if (!visual) return;
    if (pos.x !== undefined) visual.position.x = pos.x;
    if (pos.y !== undefined) visual.position.y = pos.y;
    if (pos.z !== undefined) visual.position.z = pos.z;
    // Keep data in sync
    ent.data.position = {
      x: visual.position.x,
      y: visual.position.y,
      z: visual.position.z,
    };
  }

  public patchEntityScale(id: string, scale: number) {
    const ent = this.entities.get(id);
    if (!ent) return;
    const visual = ent.model || ent.mesh;
    if (!visual) return;
    visual.scale.setScalar(scale);
    ent.data.scale = scale;
  }

  public cleanup() {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    this.gyroscope?.dispose();
    this.gyroscope = null;
    this.renderer.dispose();
  }
}
