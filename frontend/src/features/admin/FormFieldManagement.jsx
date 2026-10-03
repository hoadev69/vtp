import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../shared/api/client.js';
import InputControl from '../../shared/components/InputControl.jsx';
import { getAdminErrorMessage, handleAdminAuthorizationError } from './adminManagementUtils.js';

export default function FormFieldManagement({ onSessionExpired }) {
    const [fields, setFields] = useState(null);
    const [drafts, setDrafts] = useState({});
    const [isEditMode, setIsEditMode] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busyKey, setBusyKey] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let current = true;
        setLoading(true);
        setError('');
        apiRequest('/api/admin/form-fields')
            .then(result => {
                if (!current) return;
                setFields(result);
                setDrafts(Object.fromEntries(result.map(field => [field.key, {
                    label: field.label,
                    visible: Boolean(field.visible),
                    defaultValue: field.defaultValue ?? '',
                }])));
            })
            .catch(requestError => {
                if (!current) return;
                setFields(null);
                setDrafts({});
                if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể tải cấu hình trường nhập.'));
            })
            .finally(() => { if (current) setLoading(false); });
        return () => { current = false; };
    }, [reload, onSessionExpired]);

    function changeDraft(key, change) {
        setDrafts(value => ({ ...value, [key]: { ...value[key], ...change } }));
    }

    function resetDrafts() {
        setDrafts(Object.fromEntries((fields || []).map(field => [field.key, {
            label: field.label,
            visible: Boolean(field.visible),
            defaultValue: field.defaultValue ?? '',
        }])));
    }

    async function saveFields() {
        const changedFields = (fields || []).filter(field => {
            const draft = drafts[field.key];
            return draft && (draft.label !== field.label
                || draft.visible !== Boolean(field.visible)
                || draft.defaultValue !== (field.defaultValue ?? ''));
        });
        if (!changedFields.length) {
            setIsEditMode(false);
            return;
        }
        setError('');
        setMessage('');
        setBusyKey('all');
        const savedKeys = [];
        try {
            for (const field of changedFields) {
                const draft = drafts[field.key];
                await apiRequest(`/api/admin/form-fields/${encodeURIComponent(field.key)}`, {
                    method: 'PUT',
                    body: { label: draft.label, visible: draft.visible, defaultValue: draft.defaultValue },
                });
                savedKeys.push(field.key);
            }
            setFields(current => current.map(field => savedKeys.includes(field.key)
                ? { ...field, ...drafts[field.key] }
                : field));
            setMessage(`Đã lưu ${savedKeys.length} trường nhập.`);
            setIsEditMode(false);
        } catch (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(getAdminErrorMessage(requestError, 'Không thể lưu trường nhập.'));
            if (savedKeys.length) {
                setFields(current => current.map(field => savedKeys.includes(field.key)
                    ? { ...field, ...drafts[field.key] }
                    : field));
            }
        } finally {
            setBusyKey('');
        }
    }

    return (
        <section className="admin-management" aria-labelledby="form-field-management-title">
            <header className="admin-management__heading">
                <div><p className="admin-eyebrow">QUẢN TRỊ</p><h1 id="form-field-management-title">Trường nhập liệu</h1></div>
                {!loading && fields?.length > 0 && (
                    <div className="admin-mini-toolbar" aria-label="Thao tác trường nhập liệu">
                        {isEditMode ? <>
                            <button className="admin-secondary-button" disabled={busyKey === 'all'} onClick={() => { resetDrafts(); setIsEditMode(false); }} type="button">Hủy</button>
                            <button className="admin-primary-button" disabled={busyKey === 'all'} onClick={saveFields} type="button">{busyKey === 'all' ? 'Đang lưu...' : 'Lưu thay đổi'}</button>
                        </> : <button className="admin-secondary-button" onClick={() => setIsEditMode(true)} type="button">Sửa</button>}
                    </div>
                )}
            </header>
            {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
            {message && <p className="admin-message admin-message--success" role="status">{message}</p>}
            {loading ? <p className="admin-list-state" role="status">Đang tải trường nhập...</p>
                : fields?.length === 0 ? <p className="admin-list-state">Chưa có trường nhập liệu.</p>
                    : <div className="admin-table-scroll"><table className="admin-management-table admin-fields-table">
                        <thead><tr><th>Thứ tự</th><th>Key</th><th>Nhãn</th><th>Hiển thị</th><th>Giá trị mặc định</th>{isEditMode && <th>Thao tác</th>}</tr></thead>
                        <tbody>{(fields || []).map(field => {
                            const draft = drafts[field.key] || { label: field.label, visible: Boolean(field.visible), defaultValue: field.defaultValue ?? '' };
                            return <tr key={field.key}>
                                <td data-label="Thứ tự">{field.sortOrder}</td>
                                <td className="admin-field-key" data-label="Key">{field.key}</td>
                                <td data-label="Nhãn">{isEditMode
                                    ? <InputControl aria-label={`Nhãn ${field.key}`} clearLabel={`nhãn ${field.label}`} clearable disabled={busyKey === 'all'} maxLength="60" onChange={event => changeDraft(field.key, { label: event.target.value })} onClear={() => changeDraft(field.key, { label: '' })} value={draft.label} />
                                    : <span>{field.label}</span>}
                                </td>
                                <td data-label="Hiển thị">{isEditMode
                                    ? <label className="admin-toggle"><input checked={draft.visible} disabled={busyKey === 'all'} onChange={event => changeDraft(field.key, { visible: event.target.checked })} type="checkbox" /><span>{draft.visible ? 'Bật' : 'Tắt'}</span></label>
                                    : <span>{field.visible ? 'Bật' : 'Tắt'}</span>}
                                </td>
                                <td data-label="Giá trị mặc định">{isEditMode
                                    ? <InputControl aria-label={`Giá trị mặc định ${field.key}`} clearLabel={`giá trị mặc định ${field.label}`} clearable disabled={busyKey === 'all'} maxLength="160" onChange={event => changeDraft(field.key, { defaultValue: event.target.value })} onClear={() => changeDraft(field.key, { defaultValue: '' })} type={field.inputType} value={draft.defaultValue} />
                                    : <span>{field.defaultValue || '—'}</span>}
                                </td>
                                {isEditMode && <td data-label="Thao tác">{draft.label !== field.label || draft.visible !== Boolean(field.visible) || draft.defaultValue !== (field.defaultValue ?? '') ? 'Chưa lưu' : '—'}</td>}
                            </tr>;
                        })}</tbody>
                    </table></div>}
            <p className="admin-management-note">Thứ tự hiện tại được giữ nguyên; API chưa hỗ trợ sắp xếp lại trường.</p>
        </section>
    );
}