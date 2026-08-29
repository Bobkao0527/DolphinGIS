/**
 * DolphinGIS - 建物搜尋與 CSV 解析邏輯 (全新支援 X, Y, Z 三維定位與彈出卡片按鈕簡化)
 */

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR9jvxjv3NxZ8dJ__TFMeimgwndvnd3cCG755Nt3Pq46K7AktqYUqFn43PEEgkQpeWbIMHiKcaTIMGH/pub?output=csv';
let buildingData = [];

const DIM_ZH_NAMES = {
    'overworld': '主世界',
    'the_nether': '地獄',
    'the_end': '終界',
    'giant': '巨人',
    'mini': '縮微',
    'space': '太空',
    'survival': '生存'
};

function resolveSafeY(rawY, dim = 'overworld') {
    const value = Number(rawY);
    if (Number.isFinite(value)) return value;

    const lower = String(dim || 'overworld').toLowerCase();
    if (lower.includes('nether') || lower.includes('end')) return 120;
    return 120;
}

function getBuildingDimension(id) {
    if (!id) return 'overworld';
    const prefix = id.trim().toUpperCase().substring(0, 3);
    
    switch (prefix) {
        case 'NET': return 'the_nether';
        case 'END': return 'the_end';
        case 'GIA': return 'giant';
        case 'MIN': return 'mini';
        case 'SPA': return 'space';
        case 'SUR': return 'survival';
        default: return 'overworld';
    }
}

function parseCSVLine(text) {
    const re_valid = /^\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*(?:,\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*)*$/;
    const re_value = /(?!\s*$)\s*(?:'([^'\\]*(?:\\[\S\s][^'\\]*)*)'|"([^"\\]*(?:\\[\S\s][^"\\]*)*)"|([^,'"\s\\]*(?:\s+[^,'"\s\\]+)*))\s*(?:,|$)/g;
    if (!re_valid.test(text)) return [];
    const a = [];
    text.replace(re_value, (m0, m1, m2, m3) => {
        if (m1 !== undefined) a.push(m1.replace(/\\'/g, "'"));
        else if (m2 !== undefined) a.push(m2.replace(/\\"/g, '"'));
        else if (m3 !== undefined) a.push(m3);
        return '';
    });
    return a;
}

async function fetchBuildingData() {
    const loader = document.getElementById('loading-indicator');
    if (loader) loader.style.display = 'block';
    try {
        const response = await fetch(CSV_URL);
        const csvText = await response.text();
        const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== "");
        
        buildingData = lines.slice(1).map(line => {
            const cols = parseCSVLine(line);
            if (cols.length < 5) return null;
            const id = cols[0];
            const rawCoords = cols[1]; 
            const name = cols[2];
            const addr = cols[3];
            const type = cols[4];
            let x = NaN, y = NaN, z = NaN;
            if (rawCoords) {
                const cleanCoords = rawCoords.replace(/[()]/g, ''); 
                const parts = cleanCoords.split(/[, ]+/).filter(p => p !== "");
                
                // 🧭 支援 X, Y, Z 的三維格式解析
                if (parts.length >= 3) {
                    x = parseFloat(parts[0]);
                    y = parseFloat(parts[1]);
                    z = parseFloat(parts[2]);
                } else if (parts.length === 2) {
                    // 若只有 X, Z 軸，保留高處安全落點，避免直接窒息
                    x = parseFloat(parts[0]);
                    y = 120;
                    z = parseFloat(parts[1]);
                }
            }
            return { id, x, y, z, name, addr, type };
        }).filter(b => b !== null && !isNaN(b.x) && !isNaN(b.z));

        if (loader) {
            loader.innerHTML = `已同步 ${buildingData.length} 筆建物資料`;
            setTimeout(() => loader.style.display = 'none', 3000);
        }
    } catch (error) {
        if (loader) loader.innerHTML = "資料同步失敗";
    }
}

function getPlayerSearchResults(query) {
    if (typeof tracker === 'undefined' || !tracker.getOnlinePlayers) return [];
    return tracker.getOnlinePlayers()
        .filter(player => player && player.name && player.name.toLowerCase().includes(query))
        .map(player => {
            const dimName = DIM_ZH_NAMES[player.dim] || player.dim.toUpperCase();
            return {
                type: 'player',
                name: player.name,
                x: player.x,
                y: resolveSafeY(player.y, player.dim),
                z: player.z,
                dim: player.dim, 
                displayName: player.name,
                addr: `在線玩家 (${dimName})`
            };
        });
}

function getBuildingSearchResults(query) {
    return buildingData.filter(b => 
        (b.id && b.id.toLowerCase().includes(query)) || 
        (b.name && b.name.toLowerCase().includes(query)) || 
        (b.addr && b.addr.toLowerCase().includes(query))
    ).map(b => {
        const detectedDim = getBuildingDimension(b.id);
        const dimName = DIM_ZH_NAMES[detectedDim] || '未知維度';
        return {
            type: 'building',
            name: b.name,
            x: b.x,
            y: b.y,
            z: b.z,
            dim: detectedDim, 
            addr: b.addr,
            typeLabel: b.type,
            id: b.id,
            displayName: b.name || '未命名建物',
            dimLabel: dimName
        };
    });
}

function navigateToSearchResult(result) {
    if (!result) return;
    
    if (result.dim && typeof window.switchMapDimension === 'function') {
        window.switchMapDimension(result.dim);
    }

    goToLocation(result.x, result.y, result.z, result.name, result.addr, result.type === 'player' ? '在線玩家' : result.typeLabel, result.type === 'player' ? result.name : result.id, result.dim);
}

function executeSearch() {
    const input = document.getElementById('search-input');
    const query = input ? input.value.trim().toLowerCase() : '';
    if (!query) return;

    const coordMatch = query.match(/^(-?\d+(\.\d+)?)[, ]+(-?\d+(\.\d+)?)([, ]+(-?\d+(\.\d+)?))?$/);
    if (coordMatch) {
        const parsedX = parseFloat(coordMatch[1]);
        let parsedY = 120;
        let parsedZ = parseFloat(coordMatch[3]);
        
        // 若輸入 "X Y Z" 或 "X, Y, Z"
        if (coordMatch[5] !== undefined) {
            parsedY = parseFloat(coordMatch[3]);
            parsedZ = parseFloat(coordMatch[6]);
        }
        
        goToLocation(parsedX, parsedY, parsedZ, "手動定位", "", "座標點", "", window.currentDimension || 'overworld');
        return;
    }

    const playerResults = getPlayerSearchResults(query);
    const buildingResults = getBuildingSearchResults(query);
    const results = [...playerResults, ...buildingResults];

    if (results.length === 1) {
        navigateToSearchResult(results[0]);
    } else if (results.length > 1) {
        showResultsList(results);
    }
}

function handleSearchInput() {
    const input = document.getElementById('search-input');
    const query = input ? input.value.trim().toLowerCase() : '';
    const list = document.getElementById('results-list');
    if (!list) return;

    if (query.length < 1) {
        list.style.display = 'none';
        return;
    }

    const playerResults = getPlayerSearchResults(query).slice(0, 10);
    const buildingResults = getBuildingSearchResults(query).slice(0, 10);
    const results = [...playerResults, ...buildingResults].slice(0, 15);

    if (results.length > 0) {
        showResultsList(results);
    } else {
        list.style.display = 'none';
    }
}

function showResultsList(results) {
    const list = document.getElementById('results-list');
    if (!list) return;
    list.innerHTML = '';
    list.style.display = 'block';
    
    results.forEach(res => {
        const item = document.createElement('div');
        item.className = 'result-item';
        const isPlayer = res.type === 'player';
        const labelText = isPlayer ? '在線玩家' : `#${res.id} (${res.dimLabel})`;
        
        item.innerHTML = `
            <div class="item-header">
                <strong>${res.displayName || res.name || '未命名建物'}</strong>
                <span class="item-id" style="color: ${isPlayer ? 'var(--player-accent)' : 'var(--accent)'}">${labelText}</span>
            </div>
            <span class="item-addr">${res.addr || '無地址資訊'}</span>
        `;
        item.onclick = () => {
            const input = document.getElementById('search-input');
            if (input) input.value = res.displayName || res.name;
            navigateToSearchResult(res);
        };
        list.appendChild(item);
    });
}

// 導航跳轉 (帶入 X, Y, Z 三維數據，並調整按鈕簡化為「傳送」)
async function goToLocation(x, y, z, name, addr = "", type = "", id = "", dim = "overworld") {
    const targetLatLng = L.latLng(-z, x);
    const list = document.getElementById('results-list');
    if (list) list.style.display = 'none';

    const desiredZoom = 4;
    try {
        if (window.preloadTilesAt) {
            await window.preloadTilesAt(targetLatLng, desiredZoom, 1, 900);
        }
    } catch (e) {
        console.warn('[DolphinGIS] preload failed', e);
    }

    map.flyTo(targetLatLng, desiredZoom, { animate: true, duration: 1.2 });

    setTimeout(() => {
        const dimDisplay = DIM_ZH_NAMES[dim] || dim.toUpperCase();
        const content = `
            <div style="min-width: 140px;">
                <div style="font-size: 10px; color: #55ff55; margin-bottom: 2px;">
                    [${dimDisplay}] ${type || '建物'} ${id ? '#' + id : ''}
                </div>
                <b style="font-size: 14px; color: #55ff55;">${name || '定位點'}</b>
                <div style="font-size: 12px; margin: 5px 0; opacity: 0.8;">${addr}</div>
                <div style="font-family: monospace; font-size: 11px; border-top: 1px solid #444; padding-top: 5px; margin-top: 5px; margin-bottom: 8px;">
                    X: ${Math.round(x)}, Y: ${Math.round(y)}, Z: ${Math.round(z)}
                </div>
                <button class="teleport-btn" data-x="${x}" data-y="${y}" data-z="${z}" data-dim="${dim}" disabled>載入驗證中...</button>
            </div>
        `;
        L.popup().setLatLng(targetLatLng).setContent(content).openOn(map);
    }, 1200);
}

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');

    if (searchInput) {
        searchInput.addEventListener('input', handleSearchInput);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeSearch();
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', executeSearch);
    }

    fetchBuildingData();
});