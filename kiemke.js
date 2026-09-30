const createQrButton = document.getElementById('createQrButton');
const formError = document.getElementById('formError');
const qrDialog = document.getElementById('qrDialog');
const qrImage = document.getElementById('qrImage');

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