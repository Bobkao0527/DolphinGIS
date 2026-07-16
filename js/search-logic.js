/**
 * DolphinGIS - 建物搜尋與 CSV 解析邏輯 (支援 ID 維度自動辨識與跳轉)
 */

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR9jvxjv3NxZ8dJ__TFMeimgwndvnd3cCG755Nt3Pq46K7AktqYUqFn43PEEgkQpeWbIMHiKcaTIMGH/pub?output=csv';
let buildingData = [];

// 中文化維度名稱對照表 (UI 顯示用)
const DIM_ZH_NAMES = {
    'overworld': '主世界',
    'the_nether': '地獄',
    'the_end': '終界',
    'giant': '巨人',
    'mini': '縮微',
    'space': '太空',
    'survival': '生存'
};

/**
 * 依據建物編號 (ID) 規則分析其所屬維度
 * 規則：
 * - NET 開頭 -> 地獄 (the_nether)
 * - END 開頭 -> 終界 (the_end)
 * - GIA 開頭 -> 巨人 (giant)
 * - MIN 開頭 -> 縮微 (mini)
 * - SPA 開頭 -> 太空 (space)
 * - SUR 開頭 -> 生存 (survival)
 * - 其餘 (如 1英文+5數字) -> 主世界 (overworld)
 */
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

// 解析 CSV 格式 (處理逗號與引號)
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

// 從 Google Sheets 同步資料
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
            let x = NaN, z = NaN;
            if (rawCoords) {
                const cleanCoords = rawCoords.replace(/[()]/g, ''); 
                const parts = cleanCoords.split(/[, ]+/).filter(p => p !== "");
                if (parts.length >= 2) {
                    x = parseFloat(parts[0]);
                    z = parseFloat(parts[1]);
                }
            }
            return { id, x, z, name, addr, type };
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
                z: player.z,
                dim: player.dim, // 玩家定位本身的維度
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
            z: b.z,
            dim: detectedDim, // 解析出的建物維度
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
    
    // 🌍 核心邏輯：跳轉前先切換至目標物件 (玩家或建物) 所在的維度
    if (result.dim && typeof window.switchMapDimension === 'function') {
        window.switchMapDimension(result.dim);
    }

    if (result.type === 'player') {
        goToLocation(result.x, result.z, result.name, result.addr, '在線玩家', result.name, result.dim);
    } else {
        goToLocation(result.x, result.z, result.name, result.addr, result.typeLabel, result.id, result.dim);
    }
}

// 執行搜尋跳轉
function executeSearch() {
    const input = document.getElementById('search-input');
    const query = input ? input.value.trim().toLowerCase() : '';
    if (!query) return;

    // 支援直接輸入座標 "X, Z" (預設在當前維度)
    const coordMatch = query.match(/^(-?\d+(\.\d+)?)[, ]+(-?\d+(\.\d+)?)$/);
    if (coordMatch) {
        goToLocation(parseFloat(coordMatch[1]), parseFloat(coordMatch[3]), "手動定位", "", "座標點", "", window.currentDimension || 'overworld');
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

// 處理輸入時的即時建議
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

// 顯示搜尋結果清單
function showResultsList(results) {
    const list = document.getElementById('results-list');
    if (!list) return;
    list.innerHTML = '';
    list.style.display = 'block';
    
    results.forEach(res => {
        const item = document.createElement('div');
        item.className = 'result-item';
        const isPlayer = res.type === 'player';
        
        // 顯示 ID 與維度中文化標籤
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

// 地圖跳轉與氣泡框功能
async function goToLocation(x, z, name, addr = "", type = "", id = "", dim = "overworld") {
    const targetLatLng = L.latLng(-z, x);
    const list = document.getElementById('results-list');
    if (list) list.style.display = 'none';

    const desiredZoom = 4;
    try {
        if (window.preloadTilesAt) {
            // 先預載目標視野的高解析圖塊，再跳轉
            await window.preloadTilesAt(targetLatLng, desiredZoom, 1, 900);
        }
    } catch (e) {
        console.warn('[DolphinGIS] preload failed', e);
    }

    map.flyTo(targetLatLng, desiredZoom, { animate: true, duration: 1.2 });

    setTimeout(() => {
        const dimDisplay = DIM_ZH_NAMES[dim] || dim.toUpperCase();
        const content = `
            <div>
                <div style="font-size: 10px; color: #55ff55; margin-bottom: 2px;">
                    [${dimDisplay}] ${type || '建物'} ${id ? '#' + id : ''}
                </div>
                <b style="font-size: 14px; color: #55ff55;">${name || '定位點'}</b>
                <div style="font-size: 12px; margin: 5px 0; opacity: 0.8;">${addr}</div>
                <div style="font-family: monospace; font-size: 11px; border-top: 1px solid #444; padding-top: 5px; margin-top: 5px;">
                    X: ${x}, Z: ${z}
                </div>
            </div>
        `;
        L.popup().setLatLng(targetLatLng).setContent(content).openOn(map);
    }, 1200);
}

// 綁定事件
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

    // 初始化資料抓取
    fetchBuildingData();
});