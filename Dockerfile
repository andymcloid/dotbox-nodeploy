FROM node:18-alpine

WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Create data directory for services
RUN mkdir -p data

# Use non-root user
USER node

EXPOSE 3000

# Start with PM2
CMD ["pm2-runtime", "start", "server.js", "--name", "nodeploy"] 