import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../shared/api/client.js';
import AdminDialog from '../../shared/components/AdminDialog.jsx';
import ConfirmationDialog from '../../shared/components/ConfirmationDialog.jsx';
import InputControl from '../../shared/components/InputControl.jsx';
import { getAdminErrorMessage, handleAdminAuthorizationError } from './adminManagementUtils.js';

const emptyDraft = { type: 'district', id: '', name: '', kind: 'district', districtId: '', communeId: '' };
const resources = { district: 'districts', commune: 'communes', village: 'villages' };

export default function AddressManagement({ onSessionExpired }) {
    const [districts, setDistricts] = useState(null);
    const [draft, setDraft] = useState(emptyDraft);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [expandedDistricts, setExpandedDistricts] = useState({});
    const [expandedCommunes, setExpandedCommunes] = useState({});
    const [pendingDelete, setPendingDelete] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let current = true;
        setLoading(true);
        setError('');
        apiRequest('/api/admin/geography')
            .then(result => { if (current) setDistricts(result); })
            .catch(requestError => {
                if (!current) return;
                setDistricts(null);
                if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể tải địa bàn.'));
            })
            .finally(() => { if (current) setLoading(false); });
        return () => { current = false; };
    }, [reload, onSessionExpired]);

    const communes = (districts || []).flatMap(district => (district.communes || []).map(commune => ({
        ...commune,
        districtId: district.id,
        districtName: district.name,
    })));

    function startEdit(type, entity, parent) {
        setDraft({
            type,
            id: String(entity.id),
            name: entity.name,
            kind: entity.kind || 'district',
            districtId: String(type === 'commune' ? parent.id : type === 'village' ? parent.districtId : ''),
            communeId: String(type === 'village' ? parent.id : ''),
        });
        setError('');
        setMessage('');
        setDialogOpen(true);
    }

    function changeType(type) {
        setDraft({ ...emptyDraft, type });
    }

    function startCreate() {
        setDraft(emptyDraft);
        setError('');
        setMessage('');
        setDialogOpen(true);
    }

    async function saveAddress(event) {
        event.preventDefault();
        setError('');
        setMessage('');
        setBusy(true);
        const resource = resources[draft.type];
        const body = draft.type === 'district'
            ? { name: draft.name.trim(), kind: draft.kind }
            : draft.type === 'commune'
                ? { name: draft.name.trim(), districtId: draft.districtId }
                : { name: draft.name.trim(), communeId: draft.communeId };
        const path = `/api/admin/${resource}${draft.id ? `/${draft.id}` : ''}`;
        try {
            await apiRequest(path, { method: draft.id ? 'PUT' : 'POST', body });
            setMessage(draft.id ? 'Đã cập nhật địa bàn.' : 'Đã thêm địa bàn.');
            setDraft(emptyDraft);
            setDialogOpen(false);
            setReload(value => value + 1);
        } catch (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể lưu địa bàn.'));
        } finally {
            setBusy(false);
        }
    }

    async function changeAddress(entity, type, action) {
        const deleting = action === 'delete';
        if (deleting) {
            setPendingDelete({ entity, type });
            return;
        }
        await performAddressAction(entity, type, action);
    }

    async function performAddressAction(entity, type, action) {
        const resource = resources[type];
        const hiding = action === 'hide';
        const deleting = action === 'delete';
        setError('');
        setMessage('');
        setBusy(true);
        try {
            const path = `/api/admin/${resource}/${entity.id}${deleting ? '' : '/visibility'}`;
            await apiRequest(path, deleting
                ? { method: 'DELETE' }
                : { method: 'PATCH', body: { hidden: hiding } });
            setMessage(deleting ? 'Đã xóa địa bàn.' : hiding ? 'Đã ẩn địa bàn.' : 'Đã hiện địa bàn.');
            if (draft.id === String(entity.id)) setDraft(emptyDraft);
            setReload(value => value + 1);
        } catch (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể cập nhật địa bàn.'));
        } finally {
            setBusy(false);
        }
    }

    const rows = [];
    (districts || []).forEach(district => {
        rows.push({ type: 'district', entity: district, parent: null });
        if (!expandedDistricts[district.id]) return;
        if (!(district.communes || []).length) rows.push({ type: 'empty', parentType: 'commune', parent: district });
        (district.communes || []).forEach(commune => {
            rows.push({ type: 'commune', entity: commune, parent: district });
            if (!expandedCommunes[commune.id]) return;
            if (!(commune.villages || []).length) rows.push({ type: 'empty', parentType: 'village', parent: commune });
            (commune.villages || []).forEach(village => rows.push({ type: 'village', entity: village, parent: { ...commune, districtId: district.id, districtName: district.name } }));
        });
    });

    return (
        <section className="admin-management" aria-labelledby="address-management-title">
            <header className="admin-management__heading">
                <div><p className="admin-eyebrow">QUẢN TRỊ</p><h1 id="address-management-title">Địa bàn</h1></div>
                <div className="admin-mini-toolbar" aria-label="Thao tác địa bàn">
                    <button className="admin-primary-button" disabled={loading} onClick={startCreate} type="button">Thêm địa bàn</button>
                    {!loading && rows.length > 0 && <button className="admin-secondary-button" onClick={() => setIsEditMode(value => !value)} type="button">{isEditMode ? 'Xong' : 'Sửa'}</button>}
                </div>
            </header>

            {error && !dialogOpen && <p className="admin-message admin-message--error" role="alert">{error}</p>}
            {message && <p className="admin-message admin-message--success" role="status">{message}</p>}
            {loading ? <p className="admin-list-state" role="status">Đang tải địa bàn...</p>
                : rows.length === 0 ? <p className="admin-list-state">Chưa có địa bàn.</p>
                    : <div className="admin-table-scroll"><table className="admin-management-table admin-address-table">
                        <thead><tr><th>Địa bàn</th><th>Cha</th><th>Loại</th><th>Hiển thị</th>{isEditMode && <th>Thao tác</th>}</tr></thead>
                        <tbody>{rows.map(({ type, entity, parent, parentType }) => {
                            if (type === 'empty') return <tr className="admin-address-row admin-address-row--empty" key={`empty-${parent.id}-${parentType}`}><td colSpan={isEditMode ? 5 : 4}>Chưa có {parentType === 'commune' ? 'xã' : 'thôn'} trực thuộc.</td></tr>;
                            const children = type === 'district' ? entity.communes || [] : type === 'commune' ? entity.villages || [] : [];
                            const expanded = type === 'district' ? expandedDistricts[entity.id] : expandedCommunes[entity.id];
                            const canExpand = type !== 'village';
                            const toggleExpand = () => type === 'district'
                                ? setExpandedDistricts(value => ({ ...value, [entity.id]: !value[entity.id] }))
                                : setExpandedCommunes(value => ({ ...value, [entity.id]: !value[entity.id] }));
                            const typeLabel = type === 'district'
                                ? entity.kind === 'city' ? 'Thành phố' : 'Huyện'
                                : type === 'commune' ? 'Xã' : 'Thôn';
                            return <tr className={`admin-address-row admin-address-row--${type}`} key={`${type}-${entity.id}`}>
                                <td data-label="Địa bàn"><div className="admin-address-tree-node">
                                    <span aria-hidden="true" className="admin-address-tree-node__indent" />
                                    {canExpand
                                        ? <button aria-expanded={Boolean(expanded)} aria-label={`${expanded ? 'Thu gọn' : 'Mở'} ${type === 'district' ? 'xã trực thuộc' : 'thôn trực thuộc'} ${entity.name}`} className="admin-address-tree-node__toggle" onClick={toggleExpand} type="button">{expanded ? '−' : '+'}</button>
                                        : <span className="admin-address-tree-node__toggle-placeholder" />}
                                    <span className="admin-address-tree-node__name">{entity.name}</span>
                                    {canExpand && <small>{children.length}</small>}
                                </div></td>
                                <td data-label="Cha">{type === 'district' ? '—' : type === 'commune' ? parent.name : `${parent.districtName} · ${parent.name}`}</td>
                                <td data-label="Loại">{typeLabel}</td>
                                <td data-label="Hiển thị">{entity.is_hidden ? 'Đang ẩn' : 'Đang hiện'}</td>
                                {isEditMode && <td className="admin-management-actions" data-label="Thao tác">
                                    <button className="admin-secondary-button" disabled={busy} onClick={() => startEdit(type, entity, parent)} type="button">Sửa</button>
                                    <button className="admin-secondary-button" disabled={busy} onClick={() => changeAddress(entity, type, entity.is_hidden ? 'show' : 'hide')} type="button">{entity.is_hidden ? 'Hiện' : 'Ẩn'}</button>
                                    <button className="admin-secondary-button admin-danger-button" disabled={busy} onClick={() => changeAddress(entity, type, 'delete')} type="button">Xóa</button>
                                </td>}
                            </tr>;
                        })}</tbody>
                    </table></div>}

            <AdminDialog
                description={draft.id ? 'Cập nhật thông tin và quan hệ địa bàn.' : 'Chọn cấp hành chính và địa bàn cha phù hợp.'}
                onClose={() => setDialogOpen(false)}
                open={dialogOpen}
                title={draft.id ? 'Sửa địa bàn' : 'Thêm địa bàn'}
            >
                {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
                <form className="admin-dialog-form" onSubmit={saveAddress}>
                    <label>Loại địa bàn<select disabled={Boolean(draft.id)} onChange={event => changeType(event.target.value)} value={draft.type}>
                        <option value="district">Huyện / thành phố</option><option value="commune">Xã</option><option value="village">Thôn</option>
                    </select></label>
                    {draft.type === 'district' && <label>Cấp hành chính<select onChange={event => setDraft(value => ({ ...value, kind: event.target.value }))} value={draft.kind}><option value="district">Huyện</option><option value="city">Thành phố</option></select></label>}
                    {draft.type !== 'district' && <label>Huyện / thành phố<select onChange={event => setDraft(value => ({ ...value, districtId: event.target.value, communeId: '' }))} required value={draft.districtId}>
                        <option value="">Chọn huyện / thành phố</option>{(districts || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select></label>}
                    {draft.type === 'village' && <label>Xã<select onChange={event => setDraft(value => ({ ...value, communeId: event.target.value }))} required value={draft.communeId}>
                        <option value="">Chọn xã</option>{communes.filter(item => !draft.districtId || String(item.districtId) === draft.districtId).map(item => <option key={item.id} value={item.id}>{item.districtName} · {item.name}</option>)}
                    </select></label>}
                    <label>Tên địa bàn<InputControl clearLabel="tên địa bàn" clearable disabled={busy} maxLength="80" onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} onClear={() => setDraft(value => ({ ...value, name: '' }))} required value={draft.name} /></label>
                    <footer className="admin-dialog__actions">
                        <button className="admin-secondary-button" disabled={busy} onClick={() => setDialogOpen(false)} type="button">Hủy</button>
                        <button className="admin-primary-button" disabled={busy || loading} type="submit">{busy ? 'Đang lưu...' : draft.id ? 'Lưu thay đổi' : 'Thêm địa bàn'}</button>
                    </footer>
                </form>
            </AdminDialog>
            <ConfirmationDialog
                cancelLabel="Hủy"
                confirmLabel="Xóa địa bàn"
                danger
                description={pendingDelete ? `Xóa “${pendingDelete.entity.name}”${pendingDelete.type === 'district' ? ' và toàn bộ địa bàn trực thuộc' : pendingDelete.type === 'commune' ? ' và các thôn trực thuộc' : ''}?` : ''}
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => {
                    const item = pendingDelete;
                    setPendingDelete(null);
                    if (item) performAddressAction(item.entity, item.type, 'delete');
                }}
                open={Boolean(pendingDelete)}
                title="Xác nhận xóa địa bàn"
            />
        </section>
    );
}