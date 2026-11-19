/**
 * DolphinGIS 3D 整合引擎 (.vxq.gz + Rust WASM + GLSL3 Instanced Quad)
 * 採延遲初始化設計：停留在 2D Leaflet 模式時完全不建立 WebGL 與 Web Worker。
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const VERTEX_SHADER = `
  in uint aCornerId;
  in uvec3 aQuad;

  uniform vec3 uTileOffset;
  uniform float uSunMode;
  uniform vec3 uSunDir;
  uniform float uWorldOriginY;

  out vec4 vColor;
  out float vFogDepth;
  out float vWorldY;

  const float FACE_SHADES[6] = float[6](1.00, 0.52, 0.84, 0.78, 0.70, 0.64);
  const float AO_CURVE[4] = float[4](0.58, 0.74, 0.88, 1.00);
  const vec3 FACE_NORMALS[6] = vec3[6](
    vec3(0.0, 1.0, 0.0),
    vec3(0.0, -1.0, 0.0),
    vec3(1.0, 0.0, 0.0),
    vec3(-1.0, 0.0, 0.0),
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, 0.0, -1.0)
  );

  void main() {
    uint w0 = aQuad.x;
    uint w1 = aQuad.y;
    uint w2 = aQuad.z;

    float qx = float(w0 & 0xFFu);
    float qy = float((w0 >> 8u) & 0x1FFu);
    float qz = float((w0 >> 17u) & 0xFFu);
    uint faceId = (w0 >> 25u) & 7u;
    bool isEmissive = ((w0 >> 28u) & 1u) != 0u;
    uint flip = (w0 >> 29u) & 1u;

    float h = float((w1 & 0x1FFu) + 1u);
    float w = float(((w1 >> 9u) & 0x1FFu) + 1u);
    uint packedAo = (w1 >> 18u) & 0xFFu;
    bool isTranslucent = ((w1 >> 26u) & 1u) != 0u;

    uint c = (aCornerId + flip) & 3u;
    vec3 pos = vec3(qx, qy, qz) + uTileOffset;

    float du = 0.0;
    float dv = 0.0;
    if (faceId == 0u) {
      du = (c == 2u || c == 3u) ? h : 0.0;
      dv = (c == 1u || c == 2u) ? w : 0.0;
      pos += vec3(du, 0.0, dv);
    } else if (faceId == 1u) {
      du = (c == 1u || c == 2u) ? h : 0.0;
      dv = (c == 2u || c == 3u) ? w : 0.0;
      pos += vec3(du, 0.0, dv);
    } else if (faceId == 2u) {
      du = (c == 1u || c == 2u) ? h : 0.0;
      dv = (c == 2u || c == 3u) ? w : 0.0;
      pos += vec3(0.0, du, dv);
    } else if (faceId == 3u) {
      du = (c == 1u || c == 2u) ? h : 0.0;
      dv = (c == 0u || c == 1u) ? w : 0.0;
      pos += vec3(0.0, du, dv);
    } else if (faceId == 4u) {
      du = (c == 1u || c == 2u) ? h : 0.0;
      dv = (c == 2u || c == 3u) ? w : 0.0;
      pos += vec3(du, dv, 0.0);
    } else {
      du = (c == 0u || c == 3u) ? h : 0.0;
      dv = (c == 2u || c == 3u) ? w : 0.0;
      pos += vec3(du, dv, 0.0);
    }

    vec4 baseCol = vec4(
      float(w2 & 0xFFu),
      float((w2 >> 8u) & 0xFFu),
      float((w2 >> 16u) & 0xFFu),
      float((w2 >> 24u) & 0xFFu)
    ) / 255.0;

    float faceShade = FACE_SHADES[faceId];
    float factor = 1.0;
    if (isTranslucent) {
      factor = 0.85 + 0.15 * faceShade;
    } else {
      uint aoLvl = (packedAo >> (c * 2u)) & 3u;
      float aoF = isEmissive ? 1.0 : AO_CURVE[aoLvl];
      float dirF = isEmissive ? 1.0 : faceShade;
      factor = dirF * aoF;
    }

    if (uSunMode > 0.5 && !isEmissive) {
      vec3 n = FACE_NORMALS[faceId];
      float ndotl = max(dot(n, uSunDir), 0.0);
      float hemi = mix(0.68, 1.08, n.y * 0.5 + 0.5);
      factor *= (hemi * 0.72 + ndotl * 0.52);
    }

    vColor = vec4(clamp(baseCol.rgb * factor, 0.0, 1.0), baseCol.a);
    vWorldY = pos.y + uWorldOriginY;
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    vFogDepth = -mvPos.z;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const FRAGMENT_SHADER = `
  in vec4 vColor;
  in float vFogDepth;
  in float vWorldY;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uCutMode;
  uniform float uClipY;
  out vec4 outColor;

  void main() {
    if (uCutMode > 0.5 && uCutMode < 1.5) {
      if (vWorldY >= 112.0 && vWorldY <= 128.02) discard;
    } else if (uCutMode >= 1.5) {
      if (vWorldY > uClipY) discard;
    }
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
    vec3 col = mix(vColor.rgb, uFogColor, clamp(fogFactor, 0.0, 1.0));
    outColor = linearToOutputTexel(vec4(col, vColor.a));
  }
`;

class Dolphin3DEngine {
  constructor() {
    this.initialized = false;
    this.active = false;
    this.vxqBaseUrl = "";

    this.currentDim = "overworld";
    this.loadingDim = null;
    this.pendingFocusTarget = null;
    this.currentEpoch = 0;
    this.worldOrigin = [-832, 58, 320];

    this.renderMode = "unlit";
    this.showTranslucent = true;
    this.showBuildings = true;
    this.powerSave = true;
    this.cullMode = "radius";
    this.cullRadius = 380;
    this.netherCutMode = "roof";
    this.netherClipY = 112;

    this.tileEntries = [];
    this.manifestData = null;
    this.networkFetchedGzBytes = 0;
    this.networkFetchedCount = 0;
    this.activeFetches = 0;

    this.workers = [];
    this.workerNext = 0;
    this.reqSeq = 1;
    this.pendingJobs = new Map();

    this.dirtyFrames = 0;
    this.rafRunning = false;
    this.lastTime = 0;
    this.fpsFrames = 0;
    this.fpsTimer = 0;
    this.flyAnim = null;
    this.keys = new Set();

    this.buildingLabelPool = new Map();
    this.playerLabelPool = new Map();
    this.activeCardData = null;

    this.tmpVec = new THREE.Vector3();
    this.forwardVec = new THREE.Vector3();
    this.rightVec = new THREE.Vector3();
  }

  ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;

    const cfg = window.DOLPHIN_3D_CONFIG;
    this.cullRadius = cfg.defaultRadius || 380;

    this.mapEl = document.getElementById("map");
    this.containerEl = document.getElementById("map-3d");
    this.labelsLayerEl = document.getElementById("labels-3d-layer");
    this.panel3DEl = document.getElementById("panel-3d");
    this.toggleBtnEl = document.getElementById("toggle-3d-btn");

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bc7f2);

    this.camera = new THREE.PerspectiveCamera(
      52,
      window.innerWidth / window.innerHeight,
      0.5,
      5000
    );
    this.camera.position.set(220, 160, 240);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.containerEl.prepend(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 3200;
    this.controls.minDistance = 6;

    const sunDir = new THREE.Vector3(300, 450, 220).normalize();
    this.sharedUniforms = {
      uSunMode: { value: 0.0 },
      uSunDir: { value: sunDir },
      uFogColor: { value: this.scene.background.clone() },
      uFogDensity: { value: 0.00055 },
      uWorldOriginY: { value: 58.0 },
      uCutMode: { value: 0.0 },
      uClipY: { value: 112.0 },
    };

    const workerCount = cfg.workerCount || 3;
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker("./js/vxq-worker.js");
      w.onmessage = (e) => {
        const msg = e.data;
        const job = this.pendingJobs.get(msg.id);
        if (!job) return;
        this.pendingJobs.delete(msg.id);
        if (msg.ok) job.resolve(msg);
        else job.reject(new Error(msg.error));
      };
      this.workers.push(w);
    }

    this.bindUIEvents();
  }

  bindUIEvents() {
    this.controls.addEventListener("start", () => this.markDirty(4));
    this.controls.addEventListener("change", () => this.markDirty(2));
    this.renderer.domElement.addEventListener("wheel", () => this.markDirty(4), { passive: true });

    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      this.keys.add(e.code);
      this.markDirty(2);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    window.addEventListener("resize", () => {
      if (!this.initialized) return;
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      if (this.active) this.markDirty(2);
    });

    document.getElementById("mode3d-buttons")?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-mode]");
      if (!btn) return;
      document.querySelectorAll("#mode3d-buttons button[data-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      this.renderMode = btn.dataset.mode;
      this.applyMaterialAll();
    });

    const transBtn = document.getElementById("toggle3d-translucent");
    transBtn?.addEventListener("click", () => {
      this.showTranslucent = !this.showTranslucent;
      transBtn.classList.toggle("active", this.showTranslucent);
      transBtn.textContent = `玻璃水體：${this.showTranslucent ? "開" : "關"}`;
      this.applyMaterialAll();
    });

    const bldgBtn = document.getElementById("toggle3d-buildings");
    bldgBtn?.addEventListener("click", () => {
      this.showBuildings = !this.showBuildings;
      bldgBtn.classList.toggle("active", this.showBuildings);
      bldgBtn.textContent = `建物標籤：${this.showBuildings ? "開" : "關"}`;
      this.markDirty(2);
    });

    const powerBtn = document.getElementById("toggle3d-powersave");
    powerBtn?.addEventListener("click", () => {
      this.powerSave = !this.powerSave;
      powerBtn.classList.toggle("active", this.powerSave);
      powerBtn.textContent = `靜止省電：${this.powerSave ? "開" : "關"}`;
      this.markDirty(4);
    });

    const radiusSlider = document.getElementById("radius3d-slider");
    radiusSlider?.addEventListener("input", () => {
      this.cullRadius = Number(radiusSlider.value);
      document.getElementById("radius3d-val").textContent = `${this.cullRadius} 格`;
      this.pumpStreamingQueue();
      this.markDirty(2);
    });

    document.getElementById("ncut3d-buttons")?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-ncut]");
      if (!btn) return;
      document.querySelectorAll("#ncut3d-buttons button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      this.netherCutMode = btn.dataset.ncut;
      const yrow = document.getElementById("yclip3d-row");
      if (yrow) yrow.style.display = this.netherCutMode === "clip" ? "flex" : "none";
      if (this.currentDim === "the_nether") {
        this.sharedUniforms.uCutMode.value =
          this.netherCutMode === "roof" ? 1.0 : this.netherCutMode === "clip" ? 2.0 : 0.0;
        this.markDirty(2);
      }
    });

    const yclipSlider = document.getElementById("yclip3d-slider");
    yclipSlider?.addEventListener("input", () => {
      this.netherClipY = Number(yclipSlider.value);
      document.getElementById("yclip3d-val").textContent = `Y ≤ ${this.netherClipY}`;
      this.sharedUniforms.uClipY.value = this.netherClipY;
      this.markDirty(2);
    });

    document.getElementById("tp-3d-target-btn")?.addEventListener("click", () => {
      const mc = this.localToMc(this.controls.target);
      const safeY = Math.max(mc.y, window.DOLPHIN_3D_CONFIG.dimensions[this.currentDim]?.defaultY || 90);
      if (window.teleportSystem && typeof window.teleportSystem.teleportTo === "function") {
        window.teleportSystem.teleportTo(mc.x, safeY, mc.z, this.currentDim);
      }
    });

    document.getElementById("popup3d-close")?.addEventListener("click", () => {
      this.hideInfoCard();
    });
  }

  mcToLocal(mx, my, mz) {
    return new THREE.Vector3(
      mx - this.worldOrigin[0],
      my - this.worldOrigin[1],
      mz - this.worldOrigin[2]
    );
  }

  localToMc(vec) {
    return {
      x: Math.round(vec.x + this.worldOrigin[0]),
      y: Math.round(vec.y + this.worldOrigin[1]),
      z: Math.round(vec.z + this.worldOrigin[2]),
    };
  }

  createTileMaterial(tileOffset, isTranslucent, wireframe = false) {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uTileOffset: { value: tileOffset },
        uSunMode: this.sharedUniforms.uSunMode,
        uSunDir: this.sharedUniforms.uSunDir,
        uFogColor: this.sharedUniforms.uFogColor,
        uFogDensity: this.sharedUniforms.uFogDensity,
        uWorldOriginY: this.sharedUniforms.uWorldOriginY,
        uCutMode: this.sharedUniforms.uCutMode,
        uClipY: this.sharedUniforms.uClipY,
      },
      transparent: isTranslucent && !wireframe,
      depthWrite: !isTranslucent || wireframe,
      side: isTranslucent ? THREE.DoubleSide : THREE.FrontSide,
      wireframe,
    });
  }

  createInstancedQuadMesh(quadBuf, quadCount, aabb, tileOffset, isTranslucent) {
    const geo = new THREE.InstancedBufferGeometry();
    const cornerAttr = new THREE.BufferAttribute(new Uint8Array([0, 1, 2, 3]), 1);
    cornerAttr.gpuType = THREE.IntType;
    geo.setAttribute("aCornerId", cornerAttr);
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

    const quadAttr = new THREE.InstancedBufferAttribute(new Uint32Array(quadBuf), 3);
    quadAttr.gpuType = THREE.IntType;
    geo.setAttribute("aQuad", quadAttr);
    geo.instanceCount = quadCount;

    const minV = new THREE.Vector3(
      aabb[0] + tileOffset[0],
      aabb[1] + tileOffset[1],
      aabb[2] + tileOffset[2]
    );
    const maxV = new THREE.Vector3(
      aabb[3] + tileOffset[0],
      aabb[4] + tileOffset[1],
      aabb[5] + tileOffset[2]
    );
    geo.boundingBox = new THREE.Box3(minV, maxV);
    geo.boundingSphere = new THREE.Sphere();
    geo.boundingBox.getBoundingSphere(geo.boundingSphere);

    const mat = this.createTileMaterial(
      new THREE.Vector3(...tileOffset),
      isTranslucent,
      this.renderMode === "wireframe"
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = isTranslucent ? 2 : 1;
    return mesh;
  }

  applyMaterialToTile(tile) {
    const isWire = this.renderMode === "wireframe";
    if (tile.solidMesh) {
      tile.solidMesh.material.wireframe = isWire;
    }
    if (tile.transMesh) {
      tile.transMesh.visible = this.showTranslucent;
      tile.transMesh.material.wireframe = isWire;
      tile.transMesh.material.transparent = !isWire;
      tile.transMesh.material.depthWrite = isWire;
    }
  }

  applyMaterialAll() {
    this.sharedUniforms.uSunMode.value = this.renderMode === "sun" ? 1.0 : 0.0;
    for (const tile of this.tileEntries) {
      if (tile.state === "loaded") this.applyMaterialToTile(tile);
    }
    this.markDirty(2);
  }

  disposeTile(tile) {
    if (!tile.group) return;
    this.scene.remove(tile.group);
    tile.group.traverse((obj) => {
      if (obj.isMesh) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      }
    });
    tile.group = null;
    tile.solidMesh = null;
    tile.transMesh = null;
    tile.rawBytes = 0;
    tile.state = "unloaded";
  }

  decodeInWasmWorker(url, gzip) {
    return new Promise((resolve, reject) => {
      const id = this.reqSeq++;
      this.pendingJobs.set(id, { resolve, reject });
      const worker = this.workers[this.workerNext++ % this.workers.length];
      worker.postMessage({ id, url, gzip });
    });
  }

  async fetchAndParseTile(tile, epoch, dimId) {
    tile.state = "loading";
    this.activeFetches++;
    this.updateStreamingStatsUI();

    try {
      const url = `${this.vxqBaseUrl}/${dimId}/${tile.meta.file}`;
      const decoded = await this.decodeInWasmWorker(url, tile.meta.gzip);
      if (epoch !== this.currentEpoch) return;

      const group = new THREE.Group();
      let solidMesh = null;
      let transMesh = null;

      if (decoded.solidCount > 0) {
        solidMesh = this.createInstancedQuadMesh(
          decoded.solidBuf,
          decoded.solidCount,
          decoded.aabb,
          decoded.tileOffset,
          false
        );
        group.add(solidMesh);
      }
      if (decoded.transCount > 0) {
        transMesh = this.createInstancedQuadMesh(
          decoded.transBuf,
          decoded.transCount,
          decoded.aabb,
          decoded.tileOffset,
          true
        );
        group.add(transMesh);
      }

      tile.group = group;
      tile.solidMesh = solidMesh;
      tile.transMesh = transMesh;
      tile.rawBytes = decoded.rawBytes;
      tile.state = "loaded";
      tile.lastUsed = performance.now();

      this.networkFetchedGzBytes += tile.meta.gzBytes ?? tile.meta.bytes;
      this.networkFetchedCount++;

      this.applyMaterialToTile(tile);
      tile.group.visible = Boolean(tile._desired);
      this.scene.add(tile.group);
      this.markDirty(2);
    } catch (err) {
      if (epoch === this.currentEpoch) {
        tile.state = "unloaded";
        console.error("[DolphinGIS-3D] 載入地磚失敗:", tile.meta.file, err);
      }
    } finally {
      if (epoch === this.currentEpoch) {
        this.activeFetches--;
        this.pumpStreamingQueue();
      }
    }
  }

  updateDesiredTiles() {
    const refPos = this.controls.target;
    const now = performance.now();
    const maxCache = window.DOLPHIN_3D_CONFIG.maxCachedTiles || 128;

    for (const tile of this.tileEntries) {
      const dx = tile.centerVec.x - refPos.x;
      const dz = tile.centerVec.z - refPos.z;
      const distSq = dx * dx + dz * dz;
      tile._distSq = distSq;
      tile._desired = this.cullMode === "all" || distSq <= this.cullRadius * this.cullRadius;

      if (tile.state === "loaded" && tile.group) {
        tile.group.visible = tile._desired;
        if (tile._desired) tile.lastUsed = now;
      }
    }

    if (this.cullMode === "radius") {
      const loadedHidden = this.tileEntries.filter((t) => t.state === "loaded" && !t._desired);
      const totalLoaded = this.tileEntries.filter((t) => t.state === "loaded").length;
      if (totalLoaded > maxCache && loadedHidden.length > 0) {
        loadedHidden.sort((a, b) => b._distSq - a._distSq);
        let toEvict = totalLoaded - maxCache;
        for (const victim of loadedHidden) {
          if (toEvict <= 0) break;
          this.disposeTile(victim);
          toEvict--;
        }
      }
    }
  }

  pumpStreamingQueue() {
    if (!this.vxqBaseUrl) return;
    this.updateDesiredTiles();
    const epoch = this.currentEpoch;
    const dimId = this.currentDim;
    const maxConc = window.DOLPHIN_3D_CONFIG.maxConcurrentFetch || 6;

    if (this.activeFetches < maxConc) {
      const candidates = this.tileEntries
        .filter((t) => t._desired && t.state === "unloaded")
        .sort((a, b) => a._distSq - b._distSq);

      for (const tile of candidates) {
        if (this.activeFetches >= maxConc) break;
        this.fetchAndParseTile(tile, epoch, dimId);
      }
    }
    this.updateStreamingStatsUI();
  }

  updateStreamingStatsUI() {
    let visibleCount = 0;
    let loadedCount = 0;
    let loadedRaw = 0;
    for (const tile of this.tileEntries) {
      if (tile.state === "loaded") {
        loadedCount++;
        loadedRaw += tile.rawBytes || tile.meta.bytes;
        if (tile.group?.visible) visibleCount++;
      }
    }

    const totalTiles = this.tileEntries.length;
    const tilesEl = document.getElementById("stat3d-tiles");
    if (tilesEl) tilesEl.textContent = `${visibleCount} / ${loadedCount} / ${totalTiles}`;

    const fetchedMB = (this.networkFetchedGzBytes / 1024 / 1024).toFixed(2);
    const rawMB = (loadedRaw / 1024 / 1024).toFixed(1);
    const sizeEl = document.getElementById("stat3d-size");
    if (sizeEl) sizeEl.textContent = `${fetchedMB} MB / VRAM ${rawMB}MB`;

    let desiredCount = 0;
    let desiredLoaded = 0;
    for (const tile of this.tileEntries) {
      if (tile._desired) {
        desiredCount++;
        if (tile.state === "loaded") desiredLoaded++;
      }
    }
    const pct = desiredCount > 0 ? Math.round((desiredLoaded / desiredCount) * 100) : 100;
    const fillEl = document.getElementById("progress3d-fill");
    if (fillEl) fillEl.style.width = `${pct}%`;

    const statusEl = document.getElementById("load3d-status");
    if (statusEl) {
      if (!this.vxqBaseUrl) {
        statusEl.textContent = "未設定 MAP3D_URL 環境變數或 ?map3d= 位址";
      } else if (this.activeFetches > 0 || desiredLoaded < desiredCount) {
        statusEl.textContent = `Rust WASM 背景串流中：${desiredLoaded}/${desiredCount} 塊 (${pct}%)`;
      } else {
        statusEl.textContent = `就緒：視距內 ${visibleCount} 塊（已省去 ${totalTiles - loadedCount} 塊下載）`;
      }
    }
  }

  async loadDimension(dimId, focusTarget = null) {
    const dimCfg = window.DOLPHIN_3D_CONFIG.dimensions[dimId] || window.DOLPHIN_3D_CONFIG.dimensions.overworld;
    this.currentDim = dimId;
    this.loadingDim = dimId;
    this.pendingFocusTarget = focusTarget;
    const epoch = ++this.currentEpoch;

    this.scene.background.setHex(dimCfg.sky);
    this.sharedUniforms.uFogColor.value.copy(this.scene.background);
    this.sharedUniforms.uFogDensity.value = dimCfg.fogDensity;

    const isNether = dimId === "the_nether";
    const cutBox = document.getElementById("nether3d-cut-box");
    if (cutBox) cutBox.style.display = isNether ? "block" : "none";
    this.sharedUniforms.uCutMode.value = isNether
      ? this.netherCutMode === "roof"
        ? 1.0
        : this.netherCutMode === "clip"
          ? 2.0
          : 0.0
      : 0.0;

    for (const tile of this.tileEntries) this.disposeTile(tile);
    this.tileEntries = [];
    this.manifestData = null;
    this.networkFetchedGzBytes = 0;
    this.networkFetchedCount = 0;
    this.activeFetches = 0;
    this.clearLabelPools();
    this.hideInfoCard();

    if (!this.vxqBaseUrl) {
      this.vxqBaseUrl = await window.DOLPHIN_3D_CONFIG.resolveVxqBaseUrl();
      if (epoch !== this.currentEpoch) return;
    }

    if (!this.vxqBaseUrl) {
      this.updateStreamingStatsUI();
      this.markDirty(2);
      return;
    }

    const statusEl = document.getElementById("load3d-status");
    if (statusEl) statusEl.textContent = `讀取 ${dimCfg.label} manifest.json...`;

    try {
      const res = await fetch(`${this.vxqBaseUrl}/${dimId}/manifest.json`, { mode: "cors" });
      if (epoch !== this.currentEpoch) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.manifestData = await res.json();
      if (epoch !== this.currentEpoch) return;

      this.worldOrigin = this.manifestData.worldOrigin;
      this.sharedUniforms.uWorldOriginY.value = this.worldOrigin[1];

      for (const meta of this.manifestData.tiles) {
        this.tileEntries.push({
          meta,
          centerVec: new THREE.Vector3(...meta.center),
          state: "unloaded",
          group: null,
          solidMesh: null,
          transMesh: null,
          rawBytes: 0,
          lastUsed: 0,
          _distSq: Infinity,
          _desired: false,
        });
      }

      if (this.pendingFocusTarget) {
        const tgt = this.pendingFocusTarget;
        this.flyToCoords(tgt.x, tgt.y, tgt.z, true, tgt.offset);
        if (tgt.card) this.showInfoCard(tgt.card);
      } else {
        this.flyToCoords(this.worldOrigin[0], dimCfg.defaultY, this.worldOrigin[2], true);
      }
      this.pendingFocusTarget = null;
      this.loadingDim = null;
      this.pumpStreamingQueue();
      this.markDirty(4);
    } catch (err) {
      if (epoch === this.currentEpoch) {
        this.loadingDim = null;
        if (statusEl) statusEl.textContent = `3D 端點連線失敗：${err.message || err}`;
      }
    }
  }

  flyToCoords(x, y, z, instant = false, customOffset = null) {
    const dimCfg = window.DOLPHIN_3D_CONFIG.dimensions[this.currentDim];
    const safeY = Number.isFinite(Number(y)) ? Number(y) : (dimCfg?.defaultY || 80);
    const target = this.mcToLocal(x, safeY, z);
    const offset = customOffset || [125, 85, 135];
    const camPos = target.clone().add(new THREE.Vector3(...offset));
    const dist = this.controls.target.distanceTo(target);

    if (instant || dist > 1400) {
      this.flyAnim = null;
      this.controls.target.copy(target);
      this.camera.position.copy(camPos);
      this.controls.update();
      if (this.tileEntries.length > 0) this.pumpStreamingQueue();
      this.markDirty(4);
      return;
    }

    this.flyAnim = {
      startTarget: this.controls.target.clone(),
      endTarget: target,
      startPos: this.camera.position.clone(),
      endPos: camPos,
      progress: 0,
    };
    this.markDirty(2);
  }

  showInfoCard(data) {
    this.activeCardData = data;
    const card = document.getElementById("popup-3d");
    if (!card) return;
    document.getElementById("popup3d-badge").textContent = data.badge || "";
    document.getElementById("popup3d-title").textContent = data.title || "定位點";
    document.getElementById("popup3d-addr").textContent = data.addr || "";
    document.getElementById("popup3d-xyz").textContent =
      `X: ${Math.round(data.x)}, Y: ${Math.round(data.y)}, Z: ${Math.round(data.z)}`;

    const tpBtn = document.getElementById("popup3d-tp-btn");
    tpBtn.setAttribute("data-x", data.x);
    tpBtn.setAttribute("data-y", data.y);
    tpBtn.setAttribute("data-z", data.z);
    tpBtn.setAttribute("data-dim", data.dim || this.currentDim);
    if (window.teleportSystem && typeof window.teleportSystem.syncButtonState === "function") {
      window.teleportSystem.syncButtonState(tpBtn);
    }
    card.style.display = "block";
  }

  hideInfoCard() {
    this.activeCardData = null;
    const card = document.getElementById("popup-3d");
    if (card) card.style.display = "none";
  }

  clearLabelPools() {
    this.buildingLabelPool.forEach((entry) => entry.el.remove());
    this.buildingLabelPool.clear();
    this.playerLabelPool.forEach((entry) => entry.el.remove());
    this.playerLabelPool.clear();
  }

  updateBuildingLabels() {
    if (!this.showBuildings || typeof window.getBuildingData !== "function") {
      this.buildingLabelPool.forEach((e) => (e.el.style.display = "none"));
      return;
    }

    const buildings = window.getBuildingData();
    const mc = this.localToMc(this.controls.target);
    const maxDistSq = 550 * 550;
    const candidates = [];

    for (const b of buildings) {
      const bName = (b.name || "").trim();
      if (!bName || bName.toLowerCase() === "none" || bName === "-" || bName === "無") continue;
      const bDim = typeof window.getBuildingDimension === "function"
        ? window.getBuildingDimension(b.id)
        : "overworld";
      if (bDim !== this.currentDim) continue;
      const dx = b.x - mc.x;
      const dz = b.z - mc.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= maxDistSq) candidates.push({ b, d2 });
    }

    candidates.sort((a, b) => a.d2 - b.d2);
    const topItems = candidates.slice(0, 22);
    const keepKeys = new Set();

    for (const { b } of topItems) {
      const key = `${b.id || b.name}_${b.x}_${b.z}`;
      keepKeys.add(key);
      let entry = this.buildingLabelPool.get(key);
      if (!entry) {
        const el = document.createElement("div");
        el.className = "label-3d-building";
        el.textContent = b.name || b.id;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.flyToCoords(b.x, b.y, b.z, false, [85, 60, 95]);
          this.showInfoCard({
            badge: `[${window.DOLPHIN_3D_CONFIG.dimensions[this.currentDim]?.label || this.currentDim}] ${b.type || "建物"} ${b.id ? "#" + b.id : ""}`,
            title: b.name || "未命名建物",
            addr: b.addr || "",
            x: b.x,
            y: b.y,
            z: b.z,
            dim: this.currentDim,
          });
        });
        this.labelsLayerEl.appendChild(el);
        entry = { el, b };
        this.buildingLabelPool.set(key, entry);
      }

      const localPos = this.mcToLocal(b.x, b.y + 18, b.z);
      this.tmpVec.copy(localPos).project(this.camera);
      if (this.tmpVec.z > 1 || this.tmpVec.z < -1) {
        entry.el.style.display = "none";
      } else {
        entry.el.style.display = "block";
        entry.el.style.left = `${(this.tmpVec.x * 0.5 + 0.5) * window.innerWidth}px`;
        entry.el.style.top = `${(-this.tmpVec.y * 0.5 + 0.5) * window.innerHeight}px`;
      }
    }

    for (const [k, entry] of this.buildingLabelPool.entries()) {
      if (!keepKeys.has(k)) {
        entry.el.remove();
        this.buildingLabelPool.delete(k);
      }
    }
  }

  updatePlayerLabels() {
    if (typeof window.tracker === "undefined" || typeof window.tracker.getOnlinePlayers !== "function") {
      return;
    }

    const players = window.tracker.getOnlinePlayers();
    const keepNames = new Set();

    for (const p of players) {
      if (p.dim !== this.currentDim) continue;
      keepNames.add(p.name);
      let entry = this.playerLabelPool.get(p.name);
      if (!entry) {
        const el = document.createElement("div");
        el.className = "label-3d-player";
        el.innerHTML = `<img src="https://minotar.net/helm/${encodeURIComponent(p.name)}/24" alt="${p.name}" onerror="this.onerror=null;this.src='https://minotar.net/avatar/char/24';"><span>${p.name}</span>`;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const curP = entry.player;
          this.flyToCoords(curP.x, curP.y, curP.z, false, [55, 42, 65]);
          this.showInfoCard({
            badge: `[${window.DOLPHIN_3D_CONFIG.dimensions[this.currentDim]?.label || this.currentDim}] 在線玩家 GPS`,
            title: curP.name,
            addr: "即時位置同步中",
            x: curP.x,
            y: curP.y,
            z: curP.z,
            dim: curP.dim,
          });
        });
        this.labelsLayerEl.appendChild(el);
        entry = { el, player: p };
        this.playerLabelPool.set(p.name, entry);
      }
      entry.player = p;

      const localPos = this.mcToLocal(p.x, (Number.isFinite(p.y) ? p.y : 80) + 4, p.z);
      this.tmpVec.copy(localPos).project(this.camera);
      if (this.tmpVec.z > 1 || this.tmpVec.z < -1) {
        entry.el.style.display = "none";
      } else {
        entry.el.style.display = "flex";
        entry.el.style.left = `${(this.tmpVec.x * 0.5 + 0.5) * window.innerWidth}px`;
        entry.el.style.top = `${(-this.tmpVec.y * 0.5 + 0.5) * window.innerHeight}px`;
      }
    }

    for (const [name, entry] of this.playerLabelPool.entries()) {
      if (!keepNames.has(name)) {
        entry.el.remove();
        this.playerLabelPool.delete(name);
      }
    }
  }

  markDirty(frames = 2) {
    if (!this.active) return;
    this.dirtyFrames = Math.max(this.dirtyFrames, frames);
    if (!this.rafRunning) {
      this.rafRunning = true;
      this.lastTime = performance.now();
      requestAnimationFrame((now) => this.animate(now));
    }
  }

  animate(now) {
    if (!this.active) {
      this.rafRunning = false;
      return;
    }

    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.flyAnim) {
      this.flyAnim.progress = Math.min(1, this.flyAnim.progress + dt * 1.45);
      const t = 1 - Math.pow(1 - this.flyAnim.progress, 3);
      this.controls.target.lerpVectors(this.flyAnim.startTarget, this.flyAnim.endTarget, t);
      this.camera.position.lerpVectors(this.flyAnim.startPos, this.flyAnim.endPos, t);
      if (this.flyAnim.progress >= 1) this.flyAnim = null;
      this.dirtyFrames = Math.max(this.dirtyFrames, 2);
    }

    if (this.keys.size > 0) {
      const speed = (this.keys.has("ControlLeft") || this.keys.has("MetaLeft") ? 220 : 100) * dt;
      this.camera.getWorldDirection(this.forwardVec);
      this.forwardVec.y = 0;
      if (this.forwardVec.lengthSq() > 1e-5) this.forwardVec.normalize();
      this.rightVec.crossVectors(this.forwardVec, this.camera.up).normalize();

      const move = new THREE.Vector3();
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) move.addScaledVector(this.forwardVec, speed);
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) move.addScaledVector(this.forwardVec, -speed);
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) move.addScaledVector(this.rightVec, speed);
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) move.addScaledVector(this.rightVec, -speed);
      if (this.keys.has("Space")) move.y += speed;
      if (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) move.y -= speed;

      if (move.lengthSq() > 0) {
        this.flyAnim = null;
        this.camera.position.add(move);
        this.controls.target.add(move);
        this.dirtyFrames = Math.max(this.dirtyFrames, 2);
      }
    }

    const controlsMoved = this.controls.update();
    if (controlsMoved) this.dirtyFrames = Math.max(this.dirtyFrames, 1);

    if (this.cullMode === "radius" && (controlsMoved || this.flyAnim !== null || this.keys.size > 0)) {
      this.pumpStreamingQueue();
    }

    this.renderer.render(this.scene, this.camera);
    this.updateBuildingLabels();
    this.updatePlayerLabels();

    const mc = this.localToMc(this.controls.target);
    const coordEl = document.getElementById("coords");
    if (coordEl) {
      coordEl.innerHTML = `
        <span class="dim-display" id="current-dim-text">3D VIEW · ${this.currentDim.toUpperCase()}</span>
        <span>X: ${mc.x}, Y: ${mc.y}, Z: ${mc.z}</span>
      `;
    }

    const trisEl = document.getElementById("stat3d-tris");
    if (trisEl) {
      trisEl.textContent = `${this.renderer.info.render.triangles.toLocaleString()} / ${this.renderer.info.render.calls}`;
    }

    this.fpsFrames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.4) {
      const fps = Math.round(this.fpsFrames / this.fpsTimer);
      const fpsEl = document.getElementById("stat3d-fps");
      if (fpsEl) {
        fpsEl.textContent = `${fps} FPS`;
        fpsEl.className = `stat3d-val ${fps >= 48 ? "good" : fps >= 28 ? "warn" : "low"}`;
      }
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }

    if (this.dirtyFrames > 0) this.dirtyFrames--;
    const keepRunning = !this.powerSave || this.dirtyFrames > 0 || this.flyAnim !== null || this.keys.size > 0;
    if (keepRunning) {
      requestAnimationFrame((n) => this.animate(n));
    } else {
      this.rafRunning = false;
      this.fpsFrames = 0;
      this.fpsTimer = 0;
      const fpsEl = document.getElementById("stat3d-fps");
      if (fpsEl) {
        fpsEl.textContent = "待機省電 (0% GPU)";
        fpsEl.className = "stat3d-val good";
      }
    }
  }

  async enter3D(opts = {}) {
    this.ensureInitialized();
    const dim = opts.dim || window.currentDimension || "overworld";
    const dimCfg = window.DOLPHIN_3D_CONFIG.dimensions[dim] || window.DOLPHIN_3D_CONFIG.dimensions.overworld;

    let focusX = opts.x;
    let focusY = opts.y;
    let focusZ = opts.z;
    if (!Number.isFinite(Number(focusX)) || !Number.isFinite(Number(focusZ))) {
      const lm = window.leafletMap;
      if (lm && typeof lm.getCenter === "function") {
        const c = lm.getCenter();
        focusX = Math.round(c.lng);
        focusZ = Math.round(-c.lat);
      } else {
        focusX = 0;
        focusZ = 0;
      }
    }
    focusY = Number.isFinite(Number(focusY)) ? Number(focusY) : dimCfg.defaultY;

    if (typeof window.switchMapDimension === "function" && window.currentDimension !== dim) {
      window.switchMapDimension(dim, true);
    }

    const lm = window.leafletMap;
    if (lm && typeof lm.closePopup === "function") {
      lm.closePopup();
    }

    this.active = true;
    this.mapEl.style.display = "none";
    this.containerEl.style.display = "block";
    this.panel3DEl.style.display = "flex";
    if (this.toggleBtnEl) {
      this.toggleBtnEl.textContent = "🗺️ 返回 2D 地圖";
      this.toggleBtnEl.classList.add("is-3d");
    }

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    await this.loadDimension(dim, { x: focusX, y: focusY, z: focusZ, offset: opts.offset || null });
    if (opts.card) this.showInfoCard(opts.card);
    this.markDirty(4);
  }

  exit3D() {
    if (!this.initialized || !this.active) return;
    const mc = this.localToMc(this.controls.target);

    this.active = false;
    this.rafRunning = false;
    this.flyAnim = null;
    this.keys.clear();
    this.hideInfoCard();

    this.containerEl.style.display = "none";
    this.panel3DEl.style.display = "none";
    this.mapEl.style.display = "block";

    if (this.toggleBtnEl) {
      this.toggleBtnEl.textContent = "🧊 切換 3D 實景";
      this.toggleBtnEl.classList.remove("is-3d");
    }

    const lm = window.leafletMap;
    if (lm && typeof lm.invalidateSize === "function") {
      lm.closePopup();
      lm.invalidateSize();
      lm.setView([-mc.z, mc.x], Math.max(lm.getZoom(), 1), { animate: false });
    }

    const coordEl = document.getElementById("coords");
    if (coordEl) {
      coordEl.innerHTML = `
        <span class="dim-display" id="current-dim-text">DIMENSION: ${this.currentDim.toUpperCase()}</span>
        <span>X: ${mc.x}, Z: ${mc.z}</span>
      `;
    }
  }

  toggle3D() {
    if (this.active) this.exit3D();
    else this.enter3D();
  }

  isActive() {
    return this.active;
  }

  onDimensionChanged(dim) {
    if (!this.initialized || !this.active) return;
    if (this.currentDim === dim) return;
    this.loadDimension(dim);
  }

  flyTo(x, y, z, dim, card = null) {
    if (!this.active) {
      this.enter3D({ x, y, z, dim, card });
      return;
    }
    const targetDim = dim || this.currentDim;
    if (this.loadingDim === targetDim && !this.manifestData) {
      this.pendingFocusTarget = { x, y, z, offset: [95, 70, 105], card };
      return;
    }
    if (targetDim !== this.currentDim) {
      this.loadDimension(targetDim, { x, y, z, offset: [95, 70, 105], card });
    } else {
      this.flyToCoords(x, y, z, false, [95, 70, 105]);
      if (card) this.showInfoCard(card);
    }
  }

  refreshBuildings() {
    if (this.active) this.updateBuildingLabels();
  }

  refreshPlayers() {
    if (this.active) this.updatePlayerLabels();
  }
}

const engine = new Dolphin3DEngine();
window.dolphin3D = engine;
export default engine;
