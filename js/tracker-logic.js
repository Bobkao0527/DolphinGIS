/**
 * DolphinGIS - 玩家即時定位系統 (Firebase 版)
 * 負責從 Firebase 抓取座標並在地圖上移動玩家標記
 * 註：樣式由 style.css 控制，初始化依賴 map-logic.js 的 map 物件
 */

// 你的 Firebase Realtime Database 網址
const FIREBASE_DB_URL = "https://dgis-gps-default-rtdb.asia-southeast1.firebasedatabase.app/players.json";

const tracker = {
    playerMarkers: {},
    statusEl: null,
    
    init: function() {
        console.log("[DolphinGIS] Tracker: Connecting to Firebase...");
        this.createStatusUI();
        this.startSync();
    },

    /**
     * 在 UI 面板中動態加入聯網狀態顯示，不需更動 index.html
     */
    createStatusUI: function() {
        const infoBox = document.querySelector('.info-box');
        if (infoBox) {
            this.statusEl = document.createElement('div');
            this.statusEl.style.fontSize = '10px';
            this.statusEl.style.marginTop = '8px';
            this.statusEl.style.display = 'flex';
            this.statusEl.style.alignItems = 'center';
            this.statusEl.style.gap = '5px';
            this.statusEl.style.opacity = '0.8';
            this.statusEl.innerHTML = `
                <span id="tracker-dot" style="width:6px;height:6px;background:#ffaa00;border-radius:50%;display:inline-block;"></span>
                <span id="tracker-text" style="color:#eee;">GPS 訊號連線中...</span>
            `;
            infoBox.appendChild(this.statusEl);
        }
    },

    updateStatusUI: function(isOnline) {
        const dot = document.getElementById('tracker-dot');
        const text = document.getElementById('tracker-text');
        if (dot && text) {
            dot.style.background = isOnline ? "#55ff55" : "#ff4444";
            dot.style.boxShadow = isOnline ? "0 0 5px #55ff55" : "none";
            text.innerText = isOnline ? "GPS 訊號：良好" : "GPS 訊號：中斷";
        }
    },

    /**
     * 定期從 Firebase 同步位置
     */
    startSync: async function() {
        const fetchUpdates = async () => {
            try {
                const response = await fetch(FIREBASE_DB_URL);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                
                // 更新 UI 狀態為連線成功
                this.updateStatusUI(true);

                if (data) {
                    const activePlayersThisTick = new Set();
                    const now = Date.now();

                    Object.keys(data).forEach(playerName => {
                        const p = data[playerName];
                        
                        // 1. 離線判定：超過 30 秒未更新視為離線
                        const isOnline = (now - p.ts) < 30000;
                        
                        // 2. 維度判定：僅顯示主世界玩家 (支援 minecraft:overworld 或 overworld 字串)
                        const isOverworld = p.dim && p.dim.includes("overworld");
                        
                        if (isOnline && isOverworld) {
                            activePlayersThisTick.add(playerName);
                            this.updatePlayerOnMap(playerName, p.x, p.z);
                        }
                    });

                    // 3. 清除過時標記
                    Object.keys(this.playerMarkers).forEach(name => {
                        if (!activePlayersThisTick.has(name)) {
                            this.removePlayer(name);
                        }
                    });
                } else {
                    // Firebase 資料為空時清空地圖
                    Object.keys(this.playerMarkers).forEach(name => this.removePlayer(name));
                }
            } catch (error) {
                console.error("[DolphinGIS] 同步失敗:", error);
                this.updateStatusUI(false);
            }
            // 每 1.5 秒同步一次 (對應 Mod 發送頻率)
            setTimeout(fetchUpdates, 1500);
        };
        
        fetchUpdates();
    },

    updatePlayerOnMap: function(name, x, z) {
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

            if (typeof map !== 'undefined') {
                const marker = L.marker(latlng, { icon: icon, zIndexOffset: 1000 }).addTo(map);
                
                // 使用 CSS 中定義的 .player-tooltip 樣式
                marker.bindTooltip(name, { 
                    permanent: true, 
                    direction: 'top', 
                    offset: [0, -10],
                    className: 'player-tooltip'
                });

                this.playerMarkers[name] = marker;
                console.log(`[DolphinGIS] 偵測到玩家連線: ${name}`);
            }
        }
    },

    removePlayer: function(name) {
        if (this.playerMarkers[name] && typeof map !== 'undefined') {
            map.removeLayer(this.playerMarkers[name]);
            delete this.playerMarkers[name];
            console.log(`[DolphinGIS] 玩家已離線: ${name}`);
        }
    }
};

// 啟動追蹤器 (延遲 1 秒確保地圖核心初始化)
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof map !== 'undefined') {
            tracker.init();
        } else {
            console.error("[DolphinGIS] 無法定位地圖物件，追蹤器暫停啟動。");
        }
    }, 1000);
});
