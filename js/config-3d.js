/**
 * DolphinGIS 3D 引擎設定與端點解析
 * - 線上 Cloudflare Pages：優先讀取 ./api/config-3d（對應 env.MAP3D_URL）
 * - 本機測試開發：支援 ?map3d=... 參數，或於 localhost 自動回退至本機測試伺服器
 */
(function () {
  const DEFAULT_CONFIG = {
    vxqBaseUrl: "",
    workerCount: 3,
    maxConcurrentFetch: 6,
    maxCachedTiles: 128,
    defaultRadius: 380,
    dimensions: {
      overworld: { label: "主世界 (Overworld)", sky: 0x9bc7f2, fogDensity: 0.00055, defaultY: 85 },
      the_nether: { label: "地獄 (The Nether)", sky: 0x280b0b, fogDensity: 0.00055, defaultY: 68 },
      the_end: { label: "終界 (The End)", sky: 0x0b0616, fogDensity: 0.00042, defaultY: 90 },
      giant: { label: "巨人 (Giant)", sky: 0x9bc7f2, fogDensity: 0.00055, defaultY: 20 },
      mini: { label: "縮微 (Mini)", sky: 0x9bc7f2, fogDensity: 0.00055, defaultY: 82 },
      space: { label: "太空 (Space)", sky: 0x040615, fogDensity: 0.00022, defaultY: 18 },
      survival: { label: "生存 (Survival)", sky: 0xa8cde8, fogDensity: 0.00055, defaultY: 72 },
    },
  };

  let resolvedUrlPromise = null;

  async function resolveVxqBaseUrl() {
    if (resolvedUrlPromise) return resolvedUrlPromise;

    resolvedUrlPromise = (async () => {
      const params = new URLSearchParams(window.location.search);
      const override = (params.get("map3d") || "").trim().replace(/\/+$/, "");
      if (override) {
        window.DOLPHIN_3D_CONFIG.vxqBaseUrl = override;
        return override;
      }

      if (window.DOLPHIN_3D_CONFIG.vxqBaseUrl) {
        return window.DOLPHIN_3D_CONFIG.vxqBaseUrl.replace(/\/+$/, "");
      }

      const host = window.location.hostname;
      const forceCfApi = params.get("cf") === "1";
      if ((host === "127.0.0.1" || host === "localhost") && !forceCfApi) {
        const localFallback = "http://127.0.0.1:8765";
        window.DOLPHIN_3D_CONFIG.vxqBaseUrl = localFallback;
        return localFallback;
      }

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1800);
        const res = await fetch("./api/config-3d", { cache: "no-store", signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            const data = await res.json();
            const url = String(data?.vxqBaseUrl || "").trim().replace(/\/+$/, "");
            if (url) {
              window.DOLPHIN_3D_CONFIG.vxqBaseUrl = url;
              return url;
            }
          }
        }
      } catch (_err) {
        // 靜默回退
      }

      // 若本次解析失敗或取得空位址，清除快取的 Promise 以允許後續重試
      resolvedUrlPromise = null;
      return "";
    })().catch((err) => {
      resolvedUrlPromise = null;
      throw err;
    });

    return resolvedUrlPromise;
  }

  window.DOLPHIN_3D_CONFIG = {
    ...DEFAULT_CONFIG,
    resolveVxqBaseUrl,
  };
})();
