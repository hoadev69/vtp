const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

test('VTP runtime configuration consistently uses port 3001 and the persistent SQLite path', () => {
    const server = read('server.js');
    const envExample = read('.env.example');
    const viteConfig = read('frontend/vite.config.js');
    const serviceUnit = read('ops/vtp.service.example');
    const nginxConfig = read('nginx/vtp.conf.example');
    const deployHelper = read('ops/deploy-release.sh');
    const inventory = read('ops/vps-inventory.sh');
    const workflow = read('.github/workflows/deploy.yml');
    const databasePath = '/var/www/vtp/data/history.sqlite';

    assert.match(server, /process\.env\.PORT \|\| 3001/);
    assert.match(envExample, /^PORT=3001$/m);
    assert.match(viteConfig, /http:\/\/127\.0\.0\.1:3001/);
    assert.match(server, /express\.static\(frontendDistPath, \{ index: false \}\)/);
    assert.match(server, /function sendFrontendApp\(/);
    assert.match(serviceUnit, /^User=deploy$/m);
    assert.match(serviceUnit, /^Group=deploy$/m);
    assert.match(serviceUnit, /^Environment=PORT=3001$/m);
    assert.match(serviceUnit, new RegExp(`^Environment=DATABASE_PATH=${databasePath.replaceAll('/', '\\/')}$`, 'm'));
    assert.match(serviceUnit, /^EnvironmentFile=\/var\/www\/vtp\/\.env$/m);
    assert.match(nginxConfig, /proxy_pass http:\/\/127\.0\.0\.1:3001;/);
    assert.match(nginxConfig, /server_name vtp\.biloveg\.io\.vn;/);
    assert.match(nginxConfig, /ssl_certificate_key \/etc\/nginx\/ssl\/vtp\/origin\.key;/);
    assert.match(nginxConfig, /root \/var\/www\/vtp\/current\/frontend\/dist;/);
    assert.match(nginxConfig, /try_files \$uri \@app;/);
    assert.match(nginxConfig, /location \@app/);
    assert.doesNotMatch(nginxConfig, /127\.0\.0\.1:3000/);
    assert.match(deployHelper, /127\.0\.0\.1:3001\/healthz/);
    assert.match(deployHelper, /VTP_FRONTEND_URL/);
    assert.match(deployHelper, /unit_environment_value PORT\)" == 3001/);
    assert.match(deployHelper, /\[\[ "\$service_database_path" == "\$app_root\/data\/history\.sqlite" \]\]/);
    assert.match(deployHelper, /Only EnvironmentFile=\$app_root\/\.env is supported/);
    assert.match(inventory, /port" == 3001/);
    assert.match(inventory, /127\\\.0\\\.0\\\.1:3001/);
    assert.match(inventory, /elif \[\[ "\$database_path" != "\$app_root\/data\/history\.sqlite" \]\]/);
    assert.match(workflow, /bash scripts\/package-release\.sh/);
    assert.match(workflow, /bash "\$stage\/ops\/deploy-release\.sh" deploy/);
});