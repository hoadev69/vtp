import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../shared/api/client.js';
import ConfirmationDialog from '../../shared/components/ConfirmationDialog.jsx';
import InputControl from '../../shared/components/InputControl.jsx';
import { getAdminErrorMessage, handleAdminAuthorizationError } from './adminManagementUtils.js';

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export default function IpManagement({ onSessionExpired }) {
    const [ips, setIps] = useState(null);
    const [drafts, setDrafts] = useState({});
    const [editingIp, setEditingIp] = useState('');
    const [pendingAction, setPendingAction] = useState(null);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [busyIp, setBusyIp] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let current = true;
        setLoading(true);
        setError('');
        apiRequest('/api/admin/ips')
            .then(result => {
                if (!current) return;
                setIps(result);
                setDrafts(Object.fromEntries(result.map(entry => [entry.ip, entry.label || ''])));
            })
            .catch(requestError => {
                if (!current) return;
                setIps(null);
                setDrafts({});
                if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể tải danh sách IP.'));
            })
            .finally(() => { if (current) setLoading(false); });
        return () => { current = false; };
    }, [reload, onSessionExpired]);

    async function saveIp(entry, blocked = Boolean(entry.blocked), labelOverride) {
        const label = labelOverride ?? drafts[entry.ip] ?? entry.label ?? '';
        setError('');
        setMessage('');
        setBusyIp(entry.ip);
        try {
            await apiRequest('/api/admin/ips', { method: 'PUT', body: { ip: entry.ip, label, blocked } });
            setMessage(blocked !== Boolean(entry.blocked) ? (blocked ? 'Đã chặn IP.' : 'Đã bỏ chặn IP.') : 'Đã lưu nhãn IP.');
            setDrafts(value => ({ ...value, [entry.ip]: label }));
            setEditingIp('');
            setReload(value => value + 1);
        } catch (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể cập nhật IP.'));
        } finally {
            setBusyIp('');
        }
    }

    async function confirmPendingAction() {
        if (!pendingAction) return;
        const { entry, blocked } = pendingAction;
        setPendingAction(null);
        await saveIp(entry, blocked, entry.label || '');
    }

    function cancelLabelEdit(entry) {
        setDrafts(value => ({ ...value, [entry.ip]: entry.label || '' }));
        setEditingIp('');
    }

    function beginLabelEdit(entry) {
        setDrafts(value => ({ ...value, [entry.ip]: entry.label || '' }));
        setEditingIp(entry.ip);
    }

    const visibleIps = (ips || []).filter(entry => `${entry.ip} ${entry.label || ''}`.toLowerCase().includes(search.trim().toLowerCase()));

    return (
        <section className="admin-management" aria-labelledby="ip-management-title">
            <header className="admin-management__heading"><div><p className="admin-eyebrow">QUẢN TRỊ</p><h1 id="ip-management-title">IP truy cập</h1></div></header>
            <div className="admin-management-filters"><label>Tìm IP hoặc nhãn<InputControl clearLabel="tìm IP hoặc nhãn" clearable onChange={event => setSearch(event.target.value)} onClear={() => setSearch('')} value={search} /></label></div>
            {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
            {message && <p className="admin-message admin-message--success" role="status">{message}</p>}
            {loading ? <p className="admin-list-state" role="status">Đang tải IP...</p>
                : visibleIps.length === 0 ? <p className="admin-list-state">{search ? 'Không tìm thấy IP phù hợp.' : 'Chưa có IP tạo mã.'}</p>
                    : <div className="admin-table-scroll"><table className="admin-management-table">
                        <thead><tr><th>Địa chỉ IP</th><th>Nhãn</th><th>Số mã</th><th>Lần hoạt động cuối</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                        <tbody>{visibleIps.map(entry => {
                            const unknown = entry.ip === 'unknown';
                            const label = drafts[entry.ip] ?? entry.label ?? '';
                            const changed = label !== (entry.label || '');
                            return <tr key={entry.ip}>
                                <td className="admin-field-key" data-label="Địa chỉ IP">{unknown ? 'Chưa ghi nhận IP' : entry.ip}</td>
                                <td data-label="Nhãn">
                                    {editingIp === entry.ip ? (
                                        <div className="admin-ip-label-editor">
                                            <InputControl aria-label={`Nhãn IP ${entry.ip}`} clearLabel={`nhãn IP ${entry.ip}`} clearable disabled={busyIp === entry.ip} maxLength="80" onChange={event => setDrafts(value => ({ ...value, [entry.ip]: event.target.value }))} onClear={() => setDrafts(value => ({ ...value, [entry.ip]: '' }))} value={label} />
                                            <div className="admin-management-actions">
                                                <button className="admin-primary-button" disabled={busyIp === entry.ip || !changed} onClick={() => saveIp(entry)} type="button">Lưu</button>
                                                <button className="admin-secondary-button" disabled={busyIp === entry.ip} onClick={() => cancelLabelEdit(entry)} type="button">Hủy</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="admin-ip-label-display">
                                            <span>{entry.label || '—'}</span>
                                            <button className="admin-secondary-button" disabled={unknown || busyIp === entry.ip} onClick={() => beginLabelEdit(entry)} type="button">Sửa nhãn</button>
                                        </div>
                                    )}
                                </td>
                                <td data-label="Số mã">{Number(entry.code_count || 0).toLocaleString('vi-VN')}</td>
                                <td data-label="Lần hoạt động cuối">{formatDate(entry.last_seen)}</td>
                                <td data-label="Trạng thái">{entry.blocked ? 'Đang chặn' : 'Đang cho phép'}</td>
                                <td className="admin-management-actions" data-label="Thao tác">
                                    <button className={entry.blocked ? 'admin-secondary-button' : 'admin-secondary-button admin-danger-button'} disabled={unknown || busyIp === entry.ip} onClick={() => setPendingAction({ entry, blocked: !Boolean(entry.blocked) })} type="button">{entry.blocked ? 'Bỏ chặn' : 'Chặn IP'}</button>
                                </td>
                            </tr>;
                        })}</tbody>
                    </table></div>}
            <ConfirmationDialog
                cancelLabel="Hủy"
                confirmLabel={pendingAction?.blocked ? 'Chặn IP' : 'Bỏ chặn IP'}
                danger
                description={pendingAction
                    ? `Bạn sắp ${pendingAction.blocked ? 'chặn' : 'bỏ chặn'} địa chỉ IP ${pendingAction.entry.ip}${pendingAction.entry.label ? ` (${pendingAction.entry.label})` : ''}.`
                    : ''}
                onCancel={() => setPendingAction(null)}
                onConfirm={confirmPendingAction}
                open={Boolean(pendingAction)}
                title={pendingAction?.blocked ? 'Xác nhận chặn IP' : 'Xác nhận bỏ chặn IP'}
            />
        </section>
    );
}