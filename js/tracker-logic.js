/**
 * DolphinGIS - 玩家即時定位系統 (Firebase 版)
 * 負責從 Firebase 抓取座標並在地圖上移動玩家標記
 */

// 你的 Firebase Realtime Database 網址 (新加坡節點)
const FIREBASE_DB_URL = "https://dgis-gps-default-rtdb.asia-southeast1.firebasedatabase.app/";

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
                // 抓取 players 節點下的所有最新資料
                const response = await fetch(`${FIREBASE_DB_URL}/players.json`);
                const data = await response.json();
                
                if (data) {
                    // Firebase 回傳的是一個以玩家名稱為 Key 的物件
                    Object.keys(data).forEach(playerName => {
                        const p = data[playerName];
                        // 檢查資料是否過期 (超過 10 分鐘未更新則視為離線，可選)
                        const isOnline = (Date.now() - p.ts) < 600000;
                        
                        if (isOnline) {
                            this.updatePlayerOnMap(p.name, p.x, p.z, p.dim);
                        } else {
                            this.removePlayer(p.name);
                        }
                    });
                }
            } catch (error) {
                console.error("Firebase 同步錯誤:", error);
            }
            // 每 1.5 秒抓取一次，確保流暢度與頻寬平衡
            setTimeout(fetchUpdates, 1500);
        };
        
        fetchUpdates();
    },

    /**
     * 在地圖上更新或建立玩家標記
     */
    updatePlayerOnMap: function(name, x, z, dim) {
        const latlng = L.latLng(-z, x); // Minecraft Z 在地圖中需取負值
        
        if (this.playerMarkers[name]) {
            // 已存在則移動位置
            this.playerMarkers[name].setLatLng(latlng);
        } else {
            // 建立新的黃色發光圖標
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
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // 延遲一下確保 map-logic.js 已經把 map 物件準備好
    setTimeout(() => tracker.init(), 500);
});
