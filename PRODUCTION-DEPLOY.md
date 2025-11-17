# Production Deployment Guide for AWS Lightsail

## Quick Start

```bash
# Start all services
docker compose -f docker-compose.prod.yml up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Stop all services
docker compose -f docker-compose.prod.yml down

# Stop and remove volumes (⚠️ WARNING: This deletes data)
docker compose -f docker-compose.prod.yml down -v
```

## Pre-Deployment Checklist

### 1. **Update Secrets & Credentials**

Before deploying, update these in `docker-compose.prod.yml`:

- **Neo4j Authentication**: Change `NEO4J_AUTH=none` to `NEO4J_AUTH=neo4j/your-strong-password`
- **MinIO Credentials**: Update `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`
- **Imagor Secret**: Update `IMAGOR_SECRET` to a strong random string
- **JWT Secret**: Add `JWT_SECRET` environment variable to backend service
- **Database Passwords**: Use strong, unique passwords

### 2. **Environment Variables**

Create a `.env` file or use AWS Lightsail environment variables:

```bash
# Example .env file (DO NOT commit this to git)
JWT_SECRET=your-super-secret-jwt-key-here
NEO4J_AUTH=neo4j/your-strong-password
MINIO_ROOT_USER=your-minio-user
MINIO_ROOT_PASSWORD=your-minio-password
IMAGOR_SECRET=your-imagor-secret
```

### 3. **Network Security (AWS Lightsail)**

Configure firewall rules in AWS Lightsail:

**Required Ports:**
- `3000` - Webapp (HTTP/HTTPS)
- `4000` - Backend API (consider using reverse proxy)
- `7474` - Neo4j Browser (optional, secure with firewall)
- `7687` - Neo4j Bolt (internal only, don't expose publicly)
- `9000` - MinIO API (internal only)
- `9001` - MinIO Console (internal only, or remove)
- `8000` - Imagor (internal only)
- `1025` - SMTP (internal only)
- `1080` - Maildev UI (remove in production)

**Recommended:**
- Only expose ports 3000 (and 443 for HTTPS) publicly
- Use AWS Lightsail Load Balancer with SSL/TLS
- Set up a reverse proxy (nginx/traefik) for better security

### 4. **Production Considerations**

#### Replace Maildev with Real SMTP
Maildev is for development only. For production, use:
- AWS SES (Simple Email Service)
- SendGrid
- Mailgun
- Or another production SMTP service

Update backend environment:
```yaml
- SMTP_HOST=smtp.your-provider.com
- SMTP_PORT=587
- SMTP_USER=your-email@domain.com
- SMTP_PASS=your-password
```

#### Consider Using AWS S3 Instead of MinIO
For production, consider using AWS S3 instead of MinIO:
- More reliable
- Better scalability
- Built-in redundancy
- Pay-as-you-go pricing

If using S3, update backend environment:
```yaml
- AWS_ENDPOINT=https://s3.amazonaws.com
- AWS_REGION=us-east-1
- AWS_BUCKET=your-bucket-name
- Remove PROXY_S3
```

#### Neo4j Production Settings
Update Neo4j memory settings based on your Lightsail instance:
```yaml
- NEO4J_dbms_memory_heap_max__size=2G  # Adjust based on available RAM
- NEO4J_dbms_memory_pagecache_size=1G   # Adjust based on available RAM
```

### 5. **SSL/TLS Setup**

Set up HTTPS using AWS Lightsail Load Balancer or nginx reverse proxy:

```nginx
# Example nginx config
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://webapp:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /graphql {
        proxy_pass http://backend:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 6. **Backup Strategy**

Set up regular backups for:
- **Neo4j Database**: Use `neo4j-admin dump` or automated backups
- **MinIO/S3 Data**: Enable versioning and lifecycle policies
- **Configuration Files**: Store in version control

### 7. **Monitoring & Logging**

Consider adding:
- **Health Checks**: Add health check endpoints
- **Log Aggregation**: Use AWS CloudWatch or similar
- **Monitoring**: Set up alerts for disk space, memory, CPU
- **Metrics**: The `/metrics` endpoint is available for Prometheus

## Deployment Steps

1. **SSH into your AWS Lightsail instance**
   ```bash
   ssh your-user@your-instance-ip
   ```

2. **Install Docker & Docker Compose**
   ```bash
   # Ubuntu/Debian
   sudo apt-get update
   sudo apt-get install docker.io docker-compose-plugin
   sudo systemctl start docker
   sudo systemctl enable docker
   ```

3. **Clone your repository**
   ```bash
   git clone your-repo-url
   cd your-repo-directory
   ```

4. **Update configuration**
   - Edit `docker-compose.prod.yml` with production values
   - Create `.env` file with secrets (don't commit!)

5. **Start services**
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

6. **Verify services are running**
   ```bash
   docker compose -f docker-compose.prod.yml ps
   docker compose -f docker-compose.prod.yml logs
   ```

7. **Set up reverse proxy** (recommended)
   - Install nginx or traefik
   - Configure SSL certificates
   - Point to your services

## Troubleshooting

### Check service logs
```bash
docker compose -f docker-compose.prod.yml logs backend
docker compose -f docker-compose.prod.yml logs webapp
docker compose -f docker-compose.prod.yml logs neo4j
```

### Restart a specific service
```bash
docker compose -f docker-compose.prod.yml restart backend
```

### Check resource usage
```bash
docker stats
```

### Access Neo4j Browser
- URL: `http://your-instance-ip:7474`
- Username: `neo4j`
- Password: (set in NEO4J_AUTH)

### Access MinIO Console
- URL: `http://your-instance-ip:9001`
- Username: (set in MINIO_ROOT_USER)
- Password: (set in MINIO_ROOT_PASSWORD)

## Security Recommendations

1. ✅ Change all default passwords
2. ✅ Use strong, unique passwords
3. ✅ Enable Neo4j authentication
4. ✅ Don't expose internal ports publicly
5. ✅ Use SSL/TLS for all external connections
6. ✅ Set up firewall rules
7. ✅ Regular security updates
8. ✅ Monitor logs for suspicious activity
9. ✅ Use secrets management (AWS Secrets Manager, etc.)
10. ✅ Regular backups

## Cost Optimization

- Use appropriate Lightsail instance size
- Consider using AWS S3 instead of MinIO for storage
- Set up auto-scaling if needed
- Monitor resource usage and adjust instance size
- Use AWS RDS for Neo4j if needed (managed service)

## Support

For issues, check:
- Service logs: `docker compose -f docker-compose.prod.yml logs`
- Docker status: `docker ps`
- System resources: `docker stats`
- Network connectivity: `docker network ls`

