/**
 * DolphinGIS 3D 延遲載入代理：
 * 停留在 2D Leaflet 模式時，完全不下載 Three.js、OrbitControls、WASM 與 .vxq.gz。
 */
(function () {
  let realEnginePromise = null;
  let isLoadingEngine = false;

  function setToggleButtonLoading(loading) {
    const toggleBtn = document.getElementById("toggle-3d-btn");
    if (!toggleBtn) return;
    toggleBtn.disabled = loading;
    if (loading) {
      toggleBtn.textContent = "⏳ 載入 3D 引擎中...";
    } else if (!window.dolphin3D || !window.dolphin3D.isActive()) {
      toggleBtn.textContent = "🧊 切換 3D 實景";
    }
  }

  async function loadEngine() {
    if (!realEnginePromise) {
      isLoadingEngine = true;
      setToggleButtonLoading(true);
      realEnginePromise = import("./viewer-3d.js")
        .then((mod) => mod.default || window.dolphin3D)
        .catch((err) => {
          realEnginePromise = null;
          setToggleButtonLoading(false);
          if (window.teleportSystem && typeof window.teleportSystem.showNotification === "function") {
            window.teleportSystem.showNotification("3D 引擎載入失敗，請檢查網路連線後重試。", "error");
          } else {
            console.error("[DolphinGIS] 3D 引擎載入失敗:", err);
          }
          throw err;
        })
        .finally(() => {
          isLoadingEngine = false;
          const toggleBtn = document.getElementById("toggle-3d-btn");
          if (toggleBtn) toggleBtn.disabled = false;
        });
    }
    return realEnginePromise;
  }

  window.dolphin3D = {
    isActive: () => false,
    enter3D: async (opts) => {
      try {
        const engine = await loadEngine();
        return await engine.enter3D(opts);
      } catch (_err) {
        return undefined;
      }
    },
    toggle3D: async () => {
      if (isLoadingEngine) return undefined;
      try {
        const engine = await loadEngine();
        return await engine.toggle3D();
      } catch (_err) {
        return undefined;
      }
    },
    flyTo: async (x, y, z, dim, card) => {
      try {
        const engine = await loadEngine();
        return await engine.flyTo(x, y, z, dim, card);
      } catch (_err) {
        return undefined;
      }
    },
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
