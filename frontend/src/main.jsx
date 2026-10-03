import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.jsx';
import './styles/base.css';

createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    let hadController = Boolean(navigator.serviceWorker.controller);
    let isReloadingForUpdate = false;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) {
            hadController = Boolean(navigator.serviceWorker.controller);
            return;
        }
        if (isReloadingForUpdate) return;
        isReloadingForUpdate = true;
        window.location.reload();
    });

    window.addEventListener('load', () => {
        const basePath = import.meta.env.BASE_URL;
        navigator.serviceWorker.register(`${basePath}sw.js`, {
            scope: basePath,
            updateViaCache: 'none',
        }).then(registration => {
            const checkForUpdate = () => {
                if (!navigator.onLine || document.visibilityState !== 'visible') return;
                registration.update().catch(error => {
                    console.warn('Không thể kiểm tra bản cập nhật ứng dụng.', error);
                });
            };

            checkForUpdate();
            window.addEventListener('pageshow', checkForUpdate);
            window.addEventListener('online', checkForUpdate);
            document.addEventListener('visibilitychange', checkForUpdate);
            window.setInterval(checkForUpdate, 30 * 60 * 1000);
        }).catch(error => {
            console.error('Không thể đăng ký service worker.', error);
        });
    }, { once: true });
}