/**
 * DolphinGIS - Minecraft 統一登入 (SSO) 系統
 * 負責金鑰截取、localStorage 快取、SSO Gateway 整合與 UI 狀態同步
 */
const SSO_PORTAL = "https://sso.greendolphin.dpdns.org/index.html";
const VERIFY_API = "https://sso.greendolphin.dpdns.org/api/verify";
const LOGOUT_API = "https://sso.greendolphin.dpdns.org/api/logout";

const authSystem = {
    currentUser: null,
    authToken: null,

    init() {
        console.log("[DolphinGIS] Auth: Initializing SSO integration...");
        this.verifyCurrentSession();
        this.bindEvents();
    },

    /**
     * 向 SSO 驗證 API 發送驗證請求 (帶入 HttpOnly Cookie)
     */
    async verifyCurrentSession() {
        const loadingEl = document.getElementById('auth-loading');
        const guestEl = document.getElementById('auth-guest');
        const userEl = document.getElementById('auth-user');

        try {
            const response = await fetch(VERIFY_API, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                if (data && data.valid) {
                    this.currentUser = data.username;
                    this.setLoggedInState(data.username, loadingEl, guestEl, userEl);
                    document.dispatchEvent(new CustomEvent('auth-success', { detail: data }));
                    return;
                }
            }

            this.clearSession();
            this.setGuestState(loadingEl, guestEl, userEl);
        } catch (error) {
            console.error("[DolphinGIS] Auth: Verification error:", error);
            this.clearSession();
            this.setGuestState(loadingEl, guestEl, userEl);
        }
    },

    setGuestState(loading, guest, user) {
        this.currentUser = null;
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
        this.currentUser = null;
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
            logoutBtn.addEventListener('click', async () => {
                await this.logout();
            });
        }
    },

    /**
     * 呼叫 SSO 端點清除後端 HttpOnly Cookie Session
     */
    async logout() {
        try {
            await fetch(LOGOUT_API, {
                method: 'POST',
                credentials: 'include'
            });
        } catch (err) {
            console.error("[DolphinGIS] Auth: Logout error:", err);
        } finally {
            this.clearSession();
            window.location.reload();
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