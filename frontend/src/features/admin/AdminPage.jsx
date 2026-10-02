import React, { useState } from 'react';
import { apiRequest } from '../../shared/api/client.js';
import AdminDashboard from './AdminDashboard.jsx';
import AdminLoginForm from './AdminLoginForm.jsx';

function publishAuthChange(role, username = '') {
    window.dispatchEvent(new CustomEvent('vtp:authchange', {
        detail: role ? { role, username } : { role: null },
    }));
}

export default function AdminPage({ authUser, authStatus, onRetryAuth }) {
    const [authError, setAuthError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loginForbidden, setLoginForbidden] = useState(false);

    async function login(credentials) {
        setIsSubmitting(true);
        setAuthError('');
        setLoginForbidden(false);
        try {
            await apiRequest('/api/login', { method: 'POST', body: credentials });
            const user = await apiRequest('/api/admin/me');
            publishAuthChange('admin', user.username);
        } catch (error) {
            if (error?.status === 403) setLoginForbidden(true);
            else setAuthError(error.message || 'Đăng nhập thất bại.');
        } finally {
            setIsSubmitting(false);
        }
    }

    function handleSessionExpired() {
        publishAuthChange(null);
    }

    const view = authStatus === 'checking' ? 'checking'
        : authStatus === 'error' ? 'error'
            : authUser?.role === 'admin' ? 'dashboard'
                : authUser?.role === 'operator' || loginForbidden ? 'forbidden' : 'login';
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