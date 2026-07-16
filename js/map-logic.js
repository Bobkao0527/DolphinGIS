/**
 * DolphinGIS - 地圖核心邏輯
 */

const BASE_URL = 'https://Bobkao0527.github.io/DolphinGIS/tiles'; 
const TILE_SIZE = 512; 

let map;
window.currentDimension = 'overworld';

const DIMENSIONS = ['overworld', 'the_nether', 'the_end', 'giant', 'mini', 'space', 'survival'];

function matchDimension(rawDim) {
    if (!rawDim) return 'overworld';
    
    let cleaned = rawDim.toLowerCase().trim()
        .replace(/^(minecraft|custom):/, '')
        .replace(/[^a-z0-9]/g, '');

    if (cleaned.includes('nether') || cleaned.includes('hell')) return 'the_nether';
    if (cleaned.includes('end') || cleaned.includes('sky')) return 'the_end';
    if (cleaned.includes('giant') || cleaned.includes('gargantua')) return 'giant';
    if (cleaned.includes('mini')) return 'mini';
    if (cleaned.includes('space') || cleaned.includes('galaxy')) return 'space';
    if (cleaned.includes('survival')) return 'survival';
    if (cleaned.includes('overworld') || cleaned.includes('world') || cleaned.includes('surface')) return 'overworld';

    return 'overworld';
}

function switchMapDimension(rawDim, triggerUI = true) {
    const dim = matchDimension(rawDim);
    if (!DIMENSIONS.includes(dim)) return;
    
    if (window.currentDimension === dim) return;

    console.log(`[DolphinGIS] 切換維度至: ${dim}`);
    window.currentDimension = dim;

    const dimTextEl = document.getElementById('current-dim-text');
    if (dimTextEl) {
        dimTextEl.innerText = `DIMENSION: ${dim.toUpperCase()}`;
    }

    if (triggerUI) {
        const selectEl = document.getElementById('dimension-select');
        if (selectEl) selectEl.value = dim;
    }

    if (window.baseLayer && typeof window.baseLayer.redraw === 'function') {
        window.baseLayer.redraw();
    }

    if (typeof tracker !== 'undefined' && typeof tracker.refreshPlayersVisibility === 'function') {
        tracker.refreshPlayersVisibility();
    }
}

window.switchMapDimension = switchMapDimension;

function initMap() {
    if (!document.getElementById('map')) return;

    map = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: -3, 
        maxZoom: 4, 
        zoomControl: false, 
        attributionControl: false,
        zoomAnimation: true, 
        inertia: true,
        zoomSnap: 1
    }).setView([0, 0], 0);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const MinecraftLayer = L.TileLayer.extend({
        getTileUrl: function(coords) {
            return `${BASE_URL}/${window.currentDimension}/${coords.x},${coords.y}.png`;
        }
    });

    const baseLayer = new MinecraftLayer('', {
        tileSize: TILE_SIZE,
        noWrap: true,
        maxNativeZoom: 0,
        minNativeZoom: 0,
        maxZoom: 4,
        minZoom: -3
    }).addTo(map);
    window.baseLayer = baseLayer;

    window.preloadTilesAt = function(latlng, zoom, padding = 0, timeout = 1200) {
        return new Promise((resolve) => {
            if (!map || !window.baseLayer) return resolve();

            const centerPoint = map.project(latlng, zoom);
            const centerTileX = Math.floor(centerPoint.x / TILE_SIZE);
            const centerTileY = Math.floor(centerPoint.y / TILE_SIZE);

            const sizePx = map.getSize();
            const tilesAcross = Math.ceil(sizePx.x / TILE_SIZE);
            const tilesDown = Math.ceil(sizePx.y / TILE_SIZE);

            const halfX = Math.ceil(tilesAcross / 2) + padding;
            const halfY = Math.ceil(tilesDown / 2) + padding;

            const urls = [];
            for (let dx = -halfX; dx <= halfX; dx++) {
                for (let dy = -halfY; dy <= halfY; dy++) {
                    const x = centerTileX + dx;
                    const y = centerTileY + dy;
                    const url = window.baseLayer.getTileUrl({ x: x, y: y, z: zoom });
                    if (url) urls.push(url);
                }
            }

            if (urls.length === 0) return resolve();

            let loaded = 0;
            let finished = false;

            const checkDone = () => {
                if (finished) return;
                if (loaded >= urls.length) {
                    finished = true;
                    return resolve();
                }
            };

            const to = setTimeout(() => {
                if (finished) return;
                finished = true;
                return resolve();
            }, timeout);

            urls.forEach(u => {
                const img = new Image();
                img.onload = () => {
                    loaded++;
                    checkDone();
                };
                img.onerror = () => {
                    loaded++;
                    checkDone();
                };
                img.src = u;
            });
        });
    };

    map.on('mousemove', function(e) {
        const mcX = Math.round(e.latlng.lng);
        const mcZ = Math.round(-e.latlng.lat); 
        const coordEl = document.getElementById('coords');
        if (coordEl) {
            coordEl.innerHTML = `
                <span class="dim-display" id="current-dim-text">DIMENSION: ${window.currentDimension.toUpperCase()}</span>
                <span>X: ${mcX}, Z: ${mcZ}</span>
            `;
        }
    });

    // 點擊地圖產生標記 (支援 3D 規格坐落點，預設高度為 120)
    map.on('click', function(e) {
        const x = Math.round(e.latlng.lng);
        const y = 120; 
        const z = Math.round(-e.latlng.lat);
        const content = `
            <div style="min-width: 140px;">
                <b style="color: #55ff55;">地圖標記</b>
                <div style="font-size: 11px; color: var(--player-accent); margin-top: 2px;">維度: ${window.currentDimension}</div>
                <div style="font-family: monospace; font-size: 12px; margin-top: 5px; border-top: 1px solid #444; padding-top: 3px; margin-bottom: 5px;">X: ${x}<br>Y: ${y}<br>Z: ${z}</div>
                <button class="teleport-btn" data-x="${x}" data-y="${y}" data-z="${z}" data-dim="${window.currentDimension}" disabled>載入驗證中...</button>
            </div>
        `;
        L.popup().setLatLng(e.latlng).setContent(content).openOn(map);
    });

    map.on('mousedown', () => {
        const list = document.getElementById('results-list');
        if (list) list.style.display = 'none';
    });

    const selectEl = document.getElementById('dimension-select');
    if (selectEl) {
        selectEl.addEventListener('change', (e) => {
            switchMapDimension(e.target.value, false);
        });
    }
}

document.addEventListener('DOMContentLoaded', initMap);

window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
});