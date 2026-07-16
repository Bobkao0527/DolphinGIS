/**
 * DolphinGIS - 地圖核心邏輯 (多維度支援版)
 */

const BASE_URL = 'https://Bobkao0527.github.io/DolphinGIS/tiles'; 
const TILE_SIZE = 512; 

// 將地圖和當前維度宣告在全域，便於其他 JS 模組共享
let map;
window.currentDimension = 'overworld';

// 支援的七個維度
const DIMENSIONS = ['overworld', 'the_nether', 'the_end', 'giant', 'mini', 'space', 'survival'];

/**
 * 寬限比對 (Fuzzy Match) 函數
 */
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

/**
 * 切換地圖維度功能 (供全域呼叫，包含搜尋自動跳轉維度)
 */
function switchMapDimension(rawDim, triggerUI = true) {
    const dim = matchDimension(rawDim);
    if (!DIMENSIONS.includes(dim)) return;
    
    if (window.currentDimension === dim) return;

    console.log(`[DolphinGIS] 切換維度至: ${dim}`);
    window.currentDimension = dim;

    // 更新地圖下方的維度顯示
    const dimTextEl = document.getElementById('current-dim-text');
    if (dimTextEl) {
        dimTextEl.innerText = `DIMENSION: ${dim.toUpperCase()}`;
    }

    // 1. 同步下拉選單 UI
    if (triggerUI) {
        const selectEl = document.getElementById('dimension-select');
        if (selectEl) selectEl.value = dim;
    }

    // 2. 觸發底圖重繪以讀取新維度的資料夾
    if (window.baseLayer && typeof window.baseLayer.redraw === 'function') {
        window.baseLayer.redraw();
    }

    // 3. 呼叫 Tracker 更新，刷新當前維度下的玩家可見度
    if (typeof tracker !== 'undefined' && typeof tracker.refreshPlayersVisibility === 'function') {
        tracker.refreshPlayersVisibility();
    }
}

// 綁定到 window 使其成為全域全功能函式
window.switchMapDimension = switchMapDimension;

// 初始化函數
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

    // 自定義 Minecraft 多維度圖層類別
    const MinecraftLayer = L.TileLayer.extend({
        getTileUrl: function(coords) {
            // tiles 下將會細分：tiles/overworld/、tiles/the_nether/...
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

    // 預載圖塊邏輯
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

    // 更新座標顯示
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

    // 點擊地圖產生標記
    map.on('click', function(e) {
        const x = Math.round(e.latlng.lng);
        const z = Math.round(-e.latlng.lat);
        const content = `
            <div style="min-width: 100px;">
                <b style="color: #55ff55;">地圖標記</b>
                <div style="font-size: 11px; color: var(--player-accent); margin-top: 2px;">維度: ${window.currentDimension}</div>
                <div style="font-family: monospace; font-size: 12px; margin-top: 5px; border-top: 1px solid #444; padding-top: 3px;">X: ${x}<br>Z: ${z}</div>
            </div>
        `;
        L.popup().setLatLng(e.latlng).setContent(content).openOn(map);
    });

    // 點擊地圖時隱藏搜尋結果
    map.on('mousedown', () => {
        const list = document.getElementById('results-list');
        if (list) list.style.display = 'none';
    });

    // 綁定 UI 下拉選單切換維度事件
    const selectEl = document.getElementById('dimension-select');
    if (selectEl) {
        selectEl.addEventListener('change', (e) => {
            switchMapDimension(e.target.value, false);
        });
    }
}

// 確保網頁結構載入後才執行初始化
document.addEventListener('DOMContentLoaded', initMap);

// 視窗大小變更處理
window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
});