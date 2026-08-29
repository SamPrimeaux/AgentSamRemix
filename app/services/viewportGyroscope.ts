/**
 * Mini orientation gyro — orthographic Three.js scene synced to the main camera.
 * Renders into a small canvas overlay on the viewport (XYZ torus rings).
 */
import * as THREE from 'three';

function makeAxisRing(color: number, rotation: [number, number, number]): THREE.Mesh {
  const geo = new THREE.TorusGeometry(0.62, 0.045, 10, 56);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.renderOrder = 1;
  return mesh;
}

export class ViewportGyroscope {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private root: THREE.Group;
  private sizePx = 72;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1.15, 1.15, 1.15, -1.15, 0.1, 20);
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);

    this.root = new THREE.Group();
    this.root.add(makeAxisRing(0xe53935, [0, Math.PI / 2, 0])); // X — YZ plane
    this.root.add(makeAxisRing(0x43a047, [Math.PI / 2, 0, 0])); // Y — XZ plane
    this.root.add(makeAxisRing(0x1e88e5, [0, 0, 0])); // Z — XY plane
    this.scene.add(this.root);

    this.resize();
  }

  resize(sizePx = this.sizePx) {
    this.sizePx = sizePx;
    this.renderer.setSize(sizePx, sizePx, false);
  }

  /** Mirror main camera orientation (world axes from viewer POV). */
  syncFromCamera(camera: THREE.Camera) {
    camera.updateMatrixWorld();
    const q = new THREE.Quaternion();
    camera.getWorldQuaternion(q);
    this.root.quaternion.copy(q).invert();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.renderer.dispose();
  }
}
