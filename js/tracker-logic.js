/**
 * DolphinGIS - 玩家即時定位系統 (甲骨文 API 直連版 - 帶朝向指針)
 * 負責從自建的 Node.js API 抓取座標與朝向，並在地圖上移動、旋轉玩家標記
 */

// 🔌 已更換為你最新的 Cloudflare Tunnel 安全加密 HTTPS 網址
const API_URL = "https://mega-petition-winners-oasis.trycloudflare.com/players.json";

const tracker = {
    playerMarkers: {},
    onlinePlayers: {},
    statusEl: null,
    
    init() {
        console.log("[DolphinGIS] Tracker: Connecting to Oracle Cloud API via Cloudflare Tunnel...");
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
     * 定期從我們的 Node.js API 同步位置
     */
    async startSync() {
        const fetchUpdates = async () => {
            try {
                // 向自建 API 請求最新玩家資料 (加上 nocache 參數避免瀏覽器快取舊資料)
                const response = await fetch(`${API_URL}?nocache=${Date.now()}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                
                this.updateStatusUI(true);

                const activePlayersThisTick = new Set();
                const now = Date.now();

                if (data) {
                    Object.keys(data).forEach(playerName => {
                        const p = data[playerName];
                        
                        // 我們的 API 會幫忙過濾掉 10 秒沒動靜的玩家，所以這裡做個雙重保險即可
                        const isOnline = (now - (p.ts * 1000)) < 30000;
                        const isOverworld = p.dim && p.dim.includes("overworld");
                        
                        if (isOnline && isOverworld) {
                            activePlayersThisTick.add(playerName);
                            this.onlinePlayers[playerName] = {
                                name: playerName,
                                x: p.x,
                                z: p.z,
                                ts: p.ts,
                                yaw: p.yaw || 0 // 讀取 Java 送上來的朝向，若沒有則預設 0 (正南)
                            };
                            // 將座標與朝向同步更新到地圖上
                            this.updatePlayerOnMap(playerName, p.x, p.z, p.yaw || 0);
                        }
                    });
                }

                // 清除已經下線或不再發送訊號的玩家標記
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
            // ⚡️ 核心修改：將原本的 2000ms (2秒) 縮短至 500ms (0.5秒) 進行極速位置同步
            setTimeout(fetchUpdates, 500); 
        };
        
        fetchUpdates();
    },

    getOnlinePlayers() {
        return Object.values(this.onlinePlayers).filter(Boolean);
    },

    /**
     * 建立帶有旋轉指針的自訂 Leaflet DivIcon
     * @param {string} name 玩家名稱
     * @param {number} yaw 朝向角度 (0 ~ 359)
     */
    createPlayerIcon(name, yaw) {
        const avatarUrl = `https://minotar.net/helm/${name}/32`;
        
        return L.divIcon({
            className: 'player-icon-container',
            // 透過精密計算的 CSS 來實現：玩家臉部保持正立，而綠色三角形指針繞著圓心自由旋轉
            html: `
                <div class="player-avatar-wrapper" style="
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: 2px solid #ffffff;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.4);
                    background: #3c3c3c;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                ">
                    <!-- 🧭 朝向綠色指針：繞著頭像的中心點（X:50%, Y:28px）進行 Yaw 角度旋轉 -->
                    <div class="player-direction-pointer" style="
                        position: absolute;
                        top: -10px; /* 往外推 10px 懸浮在頭像上方 */
                        left: 50%;
                        transform: translateX(-50%) rotate(${yaw}deg);
                        transform-origin: 50% 28px; /* 10px 懸浮 + 18px 半徑 = 28px 完美對準圓心 */
                        width: 0;
                        height: 0;
                        border-left: 6px solid transparent;
                        border-right: 6px solid transparent;
                        border-bottom: 10px solid #55ff55; /* 明亮的導航綠色 */
                        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
                        transition: transform 0.2s ease-out; /* 轉向平滑過渡 */
                        z-index: 999;
                    "></div>
                    
                    <!-- 👤 玩家 Helm 3D 頭像 (保持正立，圓形遮罩) -->
                    <img src="${avatarUrl}" 
                         style="
                            width: 100%; 
                            height: 100%; 
                            image-rendering: pixelated; 
                            display: block; 
                            border-radius: 50%;
                         " 
                         alt="${name}" 
                         onerror="this.onerror=null; this.src='https://minotar.net/avatar/char/32';">
                </div>
            `,
            iconSize: [36, 36],   // 包含白框的完整寬高
            iconAnchor: [18, 18]  // 將地圖錨點精確定位在頭像正中心
        });
    },

    /**
     * 更新或繪製地圖上的玩家標記
     */
    updatePlayerOnMap(name, x, z, yaw) {
        if (typeof map === 'undefined') return;
        
        const latlng = L.latLng(-z, x); 

        if (this.playerMarkers[name]) {
            // 標記已存在，更新座標
            this.playerMarkers[name].setLatLng(latlng);
            // 🔄 動態更新 Icon，帶入最新算好的 Yaw 角度指針
            this.playerMarkers[name].setIcon(this.createPlayerIcon(name, yaw));
        } else {
            // 標記不存在，初次建立
            const icon = this.createPlayerIcon(name, yaw);
            const marker = L.marker(latlng, { icon: icon, zIndexOffset: 1000 }).addTo(map);
            
            marker.bindTooltip(name, { 
                permanent: true, 
                direction: 'top', 
                offset: [0, -20], // 配合較大尺寸的頭像，將名字標籤稍微往上移避免擋住指針
                className: 'player-tooltip'
            });

            this.playerMarkers[name] = marker;
            console.log(`[DolphinGIS] 玩家進入地圖: ${name} (Yaw: ${yaw}°)`);
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
            console.error("[DolphinGIS] 無法定位地圖 L.map 物件，追蹤器暫停啟動。");
        }
    }, 1000);
});
