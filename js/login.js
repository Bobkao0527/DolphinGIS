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
     * 檢查 URL 是否有 Hash token 參數
     */
    checkUrlToken() {
        const hash = window.location.hash;
        if (hash && hash.startsWith('#token=')) {
            const token = hash.replace('#token=', '').trim();
            if (token) {
                localStorage.setItem('mc_auth_token', token);
                console.log("[DolphinGIS] Auth: Token captured and cached.");
                history.replaceState(
                    null, 
                    document.title, 
                    window.location.pathname + window.location.search
                );
            }
        }
    },

    /**
     * 向驗證 API 送出驗證請求
     */
    async verifyCurrentSession() {
        const token = localStorage.getItem('mc_auth_token');
        const loadingEl = document.getElementById('auth-loading');
        const guestEl = document.getElementById('auth-guest');
        const userEl = document.getElementById('auth-user');

        if (!token) {
            console.log("[DolphinGIS] Auth: Operating in guest mode.");
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
                this.currentUser = data.username;
                this.authToken = token;
                this.setLoggedInState(data.username, loadingEl, guestEl, userEl);
                document.dispatchEvent(new CustomEvent('auth-success', { detail: data }));
            } else {
                this.clearSession();
                this.setGuestState(loadingEl, guestEl, userEl);
            }
        } catch (error) {
            console.error("[DolphinGIS] Auth: Verification error:", error);
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

window.authSystem = authSystem;

document.addEventListener('DOMContentLoaded', () => {
    authSystem.init();
});