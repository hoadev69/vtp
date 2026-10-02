const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const dotenv = require('dotenv');

const workspacePath = path.resolve(__dirname);
const testDirectory = path.resolve('/tmp/vtp-auth-test-2026');
const testDatabasePath = path.resolve(testDirectory, 'history.sqlite');
const configPath = path.resolve(testDirectory, 'auth-test.env');
const defaultDatabasePath = path.resolve(workspacePath, 'data', 'history.sqlite');
const testUsername = 'vtp_auth_test_2026';
const testPort = '43127';
const fixedConfig = {
    DATABASE_PATH: testDatabasePath,
    PORT: testPort,
    ADMIN_USERNAME: testUsername,
    NODE_ENV: 'test',
};

function fail(message) {
    throw new Error(message);
}

function isOutsideWorkspace(targetPath) {
    const relativePath = path.relative(workspacePath, targetPath);
    return relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);
}

function pathExists(targetPath) {
    try {
        fs.lstatSync(targetPath);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

function assertTestDirectory({ mustExist }) {
    const stats = fs.existsSync(testDirectory) ? fs.lstatSync(testDirectory) : null;
    if (!stats) {
        if (mustExist) fail('Test directory is missing; run prepare first.');
        return;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) fail('Test path must be a real directory.');
    if ((stats.mode & 0o077) !== 0) fail('Test directory permissions are too broad.');
}

function assertSafeDatabasePath(configuredPath) {
    if (typeof configuredPath !== 'string' || configuredPath.trim() === '') {
        fail('DATABASE_PATH is missing or empty.');
    }
    if (!path.isAbsolute(configuredPath)) fail('DATABASE_PATH must be absolute.');

    const resolvedPath = path.resolve(configuredPath);
    if (resolvedPath !== testDatabasePath) fail('DATABASE_PATH does not match the fixed test database path.');
    if (resolvedPath === defaultDatabasePath) fail('Test database path matches the application default.');
    if (!isOutsideWorkspace(resolvedPath)) fail('Test database path must be outside the workspace.');

    assertTestDirectory({ mustExist: false });

    for (const candidate of [resolvedPath, `${resolvedPath}-wal`, `${resolvedPath}-shm`]) {
        if (pathExists(candidate)) fail('Test database or SQLite sidecar already exists; refusing to continue.');
    }
}

function assertAmbientEnvironmentSafe() {
    for (const [key, expectedValue] of Object.entries(fixedConfig)) {
        if (process.env[key] && process.env[key] !== expectedValue) {
            fail(`Conflicting ${key} is already set in the environment.`);
        }
    }
    for (const key of ['ADMIN_PASSWORD', 'SESSION_SECRET']) {
        if (process.env[key]) fail(`Refusing to reuse an existing ${key}.`);
    }
}

function assertConfig(config) {
    for (const [key, expectedValue] of Object.entries(fixedConfig)) {
        if (config[key] !== expectedValue) fail(`Test configuration has an invalid ${key}.`);
    }
    if (typeof config.ADMIN_PASSWORD !== 'string'
        || Buffer.byteLength(config.ADMIN_PASSWORD, 'utf8') < 6
        || Buffer.byteLength(config.ADMIN_PASSWORD, 'utf8') > 72) {
        fail('Test ADMIN_PASSWORD does not meet the application requirements.');
    }
    if (typeof config.SESSION_SECRET !== 'string' || Buffer.byteLength(config.SESSION_SECRET, 'utf8') < 32) {
        fail('Test SESSION_SECRET does not meet the application requirements.');
    }

    const ambientDatabasePath = process.env.DATABASE_PATH;
    if (ambientDatabasePath !== undefined && ambientDatabasePath !== config.DATABASE_PATH) {
        fail('Environment DATABASE_PATH conflicts with the test configuration.');
    }
    assertSafeDatabasePath(config.DATABASE_PATH);
}

function loadConfig() {
    assertTestDirectory({ mustExist: true });
    if (!fs.existsSync(configPath)) fail('Test auth configuration is missing; run prepare first.');
    const metadata = fs.lstatSync(configPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) fail('Test auth configuration must be a regular file.');
    if ((metadata.mode & 0o077) !== 0) fail('Test auth configuration permissions are too broad.');

    const config = dotenv.parse(fs.readFileSync(configPath));
    assertConfig(config);
    return config;
}

function assertNoApplicationModulesLoaded() {
    for (const filePath of ['./server.js', './database.js']) {
        if (require.cache[require.resolve(filePath)]) {
            fail('Application or database module was loaded before preflight completed.');
        }
    }
}

function assertPortFree() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', error => {
            if (error.code === 'EADDRINUSE') return reject(new Error('Test port 43127 is already in use.'));
            reject(error);
        });
        probe.listen(Number(testPort), () => {
            probe.close(error => error ? reject(error) : resolve());
        });
    });
}

function prepareConfig() {
    assertSafeDatabasePath(testDatabasePath);
    assertAmbientEnvironmentSafe();
    if (pathExists(testDirectory)) fail('Test directory already exists; refusing to overwrite it.');

    fs.mkdirSync(testDirectory, { mode: 0o700 });
    assertTestDirectory({ mustExist: true });

    const config = {
        ...fixedConfig,
        ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'),
        SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
    };
    assertConfig(config);

    if (pathExists(configPath)) fail('Test auth configuration already exists; refusing to overwrite it.');

    const fileDescriptor = fs.openSync(configPath, 'wx', 0o600);
    try {
        const contents = Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n');
        fs.writeFileSync(fileDescriptor, `${contents}\n`, 'utf8');
        fs.fsyncSync(fileDescriptor);
    } finally {
        fs.closeSync(fileDescriptor);
    }
    const metadata = fs.lstatSync(configPath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o077) !== 0) {
        fail('Test auth configuration permissions or file type are unsafe.');
    }

    console.log(`Test configuration prepared: ${configPath}`);
    console.log(`Database path reserved for test: ${testDatabasePath}`);
    console.log('No SQLite database was opened or created.');
}

async function main() {
    const mode = process.argv[2] || 'check';
    if (!['prepare', 'check', 'start'].includes(mode)) {
        fail('Usage: node prepare-vtp-auth-test.js [prepare|check|start]');
    }

    assertNoApplicationModulesLoaded();
    if (mode === 'prepare') {
        await assertPortFree();
        prepareConfig();
        return;
    }

    const config = loadConfig();
    for (const [key, value] of Object.entries(config)) process.env[key] = value;
    assertNoApplicationModulesLoaded();
    await assertPortFree();
    assertSafeDatabasePath(process.env.DATABASE_PATH);

    if (mode === 'check') {
        console.log('Test configuration, database isolation, and port checks passed.');
        console.log(`Database path: ${testDatabasePath}`);
        console.log(`Test port: ${testPort}`);
        console.log('Application and database modules were not imported.');
        return;
    }

    require('./server.js');
}

main().catch(error => {
    console.error(`Test environment preflight failed: ${error.message}`);
    process.exitCode = 1;
});