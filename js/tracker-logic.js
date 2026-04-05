/**
 * DolphinGIS - 玩家即時定位系統 (Firebase 版)
 * 負責從 Firebase 抓取座標並在地圖上移動玩家標記
 */

// 你的 Firebase Realtime Database 網址 (新加坡節點)
const FIREBASE_DB_URL = "https://dgis-gps-default-rtdb.asia-southeast1.firebasedatabase.app/players.json";

const tracker = {
    // 儲存所有玩家的 Leaflet Marker 物件
    playerMarkers: {},
    
    init: function() {
        console.log("DolphinGIS Tracker: Connecting to Firebase...");
        this.startSync();
    },

    /**
     * 使用 Firebase REST API 定期同步玩家位置
     */
    startSync: async function() {
        const fetchUpdates = async () => {
            try {
                const response = await fetch(FIREBASE_DB_URL);
                const data = await response.json();
                
                if (data) {
                    const activePlayersThisTick = new Set();

                    // Firebase 回傳的是一個以玩家名稱為 Key 的物件
                    Object.keys(data).forEach(playerName => {
                        const p = data[playerName];
                        
                        // 1. 檢查資料是否過期 (超過 30 秒未更新則視為離線)
                        const isOnline = (Date.now() - p.ts) < 30000;
                        
                        // 2. 檢查維度 (只顯示主世界的玩家)
                        // Mod 傳出的格式通常為 "minecraft:overworld"
                        const isOverworld = p.dim && p.dim.includes("overworld");
                        
                        if (isOnline && isOverworld) {
                            activePlayersThisTick.add(playerName);
                            this.updatePlayerOnMap(playerName, p.x, p.z);
                        }
                    });

                    // 3. 清理已離線或切換維度的玩家標記
                    Object.keys(this.playerMarkers).forEach(name => {
                        if (!activePlayersThisTick.has(name)) {
                            this.removePlayer(name);
                        }
                    });
                }
            } catch (error) {
                console.error("Firebase 同步錯誤:", error);
            }
            // 每 1.5 秒抓取一次，與 Mod 同步頻率保持一致
            setTimeout(fetchUpdates, 1500);
        };
        
        fetchUpdates();
    },

    /**
     * 在地圖上更新或建立玩家標記
     */
    updatePlayerOnMap: function(name, x, z) {
        // Minecraft Z 在 Leaflet CRS.Simple 中需取負值作為緯度
        const latlng = L.latLng(-z, x); 
        
        if (this.playerMarkers[name]) {
            // 已存在則移動位置
            this.playerMarkers[name].setLatLng(latlng);
        } else {
            // 建立新的黃色發光圖標 (CSS 樣式需定義在 HTML 中)
            const icon = L.divIcon({
                className: 'player-icon-container',
                html: `<div class="player-dot"></div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });

            const marker = L.marker(latlng, { icon: icon }).addTo(map);
            
            // 綁定名稱標籤
            marker.bindTooltip(name, { 
                permanent: true, 
                direction: 'top', 
                offset: [0, -10],
                className: 'player-tooltip'
            });

            this.playerMarkers[name] = marker;
        }
    },

    /**
     * 移除離線玩家標記
     */
    removePlayer: function(name) {
        if (this.playerMarkers[name]) {
            map.removeLayer(this.playerMarkers[name]);
            delete this.playerMarkers[name];
            console.log(`Player ${name} removed from map.`);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // 確保地圖物件已經初始化再啟動追蹤
    setTimeout(() => {
        if (typeof map !== 'undefined') {
            tracker.init();
        } else {
            console.error("Map object not found. Tracker failed to start.");
        }
    }, 1000);
});
