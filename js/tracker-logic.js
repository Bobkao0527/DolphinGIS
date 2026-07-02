/**
 * DolphinGIS - 玩家即時定位系統 (Firebase 語法安全版 - 頭像升級版)
 * 負責從 Firebase 抓取座標並在地圖上移動玩家標記
 */

// 🔌 請確保這裡換成你正確的 Firebase 網址
const FIREBASE_DB_URL = "https://dgis-gps-default-rtdb.asia-southeast1.firebasedatabase.app/players.json";

const tracker = {
    playerMarkers: {},
    onlinePlayers: {},
    statusEl: null,
    
    init() {
        console.log("[DolphinGIS] Tracker: Connecting to Firebase...");
        console.log("[DolphinGIS] Tracker: Initializing...");
        this.ensureStatusUI();
        this.ensurePlayerMenuUI();
        this.startSync();
    },

    /**
     * 確保 UI 面板中已加入聯網狀態顯示
     */
    ensureStatusUI() {
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

    updateStatusUI(isOnline) {
        const dot = document.getElementById('tracker-dot');
        const text = document.getElementById('tracker-text');
        if (dot && text) {
            dot.style.background = isOnline ? "#55ff55" : "#ff4444";
            dot.style.boxShadow = isOnline ? "0 0 6px #55ff55" : "none";
            text.innerText = isOnline ? "GPS 訊號：良好" : "GPS 訊號：中斷";
        }
    },

    ensurePlayerMenuUI() {
        const toggle = document.getElementById('player-menu-toggle');
        const panel = document.getElementById('player-menu-panel');
        const list = document.getElementById('player-menu-list');

        if (!toggle || !panel || !list) return;

        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            const isVisible = panel.style.display === 'block';
            panel.style.display = isVisible ? 'none' : 'block';
            if (!isVisible) this.renderPlayerMenu();
        });

        document.addEventListener('click', (event) => {
            if (!toggle.contains(event.target) && !panel.contains(event.target)) {
                panel.style.display = 'none';
            }
        });

        this.renderPlayerMenu();
    },

    renderPlayerMenu() {
        const toggle = document.getElementById('player-menu-toggle');
        const list = document.getElementById('player-menu-list');
        if (!toggle || !list) return;

        const players = this.getOnlinePlayers();
        toggle.textContent = `在線玩家 (${players.length})`;

        if (players.length === 0) {
            list.innerHTML = '<div class="player-menu-empty">目前沒有在線玩家</div>';
            return;
        }

        list.innerHTML = '';
        players.forEach(player => {
            const item = document.createElement('div');
            item.className = 'player-menu-item';
            item.innerHTML = `
                <img class="player-avatar" src="https://minotar.net/helm/${encodeURIComponent(player.name)}/32" alt="${player.name}" onerror="this.onerror=null; this.src='https://minotar.net/avatar/char/32';">
                <div class="player-menu-name">${player.name}</div>
            `;
            item.addEventListener('click', () => {
                if (typeof map !== 'undefined' && player.x != null && player.z != null) {
                    goToLocation(player.x, player.z, player.name, '在線玩家', '在線玩家', player.name);
                }
                const panel = document.getElementById('player-menu-panel');
                if (panel) panel.style.display = 'none';
            });
            list.appendChild(item);
        });
    },

    /**
     * 定期從 Firebase 同步位置
     */
    async startSync() {
        const fetchUpdates = async () => {
            try {
                const response = await fetch(`${FIREBASE_DB_URL}?nocache=${Date.now()}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                
                this.updateStatusUI(true);

                const activePlayersThisTick = new Set();
                const now = Date.now();

                if (data) {
                    Object.keys(data).forEach(playerName => {
                        const p = data[playerName];
                        
                        // 🛠️ 修正 Bug：Firebase 的 ts 是 10 位數(秒)，需要乘以 1000 轉換為毫秒
                        const isOnline = (now - (p.ts * 1000)) < 30000;
                        const isOverworld = p.dim && p.dim.includes("overworld");
                        
                        if (isOnline && isOverworld) {
                            activePlayersThisTick.add(playerName);
                            this.onlinePlayers[playerName] = {
                                name: playerName,
                                x: p.x,
                                z: p.z,
                                ts: p.ts
                            };
                            this.updatePlayerOnMap(playerName, p.x, p.z);
                        }
                    });
                }

                Object.keys(this.playerMarkers).forEach(name => {
                    if (!activePlayersThisTick.has(name)) {
                        this.removePlayer(name);
                    }
                });

                Object.keys(this.onlinePlayers).forEach(name => {
                    if (!activePlayersThisTick.has(name)) {
                        delete this.onlinePlayers[name];
                    }
                });

                this.renderPlayerMenu();

            } catch (error) {
                console.error("[DolphinGIS] 同步失敗:", error);
                this.updateStatusUI(false);
            }
            setTimeout(fetchUpdates, 2000);
        };
        
        fetchUpdates();
    },

    getOnlinePlayers() {
        return Object.values(this.onlinePlayers).filter(Boolean);
    },

    updatePlayerOnMap(name, x, z) {
        if (typeof map === 'undefined') return;
        
        const latlng = L.latLng(-z, x); 

        if (this.playerMarkers[name]) {
            this.playerMarkers[name].setLatLng(latlng);
        } else {
            // 👤 取得 Minecraft 玩家 Helm 頭像 (含外層3D立體頭盔，效果最好)
            const avatarUrl = `https://minotar.net/helm/${name}/32`;
            
            const icon = L.divIcon({
                className: 'player-icon-container',
                // 透過 inline CSS 渲染圓形外觀、白色邊框以及精緻的陰影效果
                html: `
                    <div class="player-avatar-wrapper" style="
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        border: 2px solid #ffffff;
                        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
                        overflow: hidden;
                        background: #3c3c3c;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    ">
                        <img src="${avatarUrl}" 
                             style="width: 100%; height: 100%; image-rendering: pixelated; display: block;" 
                             alt="${name}" 
                             onerror="this.onerror=null; this.src='https://minotar.net/avatar/char/32';">
                    </div>
                `,
                iconSize: [36, 36],   // 包含白框的完整寬高
                iconAnchor: [18, 18]  // 將地圖錨點精確定位在頭像正中心
            });

            const marker = L.marker(latlng, { icon: icon, zIndexOffset: 1000 }).addTo(map);
            
            marker.bindTooltip(name, { 
                permanent: true, 
                direction: 'top', 
                offset: [0, -20], // 配合較大尺寸的頭像，將名字標籤稍微往上移
                className: 'player-tooltip'
            });

            this.playerMarkers[name] = marker;
            console.log(`[DolphinGIS] 玩家進入地圖: ${name}`);
        }
    },

    removePlayer(name) {
        if (this.playerMarkers[name] && typeof map !== 'undefined') {
            map.removeLayer(this.playerMarkers[name]);
            delete this.playerMarkers[name];
            console.log(`[DolphinGIS] 玩家離開地圖: ${name}`);
        }
    }
};

// 啟動追蹤器
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof map !== 'undefined') {
            tracker.init();
        } else {
            console.error("[DolphinGIS] 無法定位地圖物件，追蹤器暫停啟動。");
        }
    }, 1000);
});
