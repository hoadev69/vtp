import React from 'react';

function ThemeButton({ theme, onToggle, compact = false }) {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    const label = nextTheme === 'dark' ? 'Bật giao diện tối' : 'Bật giao diện sáng';

    return (
        <button
            className={`navigation__theme${compact ? ' navigation__theme--compact' : ''}`}
            type="button"
            onClick={onToggle}
            aria-label={label}
            title={label}
            aria-pressed={theme === 'dark'}
        >
            <span aria-hidden="true">{theme === 'dark' ? '\u2600' : '\u263e'}</span>
            {!compact && <span className="navigation__theme-label">{theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}</span>}
        </button>
    );
}

function InstallButton({ onInstall, compact = false }) {
    return (
        <button
            className={`navigation__install${compact ? ' navigation__install--compact' : ''}`}
            type="button"
            onClick={onInstall}
            aria-label="Cài đặt VTP"
            title="Cài đặt VTP"
        >
            <span aria-hidden="true">↓</span>
            {!compact && <span className="navigation__install-label">Cài đặt</span>}
        </button>
    );
}

function NavigationIcon({ name }) {
    const icons = {
        home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9M9 21v-8h6v8" /></>,
        inventory: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M9 5V3h6v2M8 11h8M8 15h5" /></>,
        admin: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
        logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></>,
    };

    return (
        <svg aria-hidden="true" className="navigation__icon" fill="none" viewBox="0 0 24 24">
            {icons[name]}
        </svg>
    );
}

function AccountArea({ authUser, authStatus, onLogout, isLoggingOut, logoutError }) {
    if (!authUser) {
        const label = authStatus === 'checking'
            ? 'Đang kiểm tra phiên...'
            : authStatus === 'error' ? 'Không xác minh được phiên' : 'Chưa đăng nhập';

        return <span className="navigation__session" role={authStatus === 'error' ? 'alert' : 'status'}>{label}</span>;
    }

    return (
        <div className="navigation__account" aria-busy={isLoggingOut}>
            <span className="navigation__identity">
                <span className="navigation__role">{authUser.role === 'admin' ? 'Quản trị' : 'Operator'}</span>
                <span className="navigation__username" title={authUser.username}>{authUser.username}</span>
            </span>
            <button
                className="navigation__logout"
                disabled={isLoggingOut}
                onClick={onLogout}
                title="Đăng xuất"
                type="button"
            >
                <NavigationIcon name="logout" />
                <span className="navigation__logout-label">{isLoggingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}</span>
            </button>
            {logoutError && <span className="navigation__logout-error" role="alert">{logoutError}</span>}
        </div>
    );
}

function NavigationLink({ link, compact }) {
    return (
        <a
            aria-current={link.isActive ? 'page' : undefined}
            aria-label={link.accessibleLabel || link.label}
            className={`app-navigation__link${compact ? ' bottom-navigation__link' : ''}${link.isActive ? ' is-active' : ''}`}
            href={link.href}
            title={link.accessibleLabel || link.label}
        >
            <NavigationIcon name={link.icon} />
            <span>{compact ? link.compactLabel : link.label}</span>
        </a>
    );
}

export default function Navigation({
    theme,
    onThemeToggle,
    canInstall,
    onInstall,
    authUser,
    authStatus,
    currentPath,
    onLogout,
    isLoggingOut,
    logoutError,
}) {
    const normalizedPath = currentPath.replace(/\/+$/, '') || '/';
    const links = [
        {
            href: '/', label: 'Trang chủ', compactLabel: 'Trang chủ', icon: 'home',
        },
        {
            href: '/kiemke', label: 'Kiểm kê', compactLabel: 'Kiểm kê', icon: 'inventory',
        },
    ];

    if (authUser?.role === 'admin') {
        links.push({ href: '/admin', label: 'Quản trị', compactLabel: 'Quản trị', icon: 'admin' });
    }

    links.forEach(link => {
        link.isActive = normalizedPath === link.href;
    });

    return (
        <>
            <header className="app-navigation app-navigation--desktop">
                <div className="app-navigation__inner">
                    <span className="app-navigation__brand">VTP</span>
                    <nav className="app-navigation__links" aria-label="Điều hướng chính">
                        {links.map(link => <NavigationLink key={link.href} link={link} />)}
                    </nav>
                    <div className="app-navigation__actions">
                        <AccountArea
                            authStatus={authStatus}
                            authUser={authUser}
                            isLoggingOut={isLoggingOut}
                            logoutError={logoutError}
                            onLogout={onLogout}
                        />
                        <div className="app-navigation__utility">
                            {canInstall && <InstallButton onInstall={onInstall} />}
                            <ThemeButton theme={theme} onToggle={onThemeToggle} />
                        </div>
                    </div>
                </div>
            </header>

            <header className="app-navigation app-navigation--mobile">
                <span className="app-navigation__brand">VTP</span>
                <AccountArea
                    authStatus={authStatus}
                    authUser={authUser}
                    isLoggingOut={isLoggingOut}
                    logoutError={logoutError}
                    onLogout={onLogout}
                />
            </header>

            <nav className="bottom-navigation" aria-label="Điều hướng ứng dụng">
                {links.map(link => <NavigationLink compact key={link.href} link={link} />)}
                {canInstall && <InstallButton onInstall={onInstall} compact />}
                <ThemeButton theme={theme} onToggle={onThemeToggle} compact />
            </nav>
        </>
    );
}