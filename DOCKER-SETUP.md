# Docker Setup Guide - Eco-Link-Lite

## 🎯 What's Changed

I've simplified the Docker setup to only run **essential services** by default.

---

## 📦 Service Overview

### **ESSENTIAL (Always Running)**
| Service | Port | Purpose | Status |
|---------|------|---------|--------|
| **neo4j** | 7474, 7687 | Graph database | ✅ Active |
| **backend** | 4000 | GraphQL API | ✅ Active |
| **webapp** | 3000 | Frontend UI | ✅ Active |

### **OPTIONAL (Commented Out)**
| Service | Port | Purpose | When to Enable |
|---------|------|---------|----------------|
| mailserver | 1080, 1025 | Email testing | Testing password reset, notifications |
| minio | 9001 | File storage | Uploading images/files |
| minio-mc | - | MinIO setup | Goes with minio |
| imagor | 8000 | Image processing | Resizing/processing images |
| maintenance | 3001 | Maintenance page | Production deployments |

---

## 🚀 Usage Options

### **Option 1: Minimal Setup (Default)**
Only starts the 3 core services (neo4j, backend, webapp):

```powershell
docker compose up -d
```

**What runs:**
- ✅ Database (Neo4j)
- ✅ Backend API
- ✅ Frontend webapp

**What's missing:**
- ❌ File uploads won't work
- ❌ Email testing won't work
- ❌ Image processing won't work

---

### **Option 2: Even More Minimal**
Use the dedicated minimal config:

```powershell
docker compose -f docker-compose.minimal.yml up -d
```

This is explicitly minimal with clean config.

---

### **Option 3: Full Setup (All Features)**
Uncomment the optional services in `docker-compose.override.yml` and run:

1. **Uncomment these sections** in `docker-compose.override.yml`:
   - `mailserver:`
   - `minio:`
   - `minio-mc:`
   - `imagor:`
   - `volumes: minio_data:`

2. **Uncomment backend dependencies** in the `backend:` section:
   ```yaml
   depends_on:
     - minio
     - minio-mc
     - imagor
     - mailserver
   ```

3. **Uncomment environment variables** for file storage and email

4. **Start everything:**
   ```powershell
   docker compose up -d
   ```

---

## 🔧 After Starting Services

### 1. Wait for services to be ready
```powershell
docker compose ps
```

### 2. Initialize database
```powershell
docker compose exec backend yarn run db:migrate init
docker compose exec backend yarn run db:migrate up
```

### 3. Seed test data
```powershell
docker compose exec backend yarn run db:reset
docker compose exec backend yarn run db:seed
```

### 4. Access the application
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:4000
- **Neo4j Browser:** http://localhost:7474

### 5. Test login
- **Email:** admin@example.org
- **Password:** 1234

---

## 💾 What's Stored

### Database
Data persists in Docker volume: `neo4j_data`

To delete all data:
```powershell
docker compose down -v
```

---

## 🎨 File Structure

```
Eco-Link-Lite/
├── docker-compose.yml              # Base production config
├── docker-compose.override.yml     # Development overrides (minimal)
├── docker-compose.minimal.yml      # Explicit minimal setup
└── DOCKER-SETUP.md                 # This file
```

---

## ⚡ Quick Commands

```powershell
# Start minimal setup
docker compose up -d

# Stop all services
docker compose down

# View logs
docker compose logs -f backend

# Check status
docker compose ps

# Restart a service
docker compose restart backend

# Rebuild from scratch
docker compose down -v
docker compose up -d --build
```

---

## 🐛 Troubleshooting

### Backend won't start
```powershell
docker compose logs backend
docker compose restart backend
```

### Database issues
```powershell
docker compose down -v  # Delete all data
docker compose up -d
# Then reinitialize database
```

### Port conflicts
Check if ports 3000, 4000, 7474, or 7687 are already in use.

---

## 📝 Notes

- **Development mode** uses code hot-reloading (volumes mounted)
- **Production mode** builds optimized containers
- Optional services can be enabled anytime by uncommenting them

