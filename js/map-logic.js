/**
 * DolphinGIS - 地圖核心邏輯
 */

const BASE_URL = 'https://Bobkao0527.github.io/DolphinGIS/tiles'; 
const TILE_SIZE = 512; 

// 將變數宣告在外部，方便其他 .js 檔案存取
let map;

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

    // 自定義 Minecraft 圖層類別
    const MinecraftLayer = L.TileLayer.extend({
        getTileUrl: function(coords) {
            return `${BASE_URL}/${coords.x},${coords.y}.png`;
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
     * latlng: L.LatLng 要預載的中心
     * zoom: 目標縮放等級
     * padding: 圖塊半徑 (以 tile 為單位)，預設 1
     * timeout: 最長等待毫秒數
     * 回傳 Promise，在圖塊載入完成或逾時時 resolve
     */
    window.preloadTilesAt = function(latlng, zoom, padding = 0, timeout = 1200) {
        return new Promise((resolve) => {
            if (!map || !window.baseLayer) return resolve();

            // 將中心 latlng 投影到指定 zoom 的像素座標
            const centerPoint = map.project(latlng, zoom);
            const centerTileX = Math.floor(centerPoint.x / TILE_SIZE);
            const centerTileY = Math.floor(centerPoint.y / TILE_SIZE);

            // 估算視窗在該 zoom 下的 tile 範圍（使用當前 map.size 作為 viewport 尺寸）
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
        if (coordEl) coordEl.innerHTML = `X: ${mcX}, Z: ${mcZ}`;
    });

    // 點擊地圖產生標記
    map.on('click', function(e) {
        const x = Math.round(e.latlng.lng);
        const z = Math.round(-e.latlng.lat);
        const content = `
            <div style="min-width: 100px;">
                <b style="color: #55ff55;">地圖標記</b>
                <div style="font-family: monospace; font-size: 12px; margin-top: 5px;">X: ${x}<br>Z: ${z}</div>
            </div>
        `;
        L.popup().setLatLng(e.latlng).setContent(content).openOn(map);
    });

    // 點擊地圖時隱藏搜尋結果
    map.on('mousedown', () => {
        const list = document.getElementById('results-list');
        if (list) list.style.display = 'none';
    });
}

// 確保網頁結構載入後才執行初始化
document.addEventListener('DOMContentLoaded', initMap);

// 視窗大小變更處理
window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
});
