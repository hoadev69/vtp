(() => {
    const themeKey = 'vtp-theme';
    const root = document.documentElement;
    let savedTheme = 'light';
    try {
        savedTheme = localStorage.getItem(themeKey) === 'dark' ? 'dark' : 'light';
    } catch {
        savedTheme = 'light';
    }
    root.dataset.theme = savedTheme;

    const initializeNavigation = () => {
    const navigation = document.querySelector('[data-vtp-navigation]');
    if (!navigation) return;

    const links = navigation.querySelector('[data-vtp-nav-links]');
    const account = navigation.querySelector('[data-vtp-nav-account]');
    if (!links || !account) return;

    let authCheckVersion = 0;
    let currentUsername = '';
    const themeToggle = document.createElement('button');
    themeToggle.type = 'button';
    themeToggle.className = 'vtp-theme-toggle';
    themeToggle.addEventListener('click', () => {
        const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = nextTheme;
        try {
            localStorage.setItem(themeKey, nextTheme);
        } catch {
            // Keep the selected theme for this page if storage is unavailable.
        }
        updateThemeToggle();
    });

    function updateThemeToggle() {
        const darkTheme = root.dataset.theme === 'dark';
        themeToggle.textContent = darkTheme ? '\u2600' : '\u263e';
        themeToggle.title = darkTheme ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
        themeToggle.setAttribute('aria-label', themeToggle.title);
        themeToggle.setAttribute('aria-pressed', String(darkTheme));
    }

    function activePage() {
        const pathname = window.location.pathname;
        if (pathname === '/kiemke') return 'inventory';
        if (pathname === '/admin') return 'admin';
        return 'home';
    }

    function setRole(role, username = '') {
        currentUsername = username;
        authCheckVersion += 1;
        if (navigation.classList.contains('topbar')) navigation.hidden = false;

        const items = [
            { id: 'home', href: '/', label: 'Trang chủ / Tạo mã' },
            { id: 'inventory', href: '/kiemke', label: 'Kiểm kê' },
        ];
        if (role === 'admin') items.push({ id: 'admin', href: '/admin', label: 'Quản trị' });

        links.replaceChildren(...items.map(item => {
            const link = document.createElement('a');
            link.href = item.href;
            link.textContent = item.label;
            link.className = 'vtp-nav-link';
            if (item.id === activePage()) {
                link.classList.add('is-active');
                link.setAttribute('aria-current', 'page');
            }
            return link;
        }), themeToggle);

        const hasPageAccount = account.matches('.topbar-actions, #operatorActions')
            || account.querySelector('#adminName, #logoutButton, #operatorActions');
        if (hasPageAccount) {
            account.hidden = role === null;
            return;
        }

        account.replaceChildren();
        account.hidden = role === null;
        if (role === null) return;

        const accountName = document.createElement('span');
        accountName.className = 'vtp-nav-account-name';
        accountName.textContent = currentUsername;
        const logout = document.createElement('button');
        logout.type = 'button';
        logout.className = 'vtp-nav-logout';
        logout.textContent = 'Đăng xuất';
        logout.addEventListener('click', async () => {
            logout.disabled = true;
            try {
                const response = await fetch('/api/logout', { method: 'POST' });
                if (!response.ok && response.status !== 401) throw new Error('Đăng xuất không thành công.');
                setRole(null);
                window.dispatchEvent(new CustomEvent('vtp:authchange', { detail: { role: null } }));
            } catch {
                logout.disabled = false;
                accountName.textContent = 'Không thể đăng xuất';
            }
        });
        account.append(accountName, logout);
    }

    async function refreshRole() {
        const version = ++authCheckVersion;
        try {
            const inventoryResponse = await fetch('/api/kiemke/me');
            if (version !== authCheckVersion) return;

            if (inventoryResponse.ok) {
                const inventoryUser = await inventoryResponse.json();
                const adminResponse = await fetch('/api/admin/me');
                if (version !== authCheckVersion) return;
                if (adminResponse.ok) {
                    const admin = await adminResponse.json();
                    setRole('admin', admin.username);
                } else if (adminResponse.status === 403) {
                    setRole('operator', inventoryUser.username);
                } else {
                    setRole(null);
                }
                return;
            }

            const adminResponse = await fetch('/api/admin/me');
            if (version !== authCheckVersion) return;
            if (adminResponse.ok) {
                const admin = await adminResponse.json();
                setRole('admin', admin.username);
            } else {
                setRole(null);
            }
        } catch {
            if (version === authCheckVersion) setRole(null);
        }
    }

    window.addEventListener('vtp:authchange', event => {
        if (event.detail && Object.prototype.hasOwnProperty.call(event.detail, 'role')) {
            setRole(event.detail.role, event.detail.username || '');
        } else {
            refreshRole();
        }
    });

    const clearableSelector = [
        'input[type="text"]', 'input[type="search"]', 'input[type="email"]',
        'input[type="tel"]', 'input[type="url"]', 'input[type="number"]', 'textarea',
    ].join(',');
    const clearButtons = new WeakMap();

    function updateClearButton(input, button, wrapper) {
        const hasValue = input.value.length > 0 && !input.hidden && !input.disabled;
        button.hidden = !hasValue;
        wrapper.classList.toggle('has-value', hasValue);
    }

    function addClearButton(input) {
        if (input.dataset.vtpClearReady === 'true' || input.disabled || input.readOnly) return;
        input.dataset.vtpClearReady = 'true';
        const wrapper = document.createElement('span');
        wrapper.className = 'vtp-clearable-input';
        input.parentNode.insertBefore(wrapper, input);
        wrapper.append(input);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'vtp-clear-button';
        button.setAttribute('aria-label', 'Xóa nội dung');
        button.textContent = '×';
        wrapper.append(button);
        clearButtons.set(input, { button, wrapper });

        const update = () => updateClearButton(input, button, wrapper);
        input.addEventListener('input', update);
        input.addEventListener('change', update);
        button.addEventListener('pointerdown', event => event.preventDefault());
        button.addEventListener('click', event => {
            event.preventDefault();
            if (input.disabled || input.readOnly) return;
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus({ preventScroll: true });
        });
        input.form?.addEventListener('reset', () => requestAnimationFrame(update));
        update();
    }

    function scanClearableInputs(root) {
        if (root instanceof Element && root.matches(clearableSelector)) addClearButton(root);
        root.querySelectorAll?.(clearableSelector).forEach(addClearButton);
    }

    scanClearableInputs(document);
    new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'attributes') {
                const clearControl = clearButtons.get(record.target);
                if (clearControl) updateClearButton(record.target, clearControl.button, clearControl.wrapper);
                continue;
            }
            for (const node of record.addedNodes) {
                if (node instanceof Element) scanClearableInputs(node);
            }
        }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });

    const updateKeyboardInset = () => {
        const viewport = window.visualViewport;
        const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
        document.documentElement.style.setProperty('--vtp-keyboard-inset', `${inset}px`);
    };
    window.visualViewport?.addEventListener('resize', updateKeyboardInset);
    window.visualViewport?.addEventListener('scroll', updateKeyboardInset);
    updateKeyboardInset();
    updateThemeToggle();
    refreshRole();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeNavigation, { once: true });
    } else {
        initializeNavigation();
    }
})();