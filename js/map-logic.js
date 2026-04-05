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

    // 加入底圖
    new MinecraftLayer('', {
        tileSize: TILE_SIZE,
        noWrap: true,
        maxNativeZoom: 0,
        minNativeZoom: 0,
        maxZoom: 4,
        minZoom: -3
    }).addTo(map);

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
