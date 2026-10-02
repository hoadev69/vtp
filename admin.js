const historyRows = document.getElementById('historyRows');
const inventoryAccountRows = document.getElementById('inventoryAccountRows');
const inventoryOrdersRows = document.getElementById('inventoryOrdersRows');
const anonymousUserRows = document.getElementById('anonymousUserRows');
const ipRows = document.getElementById('ipRows');
const historyError = document.getElementById('historyError');
const inventoryAccountsError = document.getElementById('inventoryAccountsError');
const inventoryOrdersError = document.getElementById('inventoryOrdersError');
const inventoryAccountCreateDialog = document.getElementById('inventoryAccountCreateDialog');
const inventoryAccountCreateError = document.getElementById('inventoryAccountCreateError');
const lockInventoryAccountDialog = document.getElementById('lockInventoryAccountDialog');
const lockInventoryAccountError = document.getElementById('lockInventoryAccountError');
const resetInventoryPasswordDialog = document.getElementById('resetInventoryPasswordDialog');
const resetInventoryPasswordError = document.getElementById('resetInventoryPasswordError');
const anonymousUsersError = document.getElementById('anonymousUsersError');
const ipError = document.getElementById('ipError');
const searchInput = document.getElementById('searchInput');
const inventoryAccountSearch = document.getElementById('inventoryAccountSearch');
const anonymousUserSearch = document.getElementById('anonymousUserSearch');
let currentPage = 1;
let totalPages = 1;
let inventoryAccountCurrentPage = 1;
let inventoryAccountTotalPages = 1;
let inventoryOrdersCurrentPage = 1;
let inventoryOrdersTotalPages = 1;
let anonymousCurrentPage = 1;
let anonymousTotalPages = 1;
let searchTimer;
let inventoryAccountSearchTimer;
let activeInventoryAccountId = null;
let activeLockInventoryAccountId = null;
let activeResetInventoryAccountId = null;
let activeInventoryOrdersDay = 'today';
let anonymousSearchTimer;
let showBlockedOnly = false;
const recreationEntries = new Map();

class AdminSessionExpiredError extends Error {
    constructor() {
        super('Phiên quản trị đã hết hạn.');
        this.name = 'AdminSessionExpiredError';
        this.code = 'ADMIN_SESSION_EXPIRED';
    }
}

class StaleAdminRequestError extends Error {
    constructor() {
        super('Yêu cầu thuộc phiên quản trị cũ.');
        this.name = 'StaleAdminRequestError';
        this.code = 'STALE_ADMIN_REQUEST';
    }
}

function isAdminRequestInterruption(error) {
    return error instanceof AdminSessionExpiredError || error instanceof StaleAdminRequestError;
}

function assertCurrentAdminRequest(generation) {
    if (generation !== authGeneration || authState !== 'authenticated') {
        throw new StaleAdminRequestError();
    }
}

async function api(url, options = {}) {
    const requestGeneration = authGeneration;
    const response = await fetch(url, options);
    if (requestGeneration !== authGeneration) throw new StaleAdminRequestError();
    if (response.status === 401 && url.startsWith('/api/admin/')) {
        handleAdminUnauthorized();
        throw new AdminSessionExpiredError();
    }
    const result = response.status === 204 ? null : await response.json();
    if (requestGeneration !== authGeneration) throw new StaleAdminRequestError();
    if (!response.ok) throw new Error(result?.error || 'Yêu cầu thất bại.');
    return result;
}

function appendCell(row, value, className = '') {
    const cell = document.createElement('td');
    cell.textContent = value || '—';
    if (className) cell.className = className;
    row.append(cell);
    return cell;
}

function setEditingMode(row, editing) {
    row.classList.toggle('is-editing', editing);
    row.querySelectorAll('[data-view-control]').forEach(control => { control.hidden = editing; });
    row.querySelectorAll('[data-edit-control]').forEach(control => { control.hidden = !editing; });
}

function restoreRowValues(group, row) {
    if (group === 'ips') {
        row.querySelector('.ip-label').value = row.dataset.label;
    } else if (group === 'geography' && row.dataset.rowType === 'district') {
        row.querySelector('.district-name').value = row.dataset.name;
        row.querySelector('.district-kind').value = row.dataset.kind;
    } else if (group === 'geography' && row.dataset.rowType === 'commune') {
        row.querySelector('.commune-name').value = row.dataset.name;
        row.querySelector('.commune-district').value = row.dataset.parentDistrictId;
    } else if (group === 'geography' && row.dataset.rowType === 'village') {
        row.querySelector('.village-name').value = row.dataset.name;
        row.querySelector('.village-commune').value = row.dataset.parentCommuneId;
    } else if (group === 'fields') {
        row.querySelector('.form-field-label').value = row.dataset.label;
        row.querySelector('.form-field-visible').checked = row.dataset.visible === 'true';
        row.querySelector('.form-field-default').value = row.dataset.defaultValue;
    }
}

function getEditGroupRows(group) {
    if (group === 'ips') return [...document.querySelectorAll('#ipRows tr[data-ip]')];
    if (group === 'geography') {
        return [...document.querySelectorAll('#districtRows tr[data-district-id], #communeRows tr[data-commune-id], #villageRows tr[data-village-id]')];
    }
    return [...document.querySelectorAll('#formFieldRows tr[data-field-key]')];
}

function setGroupActionsVisible(group, visible) {
    document.querySelectorAll(`[data-group-action][data-group="${group}"]`)
        .forEach(button => { button.hidden = !visible; });
    document.querySelectorAll(`[data-edit-form-group="${group}"]`)
        .forEach(form => { form.hidden = !visible; });
}

function rowHasChanges(group, row) {
    if (group === 'ips') return row.querySelector('.ip-label').value.trim() !== row.dataset.label;
    if (group === 'geography' && row.dataset.rowType === 'district') {
        return row.querySelector('.district-name').value.trim() !== row.dataset.name
            || row.querySelector('.district-kind').value !== row.dataset.kind;
    }
    if (group === 'geography' && row.dataset.rowType === 'commune') {
        return row.querySelector('.commune-name').value.trim() !== row.dataset.name
            || row.querySelector('.commune-district').value !== String(row.dataset.parentDistrictId);
    }
    if (group === 'geography' && row.dataset.rowType === 'village') {
        return row.querySelector('.village-name').value.trim() !== row.dataset.name
            || row.querySelector('.village-commune').value !== String(row.dataset.parentCommuneId);
    }
    return row.querySelector('.form-field-label').value.trim() !== row.dataset.label
        || row.querySelector('.form-field-visible').checked !== (row.dataset.visible === 'true')
        || row.querySelector('.form-field-default').value !== row.dataset.defaultValue;
}

async function saveEditGroup(group) {
    const rows = getEditGroupRows(group).filter(row => row.classList.contains('is-editing'));
    const errorElement = document.getElementById(group === 'ips' ? 'ipError'
        : group === 'geography' ? 'geographyError' : 'formFieldsError');
    errorElement.hidden = true;
    let savedCount = 0;

    try {
        setSaveStatus('Đang lưu...', 'pending');
        for (const row of rows) {
            if (!rowHasChanges(group, row)) continue;

            if (group === 'ips') {
                const label = row.querySelector('.ip-label').value.trim();
                await api('/api/admin/ips', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ip: row.dataset.ip, label, blocked: row.dataset.blocked === 'true' }),
                });
                row.dataset.label = label;
                row.querySelector('.ip-label-text').textContent = label || 'Chưa đặt tên';
            } else if (group === 'geography' && row.dataset.rowType === 'district') {
                const name = row.querySelector('.district-name').value.trim();
                const kind = row.querySelector('.district-kind').value;
                await api(`/api/admin/districts/${row.dataset.districtId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, kind }),
                });
                row.dataset.name = name;
                row.dataset.kind = kind;
                row.querySelector('.district-name-text').textContent = name;
                row.querySelector('.district-kind-text').textContent = kind === 'city' ? 'Thành phố' : 'Huyện';
            } else if (group === 'geography' && row.dataset.rowType === 'commune') {
                const name = row.querySelector('.commune-name').value.trim();
                const parentDistrictId = row.querySelector('.commune-district').value;
                await api(`/api/admin/communes/${row.dataset.communeId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, districtId: parentDistrictId }),
                });
                row.dataset.name = name;
                row.dataset.parentDistrictId = parentDistrictId;
                row.querySelector('.commune-name-text').textContent = name;
                row.querySelector('.commune-district-text').textContent = row.querySelector('.commune-district').selectedOptions[0]?.textContent || '—';
            } else if (group === 'geography' && row.dataset.rowType === 'village') {
                const name = row.querySelector('.village-name').value.trim();
                const parentCommuneId = row.querySelector('.village-commune').value;
                await api(`/api/admin/villages/${row.dataset.villageId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, communeId: parentCommuneId }),
                });
                row.dataset.name = name;
                row.dataset.parentCommuneId = parentCommuneId;
                row.querySelector('.village-name-text').textContent = name;
                row.querySelector('.village-commune-text').textContent = row.querySelector('.village-commune').selectedOptions[0]?.textContent || '—';
            } else {
                const label = row.querySelector('.form-field-label').value.trim();
                const visible = row.querySelector('.form-field-visible').checked;
                const defaultValue = row.querySelector('.form-field-default').value;
                await api(`/api/admin/form-fields/${encodeURIComponent(row.dataset.fieldKey)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label, visible, defaultValue }),
                });
                row.dataset.label = label;
                row.dataset.visible = String(visible);
                row.dataset.defaultValue = defaultValue;
                row.querySelector('.form-field-label-text').textContent = label;
                const visibilityText = row.querySelector('.form-field-visible-text');
                visibilityText.textContent = visible ? 'Đang hiện' : 'Đang ẩn';
                visibilityText.classList.toggle('hidden', !visible);
                row.querySelector('.form-field-default-text').textContent = defaultValue || '—';
            }
            savedCount += 1;
        }

        if (group === 'geography' && savedCount > 0) await syncGeographySummary();
        if (group === 'ips' && savedCount > 0) await loadHistory();
        setSaveStatus(savedCount ? `Đã lưu ${savedCount} mục` : 'Không có thay đổi');
        return true;
    } catch (error) {
        if (isAdminRequestInterruption(error)) return false;
        setSaveStatus('Lỗi lưu', 'error');
        errorElement.textContent = error.message;
        errorElement.hidden = false;
        return false;
    }
}

document.querySelectorAll('[data-group-action]').forEach(button => {
    button.addEventListener('click', () => {
        const group = button.dataset.group;
        if (button.dataset.groupAction === 'save') {
            saveEditGroup(group);
            return;
        }
        getEditGroupRows(group)
            .filter(row => row.classList.contains('is-editing'))
            .forEach(row => restoreRowValues(group, row));
        setSaveStatus('Đã hủy thay đổi');
    });
});

document.querySelectorAll('[data-edit-group]').forEach(button => {
    button.dataset.defaultText = button.textContent;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
        const group = button.dataset.editGroup;
        const editing = button.dataset.editing !== 'true';
        const rows = getEditGroupRows(group);

        if (!editing) {
            rows.forEach(row => {
                if (row.classList.contains('is-editing')) restoreRowValues(group, row);
                setEditingMode(row, false);
            });
            if (group === 'geography') {
                document.getElementById('districtForm').reset();
                document.getElementById('communeForm').reset();
            }
        } else {
            rows.filter(row => group !== 'ips' || row.dataset.ip !== 'unknown')
                .forEach(row => setEditingMode(row, true));
        }

        setGroupActionsVisible(group, editing);
        button.dataset.editing = String(editing);
        button.setAttribute('aria-pressed', String(editing));
        button.textContent = editing ? 'Thoát sửa' : button.dataset.defaultText;
    });
});

let saveStatusTimer;

function setSaveStatus(message, state = 'saved') {
    const status = document.getElementById('saveStatus');
    clearTimeout(saveStatusTimer);
    status.textContent = message;
    status.className = `save-status ${state}`;
    if (state === 'saved') {
        saveStatusTimer = setTimeout(() => {
            status.textContent = '';
            status.className = 'save-status';
        }, 2200);
    }
}

function formatDate(value) {
    return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
        .format(new Date(value));
}

function createRecreateButton(entry) {
    recreationEntries.set(String(entry.id), entry);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recreate-entry-button';
    button.dataset.recreateEntry = entry.id;
    button.textContent = 'Tạo lại';
    return button;
}

let activeRecreateEntry = null;

function openRecreateCode(entry) {
    activeRecreateEntry = entry;
    document.getElementById('recreateCodeError').hidden = true;
    document.getElementById('recreateCodeValue').textContent = entry.barcode;
    document.getElementById('recreateCodeAddress').textContent = [
        entry.village, entry.commune, entry.district,
    ].filter(Boolean).join(', ');
    document.getElementById('recreateBarcodeImage').src = `/api/barcode?text=${encodeURIComponent(entry.barcode)}`;
    document.getElementById('recreateQrImage').src = `/api/qrcode?text=${encodeURIComponent(entry.barcode)}`;

    const fieldNames = {
        nhapTen: 'Người nhận',
        nhapSdt: 'Số điện thoại',
        soHang: 'Số hàng',
        tenHang: 'Tên hàng',
    };
    const fieldList = document.getElementById('recreateFieldValues');
    fieldList.replaceChildren();
    for (const [key, value] of Object.entries(entry.fields || {})) {
        if (!value) continue;
        const term = document.createElement('dt');
        term.textContent = fieldNames[key] || key;
        const description = document.createElement('dd');
        description.textContent = value;
        fieldList.append(term, description);
    }

    document.getElementById('recreateCodeDialog').showModal();
}

document.getElementById('closeRecreateCode').addEventListener('click', () => {
    document.getElementById('recreateCodeDialog').close();
});

document.getElementById('recreateCodeDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});

document.getElementById('confirmRecreateCode').addEventListener('click', async event => {
    if (!activeRecreateEntry) return;
    const button = event.currentTarget;
    const errorMessage = document.getElementById('recreateCodeError');
    errorMessage.hidden = true;
    button.disabled = true;

    try {
        const response = await fetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                barcode: activeRecreateEntry.barcode,
                chonHuyen: activeRecreateEntry.district,
                chonXa: activeRecreateEntry.commune,
                chonThon: activeRecreateEntry.village,
                fields: activeRecreateEntry.fields || {},
            }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Không thể tạo lại mã.');
        const values = new URLSearchParams({
            barcode: activeRecreateEntry.barcode,
            chonHuyen: activeRecreateEntry.district,
            chonXa: activeRecreateEntry.commune,
            chonThon: activeRecreateEntry.village,
        });
        Object.entries(result.fields || {}).forEach(([key, value]) => values.set(key, value));
        window.location.assign(`/ketqua.html?${values}`);
    } catch (error) {
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
        button.disabled = false;
    }
});

const confirmDialog = document.getElementById('confirmDialog');
const confirmDialogTitle = document.getElementById('confirmDialogTitle');
const confirmDialogMessage = document.getElementById('confirmDialogMessage');
const confirmDialogCancelButton = document.getElementById('confirmDialogCancel');
const confirmDialogConfirmButton = document.getElementById('confirmDialogConfirm');
let activeConfirmResolve = null;
let confirmDialogOpener = null;

function resolveConfirmDialog(result) {
    if (!activeConfirmResolve) return;
    const resolve = activeConfirmResolve;
    activeConfirmResolve = null;
    resolve(result);
    if (confirmDialog.open) confirmDialog.close();
}

confirmDialogCancelButton.addEventListener('click', () => resolveConfirmDialog(false));
confirmDialogConfirmButton.addEventListener('click', () => resolveConfirmDialog(true));
confirmDialog.addEventListener('cancel', () => resolveConfirmDialog(false));
confirmDialog.addEventListener('click', event => {
    if (event.target === event.currentTarget) resolveConfirmDialog(false);
});
confirmDialog.addEventListener('close', () => {
    resolveConfirmDialog(false);
    const opener = confirmDialogOpener;
    confirmDialogOpener = null;
    if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus();
});

// Promise-based thay cho window.confirm/alert; chỉ 1 phiên xác nhận hoạt động tại một thời điểm.
function confirmAction({ title, message, confirmLabel = 'Xác nhận', danger = false }) {
    if (activeConfirmResolve || confirmDialog.open) return Promise.resolve(false);
    if (typeof confirmDialog.showModal !== 'function') {
        console.error('Trình duyệt không hỗ trợ hộp thoại xác nhận.');
        return Promise.resolve(false);
    }

    confirmDialogTitle.textContent = title || '';
    confirmDialogMessage.textContent = message || '';
    confirmDialogConfirmButton.textContent = confirmLabel;
    confirmDialogConfirmButton.classList.toggle('ui-button--danger', Boolean(danger));
    confirmDialogConfirmButton.classList.toggle('ui-button--primary', !danger);
    confirmDialogOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    return new Promise(resolve => {
        activeConfirmResolve = resolve;
        confirmDialog.showModal();
    });
}

let activeIpHistoryIp = '';
let activeIpHistoryPage = 1;
let activeIpHistoryPages = 1;

async function openIpHistory(ip, label) {
    activeIpHistoryIp = ip;
    activeIpHistoryPage = 1;
    document.getElementById('ipHistoryTitle').textContent = 'Mã tạo gần đây';
    document.getElementById('ipHistoryLabel').textContent = label ? `${label} · ${ip}` : ip;
    const dialog = document.getElementById('ipHistoryDialog');
    if (!dialog.open) dialog.showModal();
    await loadIpHistory();
}

async function loadIpHistory() {
    const errorMessage = document.getElementById('ipHistoryError');
    const rows = document.getElementById('ipHistoryRows');
    const requestGeneration = authGeneration;
    errorMessage.hidden = true;
    try {
        const query = new URLSearchParams({ page: String(activeIpHistoryPage) });
        const result = await api(`/api/admin/ips/${encodeURIComponent(activeIpHistoryIp)}/history?${query}`);
        assertCurrentAdminRequest(requestGeneration);
        activeIpHistoryPages = result.pages;
        document.getElementById('ipHistoryPageLabel').textContent = `Trang ${result.page} / ${result.pages} · ${result.total.toLocaleString('vi-VN')} mã`;
        document.getElementById('previousIpHistoryPage').disabled = result.page <= 1;
        document.getElementById('nextIpHistoryPage').disabled = result.page >= result.pages;
        rows.replaceChildren();

        if (result.rows.length === 0) {
            appendEmptyRow(rows, 'IP này chưa có mã nào.', 6);
            return;
        }

        for (const entry of result.rows) {
            const row = document.createElement('tr');
            appendCell(row, formatDate(entry.created_at));
            appendCell(row, entry.barcode);
            appendCell(row, entry.district);
            appendCell(row, entry.commune);
            appendCell(row, entry.village);
            const actionCell = document.createElement('td');
            actionCell.append(createRecreateButton(entry));
            row.append(actionCell);
            rows.append(row);
        }
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }
}

document.getElementById('closeIpHistory').addEventListener('click', () => {
    document.getElementById('ipHistoryDialog').close();
});

document.getElementById('ipHistoryDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});

document.getElementById('previousIpHistoryPage').addEventListener('click', () => {
    if (activeIpHistoryPage > 1) activeIpHistoryPage -= 1;
    loadIpHistory();
});

document.getElementById('nextIpHistoryPage').addEventListener('click', () => {
    if (activeIpHistoryPage < activeIpHistoryPages) activeIpHistoryPage += 1;
    loadIpHistory();
});

async function loadHistory() {
    const requestGeneration = authGeneration;
    historyError.hidden = true;
    const query = new URLSearchParams({ page: String(currentPage), search: searchInput.value.trim() });
    try {
        const result = await api(`/api/admin/history?${query}`);
        assertCurrentAdminRequest(requestGeneration);
        totalPages = result.pages;
        document.getElementById('historyCount').textContent = result.total.toLocaleString('vi-VN');
        document.getElementById('pageLabel').textContent = `Trang ${result.page} / ${result.pages}`;
        document.getElementById('previousPage').disabled = result.page <= 1;
        document.getElementById('nextPage').disabled = result.page >= result.pages;
        historyRows.replaceChildren();

        if (result.rows.length === 0) {
            const row = document.createElement('tr');
            const cell = appendCell(row, 'Chưa có lịch sử phù hợp.');
            cell.colSpan = 8;
            cell.className = 'empty-row';
            historyRows.append(row);
            return;
        }

        for (const entry of result.rows) {
            const row = document.createElement('tr');
            recreationEntries.set(String(entry.id), entry);
            appendCell(row, formatDate(entry.created_at));
            appendCell(row, entry.ip === 'unknown' ? 'Chưa ghi nhận IP' : entry.ip);
            const labelCell = document.createElement('td');
            const labelText = entry.ip_label || entry.legacy_username || '—';
            if (entry.ip !== 'unknown') {
                const ipLink = document.createElement('button');
                ipLink.type = 'button';
                ipLink.className = 'history-ip-link';
                ipLink.dataset.historyIp = entry.ip;
                ipLink.textContent = labelText;
                labelCell.append(ipLink);
            } else {
                labelCell.textContent = labelText;
            }
            row.append(labelCell);
            appendCell(row, entry.barcode);
            appendCell(row, entry.district);
            appendCell(row, entry.commune);
            appendCell(row, entry.village);
            const actionCell = document.createElement('td');
            actionCell.append(createRecreateButton(entry));
            row.append(actionCell);
            historyRows.append(row);
        }
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        historyError.textContent = error.message;
        historyError.hidden = false;
    }
}

async function loadInventoryAccounts() {
    const requestGeneration = authGeneration;
    inventoryAccountsError.hidden = true;
    const query = new URLSearchParams({
        page: String(inventoryAccountCurrentPage),
        search: inventoryAccountSearch.value.trim(),
    });
    try {
        const result = await api(`/api/admin/inventory-accounts?${query}`);
        assertCurrentAdminRequest(requestGeneration);
        inventoryAccountTotalPages = result.pages;
        document.getElementById('inventoryAccountPageLabel').textContent = `Trang ${result.page} / ${result.pages} · ${result.total.toLocaleString('vi-VN')} tài khoản`;
        document.getElementById('previousInventoryAccountPage').disabled = result.page <= 1;
        document.getElementById('nextInventoryAccountPage').disabled = result.page >= result.pages;
        inventoryAccountRows.replaceChildren();

        if (result.rows.length === 0) {
            const row = document.createElement('tr');
            const cell = appendCell(row, 'Chưa có tài khoản kiểm kê phù hợp.');
            cell.colSpan = 6;
            cell.className = 'empty-row';
            inventoryAccountRows.append(row);
            return;
        }

        for (const account of result.rows) {
            const row = document.createElement('tr');
            row.dataset.accountId = account.id;
            row.dataset.username = account.username;
            row.dataset.active = String(Boolean(account.active));
            appendCell(row, account.username);
            const statusCell = document.createElement('td');
            const status = document.createElement('span');
            status.className = `ip-status${account.active ? '' : ' blocked'}`;
            status.textContent = account.active ? 'Đang hoạt động' : 'Đã khóa';
            statusCell.append(status);
            if (!account.active && account.disabled_reason) {
                const reason = document.createElement('small');
                reason.className = 'account-lock-reason';
                reason.textContent = account.disabled_reason;
                statusCell.append(reason);
            }
            row.append(statusCell);
            appendCell(row, formatDate(account.created_at));
            const orderCountCell = document.createElement('td');
            const orderCountButton = document.createElement('button');
            orderCountButton.type = 'button';
            orderCountButton.className = 'ip-code-count';
            orderCountButton.dataset.inventoryOrders = account.id;
            orderCountButton.dataset.username = account.username;
            orderCountButton.textContent = Number(account.order_count).toLocaleString('vi-VN');
            orderCountButton.setAttribute('aria-label', `Xem ${account.order_count} mã kiểm kê của ${account.username}`);
            orderCountCell.append(orderCountButton);
            row.append(orderCountCell);
            appendCell(row, account.last_seen ? formatDate(account.last_seen) : '—');

            const actions = document.createElement('td');
            actions.className = 'ip-actions';
            const toggleButton = document.createElement('button');
            toggleButton.type = 'button';
            toggleButton.dataset.accountAction = 'toggle';
            toggleButton.textContent = account.active ? 'Khóa' : 'Mở khóa';
            actions.append(toggleButton);
            const passwordButton = document.createElement('button');
            passwordButton.type = 'button';
            passwordButton.dataset.accountAction = 'password';
            passwordButton.textContent = 'Đặt mật khẩu';
            actions.append(passwordButton);
            row.append(actions);
            inventoryAccountRows.append(row);
        }
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        inventoryAccountsError.textContent = error.message;
        inventoryAccountsError.hidden = false;
    }
}

async function openInventoryOrders(accountId, username) {
    activeInventoryAccountId = accountId;
    inventoryOrdersCurrentPage = 1;
    document.getElementById('inventoryOrdersTitle').textContent = 'Mã kiểm kê';
    document.getElementById('inventoryOrdersSubtitle').textContent = username;
    setInventoryOrdersDay('today');
    const dialog = document.getElementById('inventoryOrdersDialog');
    if (!dialog.open) dialog.showModal();
    await loadInventoryOrders();
}

function getInventoryOrdersDate(day) {
    const daysAgo = { today: 0, yesterday: 1, 'two-days-ago': 2 }[day] ?? 0;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const value = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    const localMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return { value, timezoneOffset: localMidnight.getTimezoneOffset() };
}

function setInventoryOrdersDay(day) {
    activeInventoryOrdersDay = day;
    document.querySelectorAll('[data-inventory-day]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.inventoryDay === day));
    });
}

async function loadInventoryOrders() {
    if (activeInventoryAccountId === null) return;
    const requestGeneration = authGeneration;
    inventoryOrdersError.hidden = true;
    const selectedDate = getInventoryOrdersDate(activeInventoryOrdersDay);
    const query = new URLSearchParams({
        page: String(inventoryOrdersCurrentPage),
        from: selectedDate.value,
        to: selectedDate.value,
        timezoneOffset: String(selectedDate.timezoneOffset),
    });

    try {
        const result = await api(`/api/admin/inventory-accounts/${activeInventoryAccountId}/orders?${query}`);
        assertCurrentAdminRequest(requestGeneration);
        inventoryOrdersTotalPages = result.pages;
        document.getElementById('inventoryOrdersPageLabel').textContent = `Trang ${result.page} / ${result.pages} · ${result.total.toLocaleString('vi-VN')} mã trong 3 ngày`;
        document.getElementById('previousInventoryOrdersPage').disabled = result.page <= 1;
        document.getElementById('nextInventoryOrdersPage').disabled = result.page >= result.pages;
        inventoryOrdersRows.replaceChildren();

        if (result.rows.length === 0) {
            const row = document.createElement('tr');
            const cell = appendCell(row, 'Không có mã nào trong khoảng ngày này.');
            cell.colSpan = 4;
            cell.className = 'empty-row';
            inventoryOrdersRows.append(row);
            return;
        }

        for (const entry of result.rows) {
            const row = document.createElement('tr');
            appendCell(row, formatDate(entry.created_at));
            appendCell(row, entry.ip === 'unknown' ? 'Chưa ghi nhận IP' : entry.ip);
            appendCell(row, entry.waybill);
            const actionCell = document.createElement('td');
            const qrButton = document.createElement('button');
            qrButton.type = 'button';
            qrButton.dataset.inventoryQrWaybill = entry.waybill;
            qrButton.setAttribute('aria-label', `Xem QR ${entry.waybill}`);
            qrButton.textContent = 'Xem QR';
            actionCell.append(qrButton);
            row.append(actionCell);
            inventoryOrdersRows.append(row);
        }
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        inventoryOrdersError.textContent = error.message;
        inventoryOrdersError.hidden = false;
    }
}

async function loadIps() {
    const requestGeneration = authGeneration;
    ipError.hidden = true;
    try {
        const ips = await api('/api/admin/ips');
        assertCurrentAdminRequest(requestGeneration);
        document.getElementById('uniqueIpCount').textContent = ips.length.toLocaleString('vi-VN');
        document.getElementById('blockedIpCount').textContent = ips
            .filter(entry => entry.blocked)
            .length.toLocaleString('vi-VN');
        document.getElementById('ipFilterToggle').hidden = !showBlockedOnly;
        const visibleIps = showBlockedOnly ? ips.filter(entry => entry.blocked) : ips;
        ipRows.replaceChildren();
        if (visibleIps.length === 0) {
            const row = document.createElement('tr');
            const cell = appendCell(row, showBlockedOnly ? 'Không có IP đang bị chặn.' : 'Chưa có địa chỉ IP nào tạo mã.');
            cell.colSpan = 6;
            cell.className = 'empty-row';
            ipRows.append(row);
            return;
        }

        for (const entry of visibleIps) {
            const row = document.createElement('tr');
            row.dataset.ip = entry.ip;
            row.dataset.blocked = String(Boolean(entry.blocked));
            row.dataset.label = entry.label;
            appendCell(row, entry.ip === 'unknown' ? 'Chưa ghi nhận IP' : entry.ip);

            const labelCell = document.createElement('td');
            const labelText = document.createElement('span');
            labelText.className = 'ip-label-text';
            labelText.dataset.viewControl = '';
            labelText.textContent = entry.label || 'Chưa đặt tên';
            labelCell.append(labelText);

            const labelInput = document.createElement('input');
            labelInput.className = 'ip-label';
            labelInput.dataset.editControl = '';
            labelInput.hidden = true;
            labelInput.maxLength = 80;
            labelInput.value = entry.label;
            labelInput.placeholder = 'Ví dụ: Kho trung tâm';
            labelInput.disabled = entry.ip === 'unknown';
            labelInput.setAttribute('aria-label', `Tên gợi nhớ cho ${entry.ip}`);
            labelCell.append(labelInput);
            row.append(labelCell);

            const codeCountCell = document.createElement('td');
            const codeCountButton = document.createElement('button');
            codeCountButton.type = 'button';
            codeCountButton.className = 'ip-code-count';
            codeCountButton.dataset.ipHistory = entry.ip;
            codeCountButton.dataset.label = entry.label;
            codeCountButton.textContent = Number(entry.code_count).toLocaleString('vi-VN');
            codeCountButton.setAttribute('aria-label', `Xem ${entry.code_count} mã đã tạo bởi IP ${entry.ip}`);
            codeCountCell.append(codeCountButton);
            row.append(codeCountCell);
            appendCell(row, entry.last_seen ? formatDate(entry.last_seen) : '—');
            appendCell(row, entry.blocked ? 'Đang chặn' : 'Đang cho phép', `ip-status${entry.blocked ? ' blocked' : ''}`);

            const actions = document.createElement('td');
            actions.className = 'ip-actions';
            if (entry.ip !== 'unknown') {
                const blockButton = document.createElement('button');
                blockButton.type = 'button';
                blockButton.dataset.ipAction = entry.blocked ? 'unblock' : 'block';
                blockButton.dataset.viewControl = '';
                blockButton.className = entry.blocked ? 'unblock-button' : 'block-button';
                blockButton.textContent = entry.blocked ? 'Mở chặn' : 'Chặn IP';
                actions.append(blockButton);

            }
            row.append(actions);
            ipRows.append(row);
        }
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        ipError.textContent = error.message;
        ipError.hidden = false;
    }
}

async function loadAnonymousUsers() {
    const requestGeneration = authGeneration;
    anonymousUsersError.hidden = true;
    const query = new URLSearchParams({
        page: String(anonymousCurrentPage),
        search: anonymousUserSearch.value.trim(),
    });
    try {
        const result = await api(`/api/admin/anonymous-users?${query}`);
        assertCurrentAdminRequest(requestGeneration);
        anonymousTotalPages = result.pages;
        document.getElementById('anonymousPageLabel').textContent = `Trang ${result.page} / ${result.pages} · ${result.total.toLocaleString('vi-VN')} UID`;
        document.getElementById('previousAnonymousPage').disabled = result.page <= 1;
        document.getElementById('nextAnonymousPage').disabled = result.page >= result.pages;
        anonymousUserRows.replaceChildren();

        if (result.rows.length === 0) {
            const row = document.createElement('tr');
            const cell = appendCell(row, 'Chưa có anonymous UID phù hợp.');
            cell.colSpan = 6;
            cell.className = 'empty-row';
            anonymousUserRows.append(row);
            return;
        }

        for (const entry of result.rows) {
            const row = document.createElement('tr');
            appendCell(row, entry.id);
            appendCell(row, entry.ips.join(', '));
            appendCell(row, Number(entry.session_count).toLocaleString('vi-VN'));
            appendCell(row, Number(entry.generated_code_count).toLocaleString('vi-VN'));
            appendCell(row, formatDate(entry.first_seen_at));
            appendCell(row, formatDate(entry.last_seen_at));
            anonymousUserRows.append(row);
        }
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        anonymousUsersError.textContent = error.message;
        anonymousUsersError.hidden = false;
    }
}

const dashboardHeader = document.querySelector('.topbar');
const dashboardMain = document.querySelector('main');
const loginModal = document.getElementById('loginModal');
const loginModalForm = document.getElementById('loginModalForm');
const loginModalUsername = document.getElementById('loginModalUsername');
const loginModalPassword = document.getElementById('loginModalPassword');
const loginModalError = document.getElementById('loginModalError');
const loginModalSubmit = document.getElementById('loginModalSubmit');
const sensitiveDialogIds = [
    'inventoryAccountCreateDialog', 'lockInventoryAccountDialog', 'resetInventoryPasswordDialog',
    'inventoryOrdersDialog', 'inventoryOrderQrDialog', 'accountLockedDialog',
    'createdCodesDialog', 'ipHistoryDialog', 'recreateCodeDialog',
];
let authState = 'checking';
let authGeneration = 0;
let loginSubmitInFlight = false;

function closeSensitiveDialogs() {
    for (const id of sensitiveDialogIds) {
        const dialog = document.getElementById(id);
        if (dialog && dialog.open) dialog.close();
    }
}

// Xóa dữ liệu quản trị đã render khỏi DOM (không chỉ ẩn bằng CSS) khi logout/hết phiên.
function clearAdminDomData() {
    historyRows.replaceChildren();
    inventoryAccountRows.replaceChildren();
    anonymousUserRows.replaceChildren();
    ipRows.replaceChildren();
    inventoryOrdersRows.replaceChildren();
    document.getElementById('districtRows').replaceChildren();
    document.getElementById('communeRows').replaceChildren();
    document.getElementById('villageRows').replaceChildren();
    document.getElementById('formFieldRows').replaceChildren();
    document.getElementById('newCommuneDistrict').replaceChildren();
    document.getElementById('newVillageCommune').replaceChildren();
    document.getElementById('ipHistoryRows').replaceChildren();
    document.getElementById('historyCount').textContent = '—';
    document.getElementById('uniqueIpCount').textContent = '—';
    document.getElementById('blockedIpCount').textContent = '—';
    document.getElementById('adminName').textContent = '';
    recreationEntries.clear();
    activeRecreateEntry = null;
    activeInventoryAccountId = null;
    activeLockInventoryAccountId = null;
    activeResetInventoryAccountId = null;
    activeIpHistoryIp = '';
    showBlockedOnly = false;
    currentPage = 1;
    totalPages = 1;
    inventoryAccountCurrentPage = 1;
    inventoryAccountTotalPages = 1;
    anonymousCurrentPage = 1;
    anonymousTotalPages = 1;
    setSaveStatus('');
    for (const element of [historyError, inventoryAccountsError, anonymousUsersError, ipError, inventoryOrdersError]) {
        element.hidden = true;
        element.textContent = '';
    }
    for (const id of ['geographyError', 'geographyMessage', 'formFieldsError']) {
        const element = document.getElementById(id);
        element.hidden = true;
        element.textContent = '';
    }
}

// Điểm vào duy nhất cho 401 của API quản trị; chống chuyển trạng thái lặp khi nhiều request cùng thất bại.
function handleAdminUnauthorized() {
    if (authState !== 'authenticated' && authState !== 'checking') return;
    transitionToUnauthenticated();
}

function transitionToUnauthenticated(message) {
    if (authState === 'unauthenticated') return;
    authState = 'unauthenticated';
    authGeneration += 1;
    closeSensitiveDialogs();
    clearAdminDomData();
    dashboardHeader.hidden = true;
    dashboardMain.hidden = true;
    loginModalForm.reset();
    loginModalSubmit.disabled = false;
    loginModalSubmit.textContent = 'Đăng nhập';
    loginModalError.hidden = !message;
    loginModalError.textContent = message || '';
    if (!loginModal.open) loginModal.showModal();
    loginModalUsername.focus();
}

function transitionToAuthenticated(username) {
    authState = 'authenticated';
    authGeneration += 1;
    document.getElementById('adminName').textContent = username;
    loginModalForm.reset();
    loginModalError.hidden = true;
    if (loginModal.open) loginModal.close();
    dashboardHeader.hidden = false;
    dashboardMain.hidden = false;
    loadHistory();
    loadInventoryAccounts();
    loadAnonymousUsers();
    loadIps();
    loadGeography();
    loadFormFields();
}

loginModal.addEventListener('cancel', event => {
    if (authState !== 'authenticated') event.preventDefault();
});

loginModalForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (loginSubmitInFlight) return;
    loginSubmitInFlight = true;
    loginModalError.hidden = true;
    loginModalSubmit.disabled = true;
    loginModalSubmit.textContent = 'Đang đăng nhập...';

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: loginModalUsername.value,
                password: loginModalPassword.value,
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Đăng nhập thất bại.');

        const meResponse = await fetch('/api/admin/me');
        if (!meResponse.ok) throw new Error('Không thể xác nhận phiên đăng nhập. Vui lòng thử lại.');
        const admin = await meResponse.json();
        transitionToAuthenticated(admin.username);
    } catch (error) {
        loginModalError.textContent = error.message;
        loginModalError.hidden = false;
        loginModalPassword.value = '';
        loginModalPassword.focus();
    } finally {
        loginSubmitInFlight = false;
        loginModalSubmit.disabled = false;
        loginModalSubmit.textContent = 'Đăng nhập';
    }
});

async function checkAdminSession() {
    authState = 'checking';
    const requestGeneration = authGeneration;
    if (!loginModal.open) loginModal.showModal();
    try {
        const response = await fetch('/api/admin/me');
        if (requestGeneration !== authGeneration) return;
        if (response.status === 401) {
            transitionToUnauthenticated();
            return;
        }
        if (!response.ok) {
            transitionToUnauthenticated('Không thể kiểm tra phiên đăng nhập. Vui lòng tải lại trang.');
            return;
        }
        const admin = await response.json();
        if (requestGeneration !== authGeneration) return;
        transitionToAuthenticated(admin.username);
    } catch {
        if (requestGeneration !== authGeneration) return;
        transitionToUnauthenticated('Không thể kết nối máy chủ. Vui lòng thử lại.');
    }
}

document.getElementById('logoutButton').addEventListener('click', async () => {
    transitionToUnauthenticated();
    try {
        const response = await fetch('/api/logout', { method: 'POST' });
        if (!response.ok && response.status !== 401) {
            console.error(`Đăng xuất thất bại (HTTP ${response.status}).`);
        }
    } catch (error) {
        console.error('Không thể đăng xuất:', error);
    } finally {
        transitionToUnauthenticated();
    }
});

document.getElementById('createInventoryAccountButton').addEventListener('click', () => {
    inventoryAccountCreateError.hidden = true;
    document.getElementById('inventoryAccountForm').reset();
    inventoryAccountCreateDialog.showModal();
});

document.getElementById('closeInventoryAccountCreate').addEventListener('click', () => inventoryAccountCreateDialog.close());
inventoryAccountCreateDialog.addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});

document.getElementById('inventoryAccountForm').addEventListener('submit', async event => {
    event.preventDefault();
    inventoryAccountCreateError.hidden = true;
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
        const account = await api('/api/admin/inventory-accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: values.get('username'), password: values.get('password') }),
        });
        form.reset();
        inventoryAccountCreateDialog.close();
        inventoryAccountCurrentPage = 1;
        setSaveStatus(`Đã tạo ${account.username}`);
        await loadInventoryAccounts();
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        inventoryAccountCreateError.textContent = error.message;
        inventoryAccountCreateError.hidden = false;
    }
});

document.getElementById('closeLockInventoryAccount').addEventListener('click', () => lockInventoryAccountDialog.close());
lockInventoryAccountDialog.addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});
document.getElementById('lockInventoryAccountForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (activeLockInventoryAccountId === null) return;
    lockInventoryAccountError.hidden = true;
    const form = event.currentTarget;
    const reason = new FormData(form).get('reason').trim();
    try {
        await api(`/api/admin/inventory-accounts/${activeLockInventoryAccountId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: false, reason }),
        });
        lockInventoryAccountDialog.close();
        form.reset();
        setSaveStatus('Đã khóa tài khoản');
        await loadInventoryAccounts();
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        lockInventoryAccountError.textContent = error.message;
        lockInventoryAccountError.hidden = false;
    }
});

document.getElementById('closeResetInventoryPassword').addEventListener('click', () => resetInventoryPasswordDialog.close());
resetInventoryPasswordDialog.addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});
document.getElementById('resetInventoryPasswordForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (activeResetInventoryAccountId === null) return;
    resetInventoryPasswordError.hidden = true;
    const form = event.currentTarget;
    const password = new FormData(form).get('password');
    try {
        await api(`/api/admin/inventory-accounts/${activeResetInventoryAccountId}/password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });
        resetInventoryPasswordDialog.close();
        form.reset();
        setSaveStatus('Đã đặt lại mật khẩu');
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        resetInventoryPasswordError.textContent = error.message;
        resetInventoryPasswordError.hidden = false;
    }
});

inventoryAccountRows.addEventListener('click', async event => {
    const ordersButton = event.target.closest('button[data-inventory-orders]');
    if (ordersButton) {
        openInventoryOrders(ordersButton.dataset.inventoryOrders, ordersButton.dataset.username);
        return;
    }
    const button = event.target.closest('button[data-account-action]');
    if (!button) return;
    const row = button.closest('tr[data-account-id]');
    const accountId = row.dataset.accountId;

    if (button.dataset.accountAction === 'toggle' && row.dataset.active === 'true') {
        activeLockInventoryAccountId = accountId;
        document.getElementById('lockInventoryAccountUsername').textContent = row.dataset.username;
        document.getElementById('lockInventoryAccountForm').reset();
        lockInventoryAccountError.hidden = true;
        lockInventoryAccountDialog.showModal();
        return;
    }
    if (button.dataset.accountAction === 'password') {
        activeResetInventoryAccountId = accountId;
        document.getElementById('resetInventoryPasswordUsername').textContent = row.dataset.username;
        document.getElementById('resetInventoryPasswordForm').reset();
        resetInventoryPasswordError.hidden = true;
        resetInventoryPasswordDialog.showModal();
        return;
    }

    if (button.dataset.accountAction === 'toggle') {
        const confirmed = await confirmAction({
            title: 'Xác nhận mở khóa tài khoản',
            message: `Mở khóa tài khoản kiểm kê "${row.dataset.username}"? Tài khoản này sẽ đăng nhập được trở lại.`,
            confirmLabel: 'Mở khóa',
        });
        if (!confirmed) return;
    }

    try {
        if (button.dataset.accountAction === 'toggle') {
            await api(`/api/admin/inventory-accounts/${accountId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: true }),
            });
            setSaveStatus('Đã mở khóa tài khoản');
        }
        await loadInventoryAccounts();
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        inventoryAccountsError.textContent = error.message;
        inventoryAccountsError.hidden = false;
    }
});

inventoryOrdersRows.addEventListener('click', event => {
    const qrButton = event.target.closest('button[data-inventory-qr-waybill]');
    if (!qrButton) return;
    const waybill = qrButton.dataset.inventoryQrWaybill;
    document.getElementById('inventoryOrderQrTitle').textContent = 'QR mã vận đơn';
    document.getElementById('inventoryOrderQrValue').textContent = waybill;
    document.getElementById('inventoryOrderQrImage').src = `/api/qrcode?text=${encodeURIComponent(waybill)}`;
    document.getElementById('inventoryOrderQrDialog').showModal();
});

document.getElementById('inventoryOrdersDayFilter').addEventListener('click', event => {
    const button = event.target.closest('button[data-inventory-day]');
    if (!button || button.dataset.inventoryDay === activeInventoryOrdersDay) return;
    setInventoryOrdersDay(button.dataset.inventoryDay);
    inventoryOrdersCurrentPage = 1;
    loadInventoryOrders();
});

document.getElementById('closeInventoryOrders').addEventListener('click', () => {
    document.getElementById('inventoryOrdersDialog').close();
});

document.getElementById('inventoryOrdersDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});
document.getElementById('inventoryOrdersDialog').addEventListener('close', () => {
    activeInventoryAccountId = null;
});

document.getElementById('previousInventoryOrdersPage').addEventListener('click', () => {
    if (inventoryOrdersCurrentPage > 1) inventoryOrdersCurrentPage -= 1;
    loadInventoryOrders();
});

document.getElementById('nextInventoryOrdersPage').addEventListener('click', () => {
    if (inventoryOrdersCurrentPage < inventoryOrdersTotalPages) inventoryOrdersCurrentPage += 1;
    loadInventoryOrders();
});

document.getElementById('closeInventoryOrderQr').addEventListener('click', () => {
    document.getElementById('inventoryOrderQrDialog').close();
});

document.getElementById('inventoryOrderQrDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});

document.getElementById('inventoryOrderQrDialog').addEventListener('close', () => {
    document.getElementById('inventoryOrderQrImage').removeAttribute('src');
});

ipRows.addEventListener('click', async event => {
    const historyButton = event.target.closest('button[data-ip-history]');
    if (historyButton) {
        openIpHistory(historyButton.dataset.ipHistory, historyButton.dataset.label);
        return;
    }

    const button = event.target.closest('button[data-ip-action]');
    if (!button) return;
    const row = button.closest('tr');
    const action = button.dataset.ipAction;
    const blocked = action === 'block';
    const ipLabel = row.dataset.label ? `${row.dataset.label} (${row.dataset.ip})` : row.dataset.ip;

    const confirmed = await confirmAction({
        title: blocked ? 'Xác nhận chặn IP' : 'Xác nhận bỏ chặn IP',
        message: blocked
            ? `Chặn địa chỉ IP ${ipLabel}? Người dùng từ IP này có thể bị từ chối truy cập theo cơ chế chặn IP hiện tại.`
            : `Bỏ chặn địa chỉ IP ${ipLabel}? IP này sẽ được phép truy cập trở lại theo cơ chế hiện tại.`,
        confirmLabel: blocked ? 'Chặn IP' : 'Bỏ chặn',
        danger: blocked,
    });
    if (!confirmed) return;

    try {
        setSaveStatus('Đang cập nhật...', 'pending');
        await api('/api/admin/ips', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ip: row.dataset.ip,
                label: row.querySelector('.ip-label').value,
                blocked,
            }),
        });
        setSaveStatus('Đã cập nhật');
        await Promise.all([loadIps(), loadHistory()]);
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        setSaveStatus('Lỗi cập nhật', 'error');
        ipError.textContent = error.message;
        ipError.hidden = false;
    }
});

searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        currentPage = 1;
        loadHistory();
    }, 250);
});

inventoryAccountSearch.addEventListener('input', () => {
    clearTimeout(inventoryAccountSearchTimer);
    inventoryAccountSearchTimer = setTimeout(() => {
        inventoryAccountCurrentPage = 1;
        loadInventoryAccounts();
    }, 250);
});

anonymousUserSearch.addEventListener('input', () => {
    clearTimeout(anonymousSearchTimer);
    anonymousSearchTimer = setTimeout(() => {
        anonymousCurrentPage = 1;
        loadAnonymousUsers();
    }, 250);
});

document.getElementById('previousPage').addEventListener('click', () => {
    if (currentPage > 1) currentPage -= 1;
    loadHistory();
});

document.getElementById('nextPage').addEventListener('click', () => {
    if (currentPage < totalPages) currentPage += 1;
    loadHistory();
});

document.getElementById('previousInventoryAccountPage').addEventListener('click', () => {
    if (inventoryAccountCurrentPage > 1) inventoryAccountCurrentPage -= 1;
    loadInventoryAccounts();
});

document.getElementById('nextInventoryAccountPage').addEventListener('click', () => {
    if (inventoryAccountCurrentPage < inventoryAccountTotalPages) inventoryAccountCurrentPage += 1;
    loadInventoryAccounts();
});

document.getElementById('previousAnonymousPage').addEventListener('click', () => {
    if (anonymousCurrentPage > 1) anonymousCurrentPage -= 1;
    loadAnonymousUsers();
});

document.getElementById('nextAnonymousPage').addEventListener('click', () => {
    if (anonymousCurrentPage < anonymousTotalPages) anonymousCurrentPage += 1;
    loadAnonymousUsers();
});

const viewTabs = [...document.querySelectorAll('[data-tab-target]')];

function activateTab(tab, moveFocus = false) {
    viewTabs.forEach(item => {
        const selected = item === tab;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
        document.getElementById(item.dataset.tabTarget).hidden = !selected;
    });
    if (moveFocus) tab.focus();
}

viewTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
        let nextIndex = index;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % viewTabs.length;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + viewTabs.length) % viewTabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = viewTabs.length - 1;
        if (nextIndex === index) return;
        event.preventDefault();
        activateTab(viewTabs[nextIndex], true);
    });
});

async function focusIpInList(ip) {
    showBlockedOnly = false;
    activateTab(document.getElementById('ipsTab'));
    await loadIps();
    const row = [...ipRows.querySelectorAll('tr[data-ip]')].find(item => item.dataset.ip === ip);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('ip-highlight');
    setTimeout(() => row.classList.remove('ip-highlight'), 1800);
}

historyRows.addEventListener('click', event => {
    const ipLink = event.target.closest('button[data-history-ip]');
    if (ipLink) {
        focusIpInList(ipLink.dataset.historyIp);
        return;
    }
    const recreateButton = event.target.closest('button[data-recreate-entry]');
    if (recreateButton) openRecreateCode(recreationEntries.get(recreateButton.dataset.recreateEntry));
});

document.getElementById('blockedIpMetric').addEventListener('click', async () => {
    showBlockedOnly = true;
    activateTab(document.getElementById('ipsTab'));
    await loadIps();
});

document.getElementById('ipFilterToggle').addEventListener('click', async () => {
    showBlockedOnly = false;
    await loadIps();
});

document.getElementById('ipHistoryRows').addEventListener('click', event => {
    const recreateButton = event.target.closest('button[data-recreate-entry]');
    if (recreateButton) openRecreateCode(recreationEntries.get(recreateButton.dataset.recreateEntry));
});

checkAdminSession();

async function loadGeography() {
    const errorMessage = document.getElementById('geographyError');
    const requestGeneration = authGeneration;
    const editing = document.querySelector('[data-edit-group="geography"]').dataset.editing === 'true';
    errorMessage.hidden = true;

    try {
        const districts = await api('/api/admin/geography');
        assertCurrentAdminRequest(requestGeneration);
        const districtRows = document.getElementById('districtRows');
        const communeRows = document.getElementById('communeRows');
        const villageRows = document.getElementById('villageRows');
        const newCommuneDistrict = document.getElementById('newCommuneDistrict');
        const newVillageCommune = document.getElementById('newVillageCommune');
        districtRows.replaceChildren();
        communeRows.replaceChildren();
        villageRows.replaceChildren();
        newCommuneDistrict.replaceChildren();
        newVillageCommune.replaceChildren();

        const allCommunes = districts.flatMap(district => district.communes.map(commune => ({
            ...commune,
            districtId: district.id,
            districtName: district.name,
        })));
        allCommunes.forEach(commune => {
            const option = document.createElement('option');
            option.value = commune.id;
            option.textContent = `${commune.districtName} · ${commune.name}`;
            newVillageCommune.append(option);
        });

        for (const district of districts) {
            const districtOption = document.createElement('option');
            districtOption.value = district.id;
            districtOption.textContent = district.name;
            newCommuneDistrict.append(districtOption);

            const row = document.createElement('tr');
            row.dataset.rowType = 'district';
            row.dataset.districtId = district.id;
            row.dataset.name = district.name;
            row.dataset.kind = district.kind;
            const nameCell = document.createElement('td');
            const nameText = document.createElement('span');
            nameText.className = 'district-name-text';
            nameText.dataset.viewControl = '';
            nameText.textContent = district.name;
            nameCell.append(nameText);
            const nameInput = document.createElement('input');
            nameInput.className = 'district-name';
            nameInput.dataset.editControl = '';
            nameInput.hidden = true;
            nameInput.maxLength = 80;
            nameInput.value = district.name;
            nameCell.append(nameInput);
            row.append(nameCell);

            const kindCell = document.createElement('td');
            const kindText = document.createElement('span');
            kindText.className = 'district-kind-text';
            kindText.dataset.viewControl = '';
            kindText.textContent = district.kind === 'city' ? 'Thành phố' : 'Huyện';
            kindCell.append(kindText);
            const kindSelect = document.createElement('select');
            kindSelect.className = 'district-kind';
            kindSelect.dataset.editControl = '';
            kindSelect.hidden = true;
            for (const [value, label] of [['city', 'Thành phố'], ['district', 'Huyện']]) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                kindSelect.append(option);
            }
            kindSelect.value = district.kind;
            kindCell.append(kindSelect);
            row.append(kindCell);
            appendCell(row, district.communes.length.toLocaleString('vi-VN'), 'district-commune-count');
            appendCell(row, district.is_hidden ? 'Đang ẩn' : 'Đang hiện', `visibility-status${district.is_hidden ? ' hidden' : ''}`);

            const actions = document.createElement('td');
            actions.className = 'geography-actions';
            actions.append(createGeographyButton(
                district.is_hidden ? 'show-district' : 'hide-district',
                district.is_hidden ? 'Hiện' : 'Ẩn',
                '',
                true,
            ));
            actions.append(createGeographyButton('delete-district', 'Xóa', 'delete-button', true));
            row.append(actions);
            if (editing) setEditingMode(row, true);
            districtRows.append(row);

            for (const commune of district.communes) {
                const communeRow = document.createElement('tr');
                communeRow.dataset.rowType = 'commune';
                communeRow.dataset.communeId = commune.id;
                communeRow.dataset.name = commune.name;
                communeRow.dataset.parentDistrictId = district.id;
                const communeNameCell = document.createElement('td');
                const communeNameText = document.createElement('span');
                communeNameText.className = 'commune-name-text';
                communeNameText.dataset.viewControl = '';
                communeNameText.textContent = commune.name;
                communeNameCell.append(communeNameText);
                const communeNameInput = document.createElement('input');
                communeNameInput.className = 'commune-name';
                communeNameInput.dataset.editControl = '';
                communeNameInput.hidden = true;
                communeNameInput.maxLength = 80;
                communeNameInput.value = commune.name;
                communeNameCell.append(communeNameInput);
                communeRow.append(communeNameCell);

                const parentCell = document.createElement('td');
                const parentText = document.createElement('span');
                parentText.className = 'commune-district-text';
                parentText.dataset.viewControl = '';
                parentText.textContent = district.name;
                parentCell.append(parentText);
                const parentSelect = document.createElement('select');
                parentSelect.className = 'commune-district';
                parentSelect.dataset.editControl = '';
                parentSelect.hidden = true;
                for (const parent of districts) {
                    const option = document.createElement('option');
                    option.value = parent.id;
                    option.textContent = parent.name;
                    parentSelect.append(option);
                }
                parentSelect.value = district.id;
                parentCell.append(parentSelect);
                communeRow.append(parentCell);
                appendCell(communeRow, commune.is_hidden ? 'Đang ẩn' : 'Đang hiện', `visibility-status${commune.is_hidden ? ' hidden' : ''}`);

                const communeActions = document.createElement('td');
                communeActions.className = 'geography-actions';
                communeActions.append(createGeographyButton(
                    commune.is_hidden ? 'show-commune' : 'hide-commune',
                    commune.is_hidden ? 'Hiện' : 'Ẩn',
                    '',
                    true,
                ));
                communeActions.append(createGeographyButton('delete-commune', 'Xóa', 'delete-button', true));
                communeRow.append(communeActions);
                if (editing) setEditingMode(communeRow, true);
                communeRows.append(communeRow);

                for (const village of commune.villages || []) {
                    const villageRow = document.createElement('tr');
                    villageRow.dataset.rowType = 'village';
                    villageRow.dataset.villageId = village.id;
                    villageRow.dataset.name = village.name;
                    villageRow.dataset.parentCommuneId = commune.id;

                    const villageNameCell = document.createElement('td');
                    const villageNameText = document.createElement('span');
                    villageNameText.className = 'village-name-text';
                    villageNameText.dataset.viewControl = '';
                    villageNameText.textContent = village.name;
                    villageNameCell.append(villageNameText);
                    const villageNameInput = document.createElement('input');
                    villageNameInput.className = 'village-name';
                    villageNameInput.dataset.editControl = '';
                    villageNameInput.hidden = true;
                    villageNameInput.maxLength = 80;
                    villageNameInput.value = village.name;
                    villageNameCell.append(villageNameInput);
                    villageRow.append(villageNameCell);

                    const villageCommuneCell = document.createElement('td');
                    const villageCommuneText = document.createElement('span');
                    villageCommuneText.className = 'village-commune-text';
                    villageCommuneText.dataset.viewControl = '';
                    villageCommuneText.textContent = commune.name;
                    villageCommuneCell.append(villageCommuneText);
                    const villageCommuneSelect = document.createElement('select');
                    villageCommuneSelect.className = 'village-commune';
                    villageCommuneSelect.dataset.editControl = '';
                    villageCommuneSelect.hidden = true;
                    for (const parent of allCommunes) {
                        const option = document.createElement('option');
                        option.value = parent.id;
                        option.textContent = `${parent.districtName} · ${parent.name}`;
                        villageCommuneSelect.append(option);
                    }
                    villageCommuneSelect.value = commune.id;
                    villageCommuneCell.append(villageCommuneSelect);
                    villageRow.append(villageCommuneCell);
                    appendCell(villageRow, district.name);
                    appendCell(villageRow, village.is_hidden ? 'Đang ẩn' : 'Đang hiện', `visibility-status${village.is_hidden ? ' hidden' : ''}`);

                    const villageActions = document.createElement('td');
                    villageActions.className = 'geography-actions';
                    villageActions.append(createGeographyButton(
                        village.is_hidden ? 'show-village' : 'hide-village',
                        village.is_hidden ? 'Hiện' : 'Ẩn',
                        '',
                        true,
                    ));
                    villageActions.append(createGeographyButton('delete-village', 'Xóa', 'delete-button', true));
                    villageRow.append(villageActions);
                    if (editing) setEditingMode(villageRow, true);
                    villageRows.append(villageRow);
                }
            }
        }

        if (districts.length === 0) {
            appendEmptyRow(districtRows, 'Chưa có thành phố hoặc huyện.', 5);
            appendEmptyRow(communeRows, 'Chưa có xã.', 4);
            appendEmptyRow(villageRows, 'Chưa có thôn.', 5);
        } else if (districts.every(district => district.communes.length === 0)) {
            appendEmptyRow(communeRows, 'Chưa có xã.', 4);
        }
        if (villageRows.children.length === 0) appendEmptyRow(villageRows, 'Chưa có thôn.', 5);
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }
}

function createGeographyButton(action, label, className = '', viewControl = false, editControl = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.geoAction = action;
    button.textContent = label;
    if (viewControl) button.dataset.viewControl = '';
    if (editControl) {
        button.dataset.editControl = '';
        button.hidden = true;
    }
    if (className) button.className = className;
    return button;
}

function appendEmptyRow(tableBody, message, columns) {
    const row = document.createElement('tr');
    const cell = appendCell(row, message, 'empty-row');
    cell.colSpan = columns;
    tableBody.append(row);
}

function showGeographyMessage(message) {
    const success = document.getElementById('geographyMessage');
    const error = document.getElementById('geographyError');
    error.hidden = true;
    success.textContent = message;
    success.hidden = false;
}

async function syncGeographySummary() {
    const requestGeneration = authGeneration;
    const districts = await api('/api/admin/geography');
    assertCurrentAdminRequest(requestGeneration);
    const districtsById = new Map(districts.map(district => [String(district.id), district]));
    const districtOptions = [
        ...document.querySelectorAll('#newCommuneDistrict option'),
        ...document.querySelectorAll('.commune-district option'),
    ];

    for (const district of districts) {
        const row = document.querySelector(`#districtRows tr[data-district-id="${district.id}"]`);
        if (row) {
            row.dataset.name = district.name;
            row.dataset.kind = district.kind;
            row.querySelector('.district-name-text').textContent = district.name;
            row.querySelector('.district-kind-text').textContent = district.kind === 'city' ? 'Thành phố' : 'Huyện';
            row.querySelector('.district-commune-count').textContent = district.communes.length.toLocaleString('vi-VN');
        }
        districtOptions
            .filter(option => option.value === String(district.id))
            .forEach(option => { option.textContent = district.name; });

        for (const commune of district.communes) {
            const communeRow = document.querySelector(`#communeRows tr[data-commune-id="${commune.id}"]`);
            if (!communeRow) continue;
            communeRow.dataset.name = commune.name;
            communeRow.dataset.parentDistrictId = district.id;
            communeRow.querySelector('.commune-name-text').textContent = commune.name;
            communeRow.querySelector('.commune-district-text').textContent = district.name;
        }
    }
}

document.getElementById('districtForm').addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
        const editButton = document.querySelector('[data-edit-group="geography"]');
        if (editButton.dataset.editing === 'true' && !await saveEditGroup('geography')) return;
        await api('/api/admin/districts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: values.get('name'), kind: values.get('kind') }),
        });
        event.currentTarget.reset();
        showGeographyMessage('Đã thêm thành phố/huyện.');
        await loadGeography();
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        const message = document.getElementById('geographyError');
        message.textContent = error.message;
        message.hidden = false;
    }
});

document.getElementById('communeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
        const editButton = document.querySelector('[data-edit-group="geography"]');
        if (editButton.dataset.editing === 'true' && !await saveEditGroup('geography')) return;
        await api('/api/admin/communes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: values.get('name'), districtId: values.get('districtId') }),
        });
        event.currentTarget.reset();
        showGeographyMessage('Đã thêm xã.');
        await loadGeography();
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        const message = document.getElementById('geographyError');
        message.textContent = error.message;
        message.hidden = false;
    }
});

document.getElementById('villageForm').addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
        const editButton = document.querySelector('[data-edit-group="geography"]');
        if (editButton.dataset.editing === 'true' && !await saveEditGroup('geography')) return;
        await api('/api/admin/villages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: values.get('name'), communeId: values.get('communeId') }),
        });
        event.currentTarget.reset();
        showGeographyMessage('Đã thêm thôn.');
        await loadGeography();
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        const message = document.getElementById('geographyError');
        message.textContent = error.message;
        message.hidden = false;
    }
});

document.querySelector('.geography-section').addEventListener('click', async event => {
    const button = event.target.closest('button[data-geo-action]');
    if (!button) return;
    const row = button.closest('tr');
    const action = button.dataset.geoAction;
    const isDistrict = action.endsWith('district');
    const isVillage = action.endsWith('village');
    const isDelete = action.startsWith('delete');
    const isVisibility = action.startsWith('hide') || action.startsWith('show');
    const id = Number(row.dataset[isDistrict ? 'districtId' : isVillage ? 'villageId' : 'communeId']);
    const errorMessage = document.getElementById('geographyError');
    errorMessage.hidden = true;

    if (isDelete) {
        const confirmed = await confirmAction({
            title: 'Xác nhận xóa',
            message: isDistrict
                ? 'Xóa thành phố/huyện này cùng toàn bộ xã/thôn trực thuộc? Lịch sử mã đã tạo vẫn được giữ lại.'
                : isVillage
                    ? 'Xóa thôn này khỏi danh sách? Lịch sử mã đã tạo vẫn được giữ lại.'
                    : 'Xóa xã này cùng các thôn trực thuộc? Lịch sử mã đã tạo vẫn được giữ lại.',
            confirmLabel: 'Xóa',
            danger: true,
        });
        if (!confirmed) return;
    }

    if (isVisibility) {
        const hiding = action.startsWith('hide');
        const entityLabel = isDistrict ? 'thành phố/huyện' : isVillage ? 'thôn' : 'xã';
        const name = row.dataset.name;
        const confirmed = await confirmAction({
            title: hiding ? 'Xác nhận ẩn địa bàn' : 'Xác nhận hiện địa bàn',
            message: hiding
                ? `Ẩn ${entityLabel}${name ? ` "${name}"` : ''}? Địa bàn này sẽ không còn xuất hiện trong danh sách địa chỉ công khai để tạo đơn.`
                : `Hiện ${entityLabel}${name ? ` "${name}"` : ''}? Địa bàn này sẽ được hiển thị trở lại trong danh sách địa chỉ công khai.`,
            confirmLabel: hiding ? 'Ẩn' : 'Hiện',
        });
        if (!confirmed) return;
    }

    const resource = isDistrict ? 'districts' : isVillage ? 'villages' : 'communes';
    const url = `/api/admin/${resource}/${id}${isVisibility ? '/visibility' : ''}`;
    const method = isDelete ? 'DELETE' : 'PATCH';
    let body;
    if (isVisibility) {
        body = { hidden: action.startsWith('hide') };
    }

    try {
        setSaveStatus(isDelete ? 'Đang xóa...' : 'Đang cập nhật...', 'pending');
        await api(url, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        setSaveStatus(isDelete ? 'Đã xóa' : 'Đã cập nhật');
        showGeographyMessage(isDelete ? 'Đã xóa dữ liệu địa bàn.' : 'Đã cập nhật trạng thái địa bàn.');
        await loadGeography();
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        setSaveStatus(isDelete ? 'Lỗi xóa' : 'Lỗi cập nhật', 'error');
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }
});

async function loadFormFields() {
    const errorMessage = document.getElementById('formFieldsError');
    const rows = document.getElementById('formFieldRows');
    const requestGeneration = authGeneration;
    errorMessage.hidden = true;
    try {
        const fields = await api('/api/admin/form-fields');
        assertCurrentAdminRequest(requestGeneration);
        rows.replaceChildren();
        for (const field of fields) {
            const row = document.createElement('tr');
            row.dataset.fieldKey = field.key;
            row.dataset.label = field.label;
            row.dataset.visible = String(Boolean(field.visible));
            row.dataset.defaultValue = field.defaultValue;
            const fieldNames = {
                nhapTen: 'Người nhận',
                nhapSdt: 'Số điện thoại',
                soHang: 'Số hàng',
                tenHang: 'Tên hàng',
            };
            appendCell(row, fieldNames[field.key] || field.key);

            const labelCell = document.createElement('td');
            const labelText = document.createElement('span');
            labelText.className = 'form-field-label-text';
            labelText.dataset.viewControl = '';
            labelText.textContent = field.label;
            labelCell.append(labelText);
            const labelInput = document.createElement('input');
            labelInput.className = 'form-field-label';
            labelInput.dataset.editControl = '';
            labelInput.hidden = true;
            labelInput.maxLength = 60;
            labelInput.value = field.label;
            labelCell.append(labelInput);
            row.append(labelCell);

            const visibleCell = document.createElement('td');
            const visibleText = document.createElement('span');
            visibleText.className = `form-field-visible-text visibility-status${field.visible ? '' : ' hidden'}`;
            visibleText.dataset.viewControl = '';
            visibleText.textContent = field.visible ? 'Đang hiện' : 'Đang ẩn';
            visibleCell.append(visibleText);
            const visibleInput = document.createElement('input');
            visibleInput.className = 'form-field-visible';
            visibleInput.dataset.editControl = '';
            visibleInput.hidden = true;
            visibleInput.type = 'checkbox';
            visibleInput.checked = Boolean(field.visible);
            visibleInput.setAttribute('aria-label', `Hiển thị ${field.label}`);
            visibleCell.append(visibleInput);
            row.append(visibleCell);

            const defaultCell = document.createElement('td');
            const defaultText = document.createElement('span');
            defaultText.className = 'form-field-default-text';
            defaultText.dataset.viewControl = '';
            defaultText.textContent = field.defaultValue || '—';
            defaultCell.append(defaultText);
            const defaultInput = document.createElement('input');
            defaultInput.className = 'form-field-default';
            defaultInput.dataset.editControl = '';
            defaultInput.hidden = true;
            defaultInput.type = field.inputType;
            defaultInput.maxLength = 160;
            defaultInput.value = field.defaultValue;
            defaultInput.placeholder = 'Không đặt';
            defaultCell.append(defaultInput);
            row.append(defaultCell);

            rows.append(row);
        }
        if (fields.length === 0) appendEmptyRow(rows, 'Chưa có trường nhập liệu.', 4);
    } catch (error) {
        if (isAdminRequestInterruption(error)) return;
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }
}
