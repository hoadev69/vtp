const form = document.getElementById('loginForm');
const errorMessage = document.getElementById('loginError');

form.addEventListener('submit', async event => {
    event.preventDefault();
    errorMessage.hidden = true;

    const values = new FormData(form);
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: values.get('username'),
                password: values.get('password'),
            }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Đăng nhập thất bại.');
        window.location.assign('/admin');
    } catch (error) {
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }
});