import React, { useEffect, useId, useRef } from 'react';
import { isDialogBackdropClick } from './dialogUtils.js';

export default function AdminDialog({
    open,
    title,
    eyebrow,
    description,
    size = 'medium',
    onClose,
    children,
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

    function closeDialog() {
        if (dialogRef.current?.open) dialogRef.current.close();
        onClose();
    }

    return (
        <dialog
            aria-describedby={description ? descriptionId : undefined}
            aria-labelledby={titleId}
            className={`admin-dialog admin-dialog--${size}`}
            onCancel={event => { event.preventDefault(); closeDialog(); }}
            onClick={event => { if (isDialogBackdropClick(event)) closeDialog(); }}
            ref={dialogRef}
        >
            <header className="admin-dialog__header">
                <div>
                    {eyebrow && <p className="admin-eyebrow">{eyebrow}</p>}
                    <h2 id={titleId}>{title}</h2>
                    {description && <p className="admin-dialog__description" id={descriptionId}>{description}</p>}
                </div>
                <button aria-label="Đóng hộp thoại" className="admin-icon-button" onClick={closeDialog} type="button">×</button>
            </header>
            <div className="admin-dialog__body">{children}</div>
        </dialog>
    );
}