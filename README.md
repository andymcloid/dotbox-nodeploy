# DotBox Nodeploy

A Node.js service orchestrator and runner that manages multiple Node.js services in a single container.

## Features

- 🚀 Automatic service discovery and management
- 🔄 Real-time service status updates via WebSocket
- 📊 Service monitoring and control
- 🔒 Secure API endpoints
- 🐳 Docker-ready
- 🔄 Automatic service restart on container reboot
- 📤 GitHub Actions integration ready

## Quick Start

1. Clone the repository
2. Copy `.env.example` to `.env` and configure your settings
3. Create a `data` directory for your services
4. Run with Docker:

```bash
docker build -t dotbox-nodeploy .
docker run -p 3000:3000 -v $(pwd)/data:/app/data dotbox-nodeploy
```

## Service Structure

Place your Node.js services in the `data` directory. Each service should be in its own subdirectory with a `package.json` file:

```
data/
├── service1/
│   ├── package.json
│   └── index.js
└── service2/
    ├── package.json
    └── index.js
```

## API Endpoints

### Services

- `GET /api/services` - List all services
- `POST /api/services/:service/start` - Start a service
- `POST /api/services/:service/stop` - Stop a service
- `POST /api/services/:service/restart` - Restart a service
- `POST /api/services/:service/update` - Update service files

### WebSocket Events

- `services-update` - Real-time service status updates

## GitHub Actions Integration

Example workflow for deploying a service:

```yaml
name: Deploy Service

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Build service
        run: npm run build
        
      - name: Deploy to Nodeploy
        run: |
          curl -X POST http://your-nodeploy-server:3000/api/services/your-service/update \
            -F "files=@dist/index.js" \
            -F "files=@package.json"
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `SESSION_SECRET` - Session secret
- `ADMIN_PASSWORD` - Admin password
- `SERVICES_DIR` - Services directory path
- `LOG_LEVEL` - Logging level

## License

MIT 