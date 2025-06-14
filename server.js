require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const ServiceManager = require('./lib/ServiceManager');
const { requireAuth, generateToken } = require('./lib/auth');
const WebSocket = require('ws');
const pm2 = require('pm2');
const readline = require('readline');
const fsSync = require('fs');

async function startServer() {
    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server, {
        cors: { origin: "*", methods: ["GET", "POST"] }
    });

    // Security middleware
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginOpenerPolicy: false,
        originAgentCluster: false
    }));

    // Performance middleware
    app.use(compression());
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Session management
    app.use(session({
        secret: process.env.SESSION_SECRET || 'default-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { 
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    }));

    // Serve static files
    app.use(express.static(path.join(__dirname, 'public')));

    // Initialize service manager
    const serviceManager = new ServiceManager();
    await serviceManager.init();

    // Configure multer for tarball uploads
    const upload = multer({
        storage: multer.memoryStorage(),
        fileFilter: (req, file, cb) => {
            if (file.mimetype === 'application/x-gzip' || file.mimetype === 'application/gzip' || file.originalname.endsWith('.tgz')) {
                cb(null, true);
            } else {
                cb(new Error('Only .tgz files are allowed'));
            }
        },
        limits: {
            fileSize: 50 * 1024 * 1024 // 50MB limit
        }
    });

    // WebSocket server
    const wss = new WebSocket.Server({ noServer: true });
    const wsClients = new Set();

    // Set up broadcast callback for ServiceManager
    serviceManager.setBroadcastCallback((update) => {
        wsClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(update));
            }
        });
    });

    wss.on('connection', (ws, req) => {
        if (req.url.startsWith('/ws/logs/')) {
            const serviceName = decodeURIComponent(req.url.split('/').pop());
            requireAuthWS(req, ws, () => {
                if (!wsLogClients.has(serviceName)) wsLogClients.set(serviceName, new Set());
                wsLogClients.get(serviceName).add(ws);
                let bus;
                pm2.launchBus((err, pm2Bus) => {
                    if (err) return;
                    bus = pm2Bus;
                    const handler = (packet) => {
                        if (packet.process && packet.process.name === serviceName) {
                            if (packet.data) ws.send(packet.data.toString());
                        }
                    };
                    bus.on('log:out', handler);
                    bus.on('log:err', handler);
                    ws.on('close', () => {
                        bus.off('log:out', handler);
                        bus.off('log:err', handler);
                        wsLogClients.get(serviceName).delete(ws);
                    });
                });
            });
        } else {
            // Handle service updates WebSocket
            requireAuthWS(req, ws, () => {
                wsClients.add(ws);
                // Send initial state
                const services = serviceManager.getServices();
                ws.send(JSON.stringify({
                    type: 'initial',
                    data: { services }
                }));

                ws.on('close', () => {
                    wsClients.delete(ws);
                });
            });
        }
    });

    server.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });

    // Auth endpoint
    app.post('/api/auth/token', (req, res) => {
        const { password } = req.body;
        if (password === process.env.ADMIN_PASSWORD) {
            const token = generateToken();
            res.json({ token });
        } else {
            res.status(401).json({ message: 'Invalid password' });
        }
    });

    // --- Service API ---
    // Create service
    app.post('/api/services', requireAuth, async (req, res) => {
        try {
            const { name, env } = req.body;
            if (!name) return res.status(400).json({ message: 'Missing service name' });
            if (!/^[a-z0-9-]+$/.test(name)) return res.status(400).json({ message: 'Service name must contain only lowercase letters, numbers, and hyphens' });
            const service = await serviceManager.createService(name, env || {});
            res.json(service);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // List all services
    app.get('/api/services', requireAuth, (req, res) => {
        res.json(serviceManager.getServices());
    });

    // Upload tarball to create a release
    app.post('/api/services/:service/releases', requireAuth, upload.single('package'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ message: 'No package file uploaded' });
            const release = await serviceManager.addRelease(req.params.service, req.file.buffer);
            res.json(release);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // List releases for a service
    app.get('/api/services/:service/releases', requireAuth, async (req, res) => {
        try {
            const releases = await serviceManager.listReleases(req.params.service);
            res.json(releases);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // Activate a release
    app.post('/api/services/:service/releases/:releaseId/activate', requireAuth, async (req, res) => {
        try {
            const id = await serviceManager.activateRelease(req.params.service, req.params.releaseId);
            res.json({ activeReleaseId: id });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // Update ENV config for a service
    app.put('/api/services/:service/env', requireAuth, async (req, res) => {
        try {
            const env = await serviceManager.updateEnv(req.params.service, req.body.env || {});
            res.json({ env });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // Start service
    app.post('/api/services/:service/start', requireAuth, async (req, res) => {
        try {
            const result = await serviceManager.startService(req.params.service);
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // Stop service
    app.post('/api/services/:service/stop', requireAuth, async (req, res) => {
        try {
            const result = await serviceManager.stopService(req.params.service);
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // Restart service
    app.post('/api/services/:service/restart', requireAuth, async (req, res) => {
        try {
            const result = await serviceManager.restartService(req.params.service);
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // Get service status
    app.get('/api/services/:service/status', requireAuth, async (req, res) => {
        try {
            const status = await serviceManager.getServiceStatus(req.params.service);
            res.json(status);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // REST: Get last N log lines for a service
    app.get('/api/services/:service/logs', requireAuth, async (req, res) => {
        try {
            const name = req.params.service;
            const tail = parseInt(req.query.tail, 10) || 100;
            const logPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.pm2', 'logs', `${name}-out.log`);
            const errPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.pm2', 'logs', `${name}-error.log`);
            let lines = [];
            const readLines = (file, tag) => new Promise(resolve => {
                if (!fsSync.existsSync(file)) return resolve([]);
                const rl = readline.createInterface({ input: fsSync.createReadStream(file) });
                const buf = [];
                rl.on('line', line => buf.push(`[${tag}] ${line}`));
                rl.on('close', () => resolve(buf));
            });
            const [outLines, errLines] = await Promise.all([
                readLines(logPath, 'out'),
                readLines(errPath, 'err')
            ]);
            lines = outLines.concat(errLines);
            // Sort by file offset is not possible here, so just take last N after concat
            lines = lines.slice(-tail);
            res.json({ lines });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // WebSocket: Live logs for a service
    const wsLogClients = new Map(); // serviceName -> Set of ws

    function requireAuthWS(req, ws, onSuccess) {
        try {
            const auth = req.headers['sec-websocket-protocol'] || req.headers['authorization'] || '';
            const token = auth.replace('Bearer ', '').trim();
            const { verifyToken } = require('./lib/auth');
            if (!verifyToken(token)) throw new Error('Unauthorized');
            onSuccess();
        } catch {
            ws.close(4001, 'Unauthorized');
        }
    }

    // Clear logs for a service
    app.post('/api/services/:service/clear-logs', requireAuth, async (req, res) => {
        try {
            const name = req.params.service;
            const logPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.pm2', 'logs', `${name}-out.log`);
            const errPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.pm2', 'logs', `${name}-error.log`);
            for (const file of [logPath, errPath]) {
                if (fsSync.existsSync(file)) {
                    fsSync.truncateSync(file, 0);
                } else {
                    fsSync.writeFileSync(file, '');
                }
            }
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // Delete a release
    app.delete('/api/services/:service/releases/:releaseId', requireAuth, async (req, res) => {
        try {
            const name = req.params.service;
            const releaseId = req.params.releaseId;
            const service = serviceManager.services.get(name);
            if (!service) return res.status(404).json({ message: 'Service not found' });
            const releaseIdx = service.releases.findIndex(r => r.id === releaseId);
            if (releaseIdx === -1) return res.status(404).json({ message: 'Release not found' });
            const release = service.releases[releaseIdx];
            // Remove tarball file
            const tarballPath = path.join(serviceManager.dataDir, name, 'releases', release.filename);
            try { await fsSync.promises.unlink(tarballPath); } catch {}
            // Remove from releases array
            service.releases.splice(releaseIdx, 1);
            // If active, set to latest or null
            if (service.activeReleaseId === releaseId) {
                service.activeReleaseId = service.releases.length ? service.releases[service.releases.length - 1].id : null;
            }
            await serviceManager.saveServiceMeta(name);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    // Start server
    const port = process.env.PORT || 3000;
    server.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}

startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
}); 