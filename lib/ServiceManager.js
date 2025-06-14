const pm2 = require('pm2');
const path = require('path');
const fs = require('fs').promises;
const winston = require('winston');
const tar = require('tar');
const { promisify } = require('util');
const stream = require('stream');
const pipeline = promisify(stream.pipeline);
const crypto = require('crypto');

class ServiceManager {
    constructor(dataDir = './data') {
        this.dataDir = dataDir;
        this.services = new Map();
        this.status = new Map(); // name -> 'running' | 'stopped'
        this.broadcastCallback = null; // Callback for broadcasting updates
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: 'error.log', level: 'error' }),
                new winston.transports.File({ filename: 'combined.log' })
            ]
        });

        if (process.env.NODE_ENV !== 'production') {
            this.logger.add(new winston.transports.Console({
                format: winston.format.simple()
            }));
        }
    }

    async init() {
        await this.ensureDataDir();
        await this.loadServices();
        this.setupPm2();
    }

    async ensureDataDir() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            this.logger.info(`Ensured data directory exists at ${this.dataDir}`);
        } catch (error) {
            this.logger.error('Failed to create data directory', error);
            throw error;
        }
    }

    setupPm2() {
        pm2.connect((err) => {
            if (err) {
                this.logger.error('Failed to connect to PM2', err);
                return;
            }
            this.logger.info('Connected to PM2');
        });
    }

    async loadServices() {
        const entries = await fs.readdir(this.dataDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const servicePath = path.join(this.dataDir, entry.name);
                const metaPath = path.join(servicePath, 'releases.json');
                let meta = { env: {}, releases: [], activeReleaseId: null };
                try {
                    meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
                } catch {}
                this.services.set(entry.name, {
                    name: entry.name,
                    env: meta.env || {},
                    releases: meta.releases || [],
                    activeReleaseId: meta.activeReleaseId || null
                });
                this.status.set(entry.name, 'stopped');
            }
        }
    }

    async saveServiceMeta(name) {
        const service = this.services.get(name);
        if (!service) throw new Error('Service not found');
        const servicePath = path.join(this.dataDir, name);
        const metaPath = path.join(servicePath, 'releases.json');
        await fs.writeFile(metaPath, JSON.stringify({
            env: service.env,
            releases: service.releases,
            activeReleaseId: service.activeReleaseId
        }, null, 2));
    }

    async createService(name, env = {}) {
        if (this.services.has(name)) throw new Error('Service already exists');
        const servicePath = path.join(this.dataDir, name);
        await fs.mkdir(path.join(servicePath, 'releases'), { recursive: true });
        const service = {
            name,
            env,
            releases: [],
            activeReleaseId: null
        };
        this.services.set(name, service);
        this.status.set(name, 'stopped');
        await this.saveServiceMeta(name);
        return service;
    }

    async addRelease(name, tarballBuffer) {
        const service = this.services.get(name);
        if (!service) throw new Error('Service not found');
        const releaseId = crypto.randomUUID();
        const releasesDir = path.join(this.dataDir, name, 'releases');
        await fs.mkdir(releasesDir, { recursive: true });
        const tarballPath = path.join(releasesDir, `${releaseId}.tgz`);
        await fs.writeFile(tarballPath, tarballBuffer);
        // Extract package.json for metadata
        let packageJson = null;
        const tmpDir = path.join(releasesDir, `tmp-${releaseId}`);
        await fs.mkdir(tmpDir, { recursive: true });
        try {
            await tar.x({ file: tarballPath, cwd: tmpDir, filter: p => p === 'package.json' });
            const pkgPath = path.join(tmpDir, 'package.json');
            const pkgRaw = await fs.readFile(pkgPath, 'utf8');
            packageJson = JSON.parse(pkgRaw);
        } catch {}
        await fs.rm(tmpDir, { recursive: true, force: true });
        const release = {
            id: releaseId,
            filename: `${releaseId}.tgz`,
            createdAt: new Date().toISOString(),
            metadata: packageJson || {}
        };
        service.releases.push(release);
        service.activeReleaseId = releaseId;
        await this.saveServiceMeta(name);
        this.broadcastUpdate(name, 'release', { release });
        return release;
    }

    async listReleases(name) {
        const service = this.services.get(name);
        if (!service) throw new Error('Service not found');
        return service.releases;
    }

    async activateRelease(name, releaseId) {
        const service = this.services.get(name);
        if (!service) throw new Error('Service not found');
        if (!service.releases.find(r => r.id === releaseId)) throw new Error('Release not found');
        service.activeReleaseId = releaseId;
        await this.saveServiceMeta(name);
        this.broadcastUpdate(name, 'release', { activeReleaseId: releaseId });
        return releaseId;
    }

    async updateEnv(name, env) {
        const service = this.services.get(name);
        if (!service) throw new Error('Service not found');
        service.env = env;
        await this.saveServiceMeta(name);
        this.broadcastUpdate(name, 'env', { env });
        return service.env;
    }

    getServices() {
        return Array.from(this.services.values()).map(s => ({
            name: s.name,
            env: s.env,
            releases: s.releases,
            activeReleaseId: s.activeReleaseId,
            status: this.status.get(s.name) || 'stopped',
            activeRelease: s.releases.find(r => r.id === s.activeReleaseId) || null
        }));
    }

    async getActiveReleaseTarball(name) {
        const service = this.services.get(name);
        if (!service) throw new Error('Service not found');
        const release = service.releases.find(r => r.id === service.activeReleaseId);
        if (!release) throw new Error('Active release not found');
        const tarballPath = path.join(this.dataDir, name, 'releases', release.filename);
        return fs.readFile(tarballPath);
    }

    async registerService(name, servicePath) {
        try {
            const packageJson = require(path.join(servicePath, 'package.json'));
            
            const service = {
                name,
                path: servicePath,
                script: packageJson.scripts?.start || 'index.js',
                status: 'stopped',
                config: {
                    instances: 1,
                    exec_mode: 'fork',
                    watch: false,
                    env: {
                        NODE_ENV: 'production'
                    }
                }
            };

            this.services.set(name, service);
            await this.startService(name);
            return service;
        } catch (error) {
            this.logger.error(`Failed to register service ${name}`, error);
            throw error;
        }
    }

    async startService(name) {
        const service = this.services.get(name);
        if (!service) throw new Error('Service not found');
        const release = service.releases.find(r => r.id === service.activeReleaseId);
        if (!release) throw new Error('No active release');
        // Extract tarball to a temp dir
        const releasesDir = path.join(this.dataDir, name, 'releases');
        const tmpDir = path.join(releasesDir, `run-${release.id}`);
        await fs.rm(tmpDir, { recursive: true, force: true });
        await fs.mkdir(tmpDir, { recursive: true });
        await tar.x({ file: path.join(releasesDir, release.filename), cwd: tmpDir });
        // Always run npm install before starting
        console.log(`[ServiceManager] Running npm install in ${tmpDir}`);
        await new Promise((resolve, reject) => {
            require('child_process').exec('npm install --omit=dev', { cwd: tmpDir }, (err, stdout, stderr) => {
                if (stdout) console.log(`[npm install stdout]`, stdout);
                if (stderr) console.log(`[npm install stderr]`, stderr);
                if (err) return reject(new Error('npm install failed: ' + stderr));
                resolve();
            });
        });
        // Find main file from package.json
        let mainFile = 'index.js';
        try {
            const pkgRaw = await fs.readFile(path.join(tmpDir, 'package.json'), 'utf8');
            const pkg = JSON.parse(pkgRaw);
            if (pkg.main) mainFile = pkg.main;
        } catch (e) {
            console.log('[ServiceManager] Could not read package.json, using index.js');
        }
        const allFiles = await fs.readdir(tmpDir);
        let mainFileName = mainFile;
        if (!allFiles.includes(mainFile)) {
            // Try case-insensitive match
            const found = allFiles.find(f => f.toLowerCase() === mainFile.toLowerCase());
            if (found) {
                mainFileName = found;
                console.log(`[ServiceManager] Main file not found case-sensitively, using: ${found}`);
            }
        }
        const pm2Script = path.join(tmpDir, mainFileName).split(path.sep).join('/');
        console.log(`[ServiceManager] Starting service '${name}' with main file: ${mainFileName}`);
        console.log(`[ServiceManager] PM2 script path:`, pm2Script);
        // Remove old PM2 process if exists
        await new Promise((resolve) => pm2.delete(name, () => resolve()));
        return new Promise((resolve, reject) => {
            pm2.start({
                name: name,
                script: pm2Script,
                cwd: tmpDir.split(path.sep).join('/'),
                env: service.env
            }, (err) => {
                if (err) return reject(err);
                pm2.describe(name, (err2, list) => {
                    if (!err2 && list && list.length) {
                        console.log(`[ServiceManager] PM2 process info after start:`, list[0]);
                        this.status.set(name, 'running');
                        this.broadcastUpdate(name, 'status', { status: 'running', pm2: list[0] });
                    }
                    resolve({ status: 'running' });
                });
            });
        });
    }

    async stopService(name) {
        return new Promise((resolve, reject) => {
            pm2.stop(name, (err) => {
                if (err) return reject(err);
                pm2.delete(name, (err2) => {
                    if (err2) console.log(`[ServiceManager] PM2 delete error:`, err2);
                    pm2.describe(name, (err3, list) => {
                        if (!err3 && list && list.length) {
                            console.log(`[ServiceManager] PM2 process info after stop:`, list[0]);
                        }
                        this.status.set(name, 'stopped');
                        this.broadcastUpdate(name, 'status', { status: 'stopped' });
                        resolve({ status: 'stopped' });
                    });
                });
            });
        });
    }

    async restartService(name) {
        return new Promise((resolve, reject) => {
            pm2.restart(name, (err) => {
                if (err) return reject(err);
                pm2.describe(name, (err2, list) => {
                    if (!err2 && list && list.length) {
                        console.log(`[ServiceManager] PM2 process info after restart:`, list[0]);
                        this.status.set(name, 'running');
                        this.broadcastUpdate(name, 'status', { status: 'running', pm2: list[0] });
                    }
                    resolve({ status: 'running' });
                });
            });
        });
    }

    async updateService(name, tarballBuffer) {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`Service ${name} not found`);
        }

        // Create a temporary directory for extraction
        const tempDir = path.join(this.dataDir, `${name}-temp`);
        await fs.mkdir(tempDir, { recursive: true });

        try {
            // Extract the tarball to temp directory
            await pipeline(
                stream.Readable.from(tarballBuffer),
                tar.extract({ cwd: tempDir })
            );

            // Validate package.json
            const packageJsonPath = path.join(tempDir, 'package.json');
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

            if (!packageJson.main) {
                throw new Error('package.json must specify a main file');
            }

            // Stop the service if it's running
            if (service.status === 'running') {
                await this.stopService(name);
            }

            // Remove old files
            const oldFiles = await fs.readdir(service.path);
            for (const file of oldFiles) {
                if (file !== 'node_modules') { // Preserve node_modules
                    await fs.rm(path.join(service.path, file), { recursive: true, force: true });
                }
            }

            // Move new files to service directory
            const newFiles = await fs.readdir(tempDir);
            for (const file of newFiles) {
                await fs.rename(
                    path.join(tempDir, file),
                    path.join(service.path, file)
                );
            }

            // Update service info
            service.mainFile = packageJson.main;
            service.package = packageJson;

            // Install dependencies
            const { exec } = require('child_process');
            await new Promise((resolve, reject) => {
                exec('npm install', { cwd: service.path }, (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });

            // Start the service if it was running
            if (service.status === 'running') {
                await this.startService(name);
            }

            return service;
        } finally {
            // Clean up temp directory
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }

    async getServiceStatus(name) {
        return new Promise((resolve, reject) => {
            pm2.describe(name, (err, list) => {
                if (err) return reject(err);
                if (!list || !list.length) {
                    this.status.set(name, 'stopped');
                    return resolve({ status: 'stopped' });
                }
                const proc = list[0];
                this.status.set(name, proc.pm2_env.status);
                resolve({
                    status: proc.pm2_env.status,
                    pm2: proc
                });
            });
        });
    }

    async getAllServices() {
        return Array.from(this.services.values());
    }

    setBroadcastCallback(callback) {
        this.broadcastCallback = callback;
    }

    broadcastUpdate(serviceName, eventType, data) {
        if (this.broadcastCallback) {
            this.broadcastCallback({
                type: eventType,
                service: serviceName,
                data
            });
        }
    }
}

module.exports = ServiceManager; 