/**
 * DolphinGIS - 玩家即時定位系統 (Firebase 版)
 * 負責從 Firebase 抓取座標並在地圖上移動玩家標記
 */

// 已更新為你的 Firebase 網址 (新加坡節點)
const FIREBASE_DB_URL = "https://dgis-gps-default-rtdb.asia-southeast1.firebasedatabase.app/";

const tracker = {
    playerMarkers: {},
    
    init: function() {
        console.log("DolphinGIS Tracker: Connecting to Firebase (Singapore)...");
        this.startSync();
    },

    /**
     * 使用 Firebase REST API 同步玩家位置
     */
    startSync: async function() {
        const fetchUpdates = async () => {
            try {
                const response = await fetch(`${FIREBASE_DB_URL}/players.json`);
                const data = await response.json();
                
                if (data) {
                    // Firebase 回傳的是物件，Key 是玩家名稱或 ID
                    Object.keys(data).forEach(playerName => {
                        const p = data[playerName];
                        this.updatePlayerOnMap(p.name, p.x, p.z, p.dim);
                    });
                }
            } catch (error) {
                console.error("Firebase Sync Error:", error);
            }
            // 每 1.5 秒抓取一次，平衡即時性與性能
            setTimeout(fetchUpdates, 1500);
        };
        
        fetchUpdates();
    },

    /**
     * 在 Leaflet 地圖上更新玩家圖示
     */
    updatePlayerOnMap: function(name, x, z, dim) {
        const latlng = L.latLng(-z, x); 
        
        if (this.playerMarkers[name]) {
            this.playerMarkers[name].setLatLng(latlng);
        } else {
            // 建立黃色發光玩家圖標
            const icon = L.divIcon({
                className: 'player-icon',
                html: `<div style="
                    background: #ffcc00; 
                    width: 10px; 
                    height: 10px; 
                    border: 2px solid #fff; 
                    border-radius: 50%;
                    box-shadow: 0 0 10px #ffcc00;
                "></div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });

            const marker = L.marker(latlng, { icon: icon }).addTo(map);
            
            // 設定標籤樣式
            marker.bindTooltip(name, { 
                permanent: true, 
                direction: 'top', 
                offset: [0, -10],
                className: 'player-tooltip'
            });

            this.playerMarkers[name] = marker;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    tracker.init();
});
