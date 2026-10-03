import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const backendTarget = process.env.VTP_BACKEND_ORIGIN || 'http://127.0.0.1:3001';

const publicAssets = [
    'manifest.webmanifest',
    'icons/vtp-192.png',
    'icons/vtp-512.png',
    'icons/vtp-maskable-512.png',
    'icons/vtp-apple-touch-icon.png',
];
const serviceWorkerTemplate = readFileSync(new URL('./src/pwa/service-worker.js', import.meta.url), 'utf8');

function serviceWorkerPlugin() {
    let basePath = '/';

    return {
        name: 'vtp-shell-service-worker',
        apply: 'build',
        configResolved(config) {
            basePath = config.base.endsWith('/') ? config.base : `${config.base}/`;
        },
        generateBundle(_options, bundle) {
            const buildAssets = Object.values(bundle).filter(asset => (
                asset.type === 'chunk' || (asset.type === 'asset' && /\.(css|woff2?|svg)$/.test(asset.fileName))
            ));
            const files = [...new Set([
                'index.html',
                ...buildAssets.map(asset => asset.fileName),
                ...publicAssets,
            ])];
            const precacheUrls = files.map(file => `${basePath}${file}`);
            const buildHash = createHash('sha256');

            for (const file of files) {
                buildHash.update(file);
                const bundledAsset = bundle[file];
                if (bundledAsset) {
                    buildHash.update(bundledAsset.type === 'chunk' ? bundledAsset.code : bundledAsset.source);
                } else {
                    const sourcePath = file === 'index.html' ? './index.html' : `./public/${file}`;
                    buildHash.update(readFileSync(new URL(sourcePath, import.meta.url)));
                }
            }

            const version = buildHash.digest('hex').slice(0, 12);
            const serviceWorker = serviceWorkerTemplate
                .replace('__CACHE_NAME__', JSON.stringify(`vtp-shell-${version}`))
                .replace('__PRECACHE_URLS__', JSON.stringify(precacheUrls))
                .replace('__APP_ROOT_PATH__', JSON.stringify(basePath))
                .replace('__APP_INDEX_PATH__', JSON.stringify(`${basePath}index.html`))
                .replace('__APP_RESULT_PATH__', JSON.stringify(`${basePath}ketqua.html`))
                .replace('__APP_ADMIN_PATH__', JSON.stringify(`${basePath}admin`))
                .replace('__APP_INVENTORY_PATH__', JSON.stringify(`${basePath}kiemke`));

            this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker });
        },
    };
}

export default defineConfig({
    base: '/',
    server: {
        proxy: {
            '/api': {
                target: backendTarget,
                changeOrigin: false,
            },
        },
    },
    plugins: [serviceWorkerPlugin()],
});