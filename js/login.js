/**
 * DolphinGIS - Minecraft 統一登入 (SSO) 系統
 * 負責金鑰截取、localStorage 快取、SSO Gateway 整合與 UI 狀態同步
 */

const SSO_PORTAL = "https://dolphinloginsystem.pages.dev";
const VERIFY_API = "https://dolphinloginsystem.pages.dev/api/verify";

const authSystem = {
    currentUser: null,
    authToken: null,

    init() {
        console.log("[DolphinGIS] Auth: Initializing SSO integration...");
        this.checkUrlToken();
        this.verifyCurrentSession();
        this.bindEvents();
    },

    /**
     * 步驟 1: 檢查 URL 中是否含有驗證完成後的 Hash 參數 (#token=...)
     */
    checkUrlToken() {
        const hash = window.location.hash;
        if (hash && hash.startsWith('#token=')) {
            const token = hash.replace('#token=', '').trim();
            if (token) {
                // 將 Token 存入快取
                localStorage.setItem('mc_auth_token', token);
                console.log("[DolphinGIS] Auth: Token captured from URL and cached.");
                
                // 清除網址列 Hash 參數以求乾淨美觀
                history.replaceState(
                    null, 
                    document.title, 
                    window.location.pathname + window.location.search
                );
            }
        }
    },

    /**
     * 步驟 2: 向自建 SSO Verify API 發送驗證，確認 Token 有效性
     */
    async verifyCurrentSession() {
        const token = localStorage.getItem('mc_auth_token');
        const loadingEl = document.getElementById('auth-loading');
        const guestEl = document.getElementById('auth-guest');
        const userEl = document.getElementById('auth-user');

        if (!token) {
            console.log("[DolphinGIS] Auth: No cached token. Operating in guest mode.");
            this.setGuestState(loadingEl, guestEl, userEl);
            return;
        }

        try {
            const response = await fetch(VERIFY_API, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (data && data.valid) {
                console.log(`[DolphinGIS] Auth: Welcome back, ${data.username}!`);
                this.currentUser = data.username;
                this.authToken = token;
                this.setLoggedInState(data.username, loadingEl, guestEl, userEl);
                
                // 發送全域驗證完成事件，供傳送系統等模組監聽
                document.dispatchEvent(new CustomEvent('auth-success', { detail: data }));
            } else {
                console.warn("[DolphinGIS] Auth: Token verification failed.", data.message || "");
                this.clearSession();
                this.setGuestState(loadingEl, guestEl, userEl);
            }
        } catch (error) {
            console.error("[DolphinGIS] Auth: Error during session verification:", error);
            this.setGuestState(loadingEl, guestEl, userEl);
        }
    },

    setGuestState(loading, guest, user) {
        this.currentUser = null;
        this.authToken = null;
        if (loading) loading.style.display = 'none';
        if (guest) guest.style.display = 'block';
        if (user) user.style.display = 'none';
    },

    setLoggedInState(username, loading, guest, user) {
        if (loading) loading.style.display = 'none';
        if (guest) guest.style.display = 'none';
        if (user) user.style.display = 'block';

        // 渲染玩家 Helm 與名稱
        const nameEl = document.getElementById('user-name');
        const avatarEl = document.getElementById('user-avatar');
        
        if (nameEl) nameEl.innerText = username;
        if (avatarEl) {
            avatarEl.src = `https://minotar.net/helm/${encodeURIComponent(username)}/32`;
            avatarEl.onerror = () => {
                avatarEl.src = 'https://minotar.net/avatar/char/32';
            };
        }
    },

    clearSession() {
        localStorage.removeItem('mc_auth_token');
        this.currentUser = null;
        this.authToken = null;
    },

    bindEvents() {
        const loginBtn = document.getElementById('login-btn');
        const logoutBtn = document.getElementById('logout-btn');

        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                // 將玩家重新導向至中央登入網域，並在網址參數帶上當前頁面的網址作為歸途路徑
                const returnUrl = encodeURIComponent(window.location.href);
                window.location.href = `${SSO_PORTAL}?returnUrl=${returnUrl}`;
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.clearSession();
                window.location.reload();
            });
        }
    },

    isLoggedIn() {
        return this.currentUser !== null;
    },

    getUsername() {
        return this.currentUser;
    }
};

// 全域註冊
window.authSystem = authSystem;

document.addEventListener('DOMContentLoaded', () => {
    authSystem.init();
});