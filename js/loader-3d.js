/**
 * DolphinGIS 3D 延遲載入代理：
 * 停留在 2D Leaflet 模式時，完全不下載 Three.js、OrbitControls、WASM 與 .vxq.gz。
 */
(function () {
  let realEnginePromise = null;

  async function loadEngine() {
    if (!realEnginePromise) {
      realEnginePromise = import("./viewer-3d.js").then((mod) => mod.default || window.dolphin3D);
    }
    return realEnginePromise;
  }

  window.dolphin3D = {
    isActive: () => false,
    enter3D: async (opts) => (await loadEngine()).enter3D(opts),
    toggle3D: async () => (await loadEngine()).toggle3D(),
    flyTo: async (x, y, z, dim, card) => (await loadEngine()).flyTo(x, y, z, dim, card),
    onDimensionChanged: () => {},
    refreshBuildings: () => {},
    refreshPlayers: () => {},
  };

  document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.getElementById("toggle-3d-btn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => window.dolphin3D.toggle3D());
    }
  });
})();
