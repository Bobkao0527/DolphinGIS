/**
 * DolphinGIS - 玩家即時定位系統 (本地 Puppeteer API 版)
 * 負責從本地 Puppeteer API 抓取座標並在地圖上移動玩家標記
 * 註：樣式由 style.css 控制，初始化依賴 map-logic.js 的 map 物件
 */

// 🔌 將原本的 Firebase 網址替換為本地 API 網址
const LOCAL_API_URL = "http://localhost:3000/api/players";

const tracker = {
    playerMarkers: {},
    statusEl: null,
    
    init: function() {
        console.log("[DolphinGIS] Tracker: Initializing...");
        this.ensureStatusUI();
        this.startSync();
    },

    /**
     * 強力確保 UI 面板中已加入聯網狀態顯示
     */
    ensureStatusUI: function() {
        if (document.getElementById('tracker-status-container')) return;

        const infoBox = document.querySelector('.info-box');
        
        if (infoBox) {
            const container = document.createElement('div');
            container.id = 'tracker-status-container';
            container.style.fontSize = '10px';
            container.style.marginTop = '8px';
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.gap = '5px';
            container.style.opacity = '0.8';
            container.innerHTML = `
                <span id="tracker-dot" style="width:6px;height:6px;background:#ffaa00;border-radius:50%;display:inline-block;transition: all 0.3s ease;"></span>
                <span id="tracker-text" style="color:#eee; font-family: sans-serif;">GPS 訊號連線中...</span>
            `;
            infoBox.appendChild(container);
            this.statusEl = container;
            console.log("[DolphinGIS] Status UI attached.");
        } else {
            setTimeout(() => this.ensureStatusUI(), 200);
        }
    },

    updateStatusUI: function(isOnline) {
        const dot = document.getElementById('tracker-dot');
        const text = document.getElementById('tracker-text');
        if (dot && text) {
            dot.style.background = isOnline ? "#55ff55" : "#ff4444";
            dot.style.boxShadow = isOnline ? "0 0 6px #55ff55" : "0 0 6px #ff4444";
            text.innerText = isOnline ? "GPS 訊號：良好" : "GPS 訊號：中斷";
        }
    },

    /**
     * 定期從本地 API 同步位置
     */
    startSync: async function() {
        const fetchUpdates = async () => {
            try {
                // 🔄 改為請求本地 API
                const response = await fetch(`${LOCAL_API_URL}?nocache=${Date.now()}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                
                this.updateStatusUI(true);

                const activePlayersThisTick = new Set();
                const now = Date.now();

                if (data) {
                    Object.keys(data).forEach(playerName => {
                        const p = data[playerName];
                        
                        // 1. 離線判定：超過 30 秒未更新視為離線 (沿用你完美的邏輯)
                        const isOnline = (now - p.ts) < 30000;
                        
                        // 2. 維度判定：純伺服器端指令預設就是主世界，或由後端給定
                        const isOverworld = p.dim && p.dim.includes("overworld");
                        
                        if (isOnline && isOverworld) {
                            activePlayersThisTick.add(playerName);
                            // 💡 沿用你原本對齊的地圖座標計算：L.latLng(-z, x)
                            this.updatePlayerOnMap(playerName, p.x, p.z);
                        }
                    });
                }

                // 3. 清除過時標記
                Object.keys(this.playerMarkers).forEach(name => {
                    if (!activePlayersThisTick.has(name)) {
                        this.removePlayer(name);
                    }
                });

            } catch (error) {
                console.error("[DolphinGIS] 同步失敗:", error);
                this.updateStatusUI(false);
            }
            // 每 1.5 秒同步一次
            setTimeout(fetchUpdates, 1500);
        };
        
        fetchUpdates();
    },

    updatePlayerOnMap: function(name, x, z) {
        if (typeof map === 'undefined') return;
        
        // 沿用你原本的對齊公式
        const latlng = L.latLng(-z, x); 
        
        if (this.playerMarkers[name]) {
            this.playerMarkers[name].setLatLng(latlng);
        } else {
            const icon = L.divIcon({
                className: 'player-icon-container',
                html: `<div class="player-dot"></div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });

            const marker = L.marker(latlng, { icon: icon, zIndexOffset: 1000 }).addTo(map);
            
            marker.bindTooltip(name, { 
                permanent: true, 
                direction: 'top', 
                offset: [0, -10],
                className: 'player-tooltip'
            });

            this.playerMarkers[name] = marker;
            console.log(`[DolphinGIS] 玩家進入地圖: ${name}`);
        }
    },

    removePlayer: function(name) {
        if (this.playerMarkers[name] && typeof map !== 'undefined') {
            map.removeLayer(this.playerMarkers[name]);
            delete this.playerMarkers[name];
            console.log(`[DolphinGIS] 玩家離開地圖: ${name}`);
        }
    }
};

// 立即啟動監測
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => tracker.init());
} else {
    tracker.init();
}
