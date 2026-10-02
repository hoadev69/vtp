import React, { Component, useCallback, useEffect, useState } from 'react';
import AppShell from '../shared/components/AppShell.jsx';
import { NavigationContext } from '../shared/NavigationContext.jsx';
import AdminPage from '../features/admin/AdminPage.jsx';
import InventoryPage from '../features/inventory/InventoryPage.jsx';
import PublicOrderPage from '../features/orders/PublicOrderPage.jsx';
import OrderResultPage from '../features/orders/OrderResultPage.jsx';
import '../styles/app-shell.css';
import '../features/orders/order.css';
import '../features/orders/result.css';
import '../features/admin/admin.css';

function readLocation() {
    return {
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
    };
}

class PageErrorBoundary extends Component {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <section className="app-route-error" aria-labelledby="app-route-error-title" role="alert">
                <h1 id="app-route-error-title">Không thể tải trang</h1>
                <p>Đã xảy ra lỗi khi hiển thị nội dung. Vui lòng thử lại.</p>
                <button className="app-route-error__retry" onClick={() => this.setState({ hasError: false })} type="button">
                    Thử tải lại
                </button>
            </section>
        );
    }
}

export default function App() {
    const [location, setLocation] = useState(readLocation);
    const path = location.pathname.replace(/\/+$/, '') || '/';
    const isAdminPage = path.endsWith('/admin');
    const isInventoryPage = path.endsWith('/kiemke');
    const isResultPage = path.endsWith('/ketqua.html');
    const navigate = useCallback(destination => {
        const nextUrl = new URL(destination, window.location.href);
        if (nextUrl.origin !== window.location.origin) {
            window.location.assign(nextUrl.href);
            return;
        }

        if (nextUrl.href === window.location.href) return;
        window.history.pushState({}, '', nextUrl.href);
        setLocation(readLocation());
        window.scrollTo(0, 0);
    }, []);

    useEffect(() => {
        const handlePopState = () => setLocation(readLocation());
        const handleInternalLink = event => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (!(event.target instanceof Element)) return;

            const anchor = event.target.closest('a[href]');
            if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;

            const nextUrl = new URL(anchor.href, window.location.href);
            if (nextUrl.origin !== window.location.origin) return;
            if (nextUrl.pathname === window.location.pathname && nextUrl.search === window.location.search) {
                if (!nextUrl.hash || nextUrl.hash === window.location.hash) event.preventDefault();
                return;
            }

            event.preventDefault();
            navigate(nextUrl.href);
        };

        window.addEventListener('popstate', handlePopState);
        document.addEventListener('click', handleInternalLink);
        return () => {
            window.removeEventListener('popstate', handlePopState);
            document.removeEventListener('click', handleInternalLink);
        };
    }, []);

    return (
        <NavigationContext.Provider value={navigate}>
            <AppShell currentPath={path}>
                {({ authUser, authStatus, retryAuth }) => {
                    const page = isAdminPage
                        ? <AdminPage authUser={authUser} authStatus={authStatus} onRetryAuth={retryAuth} />
                        : isInventoryPage
                            ? <InventoryPage authUser={authUser} authStatus={authStatus} onRetryAuth={retryAuth} />
                            : isResultPage ? <OrderResultPage /> : <PublicOrderPage />;

                    return (
                        <PageErrorBoundary key={`${path}${location.search}`}>
                            <div className="app-route-content">{page}</div>
                        </PageErrorBoundary>
                    );
                }}
            </AppShell>
        </NavigationContext.Provider>
    );
}