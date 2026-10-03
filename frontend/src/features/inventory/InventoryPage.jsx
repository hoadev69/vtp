import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, apiRequest } from '../../shared/api/client.js';
import { isDialogBackdropClick } from '../../shared/components/dialogUtils.js';
import InputControl from '../../shared/components/InputControl.jsx';
import './inventory.css';

function getErrorMessage(error, fallback) {
    if (error instanceof ApiError && error.status >= 500) {
        return 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.';
    }
    return error?.message || fallback;
}

function publishAuthChange(role, username = '') {
    window.dispatchEvent(new CustomEvent('vtp:authchange', {
        detail: role ? { role, username } : { role: null },
    }));
}

export default function InventoryPage({ authUser, authStatus, onRetryAuth }) {
    const [view, setView] = useState('checking');
    const [loginUsername, setLoginUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loginMessage, setLoginMessage] = useState('');
    const [loginError, setLoginError] = useState('');
    const [pageError, setPageError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [qrResult, setQrResult] = useState(null);
    const [lockedReason, setLockedReason] = useState('');
    const [retryCount, setRetryCount] = useState(0);
    const qrDialogRef = useRef(null);
    const lockedDialogRef = useRef(null);
    const loginInFlight = useRef(false);
    const createInFlight = useRef(false);

    useEffect(() => {
        let current = true;

        async function checkSession() {
            setPageError('');

            if (authStatus === 'checking') {
                setView('checking');
                return;
            }
            if (authStatus === 'error') {
                setPageError('Không thể xác minh phiên kiểm kê. Kiểm tra kết nối rồi thử lại.');
                setView('error');
                return;
            }
            if (authUser?.role === 'operator') {
                setView('inventory');
                return;
            }
            if (authUser?.role !== 'admin') {
                setView('login');
                return;
            }

            setView('checking');
            try {
                await apiRequest('/api/kiemke/me');
                if (!current) return;
                setView('inventory');
            } catch (error) {
                if (!current) return;
                if (error instanceof ApiError && error.status === 401) {
                    setView('login');
                    setLoginMessage('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
                    publishAuthChange(null);
                } else if (error instanceof ApiError && error.status === 403) {
                    setView('forbidden');
                } else {
                    setPageError(getErrorMessage(error, 'Không thể kiểm tra phiên kiểm kê.'));
                    setView('error');
                }
            }
        }

        checkSession();
        return () => { current = false; };
    }, [authUser, authStatus, retryCount]);

    useEffect(() => {
        const dialog = qrDialogRef.current;
        if (!dialog) return;
        if (qrResult && !dialog.open) dialog.showModal();
        else if (!qrResult && dialog.open) dialog.close();
    }, [qrResult]);

    useEffect(() => {
        const dialog = lockedDialogRef.current;
        if (!dialog) return;
        if (lockedReason && !dialog.open) dialog.showModal();
        else if (!lockedReason && dialog.open) dialog.close();
    }, [lockedReason]);

    async function submitLogin(event) {
        event.preventDefault();
        if (loginInFlight.current) return;
        loginInFlight.current = true;
        setLoginError('');
        setLoginMessage('');
        setIsSubmitting(true);
        try {
            const user = await apiRequest('/api/kiemke/login', {
                method: 'POST',
                body: { username: loginUsername, password },
            });
            setPassword('');
            onRetryAuth();
        } catch (error) {
            setPassword('');
            if (error instanceof ApiError && error.status === 403 && error.data?.code === 'ACCOUNT_DISABLED') {
                setLockedReason(error.data.reason || error.data.error || 'Vui lòng liên hệ quản trị viên.');
            } else {
                setLoginError(getErrorMessage(error, 'Đăng nhập kiểm kê thất bại.'));
            }
        } finally {
            loginInFlight.current = false;
            setIsSubmitting(false);
        }
    }

    async function createQrFromClipboard() {
        if (createInFlight.current) return;
        createInFlight.current = true;
        setPageError('');
        setIsCreating(true);
        try {
            if (!navigator.clipboard?.readText) {
                throw new Error('Trình duyệt không hỗ trợ đọc clipboard trên kết nối này.');
            }
            const waybill = (await navigator.clipboard.readText()).trim();
            if (!waybill) throw new Error('Clipboard đang trống.');

            const result = await apiRequest('/api/kiemke', {
                method: 'POST',
                body: { waybill },
            });
            if (typeof result?.qrCode !== 'string' || !result.qrCode.startsWith('data:image/png;base64,')) {
                throw new Error('Phản hồi mã QR từ máy chủ không hợp lệ.');
            }
            setQrResult({ waybill, qrCode: result.qrCode });
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) {
                setView('login');
                setLoginMessage('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
                publishAuthChange(null);
            } else if (error.name === 'NotAllowedError') {
                setPageError('Trình duyệt chưa được cấp quyền đọc clipboard.');
            } else {
                setPageError(getErrorMessage(error, 'Không thể tạo mã QR.'));
            }
        } finally {
            createInFlight.current = false;
            setIsCreating(false);
        }
    }

    const isAuthenticated = view === 'inventory';

    return (
        <section className="inventory-page" aria-labelledby="inventory-page-title">
            <header className="inventory-page__heading">
                <div>
                    <p className="inventory-page__eyebrow">VTP · KIỂM KÊ</p>
                    <h1 id="inventory-page-title">{isAuthenticated ? 'Tạo mã QR vận đơn' : 'Đăng nhập kiểm kê'}</h1>
                </div>
            </header>

            {view === 'checking' && <p className="inventory-page__state" role="status">Đang kiểm tra phiên kiểm kê...</p>}
            {view === 'error' && (
                <div className="inventory-page__state">
                    <p className="inventory-page__error" role="alert">{pageError}</p>
                    <button
                        className="inventory-page__secondary"
                        onClick={authStatus === 'error' ? onRetryAuth : () => setRetryCount(value => value + 1)}
                        type="button"
                    >Thử lại</button>
                </div>
            )}
            {view === 'forbidden' && (
                <p className="inventory-page__error" role="alert">Tài khoản hiện tại không có quyền sử dụng Kiểm kê.</p>
            )}
            {view === 'login' && (
                <form className="inventory-login" onSubmit={submitLogin} aria-busy={isSubmitting}>
                    {loginMessage && <p className="inventory-page__success" role="status">{loginMessage}</p>}
                    <div className="inventory-login__field">
                        <label htmlFor="inventory-username">Tên đăng nhập</label>
                        <input
                            autoComplete="username"
                            id="inventory-username"
                            maxLength="32"
                            minLength="3"
                            onChange={event => setLoginUsername(event.target.value)}
                            required
                            value={loginUsername}
                        />
                    </div>
                    <div className="inventory-login__field">
                        <label htmlFor="inventory-password">Mật khẩu</label>
                        <InputControl
                            autoComplete="current-password"
                            id="inventory-password"
                            onChange={event => setPassword(event.target.value)}
                            required
                            type="password"
                            value={password}
                        />
                    </div>
                    {loginError && <p className="inventory-page__error" role="alert">{loginError}</p>}
                    <button className="inventory-page__primary" disabled={isSubmitting} type="submit">
                        {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
                    </button>
                </form>
            )}
            {isAuthenticated && (
                <div className="inventory-workspace">
                    {pageError && <p className="inventory-page__error" role="alert">{pageError}</p>}
                    {!qrResult && <p className="inventory-page__state" role="status">Chưa có mã QR mới trong phiên này.</p>}
                </div>
            )}
            {isAuthenticated && createPortal(
                <button
                    className="inventory-page__primary inventory-page__create"
                    disabled={isCreating}
                    onClick={createQrFromClipboard}
                    type="button"
                >{isCreating ? 'Đang tạo mã...' : 'Lấy mã từ clipboard'}</button>,
                document.body,
            )}

            <dialog
                className="inventory-dialog"
                onClick={event => { if (isDialogBackdropClick(event)) event.currentTarget.close(); }}
                onClose={() => setQrResult(null)}
                ref={qrDialogRef}
                aria-labelledby="inventory-qr-title"
            >
                {qrResult && (
                    <>
                        <header className="inventory-dialog__heading">
                            <div>
                                <p className="inventory-page__eyebrow">KIỂM KÊ · THÀNH CÔNG</p>
                                <h2 id="inventory-qr-title">Mã QR vận đơn</h2>
                            </div>
                            <button className="inventory-page__secondary" onClick={() => setQrResult(null)} type="button">Đóng</button>
                        </header>
                        <p className="inventory-dialog__waybill">{qrResult.waybill}</p>
                        <img className="inventory-dialog__qr" src={qrResult.qrCode} alt={`Mã QR vận đơn ${qrResult.waybill}`} />
                    </>
                )}
            </dialog>

            <dialog
                className="inventory-dialog inventory-dialog--locked"
                onClick={event => { if (isDialogBackdropClick(event)) event.currentTarget.close(); }}
                onClose={() => setLockedReason('')}
                ref={lockedDialogRef}
                aria-labelledby="inventory-locked-title"
            >
                {lockedReason && (
                    <>
                        <header className="inventory-dialog__heading">
                            <div>
                                <p className="inventory-page__eyebrow">TÀI KHOẢN KIỂM KÊ</p>
                                <h2 id="inventory-locked-title">Tài khoản đã bị khóa</h2>
                            </div>
                            <button className="inventory-page__secondary" onClick={() => setLockedReason('')} type="button">Đóng</button>
                        </header>
                        <p className="inventory-dialog__reason">{lockedReason}</p>
                    </>
                )}
            </dialog>
        </section>
    );
}