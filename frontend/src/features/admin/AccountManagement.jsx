import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../shared/api/client.js';
import AdminDialog from '../../shared/components/AdminDialog.jsx';
import InputControl from '../../shared/components/InputControl.jsx';
import { getAdminErrorMessage, handleAdminAuthorizationError } from './adminManagementUtils.js';

export default function AccountManagement({ currentUser, onSessionExpired }) {
    const [accounts, setAccounts] = useState(null);
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [role, setRole] = useState('all');
    const [status, setStatus] = useState('all');
    const [roleDrafts, setRoleDrafts] = useState({});
    const [isEditMode, setIsEditMode] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [passwordAccount, setPasswordAccount] = useState(null);
    const [statusAction, setStatusAction] = useState(null);
    const [statusReason, setStatusReason] = useState('');
    const [ordersAccount, setOrdersAccount] = useState(null);
    const [ordersPage, setOrdersPage] = useState(1);
    const [ordersResult, setOrdersResult] = useState(null);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [ordersError, setOrdersError] = useState('');
    const [qrWaybills, setQrWaybills] = useState({});
    const [qrErrors, setQrErrors] = useState({});
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
            .then(result => {
                if (!current) return;
                setAccounts(result);
                setRoleDrafts(Object.fromEntries(result.rows.map(account => [account.id, account.role])));
            })
            .catch(requestError => {
                if (!current) return;
                setAccounts(null);
                if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể tải danh sách tài khoản.'));
            })
            .finally(() => { if (current) setLoading(false); });
        return () => { current = false; };
    }, [page, search, role, status, reload, onSessionExpired]);

    useEffect(() => {
        if (!ordersAccount) return undefined;
        let current = true;
        setOrdersLoading(true);
        setOrdersError('');
        const query = new URLSearchParams({ page: String(ordersPage) });
        apiRequest(`/api/admin/inventory-accounts/${ordersAccount.id}/orders?${query}`)
            .then(result => { if (current) setOrdersResult(result); })
            .catch(requestError => {
                if (!current) return;
                setOrdersResult(null);
                if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setOrdersError(getAdminErrorMessage(requestError, 'Không thể tải đơn hàng của tài khoản.'));
            })
            .finally(() => { if (current) setOrdersLoading(false); });
        return () => { current = false; };
    }, [ordersAccount, ordersPage, onSessionExpired]);

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
            setCreateDialogOpen(false);
            setPage(1);
            setReload(value => value + 1);
        } catch (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể tạo tài khoản.'));
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
            return true;
        } catch (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể cập nhật tài khoản.'));
            return false;
        } finally {
            setBusyId(null);
        }
    }

    async function saveRoles() {
        const changes = (accounts?.rows || []).filter(account => roleDrafts[account.id] && roleDrafts[account.id] !== account.role);
        if (!changes.length) {
            setIsEditMode(false);
            return;
        }
        setError('');
        setMessage('');
        setBusyId('roles');
        const savedRoles = {};
        let requestError = null;
        try {
            for (const account of changes) {
                const nextRole = roleDrafts[account.id];
                await apiRequest(`/api/admin/users/${account.id}/role`, { method: 'PATCH', body: { role: nextRole } });
                savedRoles[account.id] = nextRole;
            }
        } catch (error) {
            requestError = error;
        } finally {
            setBusyId(null);
        }
        if (Object.keys(savedRoles).length) {
            setAccounts(current => ({ ...current, rows: current.rows.map(account => (
                savedRoles[account.id] ? { ...account, role: savedRoles[account.id] } : account
            )) }));
            setRoleDrafts(current => ({ ...current, ...savedRoles }));
        }
        if (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể cập nhật vai trò.'));
            return;
        }
        setMessage(`Đã cập nhật ${changes.length} vai trò.`);
        setIsEditMode(false);
    }

    function toggleStatus(account) {
        setError('');
        setStatusReason('');
        setStatusAction({ account, active: !account.active });
    }

    async function confirmStatusAction(event) {
        event.preventDefault();
        if (!statusAction) return;
        if (!statusAction.active && !statusReason.trim()) {
            setError('Vui lòng nhập lý do khóa tài khoản.');
            return;
        }
        const { account, active } = statusAction;
        const updated = await updateAccount(
            account.id,
            `/api/admin/users/${account.id}/status`,
            active ? { active: true } : { active: false, reason: statusReason.trim() },
            active ? 'Đã mở khóa tài khoản.' : 'Đã khóa tài khoản.',
        );
        if (updated) setStatusAction(null);
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
            setPasswordAccount(null);
        } catch (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể đặt lại mật khẩu.'));
        } finally {
            setBusyId(null);
        }
    }

    function cancelRoleEdit() {
        setRoleDrafts(Object.fromEntries((accounts?.rows || []).map(account => [account.id, account.role])));
        setIsEditMode(false);
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
                <div className="admin-mini-toolbar" aria-label="Thao tác tài khoản">
                    <button className="admin-primary-button" onClick={() => { setError(''); setCreateDialogOpen(true); }} type="button">Tạo tài khoản</button>
                    {!loading && accounts?.rows.length > 0 && (isEditMode ? <>
                        <button className="admin-secondary-button" disabled={Boolean(busyId)} onClick={cancelRoleEdit} type="button">Hủy</button>
                        <button className="admin-secondary-button" disabled={Boolean(busyId)} onClick={saveRoles} type="button">{busyId === 'roles' ? 'Đang lưu...' : 'Lưu vai trò'}</button>
                    </> : <button className="admin-secondary-button" onClick={() => setIsEditMode(true)} type="button">Sửa</button>)}
                </div>
            </header>

            {error && !createDialogOpen && !passwordAccount && !statusAction && <p className="admin-message admin-message--error" role="alert">{error}</p>}
            {message && <p className="admin-message admin-message--success" role="status">{message}</p>}

            <form className="admin-management-filters" onSubmit={submitSearch}>
                <label>Tìm tài khoản<InputControl clearLabel="tài khoản" clearable maxLength="120" onChange={event => setSearchInput(event.target.value)} onClear={() => setSearchInput('')} value={searchInput} /></label>
                <label>Vai trò<select onChange={event => { setRole(event.target.value); setPage(1); }} value={role}><option value="all">Tất cả</option><option value="admin">Admin</option><option value="operator">Operator</option></select></label>
                <label>Trạng thái<select onChange={event => { setStatus(event.target.value); setPage(1); }} value={status}><option value="all">Tất cả</option><option value="active">Đang hoạt động</option><option value="locked">Đã khóa</option></select></label>
                <button className="admin-secondary-button" type="submit">Tìm kiếm</button>
            </form>

            {loading ? <p className="admin-list-state" role="status">Đang tải tài khoản...</p>
                : accounts?.rows.length === 0 ? <p className="admin-list-state">Chưa có tài khoản phù hợp.</p>
                    : <div className="admin-table-scroll"><table className="admin-management-table admin-account-table">
                        <thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Trạng thái</th><th>Tạo lúc</th><th>Số đơn</th><th>Thao tác</th></tr></thead>
                        <tbody>{(accounts?.rows || []).map(account => {
                            const isCurrentUser = account.username === currentUser?.username;
                            return <tr key={account.id}>
                                <td data-label="Tài khoản">{account.username}</td>
                                <td data-label="Vai trò">{isEditMode
                                    ? <select aria-label={`Vai trò ${account.username}`} disabled={isCurrentUser || Boolean(busyId)} onChange={event => setRoleDrafts(value => ({ ...value, [account.id]: event.target.value }))} value={roleDrafts[account.id] || account.role}>
                                        <option value="admin">Admin</option><option value="operator">Operator</option>
                                    </select>
                                    : account.role === 'admin' ? 'Admin' : 'Operator'}</td>
                                <td data-label="Trạng thái">{account.active ? 'Đang hoạt động' : `Đã khóa${account.disabled_reason ? ` · ${account.disabled_reason}` : ''}`}</td>
                                <td data-label="Tạo lúc">{account.created_at ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(account.created_at)) : '—'}</td>
                                <td data-label="Số đơn"><button className="admin-account-order-count" onClick={() => { setOrdersAccount(account); setOrdersPage(1); setOrdersResult(null); setQrWaybills({}); setQrErrors({}); }} type="button">{Number(account.order_count || 0).toLocaleString('vi-VN')}</button></td>
                                <td className="admin-management-actions" data-label="Thao tác">
                                    <button className="admin-secondary-button" disabled={isCurrentUser || Boolean(busyId)} onClick={() => toggleStatus(account)} type="button">{account.active ? 'Khóa' : 'Mở khóa'}</button>
                                    <button className="admin-secondary-button" disabled={Boolean(busyId)} onClick={() => { setError(''); setPasswordAccount(account); }} type="button">Đặt mật khẩu</button>
                                </td>
                            </tr>;
                        })}</tbody>
                    </table></div>}
            <footer className="admin-pagination"><span>{accounts ? `Trang ${accounts.page} / ${accounts.pages} · ${accounts.total} tài khoản` : ''}</span><div>
                <button className="admin-secondary-button" disabled={loading || page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} type="button">Trang trước</button>
                <button className="admin-secondary-button" disabled={loading || page >= (accounts?.pages || 1)} onClick={() => setPage(value => value + 1)} type="button">Trang sau</button>
            </div></footer>
            <p className="admin-management-note">API hiện tại không hỗ trợ xóa tài khoản.</p>

            <AdminDialog
                description="Tên đăng nhập cần từ 3 đến 32 ký tự; mật khẩu tối thiểu 6 ký tự."
                onClose={() => setCreateDialogOpen(false)}
                open={createDialogOpen}
                title="Tạo tài khoản"
            >
                {error && createDialogOpen && <p className="admin-message admin-message--error" role="alert">{error}</p>}
                <form className="admin-dialog-form" onSubmit={createAccount}>
                    <label>Tên đăng nhập<input autoComplete="username" maxLength="32" minLength="3" name="username" pattern="[a-zA-Z0-9._-]{3,32}" required /></label>
                    <label>Mật khẩu<InputControl autoComplete="new-password" maxLength="72" minLength="6" name="password" required type="password" /></label>
                    <label>Vai trò<select name="role"><option value="operator">Operator</option><option value="admin">Admin</option></select></label>
                    <footer className="admin-dialog__actions">
                        <button className="admin-secondary-button" disabled={busyId === 'create'} onClick={() => setCreateDialogOpen(false)} type="button">Hủy</button>
                        <button className="admin-primary-button" disabled={busyId === 'create'} type="submit">{busyId === 'create' ? 'Đang tạo...' : 'Tạo tài khoản'}</button>
                    </footer>
                </form>
            </AdminDialog>

            <AdminDialog
                description={passwordAccount ? `Đặt mật khẩu mới cho ${passwordAccount.username}.` : ''}
                onClose={() => setPasswordAccount(null)}
                open={Boolean(passwordAccount)}
                size="small"
                title="Đặt mật khẩu"
            >
                {error && passwordAccount && <p className="admin-message admin-message--error" role="alert">{error}</p>}
                {passwordAccount && <form className="admin-dialog-form" onSubmit={event => resetPassword(event, passwordAccount)}>
                    <label>Mật khẩu mới<InputControl autoComplete="new-password" maxLength="72" minLength="6" name="password" required type="password" /></label>
                    <footer className="admin-dialog__actions">
                        <button className="admin-secondary-button" disabled={busyId === passwordAccount.id} onClick={() => setPasswordAccount(null)} type="button">Hủy</button>
                        <button className="admin-primary-button" disabled={busyId === passwordAccount.id} type="submit">{busyId === passwordAccount.id ? 'Đang lưu...' : 'Lưu mật khẩu'}</button>
                    </footer>
                </form>}
            </AdminDialog>

            <AdminDialog
                description={statusAction ? `Tài khoản: ${statusAction.account.username}` : ''}
                onClose={() => setStatusAction(null)}
                open={Boolean(statusAction)}
                size="small"
                title={statusAction?.active ? 'Xác nhận mở khóa tài khoản' : 'Xác nhận khóa tài khoản'}
            >
                {error && statusAction && <p className="admin-message admin-message--error" role="alert">{error}</p>}
                {statusAction && <form className="admin-dialog-form" onSubmit={confirmStatusAction}>
                    {!statusAction.active && <label>Lý do khóa<textarea maxLength="500" onChange={event => setStatusReason(event.target.value)} required value={statusReason} /></label>}
                    <footer className="admin-dialog__actions">
                        <button className="admin-secondary-button" disabled={busyId === statusAction.account.id} onClick={() => setStatusAction(null)} type="button">Hủy</button>
                        <button className={statusAction.active ? 'admin-primary-button' : 'admin-secondary-button admin-danger-button'} disabled={busyId === statusAction.account.id} type="submit">{busyId === statusAction.account.id ? 'Đang xử lý...' : statusAction.active ? 'Mở khóa' : 'Khóa tài khoản'}</button>
                    </footer>
                </form>}
            </AdminDialog>

            <AdminDialog
                description={ordersAccount ? `${Number(ordersResult?.total ?? ordersAccount.order_count ?? 0).toLocaleString('vi-VN')} đơn vận đơn` : ''}
                onClose={() => { setOrdersAccount(null); setOrdersResult(null); setQrWaybills({}); }}
                open={Boolean(ordersAccount)}
                size="large"
                title={ordersAccount ? `Đơn hàng · ${ordersAccount.username}` : 'Đơn hàng'}
            >
                {ordersError && <p className="admin-message admin-message--error" role="alert">{ordersError}</p>}
                {ordersLoading ? <p className="admin-list-state" role="status">Đang tải đơn hàng...</p>
                    : !ordersResult?.rows.length ? <p className="admin-list-state">Tài khoản chưa có đơn vận đơn.</p>
                        : <div className="admin-account-orders">{ordersResult.rows.map(order => {
                            const qrOpen = Boolean(qrWaybills[order.waybill]);
                            const qrSrc = `/api/qrcode?text=${encodeURIComponent(order.waybill)}`;
                            return <article className="admin-account-order" key={order.id}>
                                <div className="admin-account-order__details">
                                    <strong className="admin-order-code">{order.waybill}</strong>
                                    <span>{order.created_at ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(order.created_at)) : '—'}</span>
                                </div>
                                <button className="admin-secondary-button" onClick={() => setQrWaybills(value => ({ ...value, [order.waybill]: !value[order.waybill] }))} type="button">{qrOpen ? 'Ẩn QR' : 'Tạo QR'}</button>
                                {qrOpen && (qrErrors[order.waybill]
                                    ? <p className="admin-message admin-message--error" role="alert">Không tải được QR cho mã {order.waybill}.</p>
                                    : <img alt={`Mã QR ${order.waybill}`} className="admin-account-order__qr" onError={() => setQrErrors(value => ({ ...value, [order.waybill]: true }))} src={qrSrc} />)}
                            </article>;
                        })}</div>}
                {ordersResult?.pages > 1 && <footer className="admin-pagination"><span>Trang {ordersResult.page} / {ordersResult.pages}</span><div>
                    <button className="admin-secondary-button" disabled={ordersLoading || ordersPage <= 1} onClick={() => setOrdersPage(value => value - 1)} type="button">Trang trước</button>
                    <button className="admin-secondary-button" disabled={ordersLoading || ordersPage >= ordersResult.pages} onClick={() => setOrdersPage(value => value + 1)} type="button">Trang sau</button>
                </div></footer>}
            </AdminDialog>
        </section>
    );
}