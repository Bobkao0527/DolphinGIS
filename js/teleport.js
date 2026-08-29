/**
 * DolphinGIS - 即時傳送系統 (支援 X, Y, Z 多維度安全傳送)
 */

const COMMAND_GATEWAY = "https://servercommand.bobkao0527.workers.dev/command";

const teleportSystem = {
    isSending: false,

    init() {
        console.log("[DolphinGIS] Teleport: System initialized.");
        this.bindGlobalPopupWatcher();
        document.addEventListener('auth-success', () => this.syncAllTeleportButtons());
    },

    syncButtonState(btn) {
        if (!btn) return;

        const x = parseFloat(btn.getAttribute('data-x'));
        const y = parseFloat(btn.getAttribute('data-y'));
        const z = parseFloat(btn.getAttribute('data-z'));
        const dim = btn.getAttribute('data-dim');

        if (!window.authSystem || !window.authSystem.isLoggedIn()) {
            btn.disabled = true;
            btn.innerText = "🔒 登入解鎖傳送";
            btn.onclick = null;
            return;
        }

        btn.disabled = false;
        btn.innerText = "⚡️ 傳送";
        btn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.teleportTo(x, y, z, dim);
        };
    },

    syncAllTeleportButtons() {
        const buttons = document.querySelectorAll('.teleport-btn');
        buttons.forEach((btn) => this.syncButtonState(btn));
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
        const tpCommand = `execute in ${dimNamespace} run tp ${username} ${Math.round(x)} ${targetY} ${Math.round(z)}`;
        const effectCommand = `effect give ${username} minecraft:slow_falling 5 0 true`;

        console.log(`[DolphinGIS] Teleport Command: ${tpCommand}`);
        console.log(`[DolphinGIS] Teleport Effect Command: ${effectCommand}`);
        this.showNotification(`正在呼叫傳送指令...`, "info");
        this.setButtonLoadingState(true);

        try {
            const tpResponse = await fetch(COMMAND_GATEWAY, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    command: tpCommand
                })
            });

            const tpData = await tpResponse.json();

            if (!(tpData && tpData.success)) {
                const errorMsg = tpData?.error || "傳送執行失敗。";
                this.showNotification(`傳送失敗: ${errorMsg}`, "error");
                return;
            }

            const effectResponse = await fetch(COMMAND_GATEWAY, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    command: effectCommand
                })
            });

            const effectData = await effectResponse.json();

            if (effectData && effectData.success) {
                this.showNotification(`傳送成功！抵達 [${dim.toUpperCase()}] X: ${Math.round(x)}, Y: ${targetY}, Z: ${Math.round(z)}`, "success");
            } else {
                const effectError = effectData?.error || "效果附加失敗，但傳送已執行。";
                this.showNotification(`傳送已完成，但附加效果失敗: ${effectError}`, "warning");
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

            this.syncButtonState(tpBtn);
        });
    },

    setButtonLoadingState(loading) {
        this.isSending = loading;
        const buttons = document.querySelectorAll('.teleport-btn');
        buttons.forEach(btn => {
            if (loading) {
                btn.disabled = true;
                btn.innerText = "傳送中...";
                btn.onclick = null;
            } else {
                this.syncButtonState(btn);
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