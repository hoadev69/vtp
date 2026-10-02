import React, { useEffect, useRef, useState } from 'react';
import Navigation from './Navigation.jsx';
import PageContainer from './PageContainer.jsx';
import { useAppNavigation } from '../NavigationContext.jsx';
import { ApiError, apiRequest } from '../api/client.js';

function getInitialTheme() {
    try {
        return localStorage.getItem('vtp-theme') === 'dark' ? 'dark' : 'light';
    } catch {
        return 'light';
    }
}

export default function AppShell({ children, currentPath }) {
    const navigate = useAppNavigation();
    const [theme, setTheme] = useState(getInitialTheme);
    const [isOnline, setIsOnline] = useState(() => navigator.onLine);
    const [installPrompt, setInstallPrompt] = useState(null);
    const [isStandalone, setIsStandalone] = useState(() => (
        window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    ));
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [authUser, setAuthUser] = useState(null);
    const [authStatus, setAuthStatus] = useState('checking');
    const [authRetry, setAuthRetry] = useState(0);
    const authCheckId = useRef(0);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [logoutError, setLogoutError] = useState('');

    useEffect(() => {
        let mounted = true;

        function updateAuth(checkId, user, status) {
            if (!mounted || checkId !== authCheckId.current) return;
            setAuthUser(user);
            setAuthStatus(status);
        }

        async function checkAuth() {
            const checkId = ++authCheckId.current;
            try {
                const admin = await apiRequest('/api/admin/me');
                updateAuth(checkId, { role: 'admin', username: admin.username }, 'authenticated');
            } catch (adminError) {
                if (!(adminError instanceof ApiError) || ![401, 403].includes(adminError.status)) {
                    updateAuth(checkId, null, 'error');
                    return;
                }
                try {
                    const inventoryUser = await apiRequest('/api/kiemke/me');
                    updateAuth(checkId, { role: 'operator', username: inventoryUser.username }, 'authenticated');
                } catch (inventoryError) {
                    const status = inventoryError instanceof ApiError && [401, 403].includes(inventoryError.status)
                        ? 'guest'
                        : 'error';
                    updateAuth(checkId, null, status);
                }
            }
        }

        const handleAuthChange = event => {
            authCheckId.current += 1;
            setAuthUser(event.detail?.role ? event.detail : null);
            setAuthStatus(event.detail?.role ? 'authenticated' : 'guest');
        };

        window.addEventListener('vtp:authchange', handleAuthChange);
        checkAuth();
        return () => {
            mounted = false;
            window.removeEventListener('vtp:authchange', handleAuthChange);
        };
    }, [authRetry]);

    function retryAuth() {
        authCheckId.current += 1;
        setAuthUser(null);
        setAuthStatus('checking');
        setAuthRetry(value => value + 1);
    }

    async function logout() {
        authCheckId.current += 1;
        setIsLoggingOut(true);
        setLogoutError('');
        try {
            await apiRequest('/api/logout', { method: 'POST' });
        } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 401) {
                setLogoutError(error.message || 'Không thể đăng xuất. Vui lòng thử lại.');
                setIsLoggingOut(false);
                return;
            }
        }

        setAuthUser(null);
        setAuthStatus('guest');
        setIsLoggingOut(false);
        navigate('/');
    }

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        const themeColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--color-brand-surface').trim();
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
        try {
            localStorage.setItem('vtp-theme', theme);
        } catch {
            // Keep the theme active for this page when storage is unavailable.
        }
    }, [theme]);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        const handleInstallPrompt = event => {
            event.preventDefault();
            setInstallPrompt(event);
        };
        const handleInstalled = () => {
            setInstallPrompt(null);
            setIsStandalone(true);
        };
        const handleModeChange = event => setIsStandalone(event.matches);
        const handleServiceWorkerMessage = event => {
            if (event.data?.type === 'VTP_APP_UPDATED') setUpdateAvailable(true);
        };
        const standaloneQuery = window.matchMedia('(display-mode: standalone)');

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        window.addEventListener('beforeinstallprompt', handleInstallPrompt);
        window.addEventListener('appinstalled', handleInstalled);
        standaloneQuery.addEventListener?.('change', handleModeChange);
        navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
            window.removeEventListener('appinstalled', handleInstalled);
            standaloneQuery.removeEventListener?.('change', handleModeChange);
            navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
        };
    }, []);

    async function promptInstall() {
        if (!installPrompt) return;
        const promptEvent = installPrompt;
        setInstallPrompt(null);
        try {
            await promptEvent.prompt();
            await promptEvent.userChoice;
        } catch {
            // The browser may dismiss the installation prompt without installing.
        }
    }

    function reloadForUpdate() {
        window.location.reload();
    }

    return (
        <div className="app-shell">
            <Navigation
                theme={theme}
                onThemeToggle={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}
                canInstall={Boolean(installPrompt) && !isStandalone}
                onInstall={promptInstall}
                authUser={authUser}
                authStatus={authStatus}
                currentPath={currentPath}
                onLogout={logout}
                isLoggingOut={isLoggingOut}
                logoutError={logoutError}
            />
            {!isOnline && (
                <aside className="app-notice app-notice--offline" role="status" aria-live="polite">
                    Đang offline. Chỉ giao diện ứng dụng đã lưu khả dụng; chức năng cần máy chủ sẽ không hoạt động.
                </aside>
            )}
            {updateAvailable && isOnline && (
                <aside className="app-notice app-notice--update" role="status" aria-live="polite">
                    <span>Đã có phiên bản VTP mới.</span>
                    <button type="button" onClick={reloadForUpdate}>Tải phiên bản mới</button>
                </aside>
            )}
            <main className="app-shell__main" id="app-main">
                <PageContainer>
                    {typeof children === 'function' ? children({ authUser, authStatus, retryAuth }) : children}
                </PageContainer>
            </main>
        </div>
    );
}