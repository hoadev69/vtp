import React, { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../../shared/api/client.js';
import InputControl from '../../shared/components/InputControl.jsx';
import { useAppNavigation } from '../../shared/NavigationContext.jsx';
import OrderDetailDialog from './OrderDetailDialog.jsx';
import { getAdminErrorMessage } from './adminManagementUtils.js';

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function creatorIdentity(order) {
    return [order.creator_username, order.legacy_username].find(value => typeof value === 'string' && value.trim())
        || (order.ip && order.ip !== 'unknown' ? order.ip : 'Chưa ghi nhận IP');
}

export default function OrderManagementPage({ onSessionExpired }) {
    const navigate = useAppNavigation();
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [barcodeLookup, setBarcodeLookup] = useState('');
    const [page, setPage] = useState(1);
    const [result, setResult] = useState(null);
    const [ipSummary, setIpSummary] = useState(null);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [listError, setListError] = useState('');
    const [summaryError, setSummaryError] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let current = true;
        const query = new URLSearchParams({ page: String(page), search });
        if (barcodeLookup) query.set('barcode', barcodeLookup);
        setIsLoading(true);
        setListError('');
        apiRequest(`/api/admin/history?${query}`)
            .then(data => { if (current) setResult(data); })
            .catch(error => {
                if (!current) return;
                if (error instanceof ApiError && error.status === 401) onSessionExpired('login');
                else if (error instanceof ApiError && error.status === 403) onSessionExpired('forbidden');
                else setListError(getAdminErrorMessage(error, 'Không thể tải lịch sử đơn hàng.'));
                setResult(null);
            })
            .finally(() => { if (current) setIsLoading(false); });
        return () => { current = false; };
    }, [page, search, barcodeLookup, onSessionExpired]);

    useEffect(() => {
        let current = true;
        setSummaryError('');
        apiRequest('/api/admin/ips')
            .then(rows => { if (current) setIpSummary(rows); })
            .catch(error => {
                if (!current) return;
                if (error instanceof ApiError && error.status === 401) onSessionExpired('login');
                else if (error instanceof ApiError && error.status === 403) onSessionExpired('forbidden');
                else setSummaryError(getAdminErrorMessage(error, 'Không thể tải tổng quan IP.'));
                setIpSummary(null);
            });
        return () => { current = false; };
    }, [onSessionExpired]);

    function submitSearch(event) {
        event.preventDefault();
        setPage(1);
        const normalizedSearch = searchInput.trim();
        setSearch(normalizedSearch.slice(0, 120));
        setBarcodeLookup(normalizedSearch.slice(0, 512));
    }

    function clearSearch() {
        setSearchInput('');
        setSearch('');
        setBarcodeLookup('');
        setPage(1);
    }

    function printSelectedOrder(order) {
        if (!window.confirm(`In lại tem từ đơn ${order.barcode}?`)) return;
        const query = new URLSearchParams({
            barcode: order.barcode,
            chonHuyen: order.district,
            chonXa: order.commune,
            chonThon: order.village,
        });
        Object.entries(order.fields || {}).forEach(([key, value]) => query.set(key, value));
        navigate(`/ketqua.html?${query}`);
    }

    const pages = Math.max(1, result?.pages || 1);
    const rows = result?.rows || [];
    const blockedCount = ipSummary?.filter(entry => Boolean(entry.blocked)).length;

    return (
        <section className="admin-dashboard" aria-labelledby="admin-dashboard-title">
            <header className="admin-dashboard__topline"><div><p className="admin-eyebrow">THEO DÕI HOẠT ĐỘNG</p><h1 id="admin-dashboard-title">Tổng quan hệ thống</h1></div></header>
            <div className="admin-metrics" aria-label="Thống kê hệ thống">
                <article className="admin-metric"><span>Đơn phù hợp</span><strong>{result ? Number(result.total).toLocaleString('vi-VN') : '—'}</strong></article>
                <article className="admin-metric"><span>Tổng lượt tạo mã</span><strong>{result ? Number(result.generatedCodeTotal).toLocaleString('vi-VN') : '—'}</strong></article>
                <article className="admin-metric"><span>Địa chỉ IP</span><strong>{ipSummary ? ipSummary.length.toLocaleString('vi-VN') : '—'}</strong></article>
                <article className="admin-metric admin-metric--blocked"><span>IP đang chặn</span><strong>{blockedCount == null ? '—' : blockedCount.toLocaleString('vi-VN')}</strong></article>
            </div>
            {summaryError && <p className="admin-message admin-message--error" role="alert">{summaryError}</p>}
            {result?.barcodeResolution?.status === 'ambiguous' && (
                <p className="admin-message" role="status">
                    Mã {result.barcodeResolution.barcode} có {result.barcodeResolution.count} đơn lịch sử. Chọn đúng dòng đơn cần xem hoặc in lại.
                </p>
            )}
            {result?.barcodeResolution?.status === 'released' && (
                <p className="admin-message" role="status">Mã này đã được giải phóng sau khi hết thời hạn lưu lịch sử.</p>
            )}

            <section className="admin-orders" aria-labelledby="admin-orders-title">
                <div className="admin-orders__heading">
                    <div><p className="admin-eyebrow">ĐƠN HÀNG</p><h2 id="admin-orders-title">Lịch sử tạo tem</h2></div>
                    <form className="admin-search" onSubmit={submitSearch} role="search">
                        <label htmlFor="admin-order-search">Tìm mã, địa chỉ, IP hoặc người tạo</label>
                        <div className="admin-search__controls">
                            <InputControl className="admin-search__input" clearLabel="tìm kiếm đơn hàng" clearable id="admin-order-search" onChange={event => setSearchInput(event.target.value)} onClear={() => setSearchInput('')} placeholder="Nhập nội dung tìm kiếm" type="search" value={searchInput} />
                            <button className="admin-primary-button" type="submit">Tìm kiếm</button>
                        </div>
                    </form>
                </div>

                {listError && <p className="admin-message admin-message--error" role="alert">{listError}</p>}
                {isLoading ? <p className="admin-list-state" role="status">Đang tải lịch sử...</p>
                    : rows.length === 0 ? <p className="admin-list-state">{search ? 'Không tìm thấy đơn phù hợp.' : 'Chưa có lịch sử đơn hàng.'}</p>
                        : <div className="admin-table-scroll"><table className="admin-order-table">
                            <thead><tr><th>Thời gian</th><th>Mã vận đơn</th><th>Người nhận / SĐT</th><th>Địa chỉ</th><th>IP</th><th>Người tạo</th><th>Chi tiết</th></tr></thead>
                            <tbody>{rows.map(order => {
                                const address = [order.district, order.commune, order.village].filter(Boolean).join(' · ') || '—';
                                return <tr key={order.id}>
                                    <td data-label="Thời gian">{formatDate(order.created_at)}</td>
                                    <td className="admin-order-code" data-label="Mã vận đơn">{order.barcode || '—'}</td>
                                    <td data-label="Người nhận / SĐT"><span>{order.fields?.nhapTen || '—'}</span><small>{order.fields?.nhapSdt || '—'}</small></td>
                                    <td data-label="Địa chỉ">{address}</td>
                                    <td data-label="IP">{order.ip === 'unknown' ? 'Chưa ghi nhận IP' : order.ip || '—'}</td>
                                    <td data-label="Người tạo">{creatorIdentity(order)}</td>
                                    <td data-label="Chi tiết"><button className="admin-secondary-button" onClick={() => setSelectedOrder(order)} type="button">Xem chi tiết</button></td>
                                </tr>;
                            })}</tbody>
                        </table></div>}

                <footer className="admin-pagination" aria-label="Phân trang đơn hàng">
                    <span>{result ? `Trang ${result.page} / ${pages} · ${Number(result.total).toLocaleString('vi-VN')} đơn` : ' '}</span>
                    <div>
                        <button className="admin-secondary-button" disabled={isLoading || page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} type="button">Trang trước</button>
                        <button className="admin-secondary-button" disabled={isLoading || page >= pages} onClick={() => setPage(value => Math.min(pages, value + 1))} type="button">Trang sau</button>
                    </div>
                </footer>
            </section>
            <OrderDetailDialog onClose={() => setSelectedOrder(null)} onPrintAgain={printSelectedOrder} order={selectedOrder} />
        </section>
    );
}