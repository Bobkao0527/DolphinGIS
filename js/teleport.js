/**
 * DolphinGIS - 即時傳送系統 (安全 RCON Workers 代理版)
 * 負責指令編譯、發送請求與全域彈出視窗按鈕生命週期綁定
 */

const COMMAND_GATEWAY = "https://servercommand.bobkao0527.workers.dev/command";

const teleportSystem = {
    isSending: false,

    init() {
        console.log("[DolphinGIS] Teleport: System initialized. Listening to popup events...");
        this.bindGlobalPopupWatcher();
    },

    /**
     * 寬限比對並返回 Minecraft 的完整命名空間維度 ID
     */
    getMinecraftDimensionID(dim) {
        const lower = (dim || 'overworld').toLowerCase();
        if (lower === 'the_nether' || lower === 'nether') return 'minecraft:the_nether';
        if (lower === 'the_end' || lower === 'end') return 'minecraft:the_end';
        if (lower === 'overworld') return 'minecraft:overworld';
        
        // 對於 giant, mini, space, survival 則使用 minecraft:<dim> 命名空間
        return `minecraft:${lower}`;
    },

    /**
     * 發送傳送指令
     * @param {number} x - 目的地 X 座標
     * @param {number} z - 目的地 Z 座標
     * @param {string} dim - 目的地維度字串
     */
    async teleportTo(x, z, dim) {
        if (this.isSending) return;

        // 安全防線：未登入玩家禁止傳送
        if (!window.authSystem || !window.authSystem.isLoggedIn()) {
            this.showNotification("安全性限制：請先完成 Minecraft 統一登入驗證！", "error");
            return;
        }

        const username = window.authSystem.getUsername();
        const dimNamespace = this.getMinecraftDimensionID(dim);
        
        // 麥塊傳送高空防摔落落點安全校正 (使用 Y: 120 座標，伺服器玩家再行平穩著陸)
        const compiledCommand = `execute in ${dimNamespace} run tp ${username} ${Math.round(x)} 120 ${Math.round(z)}`;

        console.log(`[DolphinGIS] Command Prep: ${compiledCommand}`);
        this.showNotification(`正在與 RCON 通訊：傳送中...`, "info");
        this.setButtonLoadingState(true);

        try {
            const response = await fetch(COMMAND_GATEWAY, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    command: compiledCommand
                })
            });

            const data = await response.json();

            if (data && data.success) {
                this.showNotification(`傳送成功！歡迎抵達 X: ${Math.round(x)}, Z: ${Math.round(z)}`, "success");
            } else {
                const errorMsg = data.error || "伺服器拒絕此指令要求。";
                this.showNotification(`傳送失敗: ${errorMsg}`, "error");
            }
        } catch (error) {
            console.error("[DolphinGIS] Command transmission failed:", error);
            this.showNotification("網路傳輸異常，請檢查 API Gateway 聯網狀態！", "error");
        } finally {
            this.setButtonLoadingState(false);
        }
    },

    /**
     * 全域監聽 Leaflet 地圖彈出氣泡框開啟事件
     * 藉由此方式，不論是點擊地圖標記、搜尋點，還是隨機點擊地圖生成的 Popup，都能即時綁定
     */
    bindGlobalPopupWatcher() {
        if (typeof map === 'undefined') {
            setTimeout(() => this.bindGlobalPopupWatcher(), 300);
            return;
        }

        map.on('popupopen', (e) => {
            const popupNode = e.popup.getElement();
            if (!popupNode) return;

            const tpBtn = popupNode.querySelector('.teleport-btn');
            if (!tpBtn) return;

            const x = parseFloat(tpBtn.getAttribute('data-x'));
            const z = parseFloat(tpBtn.getAttribute('data-z'));
            const dim = tpBtn.getAttribute('data-dim');

            if (window.authSystem && window.authSystem.isLoggedIn()) {
                tpBtn.disabled = false;
                tpBtn.innerText = "⚡️ 執行 RCON 傳送";
                
                tpBtn.onclick = (event) => {
                    event.preventDefault();
                    this.teleportTo(x, z, dim);
                };
            } else {
                tpBtn.disabled = true;
                tpBtn.innerText = "🔒 登入解鎖傳送";
            }
        });
    },

    setButtonLoadingState(loading) {
        this.isSending = loading;
        const buttons = document.querySelectorAll('.teleport-btn');
        buttons.forEach(btn => {
            if (loading) {
                btn.disabled = true;
                btn.innerText = "傳送發送中...";
            } else {
                if (window.authSystem && window.authSystem.isLoggedIn()) {
                    btn.disabled = false;
                    btn.innerText = "⚡️ 執行 RCON 傳送";
                }
            }
        });
    },

    /**
     * 專案內建漂亮通知彈出窗系統 (取代原生 alert 堵塞線程)
     */
    showNotification(message, type = "info") {
        // 清除舊有的 Notification
        const oldNotifs = document.querySelectorAll('.gis-notification');
        oldNotifs.forEach(n => n.remove());

        const notif = document.createElement('div');
        notif.className = `gis-notification ${type}`;
        
        let title = "地圖訊號通知";
        if (type === "error") title = "🚨 安全系統警報";
        if (type === "success") title = "✅ 傳送執行成功";
        if (type === "info") title = "📡 遠端指令呼叫";

        notif.innerHTML = `
            <div style="font-weight: bold; font-size: 13px;">${title}</div>
            <div style="font-size: 11px; opacity: 0.9; margin-top: 3px;">${message}</div>
        `;

        document.body.appendChild(notif);

        // 4秒後自動淡出移除
        setTimeout(() => {
            notif.style.transition = "all 0.4s ease";
            notif.style.opacity = "0";
            notif.style.transform = "translateX(50px)";
            setTimeout(() => notif.remove(), 400);
        }, 4000);
    }
};

window.teleportSystem = teleportSystem;

document.addEventListener('DOMContentLoaded', () => {
    // 稍作延遲，等待 Leaflet 與 地圖初始化完畢再行註冊
    setTimeout(() => {
        teleportSystem.init();
    }, 1200);
});