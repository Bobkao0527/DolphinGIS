/**
 * DolphinGIS - 玩家即時定位系統 (Firebase 穩定版)
 * 負責從 Firebase 抓取座標並在地圖上移動玩家標記
 * 註：樣式由 style.css 控制，初始化依賴 map-logic.js 的 map 物件
 */

// 🔌 請確保這裡換成你正確的 Firebase 網址（必須保留結尾的 .json）
const FIREBASE_DB_URL = "https://dgis-gps-default-rtdb.asia-southeast1.firebasedatabase.app/players.json";

const tracker = {
    playerMarkers: {},
    statusEl: null,
    
    init: function() {
        console.log("[DolphinGIS] Tracker: Connecting to Firebase...");
        console.log("[DolphinGIS] Tracker: Initializing...");
        this.ensureStatusUI();
        this.startSync();
    },

    /**
     * 確保 UI 面板中已加入聯網狀態顯示
     * 使用遞迴檢查，直到找到 .info-box 為止
     */
    ensureStatusUI: function() {
        // 如果已經存在就不要重複建立
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
            // 每 200ms 檢查一次，直到面板出現
            setTimeout(() => this.ensureStatusUI(), 200);
        }
    },

    updateStatusUI: function(isOnline) {
        const dot = document.getElementById('tracker-dot');
        const text = document.getElementById('tracker-text');
        if (dot && text) {
            dot.style.background = isOnline ? "#55ff55" : "#ff4444";
            dot.style.boxShadow = isOnline ? "0 0 6px #55ff55" : "none";
            text.innerText = isOnline ? "GPS 訊號：良好" : "GPS 訊號：中斷";
        }
    },

    /**
     * 定期從 Firebase 同步位置
     */
    startSync: async function() {
        const fetchUpdates = async () => {
            try {
                // 加一個隨機參數防止瀏覽器快取舊數據
                const response = await fetch(`${FIREBASE_DB_URL}?nocache=${Date.now()}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                
                // 更新 UI 狀態
                this.updateStatusUI(true);

                const activePlayersThisTick = new Set();
                const now = Date.now();

                if (data) {
                    Object.keys(data).forEach(playerName => {
                        const p = data[playerName];
                        
                        // 1. 離線判定：超過 30 秒未更新視為離線
                        const isOnline = (now - p.ts) < 30000;
                        
                        // 2. 維度判定：僅顯示主世界玩家 (支援 minecraft:overworld 包含字串)
                        const isOverworld = p.dim && p.dim.includes("overworld");
                        
                        if (isOnline && isOverworld) {
                            activePlayersThisTick.add(playerName);
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
        
        const latlng = L.latLng(-z, x); 

        if (this.playerMarkers[name]) {
            this.playerMarkers[name].setLatLng(latlng);
        } else {
            // 使用 CSS 中定義的 .player-dot 樣式
            const icon = L.divIcon({
                className: 'player-icon-container',
                html: `<div class="player-dot"></div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });

            // 建立 Leaflet Marker 並加入地圖
            const marker = L.marker(latlng, { icon: icon, zIndexOffset: 1000 }).addTo(map);
            
            // 綁定名字標籤
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

// 啟動追蹤器 (延遲 1 秒確保地圖核心物件 map 初始化完成)
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof map !== 'undefined') {
            tracker.init();
        } else {
            console.error("[DolphinGIS] 無法定位地圖物件，追蹤器暫停啟動。");
        }
    }, 1000);
});
