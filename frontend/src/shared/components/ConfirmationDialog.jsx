import React, { useEffect, useId, useRef } from 'react';

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
    const dialogRef = useRef(null);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        else if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog
            aria-describedby={descriptionId}
            aria-labelledby={titleId}
            className="admin-confirmation-dialog"
            onCancel={event => { event.preventDefault(); onCancel(); }}
            onClick={event => { if (event.target === event.currentTarget) onCancel(); }}
            ref={dialogRef}
        >
            <div className="admin-confirmation-dialog__content">
                <h2 id={titleId}>{title}</h2>
                <p id={descriptionId}>{description}</p>
                <footer>
                    <button className="admin-secondary-button" onClick={onCancel} type="button">{cancelLabel}</button>
                    <button
                        className={danger ? 'admin-secondary-button admin-danger-button' : 'admin-primary-button'}
                        onClick={onConfirm}
                        type="button"
                    >{confirmLabel}</button>
                </footer>
            </div>
        </dialog>
    );
}