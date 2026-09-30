const createQrButton = document.getElementById('createQrButton');
const formError = document.getElementById('formError');
const loginForm = document.getElementById('operatorLoginForm');
const loginButton = document.getElementById('operatorLoginButton');
const loginError = document.getElementById('loginError');
const loginPanel = document.getElementById('operatorLoginPanel');
const createPanel = document.getElementById('inventoryCreatePanel');
const operatorActions = document.getElementById('operatorActions');
const qrDialog = document.getElementById('qrDialog');
const qrImage = document.getElementById('qrImage');

function showLogin(error = '') {
    loginPanel.hidden = false;
    createPanel.hidden = true;
    operatorActions.hidden = true;
    loginError.textContent = error;
    loginError.hidden = !error;
}

function showInventory(username) {
    loginPanel.hidden = true;
    createPanel.hidden = false;
    operatorActions.hidden = false;
    document.getElementById('operatorName').textContent = username;
    loginError.hidden = true;
    formError.hidden = true;
}

async function checkInventorySession() {
    try {
        const response = await fetch('/api/kiemke/me');
        if (response.status === 401) {
            showLogin();
            return;
        }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Không thể kiểm tra phiên đăng nhập.');
        showInventory(result.username);
    } catch (error) {
        showLogin(error.message);
    }
}

loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    loginError.hidden = true;
    loginButton.disabled = true;
    const values = new FormData(loginForm);
    try {
        const response = await fetch('/api/kiemke/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: values.get('username'), password: values.get('password') }),
        });
        const result = await response.json();
        if (response.status === 403 && result.code === 'ACCOUNT_DISABLED') {
            loginForm.reset();
            document.getElementById('accountLockedReason').textContent = result.reason || result.error;
            document.getElementById('accountLockedDialog').showModal();
            return;
        }
        if (!response.ok) throw new Error(result.error || 'Đăng nhập thất bại.');
        loginForm.reset();
        showInventory(result.username);
    } catch (error) {
        loginError.textContent = error.message;
        loginError.hidden = false;
    } finally {
        loginButton.disabled = false;
    }
});

document.getElementById('closeAccountLocked').addEventListener('click', () => {
    document.getElementById('accountLockedDialog').close();
});

document.getElementById('accountLockedDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});

document.getElementById('operatorLogout').addEventListener('click', async () => {
    try {
        const response = await fetch('/api/kiemke/logout', { method: 'POST' });
        if (!response.ok) throw new Error('Không thể đăng xuất tài khoản kiểm kê.');
        if (qrDialog.open) qrDialog.close();
        showLogin();
    } catch (error) {
        formError.textContent = error.message;
        formError.hidden = false;
    }
});

createQrButton.addEventListener('click', async () => {
    formError.hidden = true;
    createQrButton.disabled = true;

    try {
        if (!navigator.clipboard?.readText) {
            throw new Error('Trình duyệt không hỗ trợ đọc clipboard trên kết nối này.');
        }
        const waybill = (await navigator.clipboard.readText()).trim();
        if (!waybill) throw new Error('Clipboard đang trống.');

        const response = await fetch('/api/kiemke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ waybill }),
        });
        const result = await response.json();
        if (response.status === 401) {
            showLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
            return;
        }
        if (!response.ok) throw new Error(result.error || 'Không thể tạo mã QR.');
        qrImage.src = result.qrCode;
        qrDialog.showModal();
    } catch (error) {
        formError.textContent = error.name === 'NotAllowedError'
            ? 'Trình duyệt chưa được cấp quyền đọc clipboard.'
            : error.message;
        formError.hidden = false;
    } finally {
        createQrButton.disabled = false;
    }
});

document.getElementById('closeQrDialog').addEventListener('click', () => qrDialog.close());
qrDialog.addEventListener('click', event => {
    if (event.target === qrDialog) qrDialog.close();
});
qrDialog.addEventListener('close', () => {
    qrImage.removeAttribute('src');
    createQrButton.focus();
});

checkInventorySession();