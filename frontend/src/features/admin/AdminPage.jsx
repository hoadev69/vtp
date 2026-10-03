import React, { useCallback, useRef, useState } from 'react';
import { apiRequest } from '../../shared/api/client.js';
import AdminDashboard from './AdminDashboard.jsx';
import AdminLoginForm from './AdminLoginForm.jsx';
import { getAdminErrorMessage } from './adminManagementUtils.js';

function publishAuthChange(role, username = '') {
    window.dispatchEvent(new CustomEvent('vtp:authchange', {
        detail: role ? { role, username } : { role: null },
    }));
}

export default function AdminPage({ authUser, authStatus, onRetryAuth }) {
    const [authError, setAuthError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loginForbidden, setLoginForbidden] = useState(false);
    const loginInFlight = useRef(false);
    const authFailureHandled = useRef(false);

    async function login(credentials) {
        if (loginInFlight.current) return;
        loginInFlight.current = true;
        authFailureHandled.current = false;
        setIsSubmitting(true);
        setAuthError('');
        setLoginForbidden(false);
        try {
            await apiRequest('/api/login', { method: 'POST', body: credentials });
            const user = await apiRequest('/api/admin/me');
            publishAuthChange('admin', user.username);
        } catch (error) {
            if (error?.status === 403) setLoginForbidden(true);
            else setAuthError(getAdminErrorMessage(error, 'Đăng nhập thất bại.'));
        } finally {
            loginInFlight.current = false;
            setIsSubmitting(false);
        }
    }

    const handleSessionExpired = useCallback(status => {
        if (authFailureHandled.current) return;
        authFailureHandled.current = true;
        if (status === 'forbidden') {
            setLoginForbidden(true);
            onRetryAuth();
            return;
        }
        setLoginForbidden(false);
        publishAuthChange(null);
    }, [onRetryAuth]);

    const view = authStatus === 'checking' ? 'checking'
        : authStatus === 'error' ? 'error'
            : authUser?.role === 'operator' || loginForbidden ? 'forbidden'
                : authUser?.role === 'admin' ? 'dashboard' : 'login';
    let content;
    if (view === 'checking') content = <p className="admin-list-state" role="status">Đang xác minh phiên quản trị...</p>;
    else if (view === 'login') content = <AdminLoginForm error={authError} isSubmitting={isSubmitting} onLogin={login} />;
    else if (view === 'forbidden') content = <p className="admin-message admin-message--error" role="alert">Tài khoản hiện tại không có quyền quản trị.</p>;
    else if (view === 'error') content = (
        <section className="admin-login" aria-labelledby="admin-check-title">
            <p className="admin-eyebrow">VTP · KHU VỰC QUẢN TRỊ</p>
            <h1 id="admin-check-title">Không thể xác minh phiên</h1>
            <p className="admin-message admin-message--error" role="alert">Không thể kiểm tra phiên quản trị. Kiểm tra kết nối rồi thử lại.</p>
            <button className="admin-primary-button" onClick={onRetryAuth} type="button">Thử lại</button>
        </section>
    );
    else content = <AdminDashboard onSessionExpired={handleSessionExpired} user={authUser} />;

    return (
        <div className="admin-page">
            {content}
        </div>
    );
}