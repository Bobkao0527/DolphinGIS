/**
 * DolphinGIS - 全域共用工具函式
 */
(function (global) {
    const HTML_ESCAPE_MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    /**
     * 將字串跳脫為安全的 HTML 內容，避免特殊字元破版或 XSS 風險
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
    }

    /**
     * 依據維度名稱回傳安全預設落點高度 (Y 軸)
     */
    function getSafeDefaultY(dim) {
        const normalized = String(dim || 'overworld')
            .toLowerCase()
            .trim()
            .replace(/^(minecraft|custom):/, '');

        if (normalized === 'the_nether' || normalized === 'nether') return 68;
        if (normalized === 'the_end' || normalized === 'end') return 90;
        if (normalized === 'space') return 64;
        return 120;
    }

    global.dolphinUtils = {
        escapeHtml,
        getSafeDefaultY
    };
    global.escapeHtml = escapeHtml;
})(typeof window !== 'undefined' ? window : globalThis);
