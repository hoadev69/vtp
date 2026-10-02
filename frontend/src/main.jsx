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
    window.addEventListener('load', () => {
        const basePath = import.meta.env.BASE_URL;
        navigator.serviceWorker.register(`${basePath}sw.js`, { scope: basePath })
            .catch(() => {});
    }, { once: true });
}