import React from 'react';
import AdminDialog from './AdminDialog.jsx';

export default function ConfirmationDialog({
    open,
    title,
    description,
    confirmLabel = 'Xác nhận',
    cancelLabel = 'Hủy',
    danger = false,
    onConfirm,
    onCancel,
}) {
    return (
        <AdminDialog
            description={description}
            onClose={onCancel}
            open={open}
            size="small"
            title={title}
        >
            <div className="admin-dialog__actions">
                    <button className="admin-secondary-button" onClick={onCancel} type="button">{cancelLabel}</button>
                    <button
                        className={danger ? 'admin-secondary-button admin-danger-button' : 'admin-primary-button'}
                        onClick={onConfirm}
                        type="button"
                    >{confirmLabel}</button>
            </div>
        </AdminDialog>
    );
}