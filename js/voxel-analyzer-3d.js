/**
 * DolphinGIS 3D 全高體素分析、特定方塊分布與三軸 CT 電腦斷層控制器
 */
import * as THREE from "three";
import { formatBlockDisplayName, getBlockChineseName, getBlockShortId } from "./block-names-zh.js?v=20261120-ui3";
import { computeTwoPointBox, mapCtCanvasPointToGrid } from "./raycast-3d.js?v=20261120-ui3";

export class VoxelAnalyzer3D {
  constructor(engine) {
    this.engine = engine;
    this.isOpen = false;
    this.dimId = "overworld";
    this.dimEpoch = 0;
    this.analyzeEpoch = 0;
    this.ctReqSeq = 0;

    this.worker = null;
    this.reqSeq = 1;
    this.pendingJobs = new Map();

    this.voxelsManifest = null;
    this.manifestStatus = "idle"; // idle | loading | ready | missing | error
    this.manifestError = "";

    this.cornerPickMode = false;
    this.cornerPickFirst = null;
    this.cornerHoverPoint = null;
    this.cornerPreviewBounds = null;
    this.boxBounds = {
      xMin: -714,
      xMax: -651,
      yMin: -64,
      yMax: 319,
      zMin: 368,
      zMax: 431,
    };
    this.analyzedBox = null;

    this.stats = [];
    this.totalVoxels = 0;
    this.selectedBids = new Set();
    this.filterTimer = null;
    this.terrainMode = "normal"; // normal | translucent | hidden

    this.ctEnabled = false;
    this.ctAxis = 0; // 0=Y, 1=X, 2=Z
    this.ctCoord = 64;
    this.ctClipTerrain = true;
    this.ctClipDir = 1; // 1=裁切正側 (> coord), -1=裁切負側 (< coord)
    this.ctClipScope = "box"; // "box" | "global"
    this.ctShowAir3D = false;
    this.ctSliceData = null;
    this.ctTexture = null;
    this.ctAirTexture = null;
    this.ctDebounceTimer = null;

    this.rootGroup = new THREE.Group();
    this.boxGroup = new THREE.Group();
    this.cornerPreviewGroup = new THREE.Group();
    this.filterGroup = new THREE.Group();
    this.ctGroup = new THREE.Group();
    this.ctMesh = null;
    this.ctSliceContainer = null;
    this.cornerMarker = null;

    this.rootGroup.add(this.boxGroup, this.cornerPreviewGroup, this.filterGroup, this.ctGroup);
    this.engine.scene.add(this.rootGroup);

    this.bindUI();
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    const w = new Worker("./js/vxv-worker.js?v=20261120-ui3");
    w.onmessage = (e) => {
      const msg = e.data;
      const job = this.pendingJobs.get(msg.id);
      if (!job) return;
      this.pendingJobs.delete(msg.id);
      if (msg.ok) job.resolve(msg);
      else job.reject(new Error(msg.error));
    };
    const onFail = (err) => {
      const message = err?.message || "體素分析 Worker 發生異常";
      for (const [, job] of this.pendingJobs.entries()) {
        job.reject(new Error(message));
      }
      this.pendingJobs.clear();
      try {
        w.terminate();
      } catch (_e) {
        // 忽略終止錯誤
      }
      this.worker = null;
    };
    w.onerror = onFail;
    w.onmessageerror = onFail;
    this.worker = w;
    return w;
  }

  callWorker(type, payload = {}) {
    const w = this.ensureWorker();
    return new Promise((resolve, reject) => {
      const id = this.reqSeq++;
      this.pendingJobs.set(id, { resolve, reject });
      try {
        w.postMessage({ id, type, ...payload });
      } catch (err) {
        this.pendingJobs.delete(id);
        reject(err);
      }
    });
  }

  getManifestYLimits() {
    const yMinLimit = Number.isFinite(this.voxelsManifest?.yMin) ? this.voxelsManifest.yMin : -64;
    const yMaxLimit = Number.isFinite(this.voxelsManifest?.yMax) ? this.voxelsManifest.yMax : 319;
    return { yMinLimit, yMaxLimit };
  }

  isBoxDirty() {
    if (!this.analyzedBox) return true;
    const a = this.analyzedBox;
    const b = this.boxBounds;
    return (
      a.xMin !== b.xMin ||
      a.xMax !== b.xMax ||
      a.yMin !== b.yMin ||
      a.yMax !== b.yMax ||
      a.zMin !== b.zMin ||
      a.zMax !== b.zMax
    );
  }

  bindUI() {
    this.panelEl = document.getElementById("panel-voxel-analyzer");
    this.toolTabsEl = document.getElementById("vox-tool-tabs");
    this.activeTabTitleEl = document.getElementById("vox-active-tab-title");
    this.statsBadgeEl = document.getElementById("vox-tab-stats-badge");
    this.boxDimPreviewEl = document.getElementById("vox-box-dim-preview");
    this.activeTab = "box";

    this.toggleBtn = document.getElementById("toggle-vox-analyzer-btn");
    this.closeBtn = document.getElementById("vox-panel-close");
    this.statusEl = document.getElementById("vox-status");
    this.cornerPickBtn = document.getElementById("vox-pick-corners-btn");
    this.quick64Btn = document.getElementById("vox-quick-64-btn");
    this.quick128Btn = document.getElementById("vox-quick-128-btn");
    this.fullYBtn = document.getElementById("vox-full-y-btn");
    this.analyzeBtn = document.getElementById("vox-analyze-btn");

    this.xMinInput = document.getElementById("vox-xmin");
    this.xMaxInput = document.getElementById("vox-xmax");
    this.yMinInput = document.getElementById("vox-ymin");
    this.yMaxInput = document.getElementById("vox-ymax");
    this.zMinInput = document.getElementById("vox-zmin");
    this.zMaxInput = document.getElementById("vox-zmax");

    this.terrainBtns = document.getElementById("vox-terrain-buttons");
    this.searchInput = document.getElementById("vox-filter-search");
    this.clearFilterBtn = document.getElementById("vox-clear-filter-btn");
    this.statsSummaryEl = document.getElementById("vox-stats-summary");
    this.statsListEl = document.getElementById("vox-stats-list");

    this.ctToggleChk = document.getElementById("vox-ct-enabled");
    this.ctControlsEl = document.getElementById("vox-ct-controls");
    this.ctAxisBtns = document.getElementById("vox-ct-axis-buttons");
    this.ctScopeBtns = document.getElementById("vox-ct-scope-buttons");
    this.ctDirBtns = document.getElementById("vox-ct-dir-buttons");
    this.ctSlider = document.getElementById("vox-ct-slider");
    this.ctCoordValEl = document.getElementById("vox-ct-coord-val");
    this.ctDecBtn = document.getElementById("vox-ct-dec-btn");
    this.ctIncBtn = document.getElementById("vox-ct-inc-btn");
    this.ctClipChk = document.getElementById("vox-ct-clip-terrain");
    this.ctShowAirChk = document.getElementById("vox-ct-show-air");
    this.ctAxesHintEl = document.getElementById("vox-ct-axes-hint");
    this.ctCanvas = document.getElementById("vox-ct-canvas");
    this.ctHoverEl = document.getElementById("vox-ct-hover");

    this.toolTabsEl?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-vox-tab]");
      if (!btn) return;
      this.switchTab(btn.dataset.voxTab);
    });

    this.toggleBtn?.addEventListener("click", () => this.togglePanel());
    this.closeBtn?.addEventListener("click", () => {
      this.setCornerPickMode(false);
      this.resetAnalysisState(false);
      if (this.manifestStatus === "ready") {
        this.setStatus("已重置選取框、方塊高亮與 CT 切面");
      }
    });

    this.quick64Btn?.addEventListener("click", () => this.createBoxAtView(64));
    this.quick128Btn?.addEventListener("click", () => this.createBoxAtView(128));
    this.cornerPickBtn?.addEventListener("click", () => this.toggleCornerPickMode());
    this.fullYBtn?.addEventListener("click", () => this.expandBoxToFullY());
    this.analyzeBtn?.addEventListener("click", () => this.applyInputsAndAnalyze());

    [
      this.xMinInput,
      this.xMaxInput,
      this.yMinInput,
      this.yMaxInput,
      this.zMinInput,
      this.zMaxInput,
    ].forEach((inp) => {
      inp?.addEventListener("change", () => {
        this.readBoxFromInputs();
        this.renderBoxOutline();
        if (this.analyzedBox && this.isBoxDirty()) {
          this.setStatus("選取框已變更，請點擊「套用並分析選取區」同步更新統計與 CT 切面");
        }
      });
    });

    this.terrainBtns?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-terrain]");
      if (!btn) return;
      this.setTerrainMode(btn.dataset.terrain);
    });

    this.searchInput?.addEventListener("input", () => this.renderStatsList());
    this.clearFilterBtn?.addEventListener("click", () => {
      this.selectedBids.clear();
      this.renderStatsList();
      this.scheduleFilterMeshUpdate(true);
    });

    this.statsListEl?.addEventListener("change", (e) => {
      const chk = e.target.closest("input[data-bid]");
      if (!chk) return;
      const bid = Number(chk.dataset.bid);
      if (chk.checked) this.selectedBids.add(bid);
      else this.selectedBids.delete(bid);
      this.scheduleFilterMeshUpdate();
    });

    this.ctToggleChk?.addEventListener("change", async () => {
      const wantEnabled = Boolean(this.ctToggleChk.checked);
      if (!wantEnabled) {
        this.ctEnabled = false;
        this.syncCtClipAndPlane();
        this.syncCtControlsState();
        return;
      }
      if (this.manifestStatus !== "ready") {
        this.ctEnabled = false;
        this.ctToggleChk.checked = false;
        this.syncCtControlsState();
        this.setStatus("目前維度尚未載入全高體素資料，無法啟用 CT 截面", true);
        return;
      }
      this.ctEnabled = true;
      if (!this.analyzedBox || this.isBoxDirty()) {
        const ok = await this.analyzeBox();
        if (!ok || !this.isOpen || !this.analyzedBox || this.isBoxDirty()) {
          this.ctEnabled = false;
          if (this.ctToggleChk) this.ctToggleChk.checked = false;
          this.syncCtClipAndPlane();
          this.syncCtControlsState();
          return;
        }
      }
      this.syncCtClipAndPlane();
      this.syncCtControlsState();
    });

    this.ctAxisBtns?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-axis]");
      if (!btn) return;
      this.setCtAxis(Number(btn.dataset.axis));
    });

    this.ctScopeBtns?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-scope]");
      if (!btn) return;
      this.setCtClipScope(btn.dataset.scope);
    });

    this.ctDirBtns?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-dir]");
      if (!btn) return;
      this.setCtClipDir(Number(btn.dataset.dir));
    });

    this.ctSlider?.addEventListener("input", () => {
      if (!this.analyzedBox) {
        this.setStatus("請先在「選取區」分析一個範圍，再調整 CT 切面", true);
        return;
      }
      if (!this.ctEnabled && this.ctToggleChk) {
        this.ctEnabled = true;
        this.ctToggleChk.checked = true;
        this.syncCtControlsState();
      }
      this.ctCoord = Number(this.ctSlider.value);
      this.updateCtCoordLabel();
      this.syncCtClipUniform();
      this.scheduleCtSliceUpdate();
    });

    this.ctDecBtn?.addEventListener("click", () => this.stepCtCoord(-1));
    this.ctIncBtn?.addEventListener("click", () => this.stepCtCoord(1));

    this.ctClipChk?.addEventListener("change", () => {
      this.ctClipTerrain = Boolean(this.ctClipChk.checked);
      this.syncCtClipUniform();
    });

    this.ctShowAirChk?.addEventListener("change", () => {
      this.ctShowAir3D = Boolean(this.ctShowAirChk.checked);
      if (this.isCtActive() && this.ctSliceData) {
        this.updateCt3DPlane(
          this.ctSliceData.rgba,
          this.ctSliceData.bids,
          this.ctSliceData.width,
          this.ctSliceData.height,
          this.ctSliceData.axis,
          this.ctSliceData.coord,
          this.ctSliceData.boxOrigin
        );
      }
    });

    this.ctCanvas?.addEventListener("mousemove", (e) => this.handleCtCanvasHover(e));
    this.ctCanvas?.addEventListener("mouseleave", () => {
      if (this.ctHoverEl) this.ctHoverEl.textContent = "滑鼠移到切面上可查看各格方塊";
    });
    this.ctCanvas?.addEventListener("click", (e) => this.handleCtCanvasClick(e));

    this.updateBoxDimPreview();
    this.updateCtAxisLabels();
    this.syncCtControlsState();
    this.renderStatsList();
  }

  switchTab(tabId) {
    if (!tabId) return;
    this.activeTab = tabId;
    const titles = {
      box: "📐 選取區調整",
      stats: "📊 方塊數目分析",
      ct: "🩻 CT 截面分析",
    };
    if (this.activeTabTitleEl && titles[tabId]) {
      this.activeTabTitleEl.textContent = titles[tabId];
    }
    this.toolTabsEl?.querySelectorAll("button[data-vox-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.voxTab === tabId);
    });
    this.panelEl?.querySelectorAll(".vox-tab-pane[data-vox-pane]").forEach((pane) => {
      pane.classList.toggle("active", pane.dataset.voxPane === tabId);
    });
  }

  updateBoxDimPreview(bounds = this.boxBounds, prefix = "選區尺寸") {
    if (!this.boxDimPreviewEl) return;
    const { xMin, xMax, yMin, yMax, zMin, zMax } = bounds;
    const sx = Math.max(0, xMax - xMin + 1);
    const sy = Math.max(0, yMax - yMin + 1);
    const sz = Math.max(0, zMax - zMin + 1);
    this.boxDimPreviewEl.textContent = `${prefix}：${sx} × ${sy} × ${sz} 格 (Y: ${yMin}..${yMax})`;
  }

  togglePanel() {
    if (this.isOpen) this.closePanel();
    else this.openPanel();
  }

  async openPanel() {
    if (this.isOpen) return;
    this.isOpen = true;
    if (this.panelEl) this.panelEl.style.display = "flex";
    if (this.toggleBtn) this.toggleBtn.classList.add("active");
  }

  closePanel() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.toggleBtn) this.toggleBtn.classList.remove("active");
    this.setCornerPickMode(false);
    this.resetAnalysisState(true);
  }

  resetAnalysisState(clearWorkerCache = false) {
    this.analyzeEpoch++;
    this.ctReqSeq++;
    clearTimeout(this.filterTimer);
    clearTimeout(this.ctDebounceTimer);
    this.analyzedBox = null;
    this.stats = [];
    this.totalVoxels = 0;
    this.selectedBids.clear();
    this.ctSliceData = null;
    if (this.searchInput) this.searchInput.value = "";

    if (this.ctToggleChk) this.ctToggleChk.checked = false;
    this.ctEnabled = false;
    this.ctClipDir = 1;
    this.ctClipScope = "box";
    this.ctShowAir3D = false;
    if (this.ctShowAirChk) this.ctShowAirChk.checked = false;
    this.ctScopeBtns?.querySelectorAll("button[data-scope]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.scope === "box");
    });
    this.ctDirBtns?.querySelectorAll("button[data-dir]").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.dir) === 1);
    });
    this.updateCtAxisLabels();
    this.syncCtControlsState();

    this.setTerrainMode("normal");
    this.engine.setCtClip(0, 0, 1, 0, null, null);

    this.clearMeshGroup(this.boxGroup);
    this.clearMeshGroup(this.cornerPreviewGroup);
    this.clearMeshGroup(this.filterGroup);
    this.clearMeshGroup(this.ctGroup);
    this.ctMesh = null;
    this.ctSliceContainer = null;
    this.ctTexture = null;
    this.ctAirTexture = null;

    if (this.cornerMarker) {
      this.engine.scene.remove(this.cornerMarker);
      this.disposeObject(this.cornerMarker);
      this.cornerMarker = null;
    }

    if (this.statsBadgeEl) {
      this.statsBadgeEl.style.display = "none";
      this.statsBadgeEl.textContent = "0";
    }
    if (this.statsSummaryEl) this.statsSummaryEl.textContent = "尚未分析選取區";
    if (this.ctHoverEl) this.ctHoverEl.textContent = "滑鼠移到切面上可查看各格方塊";
    this.renderStatsList();
    if (this.ctCanvas) {
      const ctx = this.ctCanvas.getContext("2d");
      ctx?.clearRect(0, 0, this.ctCanvas.width, this.ctCanvas.height);
    }

    if (clearWorkerCache && this.worker) {
      this.callWorker("clearCache").catch(() => {});
    }
    this.engine.markDirty(2);
  }

  disposeObject(obj) {
    obj.traverse?.((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
  }

  clearMeshGroup(group) {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      this.disposeObject(child);
    }
  }

  setStatus(text, isError = false) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("is-error", Boolean(isError));
  }

  async onDimensionChanged(dimId) {
    this.dimId = dimId;
    const epoch = ++this.dimEpoch;
    this.setCornerPickMode(false);
    this.resetAnalysisState(true);
    this.voxelsManifest = null;
    this.manifestStatus = "idle";

    if (!this.isOpen) return;
    if (!this.engine.vxqBaseUrl) {
      this.setStatus("尚未設定 3D 節點位址，無法載入體素資料", true);
      return;
    }

    this.manifestStatus = "loading";
    this.setStatus(`正在讀取 ${dimId} 全高體素索引...`);

    try {
      const res = await fetch(`${this.engine.vxqBaseUrl}/${dimId}/voxels/manifest.json`, {
        mode: "cors",
      });
      if (!this.isOpen || epoch !== this.dimEpoch) return;
      if (res.status === 404) {
        this.manifestStatus = "missing";
        this.setStatus("此維度尚未產生全高體素資料（僅支援 3D 表面檢視）", true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!this.isOpen || epoch !== this.dimEpoch) return;

      this.voxelsManifest = data;
      this.manifestStatus = "ready";
      const yMin = Number.isFinite(data.yMin) ? data.yMin : -64;
      const yMax = Number.isFinite(data.yMax) ? data.yMax : 319;
      if (this.yMinInput) {
        this.yMinInput.min = String(yMin);
        this.yMinInput.max = String(yMax);
      }
      if (this.yMaxInput) {
        this.yMaxInput.min = String(yMin);
        this.yMaxInput.max = String(yMax);
      }
      this.boxBounds.yMin = yMin;
      this.boxBounds.yMax = yMax;

      const mc = this.engine.localToMc(this.engine.controls.target);
      this.boxBounds.xMin = mc.x - 32;
      this.boxBounds.xMax = mc.x + 31;
      this.boxBounds.zMin = mc.z - 32;
      this.boxBounds.zMax = mc.z + 31;
      this.syncInputsFromBox();
      this.syncCtRangeForAxis(true);

      this.setStatus(
        `就緒：${data.tileCount} 塊全高體素磚 (Y=${yMin}..${yMax})，請建立或調整選區開始分析`
      );
    } catch (err) {
      if (!this.isOpen || epoch !== this.dimEpoch) return;
      this.manifestStatus = "error";
      this.setStatus(`讀取體素索引失敗：${err.message || err}`, true);
    }
  }

  syncInputsFromBox() {
    if (this.xMinInput) this.xMinInput.value = String(this.boxBounds.xMin);
    if (this.xMaxInput) this.xMaxInput.value = String(this.boxBounds.xMax);
    if (this.yMinInput) this.yMinInput.value = String(this.boxBounds.yMin);
    if (this.yMaxInput) this.yMaxInput.value = String(this.boxBounds.yMax);
    if (this.zMinInput) this.zMinInput.value = String(this.boxBounds.zMin);
    if (this.zMaxInput) this.zMaxInput.value = String(this.boxBounds.zMax);
    this.updateBoxDimPreview();
  }

  readBoxFromInputs() {
    const parse = (el, fallback) => {
      const v = Number(el?.value);
      return Number.isFinite(v) ? Math.floor(v) : fallback;
    };
    const { yMinLimit, yMaxLimit } = this.getManifestYLimits();
    const clampY = (y) => Math.max(yMinLimit, Math.min(yMaxLimit, y));

    const xA = parse(this.xMinInput, this.boxBounds.xMin);
    const xB = parse(this.xMaxInput, this.boxBounds.xMax);
    const yA = clampY(parse(this.yMinInput, this.boxBounds.yMin));
    const yB = clampY(parse(this.yMaxInput, this.boxBounds.yMax));
    const zA = parse(this.zMinInput, this.boxBounds.zMin);
    const zB = parse(this.zMaxInput, this.boxBounds.zMax);

    this.boxBounds = {
      xMin: Math.min(xA, xB),
      xMax: Math.max(xA, xB),
      yMin: Math.min(yA, yB),
      yMax: Math.max(yA, yB),
      zMin: Math.min(zA, zB),
      zMax: Math.max(zA, zB),
    };
    this.syncInputsFromBox();
    return this.boxBounds;
  }

  expandBoxToFullY() {
    if (this.manifestStatus !== "ready") {
      this.setStatus("目前維度尚未載入全高體素資料", true);
      return;
    }
    const { yMinLimit, yMaxLimit } = this.getManifestYLimits();
    this.boxBounds.yMin = yMinLimit;
    this.boxBounds.yMax = yMaxLimit;
    this.syncInputsFromBox();
    this.renderBoxOutline();
    if (this.analyzedBox && this.isBoxDirty()) {
      this.setStatus(`已展開 Y 軸為全高 (${yMinLimit}..${yMaxLimit})，請點擊「套用並分析選取區」更新結果`);
    } else {
      this.setStatus(`已將選取區 Y 軸設定為全高 (${yMinLimit}..${yMaxLimit})`);
    }
  }

  createBoxAtView(spanXZ) {
    if (this.manifestStatus !== "ready") {
      this.setStatus("目前維度尚未載入全高體素資料", true);
      return;
    }
    this.setCornerPickMode(false);
    const mc = this.engine.localToMc(this.engine.controls.target);
    const half = Math.floor(spanXZ / 2);
    const { yMinLimit, yMaxLimit } = this.getManifestYLimits();
    this.boxBounds = {
      xMin: mc.x - half,
      xMax: mc.x + (spanXZ - half - 1),
      yMin: yMinLimit,
      yMax: yMaxLimit,
      zMin: mc.z - half,
      zMax: mc.z + (spanXZ - half - 1),
    };
    this.syncInputsFromBox();
    this.analyzeBox();
  }

  isCornerPicking() {
    return this.cornerPickMode;
  }

  setCornerPickMode(enabled) {
    const next = Boolean(enabled);
    if (this.cornerPickMode === next) return;
    this.cornerPickMode = next;
    if (next) {
      this.engine.setPickTeleportMode(false);
    }
    this.cornerPickFirst = null;
    this.cornerHoverPoint = null;
    this.cornerPreviewBounds = null;
    this.clearMeshGroup(this.cornerPreviewGroup);
    if (this.cornerMarker) {
      this.engine.scene.remove(this.cornerMarker);
      this.disposeObject(this.cornerMarker);
      this.cornerMarker = null;
    }
    if (this.cornerPickBtn) {
      this.cornerPickBtn.classList.toggle("active", next);
      this.cornerPickBtn.textContent = next ? "取消選角 (ESC)" : "📍 兩點選 3D 立方體";
    }
    if (this.engine.containerEl) {
      this.engine.containerEl.classList.toggle("picking-mode", next || this.engine.pickTeleportMode);
    }
    if (next) {
      this.setStatus("請點擊 3D 地形第 1 個 3D 角點（含 X/Y/Z 高度，按 ESC 取消）");
    } else {
      this.updateBoxDimPreview();
    }
    this.engine.markDirty(2);
  }

  toggleCornerPickMode() {
    if (this.manifestStatus !== "ready") {
      this.setStatus("目前維度尚未載入全高體素資料", true);
      return;
    }
    this.setCornerPickMode(!this.cornerPickMode);
  }

  clearCornerHoverPreview() {
    this.cornerHoverPoint = null;
    this.cornerPreviewBounds = null;
    this.clearMeshGroup(this.cornerPreviewGroup);
    this.updateBoxDimPreview();
    this.engine.markDirty(2);
  }

  updateCornerHoverPreview(hit) {
    if (!this.cornerPickMode || !hit) {
      this.clearCornerHoverPreview();
      return;
    }
    const { yMinLimit, yMaxLimit } = this.getManifestYLimits();
    const clampY = (y) => Math.max(yMinLimit, Math.min(yMaxLimit, Math.floor(y)));
    const pt = {
      x: Math.floor(hit.blockX),
      y: clampY(hit.blockY),
      z: Math.floor(hit.blockZ),
    };
    this.cornerHoverPoint = pt;
    this.clearMeshGroup(this.cornerPreviewGroup);

    const pointColor = this.cornerPickFirst ? 0xffcc00 : 0x38d7ff;
    const ptOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06)),
      new THREE.LineBasicMaterial({ color: pointColor })
    );
    ptOutline.position.copy(this.engine.mcToLocal(pt.x + 0.5, pt.y + 0.5, pt.z + 0.5));
    ptOutline.renderOrder = 6;
    this.cornerPreviewGroup.add(ptOutline);

    if (this.cornerPickFirst) {
      const b = computeTwoPointBox(this.cornerPickFirst, pt, {
        maxSpanXZ: 250,
        yMinLimit,
        yMaxLimit,
      });
      this.cornerPreviewBounds = b;
      const sx = b.xMax - b.xMin + 1;
      const sy = b.yMax - b.yMin + 1;
      const sz = b.zMax - b.zMin + 1;
      const center = this.engine.mcToLocal(
        b.xMin + sx * 0.5,
        b.yMin + sy * 0.5,
        b.zMin + sz * 0.5
      );
      const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeo),
        new THREE.LineBasicMaterial({ color: 0xffcc00 })
      );
      edges.position.copy(center);
      edges.renderOrder = 5;

      const fill = new THREE.Mesh(
        boxGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffcc00,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      fill.position.copy(center);
      fill.renderOrder = 4;

      this.cornerPreviewGroup.add(edges, fill);
      this.updateBoxDimPreview(b, "預覽立方體");
    } else {
      this.cornerPreviewBounds = null;
    }
    this.engine.markDirty(2);
  }

  getCornerPickHudText() {
    if (!this.cornerPickMode) return "";
    if (this.cornerPickFirst && this.cornerPreviewBounds) {
      const b = this.cornerPreviewBounds;
      const sx = b.xMax - b.xMin + 1;
      const sy = b.yMax - b.yMin + 1;
      const sz = b.zMax - b.zMin + 1;
      return `3D 立方體 ${sx}×${sy}×${sz} (Y:${b.yMin}..${b.yMax})｜點第 2 角確認`;
    }
    if (this.cornerPickFirst) {
      const p1 = this.cornerPickFirst;
      return `第 1 角 (${p1.x}, ${p1.y}, ${p1.z})｜請移動並點擊第 2 角`;
    }
    if (this.cornerHoverPoint) {
      const h = this.cornerHoverPoint;
      return `對準方塊 (${h.x}, ${h.y}, ${h.z})｜請點擊第 1 角`;
    }
    return "請點擊 3D 地形第 1 個角點 (X/Y/Z)";
  }

  handleCornerPick(hit) {
    if (!this.cornerPickMode || !hit) return;
    const { yMinLimit, yMaxLimit } = this.getManifestYLimits();
    const clampY = (y) => Math.max(yMinLimit, Math.min(yMaxLimit, Math.floor(y)));
    const wx = Math.floor(hit.blockX);
    const wy = clampY(hit.blockY);
    const wz = Math.floor(hit.blockZ);

    if (!this.cornerPickFirst) {
      this.cornerPickFirst = { x: wx, y: wy, z: wz };
      const markerGroup = new THREE.Group();
      const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1.08, 1.08, 1.08)),
        new THREE.LineBasicMaterial({ color: 0x38d7ff })
      );
      wire.renderOrder = 6;
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(1.04, 1.04, 1.04),
        new THREE.MeshBasicMaterial({
          color: 0x38d7ff,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        })
      );
      core.renderOrder = 5;
      markerGroup.add(wire, core);
      markerGroup.position.copy(this.engine.mcToLocal(wx + 0.5, wy + 0.5, wz + 0.5));
      this.cornerMarker = markerGroup;
      this.engine.scene.add(this.cornerMarker);
      this.setStatus(`已選第 1 角 (${wx}, ${wy}, ${wz})，移動滑鼠預覽並點擊第 2 個 3D 對角`);
      this.updateCornerHoverPreview(hit);
      return;
    }

    const box = computeTwoPointBox(
      this.cornerPickFirst,
      { x: wx, y: wy, z: wz },
      { maxSpanXZ: 250, yMinLimit, yMaxLimit }
    );
    this.boxBounds = {
      xMin: box.xMin,
      xMax: box.xMax,
      yMin: box.yMin,
      yMax: box.yMax,
      zMin: box.zMin,
      zMax: box.zMax,
    };
    this.syncInputsFromBox();
    this.setCornerPickMode(false);
    if (box.clamped) {
      this.setStatus("已依第 1 角點限制 X/Z 最大跨度 250 格，開始分析 3D 立方體...");
    }
    this.analyzeBox().then((ok) => {
      if (ok && this.analyzedBox && this.analyzedBox.yMin === this.analyzedBox.yMax) {
        this.setStatus(
          `分析完成（單層高度 Y=${this.analyzedBox.yMin}，可調整 Y Min / Y Max 或點「全高 Y」擴展高度）`
        );
      }
    });
  }

  applyInputsAndAnalyze() {
    if (this.manifestStatus !== "ready") {
      this.setStatus("目前維度尚未載入全高體素資料", true);
      return;
    }
    this.setCornerPickMode(false);
    this.readBoxFromInputs();
    this.analyzeBox();
  }

  renderBoxOutline() {
    this.clearMeshGroup(this.boxGroup);
    const { xMin, xMax, yMin, yMax, zMin, zMax } = this.boxBounds;
    const sx = xMax - xMin + 1;
    const sy = yMax - yMin + 1;
    const sz = zMax - zMin + 1;
    const center = this.engine.mcToLocal(xMin + sx * 0.5, yMin + sy * 0.5, zMin + sz * 0.5);

    const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color: 0x38d7ff })
    );
    edges.position.copy(center);
    edges.renderOrder = 4;

    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x38d7ff,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(boxGeo, fillMat);
    fill.position.copy(center);
    fill.renderOrder = 3;

    this.boxGroup.add(edges, fill);
    this.engine.markDirty(2);
  }

  async analyzeBox() {
    if (this.manifestStatus !== "ready" || !this.voxelsManifest) {
      this.setStatus("目前維度尚未載入全高體素資料", true);
      return false;
    }
    const epoch = ++this.analyzeEpoch;
    const box = this.boxBounds;
    this.renderBoxOutline();
    this.clearMeshGroup(this.filterGroup);
    this.selectedBids.clear();

    this.setStatus("正在下載全高體素磚並以 Rust WASM 統計方塊...");
    if (this.analyzeBtn) this.analyzeBtn.disabled = true;

    try {
      const res = await this.callWorker("prepareBox", {
        baseUrl: this.engine.vxqBaseUrl,
        dimId: this.dimId,
        box,
        tileMetas: this.voxelsManifest.tiles || [],
      });
      if (!this.isOpen || epoch !== this.analyzeEpoch) return false;

      this.boxBounds = res.box;
      this.analyzedBox = { ...res.box };
      this.syncInputsFromBox();
      this.stats = res.stats || [];
      this.totalVoxels = res.totalVoxels || 0;

      if (this.statsBadgeEl) {
        this.statsBadgeEl.textContent = String(this.stats.length);
        this.statsBadgeEl.style.display = this.stats.length > 0 ? "inline-block" : "none";
      }

      if (this.statsSummaryEl) {
        const [sx, sy, sz] = res.dims;
        this.statsSummaryEl.textContent =
          `體積 ${sx}×${sy}×${sz} = ${this.totalVoxels.toLocaleString()} 格 ｜ 共 ${this.stats.length} 種方塊`;
      }
      this.renderStatsList();
      this.setStatus(
        `分析完成（讀取 ${res.tilesUsed} 塊體素磚），可切換左側圖示查看方塊數或 CT 截面`
      );

      // 預設 CT 滑桿範圍並依狀況更新切面
      this.syncCtRangeForAxis(true);
      this.syncCtControlsState();
      if (this.ctEnabled) {
        this.syncCtClipAndPlane();
      }
      return true;
    } catch (err) {
      if (epoch === this.analyzeEpoch) {
        this.setStatus(`分析失敗：${err.message || err}`, true);
      }
      return false;
    } finally {
      if (this.analyzeBtn) this.analyzeBtn.disabled = false;
    }
  }

  renderStatsList() {
    if (!this.statsListEl) return;
    const kw = (this.searchInput?.value || "").trim().toLowerCase();
    this.statsListEl.innerHTML = "";

    if (this.stats.length === 0) {
      const empty = document.createElement("div");
      empty.className = "vox-empty";
      const hint = document.createElement("span");
      hint.textContent = "尚未分析任何選取區";
      const quickBtn = document.createElement("button");
      quickBtn.type = "button";
      quickBtn.className = "vox-primary-btn";
      quickBtn.textContent = "📊 立即分析目前視角 64×64 選區";
      quickBtn.addEventListener("click", () => this.createBoxAtView(64));
      empty.append(hint, quickBtn);
      this.statsListEl.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    let shown = 0;
    for (const item of this.stats) {
      const shortId = getBlockShortId(item.name);
      const zhName = getBlockChineseName(item.name);
      if (
        kw &&
        !shortId.toLowerCase().includes(kw) &&
        !zhName.toLowerCase().includes(kw) &&
        !item.name.toLowerCase().includes(kw)
      ) {
        continue;
      }
      shown++;

      const row = document.createElement("label");
      row.className = "vox-stat-row";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.dataset.bid = String(item.bid);
      chk.checked = this.selectedBids.has(item.bid);

      const swatch = document.createElement("span");
      swatch.className = "vox-swatch";
      const [r, g, b] = item.rgba;
      swatch.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;

      const info = document.createElement("div");
      info.className = "vox-stat-name";
      const titleSpan = document.createElement("span");
      titleSpan.textContent = zhName && zhName !== shortId ? `${zhName}` : shortId;
      const subSpan = document.createElement("small");
      subSpan.textContent = shortId;
      info.append(titleSpan, subSpan);

      const countEl = document.createElement("div");
      countEl.className = "vox-stat-count";
      countEl.innerHTML = `${item.count.toLocaleString()}<small>${item.pct.toFixed(1)}%</small>`;

      row.append(chk, swatch, info, countEl);
      frag.appendChild(row);
    }

    if (shown === 0) {
      const empty = document.createElement("div");
      empty.className = "vox-empty";
      empty.textContent = "查無符合關鍵字的方塊";
      frag.appendChild(empty);
    }
    this.statsListEl.appendChild(frag);
  }

  scheduleFilterMeshUpdate(immediate = false) {
    clearTimeout(this.filterTimer);
    if (immediate) {
      this.updateFilterMesh();
      return;
    }
    this.filterTimer = setTimeout(() => this.updateFilterMesh(), 50);
  }

  async updateFilterMesh() {
    if (!this.isOpen || this.stats.length === 0) {
      this.clearMeshGroup(this.filterGroup);
      this.engine.markDirty(2);
      return;
    }
    const epoch = this.analyzeEpoch;
    const bids = Array.from(this.selectedBids);
    if (bids.length === 0) {
      this.clearMeshGroup(this.filterGroup);
      this.engine.markDirty(2);
      return;
    }

    try {
      const res = await this.callWorker("buildFilterMesh", { selectedBids: bids });
      if (!this.isOpen || epoch !== this.analyzeEpoch) return;

      this.clearMeshGroup(this.filterGroup);
      const [bx, by, bz] = res.boxOrigin;
      const offset = [
        bx - this.engine.worldOrigin[0],
        by - this.engine.worldOrigin[1],
        bz - this.engine.worldOrigin[2],
      ];

      if (res.solidCount > 0) {
        const solidMesh = this.engine.createOverlayQuadMesh(
          res.solidBuf,
          res.solidCount,
          res.aabb,
          offset,
          false
        );
        solidMesh.renderOrder = 3;
        this.filterGroup.add(solidMesh);
      }
      if (res.transCount > 0) {
        const transMesh = this.engine.createOverlayQuadMesh(
          res.transBuf,
          res.transCount,
          res.aabb,
          offset,
          true
        );
        transMesh.renderOrder = 4;
        this.filterGroup.add(transMesh);
      }
      this.engine.markDirty(2);
    } catch (err) {
      if (epoch === this.analyzeEpoch) {
        this.setStatus(`分布網格計算失敗：${err.message || err}`, true);
      }
    }
  }

  setTerrainMode(mode) {
    this.terrainMode = mode || "normal";
    if (this.terrainBtns) {
      this.terrainBtns.querySelectorAll("button[data-terrain]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.terrain === this.terrainMode);
      });
    }
    this.engine.setTerrainDisplayMode(this.terrainMode);
  }

  setCtAxis(axis) {
    this.ctAxis = axis;
    if (this.ctAxisBtns) {
      this.ctAxisBtns.querySelectorAll("button[data-axis]").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.axis) === axis);
      });
    }
    this.updateCtAxisLabels();
    this.syncCtRangeForAxis(true);
    if (this.ctEnabled && this.analyzedBox) {
      this.syncCtClipAndPlane();
    }
  }

  setCtClipScope(scope) {
    this.ctClipScope = scope === "global" ? "global" : "box";
    this.ctScopeBtns?.querySelectorAll("button[data-scope]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.scope === this.ctClipScope);
    });
    this.syncCtClipUniform();
  }

  setCtClipDir(dir) {
    this.ctClipDir = dir < 0 ? -1 : 1;
    this.ctDirBtns?.querySelectorAll("button[data-dir]").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.dir) === this.ctClipDir);
    });
    this.syncCtClipUniform();
  }

  updateCtAxisLabels() {
    if (this.ctDirBtns) {
      const posBtn = this.ctDirBtns.querySelector('button[data-dir="1"]');
      const negBtn = this.ctDirBtns.querySelector('button[data-dir="-1"]');
      if (this.ctAxis === 0) {
        if (posBtn) posBtn.textContent = "切上方 (+Y)";
        if (negBtn) negBtn.textContent = "切下方 (-Y)";
      } else if (this.ctAxis === 1) {
        if (posBtn) posBtn.textContent = "切東側 (+X)";
        if (negBtn) negBtn.textContent = "切西側 (-X)";
      } else {
        if (posBtn) posBtn.textContent = "切南側 (+Z)";
        if (negBtn) negBtn.textContent = "切北側 (-Z)";
      }
    }
    if (this.ctAxesHintEl) {
      if (this.ctAxis === 0) {
        this.ctAxesHintEl.textContent = "西(X-) → 東(X+) ｜ 北(Z-) ↓ 南(Z+)";
      } else if (this.ctAxis === 1) {
        this.ctAxesHintEl.textContent = "北(Z-) → 南(Z+) ｜ 下(Y-) ↑ 上(Y+)";
      } else {
        this.ctAxesHintEl.textContent = "西(X-) → 東(X+) ｜ 下(Y-) ↑ 上(Y+)";
      }
    }
  }

  syncCtControlsState() {
    if (!this.ctControlsEl) return;
    this.ctControlsEl.classList.toggle("is-disabled", !this.ctEnabled || !this.analyzedBox);
  }

  syncCtRangeForAxis(resetCenter = false) {
    const b = this.analyzedBox || this.boxBounds;
    let min = b.yMin;
    let max = b.yMax;
    if (this.ctAxis === 1) {
      min = b.xMin;
      max = b.xMax;
    } else if (this.ctAxis === 2) {
      min = b.zMin;
      max = b.zMax;
    }
    if (resetCenter) {
      if (this.ctAxis === 0 && max - min >= 200 && min < 0) {
        const defY = window.DOLPHIN_3D_CONFIG?.dimensions?.[this.dimId]?.defaultY ?? 64;
        this.ctCoord = Math.min(max, Math.max(min, Math.round(defY)));
      } else {
        this.ctCoord = Math.floor((min + max) / 2);
      }
    } else {
      this.ctCoord = Math.min(max, Math.max(min, this.ctCoord));
    }
    if (this.ctSlider) {
      this.ctSlider.min = String(min);
      this.ctSlider.max = String(max);
      this.ctSlider.value = String(this.ctCoord);
    }
    this.updateCtCoordLabel();
  }

  updateCtCoordLabel() {
    if (!this.ctCoordValEl) return;
    const axisName = this.ctAxis === 0 ? "Y" : this.ctAxis === 1 ? "X" : "Z";
    this.ctCoordValEl.textContent = `${axisName} = ${this.ctCoord}`;
  }

  stepCtCoord(delta) {
    if (!this.ctSlider) return;
    if (!this.analyzedBox) {
      this.setStatus("請先在「選取區」分析一個範圍，再調整 CT 切面", true);
      return;
    }
    if (!this.ctEnabled && this.ctToggleChk) {
      this.ctEnabled = true;
      this.ctToggleChk.checked = true;
      this.syncCtControlsState();
    }
    const min = Number(this.ctSlider.min);
    const max = Number(this.ctSlider.max);
    this.ctCoord = Math.min(max, Math.max(min, this.ctCoord + delta));
    this.ctSlider.value = String(this.ctCoord);
    this.updateCtCoordLabel();
    this.syncCtClipUniform();
    this.scheduleCtSliceUpdate(true);
  }

  syncCtClipUniform() {
    if (this.ctEnabled && this.ctClipTerrain && this.analyzedBox) {
      const clipVal = this.ctClipDir > 0 ? this.ctCoord + 0.99 : this.ctCoord + 0.01;
      const scopeVal = this.ctClipScope === "box" ? 1 : 0;
      const b = this.analyzedBox;
      const boxMin = [b.xMin - 0.001, b.yMin - 0.001, b.zMin - 0.001];
      const boxMax = [b.xMax + 1.001, b.yMax + 1.001, b.zMax + 1.001];
      this.engine.setCtClip(this.ctAxis + 1, clipVal, this.ctClipDir, scopeVal, boxMin, boxMax);
    } else {
      this.engine.setCtClip(0, 0, 1, 0, null, null);
    }
    this.updateCtPlanePosition();
  }

  syncCtClipAndPlane() {
    this.syncCtClipUniform();
    if (!this.ctEnabled || !this.analyzedBox) {
      this.ctReqSeq++;
      this.clearMeshGroup(this.ctGroup);
      this.ctMesh = null;
      this.ctSliceContainer = null;
      this.ctTexture = null;
      this.ctAirTexture = null;
      this.ctSliceData = null;
      if (this.ctHoverEl) this.ctHoverEl.textContent = "滑鼠移到切面上可查看各格方塊";
      if (this.ctCanvas) {
        const ctx = this.ctCanvas.getContext("2d");
        ctx?.clearRect(0, 0, this.ctCanvas.width, this.ctCanvas.height);
      }
      this.engine.markDirty(2);
      if (this.ctEnabled && !this.analyzedBox) {
        this.setStatus("請先分析一個區域，才能產生 CT 實心斷層切面", true);
      }
      return;
    }
    this.scheduleCtSliceUpdate(true);
  }

  scheduleCtSliceUpdate(immediate = false) {
    clearTimeout(this.ctDebounceTimer);
    if (immediate) {
      this.updateCtSlice();
      return;
    }
    this.ctDebounceTimer = setTimeout(() => this.updateCtSlice(), 25);
  }

  async updateCtSlice() {
    if (!this.isOpen || !this.ctEnabled || !this.analyzedBox) return;
    const epoch = this.analyzeEpoch;
    const reqSeq = ++this.ctReqSeq;
    try {
      const res = await this.callWorker("extractSlice", {
        axis: this.ctAxis,
        coord: this.ctCoord,
      });
      if (
        !this.isOpen ||
        !this.ctEnabled ||
        epoch !== this.analyzeEpoch ||
        reqSeq !== this.ctReqSeq
      ) {
        return;
      }

      if (res.coord !== this.ctCoord) {
        this.ctCoord = res.coord;
        if (this.ctSlider) this.ctSlider.value = String(res.coord);
        this.updateCtCoordLabel();
        this.syncCtClipUniform();
      }

      const rgba = new Uint8Array(res.rgbaBuf);
      const bids = new Uint16Array(res.bidsBuf);
      this.ctSliceData = {
        axis: res.axis,
        coord: res.coord,
        width: res.width,
        height: res.height,
        boxOrigin: res.boxOrigin,
        paletteNames: res.paletteNames,
        rgba,
        bids,
      };

      this.updateCt3DPlane(rgba, bids, res.width, res.height, res.axis, res.coord, res.boxOrigin);
      this.drawCtPreviewCanvas(rgba, res.width, res.height, res.axis);
    } catch (err) {
      if (epoch === this.analyzeEpoch && reqSeq === this.ctReqSeq) {
        this.setStatus(`CT 切面計算失敗：${err.message || err}`, true);
      }
    }
  }

  updateCtPlanePosition() {
    if (!this.ctSliceContainer || !this.ctSliceData) return;
    const { axis, coord, width, height, boxOrigin } = this.ctSliceData;
    const [x0, y0, z0] = boxOrigin;
    const sliceOffset = this.ctClipTerrain ? (this.ctClipDir > 0 ? 0.995 : 0.005) : 0.5;

    if (axis === 0) {
      this.ctSliceContainer.position.copy(
        this.engine.mcToLocal(x0 + width * 0.5, coord + sliceOffset, z0 + height * 0.5)
      );
    } else if (axis === 1) {
      this.ctSliceContainer.position.copy(
        this.engine.mcToLocal(coord + sliceOffset, y0 + height * 0.5, z0 + width * 0.5)
      );
    } else {
      this.ctSliceContainer.position.copy(
        this.engine.mcToLocal(x0 + width * 0.5, y0 + height * 0.5, coord + sliceOffset)
      );
    }
    this.engine.markDirty(2);
  }

  updateCt3DPlane(rgba, bids, width, height, axis, _coord, _boxOrigin) {
    this.clearMeshGroup(this.ctGroup);
    this.ctTexture = null;
    this.ctAirTexture = null;
    this.ctMesh = null;
    this.ctSliceContainer = null;

    const pixelCount = width * height;
    const solidRgba = new Uint8Array(pixelCount * 4);
    const airRgba = this.ctShowAir3D ? new Uint8Array(pixelCount * 4) : null;

    for (let i = 0; i < pixelCount; i++) {
      const o4 = i * 4;
      if (bids[i] === 0) {
        solidRgba[o4 + 3] = 0;
        if (airRgba) {
          // 保留輕微棋盤亮度變化使空間感清晰且不遮蔽後方地形
          airRgba[o4] = Math.min(255, rgba[o4] + 6);
          airRgba[o4 + 1] = Math.min(255, rgba[o4 + 1] + 50);
          airRgba[o4 + 2] = Math.min(255, rgba[o4 + 2] + 66);
          airRgba[o4 + 3] = 88;
        }
      } else {
        solidRgba[o4] = rgba[o4];
        solidRgba[o4 + 1] = rgba[o4 + 1];
        solidRgba[o4 + 2] = rgba[o4 + 2];
        solidRgba[o4 + 3] = 255;
      }
    }

    const solidTex = new THREE.DataTexture(solidRgba, width, height, THREE.RGBAFormat);
    solidTex.flipY = false;
    solidTex.magFilter = THREE.NearestFilter;
    solidTex.minFilter = THREE.NearestFilter;
    solidTex.colorSpace = THREE.NoColorSpace;
    solidTex.needsUpdate = true;
    this.ctTexture = solidTex;

    const container = new THREE.Group();
    if (axis === 0) {
      container.rotation.set(Math.PI / 2, 0, 0);
    } else if (axis === 1) {
      container.rotation.set(0, -Math.PI / 2, 0);
    } else {
      container.rotation.set(0, 0, 0);
    }

    const solidMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        map: solidTex,
        transparent: false,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        depthWrite: true,
      })
    );
    solidMesh.renderOrder = 1;
    container.add(solidMesh);

    if (airRgba) {
      const airTex = new THREE.DataTexture(airRgba, width, height, THREE.RGBAFormat);
      airTex.flipY = false;
      airTex.magFilter = THREE.NearestFilter;
      airTex.minFilter = THREE.NearestFilter;
      airTex.colorSpace = THREE.NoColorSpace;
      airTex.needsUpdate = true;
      this.ctAirTexture = airTex;

      const airMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({
          map: airTex,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      airMesh.renderOrder = 3;
      container.add(airMesh);
    }

    const hw = width * 0.5;
    const hh = height * 0.5;
    const borderGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hw, -hh, 0),
      new THREE.Vector3(hw, -hh, 0),
      new THREE.Vector3(hw, hh, 0),
      new THREE.Vector3(-hw, hh, 0),
    ]);
    const borderLoop = new THREE.LineLoop(
      borderGeo,
      new THREE.LineBasicMaterial({ color: 0x5ee3ff })
    );
    borderLoop.renderOrder = 4;
    container.add(borderLoop);

    this.ctMesh = solidMesh;
    this.ctSliceContainer = container;
    this.ctGroup.add(container);
    this.updateCtPlanePosition();
  }

  drawCtPreviewCanvas(rgba, width, height, axis) {
    if (!this.ctCanvas) return;
    const canvas = this.ctCanvas;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imgData = ctx.createImageData(width, height);
    if (axis === 0) {
      // Y 水平切面 row=0 對應北側 (zMin)，與 Canvas top-down 完全一致
      imgData.data.set(rgba);
    } else {
      // X / Z 垂直切面在 WASM 中 row=0 為底部 (yMin)，繪製到 Canvas 須垂直翻轉使高處朝上
      const rowBytes = width * 4;
      for (let r = 0; r < height; r++) {
        const srcOff = (height - 1 - r) * rowBytes;
        const dstOff = r * rowBytes;
        imgData.data.set(rgba.subarray(srcOff, srcOff + rowBytes), dstOff);
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  resolveCtCanvasCell(e) {
    if (!this.ctSliceData || !this.ctCanvas) return null;
    const cw = this.ctCanvas.clientWidth;
    const ch = this.ctCanvas.clientHeight;
    if (cw <= 0 || ch <= 0) return null;

    const rect = this.ctCanvas.getBoundingClientRect();
    const relX = e.clientX - rect.left - this.ctCanvas.clientLeft;
    const relY = e.clientY - rect.top - this.ctCanvas.clientTop;
    const { axis, coord, width, height, boxOrigin, paletteNames, bids } = this.ctSliceData;
    const mapped = mapCtCanvasPointToGrid(relX, relY, cw, ch, width, height, axis);
    if (!mapped) return null;

    const { col, dataRow } = mapped;
    const bid = bids[dataRow * width + col];
    const blockName = paletteNames[bid] || "minecraft:air";
    const [x0, y0, z0] = boxOrigin;

    let wx = x0;
    let wy = y0;
    let wz = z0;
    if (axis === 0) {
      wx = x0 + col;
      wy = coord;
      wz = z0 + dataRow;
    } else if (axis === 1) {
      wx = coord;
      wy = y0 + dataRow;
      wz = z0 + col;
    } else {
      wx = x0 + col;
      wy = y0 + dataRow;
      wz = coord;
    }
    return { wx, wy, wz, bid, blockName };
  }

  handleCtCanvasHover(e) {
    if (!this.ctHoverEl) return;
    const cell = this.resolveCtCanvasCell(e);
    if (!cell) {
      this.ctHoverEl.textContent = "滑鼠移到切面上可查看各格方塊";
      return;
    }
    this.ctHoverEl.textContent = `(${cell.wx}, ${cell.wy}, ${cell.wz}) · ${formatBlockDisplayName(cell.blockName)}`;
  }

  handleCtCanvasClick(e) {
    const cell = this.resolveCtCanvasCell(e);
    if (!cell) return;
    this.engine.selectTerrainPoint({
      blockX: cell.wx,
      blockY: cell.wy,
      blockZ: cell.wz,
      x: cell.wx,
      y: cell.wy + 1,
      z: cell.wz,
      blockName: cell.blockName,
      isCtSlice: true,
    });
  }

  isCtActive() {
    return Boolean(this.isOpen && this.ctEnabled && this.ctMesh && this.ctSliceData);
  }

  /**
   * 測試射線是否擊中 3D CT 斷層切面，並反查精確的世界座標與方塊名稱
   */
  pickCtSlice(raycasterArg = null) {
    if (!this.isCtActive()) return null;
    const rc = raycasterArg || this.engine.raycaster;
    this.ctGroup.updateMatrixWorld(true);
    const hits = rc.intersectObject(this.ctMesh, false);
    if (!hits || hits.length === 0) return null;

    const hit = hits[0];
    const { axis, coord, width, height, boxOrigin, paletteNames, bids } = this.ctSliceData;
    const [x0, y0, z0] = boxOrigin;
    const wxFloat = hit.point.x + this.engine.worldOrigin[0];
    const wyFloat = hit.point.y + this.engine.worldOrigin[1];
    const wzFloat = hit.point.z + this.engine.worldOrigin[2];

    let col = 0;
    let row = 0;
    let blockX = x0;
    let blockY = y0;
    let blockZ = z0;

    if (axis === 0) {
      col = Math.min(width - 1, Math.max(0, Math.floor(wxFloat) - x0));
      row = Math.min(height - 1, Math.max(0, Math.floor(wzFloat) - z0));
      blockX = x0 + col;
      blockY = coord;
      blockZ = z0 + row;
    } else if (axis === 1) {
      col = Math.min(width - 1, Math.max(0, Math.floor(wzFloat) - z0));
      row = Math.min(height - 1, Math.max(0, Math.floor(wyFloat) - y0));
      blockX = coord;
      blockY = y0 + row;
      blockZ = z0 + col;
    } else {
      col = Math.min(width - 1, Math.max(0, Math.floor(wxFloat) - x0));
      row = Math.min(height - 1, Math.max(0, Math.floor(wyFloat) - y0));
      blockX = x0 + col;
      blockY = y0 + row;
      blockZ = coord;
    }

    const bid = bids[row * width + col];
    if (bid === 0 && !this.ctShowAir3D) {
      return null;
    }
    const blockName = paletteNames[bid] || "minecraft:air";
    return {
      t: hit.distance,
      blockX,
      blockY,
      blockZ,
      x: blockX,
      y: blockY + 1,
      z: blockZ,
      blockName,
      isCtSlice: true,
    };
  }
}
