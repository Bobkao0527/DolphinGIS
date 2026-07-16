/**
 * DolphinGIS - 地圖核心邏輯
 */

const BASE_URL = 'https://Bobkao0527.github.io/DolphinGIS/tiles'; 
const TILE_SIZE = 512; 

// 將變數宣告在外部，方便其他 .js 檔案存取
let map;

// 當前啟用的維度
let currentDimension = 'overworld';

// 定義目前支援的七個主要維度
const DIMENSIONS = ['overworld', 'the_nether', 'the_end', 'giant', 'mini', 'space', 'survival'];

/**
 * 寬限比對 (Fuzzy Match) 函數
 * 用於比對 GPS 傳來的字串，解析其屬於哪一個維度
 */
function matchDimension(rawDim) {
    if (!rawDim) return 'overworld';
    
    // 清理字串：大寫轉小寫，去空格，移除 minecraft: 或 custom: 等常見命名空間前綴
    let cleaned = rawDim.toLowerCase().trim()
        .replace(/^(minecraft|custom):/, '') // 移除前綴
        .replace(/[^a-z0-9]/g, '');         // 只保留字母與數字，這樣有沒有下底線都能比對

    // 各維度的寬限代稱對應
    if (cleaned.includes('nether') || cleaned.includes('hell')) return 'the_nether';
    if (cleaned.includes('end') || cleaned.includes('sky')) return 'the_end';
    if (cleaned.includes('giant') || cleaned.includes('gargantua')) return 'giant';
    if (cleaned.includes('mini')) return 'mini';
    if (cleaned.includes('space') || cleaned.includes('galaxy')) return 'space';
    if (cleaned.includes('survival')) return 'survival';
    if (cleaned.includes('overworld') || cleaned.includes('world') || cleaned.includes('surface')) return 'overworld';

    // 預設 fallback 為 overworld
    return 'overworld';
}

/**
 * 切換地圖維度功能
 * @param {string} rawDim - 目標維度字串
 * @param {boolean} triggerUI - 是否一併同步更新下拉選單 UI (避免遞迴死循環)
 */
function switchMapDimension(rawDim, triggerUI = true) {
    const dim = matchDimension(rawDim);
    if (!DIMENSIONS.includes(dim)) return;
    
    if (currentDimension === dim) return; // 沒變就不重複重載

    console.log(`[DolphinGIS] 切換維度至: ${dim}`);
    currentDimension = dim;

    // 更新地圖顯示資訊
    const dimTextEl = document.getElementById('current-dim-text');
    if (dimTextEl) {
        dimTextEl.innerText = `DIMENSION: ${dim.toUpperCase()}`;
    }

    // 1. 同步下拉選單 UI
    if (triggerUI) {
        const selectEl = document.getElementById('dimension-select');
        if (selectEl) selectEl.value = dim;
    }

    // 2. 觸發 Leaflet 底圖重繪路徑
    if (window.baseLayer && typeof window.baseLayer.redraw === 'function') {
        window.baseLayer.redraw();
    }

    // 3. 呼叫 Tracker 更新，因為切換了維度，需要刷新當前視野內的玩家標記
    if (typeof tracker !== 'undefined' && typeof tracker.refreshPlayersVisibility === 'function') {
        tracker.refreshPlayersVisibility();
    }
}

// 初始化函數
function initMap() {
    // 確保 id="map" 的元素存在
    if (!document.getElementById('map')) return;

    // 初始化 Leaflet 地圖
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

    // 將縮放控制鈕移到右下角
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // 自定義 Minecraft 圖層類別，網址引入當前維度資料夾
    const MinecraftLayer = L.TileLayer.extend({
        getTileUrl: function(coords) {
            // tiles 資料夾下，新增對應維度的子資料夾：e.g., /tiles/the_nether/0,0.png
            return `${BASE_URL}/${currentDimension}/${coords.x},${coords.y}.png`;
        }
    });

    // 加入底圖，並保留參考以便其他模組使用（例如預載 tiles）
    const baseLayer = new MinecraftLayer('', {
        tileSize: TILE_SIZE,
        noWrap: true,
        maxNativeZoom: 0,
        minNativeZoom: 0,
        maxZoom: 4,
        minZoom: -3
    }).addTo(map);
    // 暴露給全域以供其他檔案存取
    window.baseLayer = baseLayer;

    /**
     * 預載指定中心與縮放等級周圍的圖塊
     */
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
                <span class="dim-display" id="current-dim-text">DIMENSION: ${currentDimension.toUpperCase()}</span>
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
                <div style="font-size: 11px; color: var(--player-accent); margin-top: 2px;">維度: ${currentDimension}</div>
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