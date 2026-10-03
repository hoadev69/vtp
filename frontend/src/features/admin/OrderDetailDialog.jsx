import React, { useEffect, useRef } from 'react';

const fieldLabels = { nhapTen: 'Người nhận', nhapSdt: 'Số điện thoại', soHang: 'Số hàng', tenHang: 'Tên hàng' };

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export default function OrderDetailDialog({ order, onClose, onPrintAgain }) {
    const dialogRef = useRef(null);
    const closeTimerRef = useRef(null);
    const [isClosing, setIsClosing] = React.useState(false);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (order) {
            setIsClosing(false);
            if (!dialog.open) dialog.showModal();
        }
    }, [order]);

    useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

    function closeDialog() {
        const dialog = dialogRef.current;
        if (!dialog?.open || isClosing) return;

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            dialog.close();
            return;
        }

        setIsClosing(true);
        const finishClose = () => {
            window.clearTimeout(closeTimerRef.current);
            dialog.removeEventListener('transitionend', handleTransitionEnd);
            if (dialog.open) dialog.close();
        };
        const handleTransitionEnd = event => {
            if (event.target === dialog && event.propertyName === 'opacity') finishClose();
        };

        dialog.addEventListener('transitionend', handleTransitionEnd);
        closeTimerRef.current = window.setTimeout(finishClose, 220);
    }

    const address = [order?.district, order?.commune, order?.village].filter(Boolean).join(' · ') || '—';
    const creator = [order?.creator_username, order?.legacy_username].find(value => typeof value === 'string' && value.trim())
        || (order?.ip && order.ip !== 'unknown' ? order.ip : 'Chưa ghi nhận IP');

    return (
        <dialog aria-labelledby="admin-order-detail-title" className="admin-order-dialog" onClose={onClose}
            data-closing={isClosing || undefined}
            onCancel={event => { event.preventDefault(); closeDialog(); }}
            onClick={event => { if (event.target === event.currentTarget) closeDialog(); }} ref={dialogRef}>
            {order && (
                <>
                    <header className="admin-order-dialog__header">
                        <div><p className="admin-eyebrow">CHI TIẾT ĐƠN</p><h2 id="admin-order-detail-title">{order.barcode || 'Mã vận đơn'}</h2></div>
                        <button aria-label="Đóng chi tiết" className="admin-icon-button" onClick={closeDialog} type="button">×</button>
                    </header>
                    <dl className="admin-order-detail__grid">
                        <div><dt>Thời gian</dt><dd>{formatDate(order.created_at)}</dd></div>
                        <div><dt>Người tạo</dt><dd>{creator}</dd></div>
                        <div><dt>IP</dt><dd>{order.ip === 'unknown' ? 'Chưa ghi nhận IP' : order.ip || '—'}</dd></div>
                        {order.ip_label && <div><dt>Nhãn IP</dt><dd>{order.ip_label}</dd></div>}
                        <div className="admin-order-detail__full"><dt>Địa chỉ</dt><dd>{address}</dd></div>
                        {Object.entries(order.fields || {}).map(([key, value]) => (
                            <div className="admin-order-detail__full" key={key}>
                                <dt>{fieldLabels[key] || key}</dt><dd>{value === '' || value == null ? '—' : String(value)}</dd>
                            </div>
                        ))}
                    </dl>
                    <footer className="admin-order-dialog__footer">
                        <button className="admin-secondary-button" onClick={closeDialog} type="button">Đóng</button>
                        <button className="admin-primary-button" onClick={() => onPrintAgain(order)} type="button">
                            In lại tem
                        </button>
                    </footer>
                </>
            )}
        </dialog>
    );
}