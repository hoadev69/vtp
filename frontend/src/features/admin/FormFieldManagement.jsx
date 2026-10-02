import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../shared/api/client.js';
import InputControl from '../../shared/components/InputControl.jsx';
import { handleAdminAuthorizationError } from './adminManagementUtils.js';

export default function FormFieldManagement({ onSessionExpired }) {
    const [fields, setFields] = useState(null);
    const [drafts, setDrafts] = useState({});
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
                if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(requestError.message || 'Không thể tải cấu hình trường nhập.');
            })
            .finally(() => { if (current) setLoading(false); });
        return () => { current = false; };
    }, [reload, onSessionExpired]);

    function changeDraft(key, change) {
        setDrafts(value => ({ ...value, [key]: { ...value[key], ...change } }));
    }

    async function saveField(field) {
        const draft = drafts[field.key];
        setError('');
        setMessage('');
        setBusyKey(field.key);
        try {
            await apiRequest(`/api/admin/form-fields/${encodeURIComponent(field.key)}`, {
                method: 'PUT',
                body: { label: draft.label, visible: draft.visible, defaultValue: draft.defaultValue },
            });
            setMessage(`Đã lưu “${field.label}”.`);
            setReload(value => value + 1);
        } catch (requestError) {
            if (!handleAdminAuthorizationError(requestError, onSessionExpired)) setError(requestError.message || 'Không thể lưu trường nhập.');
        } finally {
            setBusyKey('');
        }
    }

    return (
        <section className="admin-management" aria-labelledby="form-field-management-title">
            <header className="admin-management__heading"><div><p className="admin-eyebrow">QUẢN TRỊ</p><h1 id="form-field-management-title">Trường nhập liệu</h1></div></header>
            {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
            {message && <p className="admin-message admin-message--success" role="status">{message}</p>}
            {loading ? <p className="admin-list-state" role="status">Đang tải trường nhập...</p>
                : fields?.length === 0 ? <p className="admin-list-state">Chưa có trường nhập liệu.</p>
                    : <div className="admin-table-scroll"><table className="admin-management-table admin-fields-table">
                        <thead><tr><th>Thứ tự</th><th>Key</th><th>Nhãn</th><th>Hiển thị</th><th>Giá trị mặc định</th><th>Thao tác</th></tr></thead>
                        <tbody>{(fields || []).map(field => {
                            const draft = drafts[field.key] || { label: field.label, visible: Boolean(field.visible), defaultValue: field.defaultValue ?? '' };
                            return <tr key={field.key}>
                                <td data-label="Thứ tự">{field.sortOrder}</td>
                                <td className="admin-field-key" data-label="Key">{field.key}</td>
                                <td data-label="Nhãn"><InputControl aria-label={`Nhãn ${field.key}`} clearLabel={`nhãn ${field.label}`} clearable maxLength="60" onChange={event => changeDraft(field.key, { label: event.target.value })} onClear={() => changeDraft(field.key, { label: '' })} value={draft.label} /></td>
                                <td data-label="Hiển thị"><label className="admin-toggle"><input checked={draft.visible} onChange={event => changeDraft(field.key, { visible: event.target.checked })} type="checkbox" /><span>{draft.visible ? 'Bật' : 'Tắt'}</span></label></td>
                                <td data-label="Giá trị mặc định"><InputControl aria-label={`Giá trị mặc định ${field.key}`} clearLabel={`giá trị mặc định ${field.label}`} clearable maxLength="160" onChange={event => changeDraft(field.key, { defaultValue: event.target.value })} onClear={() => changeDraft(field.key, { defaultValue: '' })} type={field.inputType} value={draft.defaultValue} /></td>
                                <td data-label="Thao tác"><button className="admin-primary-button" disabled={busyKey === field.key || (draft.label === field.label && draft.visible === Boolean(field.visible) && draft.defaultValue === (field.defaultValue ?? ''))} onClick={() => saveField(field)} type="button">{busyKey === field.key ? 'Đang lưu...' : 'Lưu'}</button></td>
                            </tr>;
                        })}</tbody>
                    </table></div>}
            <p className="admin-management-note">Thứ tự hiện tại được giữ nguyên; API chưa hỗ trợ sắp xếp lại trường.</p>
        </section>
    );
}