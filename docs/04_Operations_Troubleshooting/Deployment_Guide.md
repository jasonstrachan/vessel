# Deployment Guide

## Prerequisites

### System Requirements
- **Node.js**: Version 18.0 or higher
- **npm**: Version 8.0 or higher (included with Node.js)
- **Memory**: Minimum 4GB RAM for build process
- **Storage**: 1GB free space for dependencies and build files

### Environment Setup
```bash
# Verify Node.js version
node --version  # Should be 18.0+

# Verify npm version  
npm --version   # Should be 8.0+

# Check available memory
free -h         # Linux/WSL
```

## Development Deployment

### Local Development Server

#### Standard Setup
```bash
# 1. Clone the repository
git clone <repository-url>
cd tinybrush

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# 4. Open browser
# Navigate to http://localhost:3000
```

#### WSL2 Setup (Windows Subsystem for Linux)
```bash
# 1. Clone and install (same as above)
git clone <repository-url>
cd tinybrush
npm install

# 2. Start server with explicit hostname binding
npx next dev --hostname 0.0.0.0 --port 3000

# 3. Test connectivity
curl -I http://127.0.0.1:3000

# 4. Run in background (optional)
nohup npx next dev --hostname 0.0.0.0 --port 3000 > server.log 2>&1 &
```

#### Development Environment Variables
Create `.env.local` file in project root:
```bash
# Development environment
NODE_ENV=development

# Optional: Custom port
PORT=3000

# Optional: Debug settings
DEBUG=tinybrush:*
```

### Development Server Commands
```bash
# Start development server
npm run dev

# Start with custom port
npm run dev -- --port 3001

# Start with hostname binding (WSL2)
npm run dev -- --hostname 0.0.0.0

# Build for development testing
npm run build
npm start
```

## Production Deployment

### Build Process

#### Standard Production Build
```bash
# 1. Install production dependencies
npm ci --production=false

# 2. Run production build
npm run build

# 3. Test production build locally
npm start

# 4. Verify build output
ls -la .next/
```

#### Build Optimization
```bash
# Clean build (if needed)
rm -rf .next
npm run build

# Analyze bundle size
npm run build -- --analyze

# Check build output
npm run build 2>&1 | tee build.log
```

### Static Export (Recommended)

#### Generate Static Files
```bash
# 1. Configure next.config.js for static export
# Add: output: 'export'

# 2. Build and export
npm run build

# 3. Static files available in 'out' directory
ls -la out/

# 4. Test static build
cd out && python -m http.server 8000
```

#### Static Export Configuration
Update `next.config.js`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true
  }
}

module.exports = nextConfig
```

### Server Deployment

#### Node.js Server Deployment
```bash
# 1. Transfer built files to server
scp -r .next package.json package-lock.json user@server:/path/to/app/

# 2. Install production dependencies on server
cd /path/to/app
npm ci --production

# 3. Start production server
npm start

# 4. Use process manager (PM2 recommended)
npm install -g pm2
pm2 start npm --name "tinybrush" -- start
pm2 save
```

#### Docker Deployment
Create `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production=false

# Copy source code
COPY . .

# Build application
RUN npm run build

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
```

Build and run Docker container:
```bash
# Build image
docker build -t tinybrush .

# Run container
docker run -p 3000:3000 tinybrush

# Run with environment variables
docker run -p 3000:3000 -e NODE_ENV=production tinybrush
```

## Cloud Platform Deployment

### Vercel Deployment (Recommended)

#### Automatic Deployment
```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Login to Vercel
vercel login

# 3. Deploy project
vercel

# 4. Configure custom domain (optional)
vercel --prod
```

#### Manual Deployment
1. Connect GitHub repository to Vercel
2. Configure build settings:
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`
   - **Install Command**: `npm install`
3. Deploy automatically on git push

### Netlify Deployment

#### Build Configuration
Create `netlify.toml`:
```toml
[build]
  command = "npm run build && npm run export"
  publish = "out"

[build.environment]
  NODE_VERSION = "18"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

#### Manual Deployment Steps
```bash
# 1. Build static export
npm run build

# 2. Deploy to Netlify
npx netlify-cli deploy --prod --dir=out
```

### GitHub Pages Deployment

#### GitHub Actions Workflow
Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to GitHub Pages

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
      
    - name: Deploy to GitHub Pages
      uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: ./out
```

## Environment Configuration

### Production Environment Variables
```bash
# Production environment
NODE_ENV=production

# Security
NEXTAUTH_SECRET=your-secret-key-here

# Optional: Analytics
GOOGLE_ANALYTICS_ID=GA-XXXXXXXXX

# Optional: Error reporting
SENTRY_DSN=your-sentry-dsn-here
```

### Next.js Configuration
Update `next.config.js` for production:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production optimizations
  compress: true,
  poweredByHeader: false,
  
  // Image optimization
  images: {
    domains: ['example.com'],
    formats: ['image/webp', 'image/avif'],
  },
  
  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
```

## Performance Optimization

### Build Optimization
```bash
# Analyze bundle size
npm run build -- --analyze

# Enable experimental features (next.config.js)
experimental: {
  optimizeCss: true,
  optimizeImages: true,
}
```

### CDN Configuration
Configure CDN for static assets:
```javascript
// next.config.js
const nextConfig = {
  assetPrefix: process.env.NODE_ENV === 'production' 
    ? 'https://cdn.example.com' 
    : '',
}
```

### Caching Strategy
```bash
# Set cache headers for static assets
# In .htaccess (Apache) or nginx.conf
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType image/png "access plus 1 year"
</IfModule>
```

## Monitoring and Maintenance

### Health Checks
```bash
# Server health check endpoint
curl -f http://localhost:3000/api/health || exit 1

# Performance monitoring
curl -w "%{time_total}" -s -o /dev/null http://localhost:3000
```

### Log Management
```bash
# Application logs
tail -f /var/log/tinybrush/app.log

# Error logs
tail -f /var/log/tinybrush/error.log

# Access logs
tail -f /var/log/nginx/tinybrush-access.log
```

### Backup Strategy
```bash
# Backup user data (if applicable)
tar -czf backup-$(date +%Y%m%d).tar.gz ./data

# Database backup (if using database)
pg_dump tinybrush > backup-$(date +%Y%m%d).sql
```

## Security Considerations

### SSL/TLS Configuration
```bash
# Generate SSL certificate (Let's Encrypt)
certbot --nginx -d yourdomain.com

# Configure HTTPS redirect
# In nginx.conf or .htaccess
```

### Security Headers
```javascript
// next.config.js security headers
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload'
  },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-eval'"
  }
]
```

### Access Control
```bash
# Firewall configuration
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw enable

# Rate limiting (nginx)
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
```

---

*This deployment guide provides comprehensive instructions for deploying TinyBrush in various environments with proper optimization and security considerations.*