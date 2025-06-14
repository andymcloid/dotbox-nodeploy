# Nodeploy Integration Guide

This guide explains how to integrate your Node.js projects with Nodeploy for automated deployment.

## API Endpoints

### Authentication
- `POST /api/auth/token` - Get JWT token for API access
  ```json
  {
    "password": "your_admin_password"
  }
  ```

### Service Management
- `GET /api/services` - List all services
- `POST /api/services/:service/start` - Start a service
- `POST /api/services/:service/stop` - Stop a service
- `POST /api/services/:service/restart` - Restart a service
- `POST /api/services/:service/update` - Update a service with a new package

## Deployment Methods

### GitHub Actions Integration

Add this workflow to `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Nodeploy

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Build
        run: npm run build
        
      - name: Create package
        run: |
          # Create a tarball of the build output
          tar -czf deploy.tgz \
            package.json \
            dist/ \
            # Add other files/directories as needed
            
      - name: Deploy to Nodeploy
        run: |
          curl -X POST ${{ secrets.NODEPLOY_URL }}/api/services/${{ secrets.SERVICE_NAME }}/update \
            -H "Authorization: Bearer ${{ secrets.NODEPLOY_TOKEN }}" \
            -F "package=@deploy.tgz"
```

### Manual Deployment Script

Create a `deploy.js` script:

```javascript
const fs = require('fs');
const { exec } = require('child_process');
const FormData = require('form-data');
const fetch = require('node-fetch');

async function deploy() {
    // Create tarball
    await new Promise((resolve, reject) => {
        exec('tar -czf deploy.tgz package.json dist/', (error) => {
            if (error) reject(error);
            else resolve();
        });
    });

    // Create form data
    const form = new FormData();
    form.append('package', fs.createReadStream('deploy.tgz'));

    // Deploy
    const response = await fetch(
        `${process.env.NODEPLOY_URL}/api/services/${process.env.SERVICE_NAME}/update`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.NODEPLOY_TOKEN}`
            },
            body: form
        }
    );

    if (!response.ok) {
        throw new Error(`Deployment failed: ${response.statusText}`);
    }

    console.log('Deployment successful');
}

deploy().catch(console.error);
```

### Using cURL

Quick manual deployment:

```bash
# Create tarball
tar -czf deploy.tgz package.json dist/

# Deploy
curl -X POST $NODEPLOY_URL/api/services/$SERVICE_NAME/update \
  -H "Authorization: Bearer $NODEPLOY_TOKEN" \
  -F "package=@deploy.tgz"
```

## Required Files

Your project must include:

1. `package.json` with:
   - `name` - Service name
   - `version` - Service version
   - `main` - Entry point file
   - `scripts.start` - Start command

2. Main application file (specified in `package.json.main`)

## Environment Variables

Set these in your CI/CD environment:

- `NODEPLOY_URL` - Nodeploy server URL
- `NODEPLOY_TOKEN` - JWT token from `/api/auth/token`
- `SERVICE_NAME` - Your service name

## Best Practices

1. **Version Control**
   - Use semantic versioning
   - Tag releases
   - Keep build artifacts out of git

2. **Build Process**
   - Run tests before deployment
   - Build in CI/CD environment
   - Create tarball with only necessary files

3. **Error Handling**
   - Check deployment response
   - Log deployment status
   - Set up notifications

4. **Security**
   - Use environment variables for secrets
   - Rotate tokens regularly
   - Validate package contents

## Example Project Structure

```
my-service/
├── src/
│   └── index.js
├── package.json
├── .github/
│   └── workflows/
│       └── deploy.yml
└── deploy.js
```

## Troubleshooting

1. **Deployment Fails**
   - Check token validity
   - Verify service exists
   - Check file permissions
   - Validate package.json

2. **Service Won't Start**
   - Check main file path
   - Verify dependencies
   - Check logs in Nodeploy UI

3. **Authentication Errors**
   - Verify token
   - Check token expiration
   - Ensure correct password

## Support

For issues or questions:
1. Check the logs in Nodeploy UI
2. Review deployment response
3. Contact support with error details 