/**
 * DolphinGIS - 即時傳送系統 (支援 X, Y, Z 多維度安全傳送)
 */

const COMMAND_GATEWAY = "https://servercommand.bobkao0527.workers.dev/command";

const teleportSystem = {
    isSending: false,

    init() {
        console.log("[DolphinGIS] Teleport: System initialized.");
        this.bindGlobalPopupWatcher();
    },

    /**
     * 依據維度名稱返回正確的 Minecraft 命名空間 ID
     * - 原生維度 (overworld, nether, end) 使用 minecraft: 前綴
     * - 其他自定義維度 (giant, mini, space, survival 等) 使用 custom: 前綴
     */
    getMinecraftDimensionID(dim) {
        const lower = (dim || 'overworld').toLowerCase().trim();
        
        // 原生維度對應
        if (lower === 'the_nether' || lower === 'nether') return 'minecraft:the_nether';
        if (lower === 'the_end' || lower === 'end') return 'minecraft:the_end';
        if (lower === 'overworld') return 'minecraft:overworld';
        
        // 其他自訂維度一律使用 custom: 命名空間
        return `custom:${lower}`;
    },

    getSafeTeleportY(y, dim = 'overworld') {
        const parsed = Number(y);
        if (Number.isFinite(parsed)) return Math.round(parsed);
        return 120;
    },

    /**
     * 發送 RCON 傳送指令至中繼 Workers 代理
     */
    async teleportTo(x, y, z, dim) {
        if (this.isSending) return;

        if (!window.authSystem || !window.authSystem.isLoggedIn()) {
            this.showNotification("安全性限制：請先完成 Minecraft 統一登入驗證！", "error");
            return;
        }

        const username = window.authSystem.getUsername();
        const dimNamespace = this.getMinecraftDimensionID(dim);
        
        const targetY = this.getSafeTeleportY(y, dim);
        const compiledCommand = `execute in ${dimNamespace} run tp ${username} ${Math.round(x)} ${targetY} ${Math.round(z)}; effect give ${username} minecraft:slow_falling 5 0 true`;

        console.log(`[DolphinGIS] Teleport Command: ${compiledCommand}`);
        this.showNotification(`正在呼叫傳送指令...`, "info");
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
                this.showNotification(`傳送成功！抵達 [${dim.toUpperCase()}] X: ${Math.round(x)}, Y: ${targetY}, Z: ${Math.round(z)}`, "success");
            } else {
                const errorMsg = data.error || "傳送執行失敗。";
                this.showNotification(`傳送失敗: ${errorMsg}`, "error");
            }
        } catch (error) {
            console.error("[DolphinGIS] Teleport request failed:", error);
            this.showNotification("網路連線異常，請確認伺服器連線狀態！", "error");
        } finally {
            this.setButtonLoadingState(false);
        }
    },

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
            const y = parseFloat(tpBtn.getAttribute('data-y'));
            const z = parseFloat(tpBtn.getAttribute('data-z'));
            const dim = tpBtn.getAttribute('data-dim');

            if (window.authSystem && window.authSystem.isLoggedIn()) {
                tpBtn.disabled = false;
                tpBtn.innerText = "⚡️ 傳送";
                
                tpBtn.onclick = (event) => {
                    event.preventDefault();
                    this.teleportTo(x, y, z, dim);
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
                btn.innerText = "傳送中...";
            } else {
                if (window.authSystem && window.authSystem.isLoggedIn()) {
                    btn.disabled = false;
                    btn.innerText = "⚡️ 傳送";
                }
            }
        });
    },

    showNotification(message, type = "info") {
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
    setTimeout(() => {
        teleportSystem.init();
    }, 1200);
});