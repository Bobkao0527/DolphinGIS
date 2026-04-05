/**
 * DolphinGIS - 建物搜尋與 CSV 解析邏輯
 */

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR9jvxjv3NxZ8dJ__TFMeimgwndvnd3cCG755Nt3Pq46K7AktqYUqFn43PEEgkQpeWbIMHiKcaTIMGH/pub?output=csv';
let buildingData = [];

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

// 執行搜尋跳轉
function executeSearch() {
    const input = document.getElementById('search-input');
    const query = input ? input.value.trim().toLowerCase() : '';
    if (!query) return;

    // 支援直接輸入座標 "X, Z"
    const coordMatch = query.match(/^(-?\d+(\.\d+)?)[, ]+(-?\d+(\.\d+)?)$/);
    if (coordMatch) {
        goToLocation(parseFloat(coordMatch[1]), parseFloat(coordMatch[3]), "手動定位");
        return;
    }

    const results = buildingData.filter(b => 
        (b.id && b.id.toLowerCase().includes(query)) || 
        (b.name && b.name.toLowerCase().includes(query)) || 
        (b.addr && b.addr.toLowerCase().includes(query))
    );

    if (results.length === 1) {
        const b = results[0];
        goToLocation(b.x, b.z, b.name, b.addr, b.type, b.id);
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

    const results = buildingData.filter(b => 
        (b.id && b.id.toLowerCase().includes(query)) || 
        (b.name && b.name.toLowerCase().includes(query)) || 
        (b.addr && b.addr.toLowerCase().includes(query))
    ).slice(0, 15);

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
        item.innerHTML = `
            <div class="item-header">
                <strong>${res.name || '未命名建物'}</strong>
                <span class="item-id">#${res.id}</span>
            </div>
            <span class="item-addr">${res.addr || '無地址資訊'}</span>
        `;
        item.onclick = () => {
            const input = document.getElementById('search-input');
            if (input) input.value = res.name;
            goToLocation(res.x, res.z, res.name, res.addr, res.type, res.id);
        };
        list.appendChild(item);
    });
}

// 地圖跳轉功能
function goToLocation(x, z, name, addr = "", type = "", id = "") {
    const targetLatLng = L.latLng(-z, x);
    const list = document.getElementById('results-list');
    if (list) list.style.display = 'none';
    
    map.flyTo(targetLatLng, 4, { animate: true, duration: 1.2 }); 
    
    setTimeout(() => {
        const content = `
            <div>
                <div style="font-size: 10px; color: #55ff55; margin-bottom: 2px;">${type || '建物'} ${id ? '#' + id : ''}</div>
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
