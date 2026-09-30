const historyRows = document.getElementById('historyRows');
const inventoryHistoryRows = document.getElementById('inventoryHistoryRows');
const ipRows = document.getElementById('ipRows');
const historyError = document.getElementById('historyError');
const inventoryHistoryError = document.getElementById('inventoryHistoryError');
const ipError = document.getElementById('ipError');
const searchInput = document.getElementById('searchInput');
const inventorySearchInput = document.getElementById('inventorySearchInput');
let currentPage = 1;
let totalPages = 1;
let inventoryCurrentPage = 1;
let inventoryTotalPages = 1;
let searchTimer;
let inventorySearchTimer;
let showBlockedOnly = false;
const recreationEntries = new Map();

async function api(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 401) {
        window.location.assign('/admin');
        throw new Error('Phiên quản trị đã hết hạn.');
    }
    const result = response.status === 204 ? null : await response.json();
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
    } else if (group === 'geography') {
        row.querySelector('.commune-name').value = row.dataset.name;
        row.querySelector('.commune-district').value = row.dataset.parentDistrictId;
    } else if (group === 'fields') {
        row.querySelector('.form-field-label').value = row.dataset.label;
        row.querySelector('.form-field-visible').checked = row.dataset.visible === 'true';
        row.querySelector('.form-field-default').value = row.dataset.defaultValue;
    }
}

function getEditGroupRows(group) {
    if (group === 'ips') return [...document.querySelectorAll('#ipRows tr[data-ip]')];
    if (group === 'geography') {
        return [...document.querySelectorAll('#districtRows tr[data-district-id], #communeRows tr[data-commune-id]')];
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
    if (group === 'geography') {
        return row.querySelector('.commune-name').value.trim() !== row.dataset.name
            || row.querySelector('.commune-district').value !== String(row.dataset.parentDistrictId);
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
            } else if (group === 'geography') {
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
    errorMessage.hidden = true;
    try {
        const query = new URLSearchParams({ page: String(activeIpHistoryPage) });
        const result = await api(`/api/admin/ips/${encodeURIComponent(activeIpHistoryIp)}/history?${query}`);
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
    historyError.hidden = true;
    const query = new URLSearchParams({ page: String(currentPage), search: searchInput.value.trim() });
    try {
        const result = await api(`/api/admin/history?${query}`);
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
        historyError.textContent = error.message;
        historyError.hidden = false;
    }
}

async function loadInventoryHistory() {
    inventoryHistoryError.hidden = true;
    const query = new URLSearchParams({
        page: String(inventoryCurrentPage),
        search: inventorySearchInput.value.trim(),
    });
    try {
        const result = await api(`/api/admin/kiemke-history?${query}`);
        inventoryTotalPages = result.pages;
        document.getElementById('inventoryPageLabel').textContent = `Trang ${result.page} / ${result.pages} · ${result.total.toLocaleString('vi-VN')} mã`;
        document.getElementById('previousInventoryPage').disabled = result.page <= 1;
        document.getElementById('nextInventoryPage').disabled = result.page >= result.pages;
        inventoryHistoryRows.replaceChildren();

        if (result.rows.length === 0) {
            const row = document.createElement('tr');
            const cell = appendCell(row, 'Chưa có lịch sử kiểm kê phù hợp.');
            cell.colSpan = 3;
            cell.className = 'empty-row';
            inventoryHistoryRows.append(row);
            return;
        }

        for (const entry of result.rows) {
            const row = document.createElement('tr');
            appendCell(row, formatDate(entry.created_at));
            appendCell(row, entry.ip === 'unknown' ? 'Chưa ghi nhận IP' : entry.ip);
            appendCell(row, entry.waybill);
            inventoryHistoryRows.append(row);
        }
    } catch (error) {
        inventoryHistoryError.textContent = error.message;
        inventoryHistoryError.hidden = false;
    }
}

async function loadIps() {
    ipError.hidden = true;
    try {
        const ips = await api('/api/admin/ips');
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
        ipError.textContent = error.message;
        ipError.hidden = false;
    }
}

function showAdminInitError(message) {
    let banner = document.getElementById('adminInitError');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'adminInitError';
        banner.style.cssText = 'background:#fee;color:#900;padding:12px;margin:12px 0;border:1px solid #900;font-family:monospace;white-space:pre-wrap;';
        document.body.prepend(banner);
    }
    banner.textContent = message;
}

fetch('/api/admin/me').then(async response => {
    if (response.status === 401) {
        throw new Error('API /api/admin/me trả HTTP 401 - session không được xác thực.');
    }
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`/api/admin/me trả HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return response.json();
}).then(admin => {
    if (admin) document.getElementById('adminName').textContent = admin.username;
}).catch(error => {
    console.error('Lỗi khởi tạo trang quản trị:', error);
    showAdminInitError(error.message || 'Lỗi không xác định khi tải /api/admin/me.');
});

document.getElementById('logoutButton').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.assign('/admin');
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

    try {
        const blocked = action === 'block';
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

inventorySearchInput.addEventListener('input', () => {
    clearTimeout(inventorySearchTimer);
    inventorySearchTimer = setTimeout(() => {
        inventoryCurrentPage = 1;
        loadInventoryHistory();
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

document.getElementById('previousInventoryPage').addEventListener('click', () => {
    if (inventoryCurrentPage > 1) inventoryCurrentPage -= 1;
    loadInventoryHistory();
});

document.getElementById('nextInventoryPage').addEventListener('click', () => {
    if (inventoryCurrentPage < inventoryTotalPages) inventoryCurrentPage += 1;
    loadInventoryHistory();
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

loadHistory();
loadInventoryHistory();
loadIps();
loadGeography();
loadFormFields();

async function loadGeography() {
    const errorMessage = document.getElementById('geographyError');
    const editing = document.querySelector('[data-edit-group="geography"]').dataset.editing === 'true';
    errorMessage.hidden = true;

    try {
        const districts = await api('/api/admin/geography');
        const districtRows = document.getElementById('districtRows');
        const communeRows = document.getElementById('communeRows');
        const newCommuneDistrict = document.getElementById('newCommuneDistrict');
        districtRows.replaceChildren();
        communeRows.replaceChildren();
        newCommuneDistrict.replaceChildren();

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
            }
        }

        if (districts.length === 0) {
            appendEmptyRow(districtRows, 'Chưa có thành phố hoặc huyện.', 5);
            appendEmptyRow(communeRows, 'Chưa có xã.', 4);
        } else if (districts.every(district => district.communes.length === 0)) {
            appendEmptyRow(communeRows, 'Chưa có xã.', 4);
        }
    } catch (error) {
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
    const districts = await api('/api/admin/geography');
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
    const isDelete = action.startsWith('delete');
    const isVisibility = action.startsWith('hide') || action.startsWith('show');
    const id = Number(row.dataset[isDistrict ? 'districtId' : 'communeId']);
    const errorMessage = document.getElementById('geographyError');
    errorMessage.hidden = true;

    if (isDelete && !window.confirm(isDistrict
        ? 'Xóa thành phố/huyện này cùng toàn bộ xã trực thuộc? Lịch sử tem đã tạo vẫn được giữ lại.'
        : 'Xóa xã này? Lịch sử tem đã tạo vẫn được giữ lại.')) return;

    const resource = isDistrict ? 'districts' : 'communes';
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
        setSaveStatus(isDelete ? 'Lỗi xóa' : 'Lỗi cập nhật', 'error');
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }
});

async function loadFormFields() {
    const errorMessage = document.getElementById('formFieldsError');
    const rows = document.getElementById('formFieldRows');
    errorMessage.hidden = true;
    try {
        const fields = await api('/api/admin/form-fields');
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
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }
}
