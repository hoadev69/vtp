import React, { useState } from 'react';
import InputControl from '../../shared/components/InputControl.jsx';

export default function AdminLoginForm({ onLogin, error, isSubmitting }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    function submit(event) {
        event.preventDefault();
        onLogin({ username, password });
    }

    return (
        <section className="admin-login" aria-labelledby="admin-login-title">
            <p className="admin-eyebrow">VTP · KHU VỰC QUẢN TRỊ</p>
            <h1 id="admin-login-title">Đăng nhập quản trị</h1>
            <form className="admin-login__form" onSubmit={submit} aria-busy={isSubmitting}>
                <div className="admin-field">
                    <label htmlFor="admin-username">Tên đăng nhập</label>
                    <input autoComplete="username" id="admin-username" name="username" onChange={event => setUsername(event.target.value)} required value={username} />
                </div>
                <div className="admin-field">
                    <label htmlFor="admin-password">Mật khẩu</label>
                    <InputControl autoComplete="current-password" id="admin-password" name="password" onChange={event => setPassword(event.target.value)} required type="password" value={password} />
                </div>
                {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
                <button className="admin-primary-button" disabled={isSubmitting} type="submit">
                    {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
                </button>
            </form>
        </section>
    );
}