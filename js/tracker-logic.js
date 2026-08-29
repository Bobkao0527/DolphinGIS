/**
 * DolphinGIS - 玩家即時定位系統
 */

const API_URL = "https://mega-petition-winners-oasis.trycloudflare.com/players.json";

const tracker = {
    playerMarkers: {},
    onlinePlayers: {},
    statusEl: null,
    
    init() {
        console.log("[DolphinGIS] Tracker: Connecting to Oracle Cloud API...");
        this.ensureStatusUI();
        this.ensurePlayerMenuUI();
        this.startSync();
    },

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
                <div class="player-menu-name">
                    <span>${player.name}</span>
                    <span class="player-menu-dim">${player.dim.toUpperCase()}</span>
                </div>
            `;
            item.addEventListener('click', () => {
                if (typeof switchMapDimension === 'function') {
                    switchMapDimension(player.dim);
                }
                if (typeof map !== 'undefined' && player.x != null && player.z != null) {
                    const playerY = Number.isFinite(Number(player.y)) ? Number(player.y) : 120;
                    goToLocation(player.x, playerY, player.z, player.name, '在線玩家', '在線玩家', player.name, player.dim);
                }
                const panel = document.getElementById('player-menu-panel');
                if (panel) panel.style.display = 'none';
            });
            list.appendChild(item);
        });
    },

    async startSync() {
        const fetchUpdates = async () => {
            try {
                const response = await fetch(`${API_URL}?nocache=${Date.now()}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                
                this.updateStatusUI(true);

                const activePlayersThisTick = new Set();
                const now = Date.now();

                if (data) {
                    Object.keys(data).forEach(playerName => {
                        const p = data[playerName];
                        const isOnline = (now - (p.ts * 1000)) < 30000;
                        
                        if (isOnline) {
                            const resolvedDim = (typeof matchDimension === 'function') 
                                ? matchDimension(p.dim) 
                                : 'overworld';

                            activePlayersThisTick.add(playerName);
                            
                            this.onlinePlayers[playerName] = {
                                name: playerName,
                                x: p.x,
                                y: Number.isFinite(Number(p.y)) ? Number(p.y) : 120,
                                z: p.z,
                                ts: p.ts,
                                dim: resolvedDim, 
                                yaw: p.yaw || 0   
                            };

                            this.updatePlayerOnMap(playerName, p.x, p.z, p.yaw || 0, resolvedDim);
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
            setTimeout(fetchUpdates, 500); 
        };
        
        fetchUpdates();
    },

    getOnlinePlayers() {
        return Object.values(this.onlinePlayers).filter(Boolean);
    },

    createPlayerIcon(name, yaw) {
        const avatarUrl = `https://minotar.net/helm/${name}/32`;
        const correctedYaw = (yaw + 180) % 360;
        
        return L.divIcon({
            className: 'player-icon-container',
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
                    <div class="player-direction-pointer" style="
                        position: absolute;
                        top: -10px;
                        left: 50%;
                        transform: translateX(-50%) rotate(${correctedYaw}deg);
                        transform-origin: 50% 28px;
                        width: 0;
                        height: 0;
                        border-left: 6px solid transparent;
                        border-right: 6px solid transparent;
                        border-bottom: 10px solid #55ff55;
                        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
                        transition: transform 0.2s ease-out;
                        z-index: 999;
                    "></div>
                    
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
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });
    },

    refreshPlayersVisibility() {
        if (typeof map === 'undefined') return;

        Object.keys(this.onlinePlayers).forEach(name => {
            const player = this.onlinePlayers[name];
            if (player) {
                this.updatePlayerOnMap(name, player.x, player.z, player.yaw, player.dim);
            }
        });
    },

    updatePlayerOnMap(name, x, z, yaw, playerDim) {
        if (typeof map === 'undefined') return;
        
        if (playerDim !== currentDimension) {
            this.removePlayer(name);
            return;
        }

        const latlng = L.latLng(-z, x); 

        if (this.playerMarkers[name]) {
            this.playerMarkers[name].setLatLng(latlng);
            this.playerMarkers[name].setIcon(this.createPlayerIcon(name, yaw));
        } else {
            const icon = this.createPlayerIcon(name, yaw);
            const marker = L.marker(latlng, { icon: icon, zIndexOffset: 1000 }).addTo(map);
            
            marker.bindTooltip(name, { 
                permanent: true, 
                direction: 'top', 
                offset: [0, -20],
                className: 'player-tooltip'
            });

            this.playerMarkers[name] = marker;
        }
    },

    removePlayer(name) {
        if (this.playerMarkers[name] && typeof map !== 'undefined') {
            map.removeLayer(this.playerMarkers[name]);
            delete this.playerMarkers[name];
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof map !== 'undefined') {
            tracker.init();
        } else {
            console.error("[DolphinGIS] Tracker: map object not found.");
        }
    }, 1000);
});