import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../shared/api/client.js';
import InputControl from '../../shared/components/InputControl.jsx';
import { handleAdminAuthorizationError } from './adminManagementUtils.js';

export default function AccountManagement({ currentUser, onSessionExpired }) {
    const [accounts, setAccounts] = useState(null);
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [role, setRole] = useState('all');
    const [status, setStatus] = useState('all');
    const [roleDrafts, setRoleDrafts] = useState({});
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let current = true;
        const query = new URLSearchParams({ page: String(page), search, role, status });
        setLoading(true);
        setError('');
        apiRequest(`/api/admin/users?${query}`)
            .then(result => { if (current) setAccounts(result); })
            .catch(requestError => {
                if (!current) return;
                if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(requestError.message || 'Không thể tải danh sách tài khoản.');
            })
            .finally(() => { if (current) setLoading(false); });
        return () => { current = false; };
    }, [page, search, role, status, reload, onSessionExpired]);

    async function createAccount(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        setError('');
        setMessage('');
        setBusyId('create');
        try {
            const created = await apiRequest('/api/admin/users', {
                method: 'POST',
                body: {
                    username: values.get('username'),
                    password: values.get('password'),
                    role: values.get('role'),
                },
            });
            form.reset();
            setMessage(`Đã tạo tài khoản ${created.username}.`);
            setPage(1);
            setReload(value => value + 1);
        } catch (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(requestError.message || 'Không thể tạo tài khoản.');
        } finally {
            setBusyId(null);
        }
    }

    async function updateAccount(id, path, body, successMessage) {
        setError('');
        setMessage('');
        setBusyId(id);
        try {
            await apiRequest(path, { method: 'PATCH', body });
            setMessage(successMessage);
            setReload(value => value + 1);
        } catch (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(requestError.message || 'Không thể cập nhật tài khoản.');
        } finally {
            setBusyId(null);
        }
    }

    async function saveRole(account) {
        const nextRole = roleDrafts[account.id] || account.role;
        if (nextRole === account.role) return;
        await updateAccount(account.id, `/api/admin/users/${account.id}/role`, { role: nextRole }, 'Đã cập nhật vai trò.');
    }

    async function toggleStatus(account) {
        if (account.active) {
            if (!window.confirm(`Xác nhận khóa tài khoản ${account.username}?`)) return;
            const reason = window.prompt('Nhập lý do khóa tài khoản:');
            if (reason === null || !reason.trim()) return;
            await updateAccount(account.id, `/api/admin/users/${account.id}/status`, { active: false, reason }, 'Đã khóa tài khoản.');
            return;
        }
        if (!window.confirm(`Xác nhận mở khóa tài khoản ${account.username}?`)) return;
        await updateAccount(account.id, `/api/admin/users/${account.id}/status`, { active: true }, 'Đã mở khóa tài khoản.');
    }

    async function resetPassword(event, account) {
        event.preventDefault();
        const form = event.currentTarget;
        const password = new FormData(form).get('password');
        setError('');
        setMessage('');
        setBusyId(account.id);
        try {
            await apiRequest(`/api/admin/users/${account.id}/password`, { method: 'PUT', body: { password } });
            form.reset();
            setMessage(`Đã đặt lại mật khẩu cho ${account.username}.`);
        } catch (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(requestError.message || 'Không thể đặt lại mật khẩu.');
        } finally {
            setBusyId(null);
        }
    }

    function submitSearch(event) {
        event.preventDefault();
        setPage(1);
        setSearch(searchInput.trim().slice(0, 120));
    }

    return (
        <section className="admin-management" aria-labelledby="account-management-title">
            <header className="admin-management__heading">
                <div><p className="admin-eyebrow">QUẢN TRỊ</p><h1 id="account-management-title">Tài khoản</h1></div>
            </header>
            <form className="admin-management-form" onSubmit={createAccount}>
                <h2>Tạo tài khoản</h2>
                <label>Tên đăng nhập<input autoComplete="username" maxLength="32" minLength="3" name="username" pattern="[a-zA-Z0-9._-]{3,32}" required /></label>
                <label>Mật khẩu<InputControl autoComplete="new-password" maxLength="72" minLength="6" name="password" required type="password" /></label>
                <label>Vai trò<select name="role"><option value="operator">Operator</option><option value="admin">Admin</option></select></label>
                <button className="admin-primary-button" disabled={busyId === 'create'} type="submit">{busyId === 'create' ? 'Đang tạo...' : 'Tạo tài khoản'}</button>
            </form>

            {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
            {message && <p className="admin-message admin-message--success" role="status">{message}</p>}

            <form className="admin-management-filters" onSubmit={submitSearch}>
                <label>Tìm tài khoản<InputControl clearLabel="tài khoản" clearable maxLength="120" onChange={event => setSearchInput(event.target.value)} onClear={() => setSearchInput('')} value={searchInput} /></label>
                <label>Vai trò<select onChange={event => { setRole(event.target.value); setPage(1); }} value={role}><option value="all">Tất cả</option><option value="admin">Admin</option><option value="operator">Operator</option></select></label>
                <label>Trạng thái<select onChange={event => { setStatus(event.target.value); setPage(1); }} value={status}><option value="all">Tất cả</option><option value="active">Đang hoạt động</option><option value="locked">Đã khóa</option></select></label>
                <button className="admin-secondary-button" type="submit">Tìm kiếm</button>
            </form>

            {loading ? <p className="admin-list-state" role="status">Đang tải tài khoản...</p>
                : accounts?.rows.length === 0 ? <p className="admin-list-state">Chưa có tài khoản phù hợp.</p>
                    : <div className="admin-table-scroll"><table className="admin-management-table">
                        <thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Trạng thái</th><th>Tạo lúc</th><th>Số đơn</th><th>Thao tác</th></tr></thead>
                        <tbody>{(accounts?.rows || []).map(account => {
                            const isCurrentUser = account.username === currentUser?.username;
                            return <tr key={account.id}>
                                <td data-label="Tài khoản">{account.username}</td>
                                <td data-label="Vai trò"><div className="admin-management-inline">
                                    <select aria-label={`Vai trò ${account.username}`} disabled={isCurrentUser || busyId === account.id} onChange={event => setRoleDrafts(value => ({ ...value, [account.id]: event.target.value }))} value={roleDrafts[account.id] || account.role}>
                                        <option value="admin">Admin</option><option value="operator">Operator</option>
                                    </select>
                                    <button className="admin-secondary-button" disabled={isCurrentUser || busyId === account.id || (roleDrafts[account.id] || account.role) === account.role} onClick={() => saveRole(account)} type="button">Lưu quyền</button>
                                </div></td>
                                <td data-label="Trạng thái">{account.active ? 'Đang hoạt động' : `Đã khóa${account.disabled_reason ? ` · ${account.disabled_reason}` : ''}`}</td>
                                <td data-label="Tạo lúc">{account.created_at ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(account.created_at)) : '—'}</td>
                                <td data-label="Số đơn">{Number(account.order_count || 0).toLocaleString('vi-VN')}</td>
                                <td className="admin-management-actions" data-label="Thao tác">
                                    <button className="admin-secondary-button" disabled={isCurrentUser || busyId === account.id} onClick={() => toggleStatus(account)} type="button">{account.active ? 'Khóa' : 'Mở khóa'}</button>
                                    <details className="admin-password-reset"><summary>Đặt mật khẩu</summary><form onSubmit={event => resetPassword(event, account)}>
                                        <label>Mật khẩu mới<InputControl autoComplete="new-password" maxLength="72" minLength="6" name="password" required type="password" /></label>
                                        <button className="admin-secondary-button" disabled={busyId === account.id} type="submit">Lưu mật khẩu</button>
                                    </form></details>
                                </td>
                            </tr>;
                        })}</tbody>
                    </table></div>}
            <footer className="admin-pagination"><span>{accounts ? `Trang ${accounts.page} / ${accounts.pages} · ${accounts.total} tài khoản` : ''}</span><div>
                <button className="admin-secondary-button" disabled={loading || page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} type="button">Trang trước</button>
                <button className="admin-secondary-button" disabled={loading || page >= (accounts?.pages || 1)} onClick={() => setPage(value => value + 1)} type="button">Trang sau</button>
            </div></footer>
            <p className="admin-management-note">API hiện tại không hỗ trợ xóa tài khoản.</p>
        </section>
    );
}