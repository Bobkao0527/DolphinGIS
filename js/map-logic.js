/**
 * DolphinGIS - 地圖核心邏輯
 */

const BASE_URL = './tiles';
const TILE_SIZE = 512; 
const NATIVE_ZOOM = 0;
const PRELOAD_CONCURRENCY = 4;
const MAX_PRELOAD_TILES = 32;
const PRELOAD_CACHE_LIMIT = 64;

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

    if (map && typeof map.closePopup === 'function') {
        map.closePopup();
    }

    if (typeof tracker !== 'undefined' && typeof tracker.refreshPlayersVisibility === 'function') {
        tracker.refreshPlayersVisibility();
    }

    if (window.dolphin3D && typeof window.dolphin3D.onDimensionChanged === 'function') {
        window.dolphin3D.onDimensionChanged(dim);
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
    window.leafletMap = map;

    const mapContainer = map.getContainer();
    let pendingPan = [0, 0];
    let panFrame = null;

    mapContainer.addEventListener('wheel', (event) => {
        const isPinch = event.ctrlKey || event.metaKey;
        const isLikelyMouseWheel = event.deltaX === 0 && (
            (typeof event.wheelDeltaY === 'number' && event.wheelDeltaY !== 0 && event.wheelDeltaY % 120 === 0) ||
            Math.abs(event.deltaY) >= 80
        );
        const isTrackpad = event.deltaMode === 0 && !isLikelyMouseWheel;

        if (!isTrackpad || isPinch) return;

        event.preventDefault();
        event.stopPropagation();
        pendingPan[0] += event.deltaX;
        pendingPan[1] += event.deltaY;
        if (panFrame === null) {
            panFrame = requestAnimationFrame(() => {
                map.panBy(pendingPan, { animate: false });
                pendingPan = [0, 0];
                panFrame = null;
            });
        }
    }, { capture: true, passive: false });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const MinecraftLayer = L.TileLayer.extend({
        getTileUrl: function(coords) {
            return `${BASE_URL}/${window.currentDimension}/${coords.x},${coords.y}.webp`;
        }
    });

    const baseLayer = new MinecraftLayer('', {
        tileSize: TILE_SIZE,
        noWrap: true,
        keepBuffer: 1,
        updateWhenIdle: false,
        updateWhenZooming: false,
        maxNativeZoom: 0,
        minNativeZoom: 0,
        maxZoom: 4,
        minZoom: -3
    }).addTo(map);
    window.baseLayer = baseLayer;

    const preloadEntries = new Map();
    let preloadGeneration = 0;
    let cancelActivePreload = () => {};

    const trimPreloadCache = () => {
        while (preloadEntries.size > PRELOAD_CACHE_LIMIT) {
            const oldestKey = preloadEntries.keys().next().value;
            preloadEntries.delete(oldestKey);
        }
    };

    window.preloadTilesAt = function(latlng, zoom, padding = 0, timeout = 1200) {
        cancelActivePreload();
        const generation = ++preloadGeneration;

        return new Promise((resolve) => {
            if (!map || !window.baseLayer) return resolve();

            // TileLayer only has native tile coordinates at z0. Scale the viewport
            // down so a high display zoom does not accidentally preload the whole map.
            const centerPoint = map.project(latlng, NATIVE_ZOOM);
            const centerTileX = Math.floor(centerPoint.x / TILE_SIZE);
            const centerTileY = Math.floor(centerPoint.y / TILE_SIZE);
            const zoomScale = Math.pow(2, Math.max(0, zoom - NATIVE_ZOOM));
            const sizePx = map.getSize();
            const halfX = Math.ceil(sizePx.x / zoomScale / TILE_SIZE / 2) + padding;
            const halfY = Math.ceil(sizePx.y / zoomScale / TILE_SIZE / 2) + padding;
            const candidates = [];

            for (let dx = -halfX; dx <= halfX; dx++) {
                for (let dy = -halfY; dy <= halfY; dy++) {
                    const x = centerTileX + dx;
                    const y = centerTileY + dy;
                    const url = window.baseLayer.getTileUrl({ x, y, z: NATIVE_ZOOM });
                    candidates.push({ url, distance: Math.abs(dx) + Math.abs(dy) });
                }
            }

            candidates.sort((left, right) => left.distance - right.distance);
            const urls = [...new Map(candidates.map(candidate => [candidate.url, candidate])).values()]
                .slice(0, MAX_PRELOAD_TILES);
            if (urls.length === 0) return resolve();

            let nextIndex = 0;
            let active = 0;
            let resolved = false;
            let aborted = false;
            let centerFinished = false;
            const activeImages = new Set();
            const centerUrl = urls[0] && urls[0].url;

            const cancelImages = () => {
                activeImages.forEach((image) => {
                    image.onload = null;
                    image.onerror = null;
                    image.src = '';
                });
                activeImages.clear();
            };

            const cleanupRef = () => {
                if (cancelActivePreload === cancelThis) cancelActivePreload = () => {};
            };

            const resolveOnce = () => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeoutId);
                resolve();
            };

            const abortPreload = () => {
                if (aborted) return;
                aborted = true;
                clearTimeout(timeoutId);
                cancelImages();
                cleanupRef();
                resolveOnce();
            };

            const cancelThis = () => abortPreload();
            const timeoutId = setTimeout(abortPreload, timeout);
            cancelActivePreload = cancelThis;

            const pump = () => {
                if (aborted || generation !== preloadGeneration) {
                    abortPreload();
                    return;
                }
                while (active < PRELOAD_CONCURRENCY && nextIndex < urls.length) {
                    const url = urls[nextIndex++].url;
                    const cached = preloadEntries.get(url);
                    if (cached && cached.expiresAt > Date.now()) {
                        if (url === centerUrl) centerFinished = true;
                        continue;
                    }

                    active++;
                    const image = new Image();
                    activeImages.add(image);
                    image.decoding = 'async';
                    image.fetchPriority = url === centerUrl ? 'high' : 'low';
                    const complete = () => {
                        if (aborted) return;
                        active--;
                        activeImages.delete(image);
                        preloadEntries.delete(url);
                        preloadEntries.set(url, { expiresAt: Date.now() + 2000 });
                        trimPreloadCache();

                        if (url === centerUrl) {
                            centerFinished = true;
                            resolveOnce();
                        }

                        if (nextIndex >= urls.length && active === 0) {
                            cleanupRef();
                            resolveOnce();
                        } else {
                            pump();
                        }
                        image.onload = null;
                        image.onerror = null;
                        image.src = '';
                    };
                    image.onload = complete;
                    image.onerror = complete;
                    image.src = url;
                }

                if (centerFinished) resolveOnce();
                if (nextIndex >= urls.length && active === 0) {
                    cleanupRef();
                    resolveOnce();
                }
            };

            pump();
        });
    };

    map.on('mousemove', function(e) {
        const mcX = Math.round(e.latlng.lng);
        const mcZ = Math.round(-e.latlng.lat);
        const dimTextEl = document.getElementById('current-dim-text');
        const coordsXyzEl = document.getElementById('coords-xyz');
        const dimLabel = `DIMENSION: ${window.currentDimension.toUpperCase()}`;
        const xyzLabel = `X: ${mcX}, Z: ${mcZ}`;
        if (dimTextEl && dimTextEl.textContent !== dimLabel) {
            dimTextEl.textContent = dimLabel;
        }
        if (coordsXyzEl && coordsXyzEl.textContent !== xyzLabel) {
            coordsXyzEl.textContent = xyzLabel;
        }
    });

    // 點擊地圖產生標記：依維度選擇安全落點高度，避免窒息或逼近地獄基岩頂
    map.on('click', function(e) {
        const x = Math.round(e.latlng.lng);
        const y = window.dolphinUtils ? window.dolphinUtils.getSafeDefaultY(window.currentDimension) : 120;
        const z = Math.round(-e.latlng.lat);
        const escape = window.escapeHtml || ((s) => String(s ?? ''));
        const safeDim = escape(window.currentDimension);
        const content = `
            <div style="min-width: 140px;">
                <b style="color: #55ff55;">地圖標記</b>
                <div style="font-size: 11px; color: var(--player-accent); margin-top: 2px;">維度: ${safeDim}</div>
                <div style="font-family: monospace; font-size: 12px; margin-top: 5px; border-top: 1px solid #444; padding-top: 3px; margin-bottom: 5px;">X: ${x}<br>Y: ${y}<br>Z: ${z}</div>
                <button class="teleport-btn" data-x="${x}" data-y="${y}" data-z="${z}" data-dim="${safeDim}" disabled>載入驗證中...</button>
                <button class="enter-3d-btn" data-x="${x}" data-y="${y}" data-z="${z}" data-dim="${safeDim}" data-name="地圖標記">🧊 3D 檢視</button>
            </div>
        `;
        L.popup().setLatLng(e.latlng).setContent(content).openOn(map);
    });

    document.addEventListener('click', (event) => {
        const btn = event.target.closest('.enter-3d-btn');
        if (!btn) return;
        event.preventDefault();
        event.stopPropagation();
        const tx = parseFloat(btn.getAttribute('data-x'));
        const ty = parseFloat(btn.getAttribute('data-y'));
        const tz = parseFloat(btn.getAttribute('data-z'));
        const tdim = btn.getAttribute('data-dim') || window.currentDimension || 'overworld';
        const tname = btn.getAttribute('data-name') || '定位點';
        if (window.dolphin3D && typeof window.dolphin3D.enter3D === 'function') {
            window.dolphin3D.enter3D({
                dim: tdim,
                x: tx,
                y: ty,
                z: tz,
                card: {
                    badge: `[${tdim.toUpperCase()}] 定位座標`,
                    title: tname,
                    addr: '',
                    x: tx,
                    y: ty,
                    z: tz,
                    dim: tdim
                }
            });
        }
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