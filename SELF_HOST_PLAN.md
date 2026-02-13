# TopSeller Studio 自部署方案

## 架构概览

**Coolify 自托管 + Cloudflare R2**

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare CDN + DDoS 防护                │
│                   (cdn.yourdomain.com)                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Coolify Server (主节点)                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   Traefik   │  │  PostgreSQL  │  │  Express + React │   │
│  │  (反向代理)  │  │  (主数据库)   │  │   (应用容器)      │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
│         │                 │                    │             │
│         └─────────────────┴────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
         │                                        │
         ▼                                        ▼
┌──────────────────┐                    ┌─────────────────┐
│  Cloudflare R2   │                    │ Backup Server   │
│  (图片存储)       │                    │ (备份节点)       │
└──────────────────┘                    └─────────────────┘
```

---

## 一、服务器选型和配置

### 主服务器配置（Coolify + App + PostgreSQL）

**推荐配置**：

| 用户规模 | CPU | 内存 | 硬盘 | 带宽 | 月成本 |
|---------|-----|------|------|------|--------|
| 0-50 用户 | 2核 | 4GB | 50GB SSD | 5M | ¥100-150 |
| 50-200 用户 | 4核 | 8GB | 100GB SSD | 10M | ¥200-300 |
| 200-500 用户 | 8核 | 16GB | 200GB SSD | 20M | ¥400-600 |

**服务商推荐**：

1. **阿里云 ECS**（推荐）
   - 华东2（上海）/ 华北2（北京）
   - 按量付费 + 预留实例券
   - 支持快照备份

2. **腾讯云轻量应用服务器**
   - 性价比高（¥112/月 2核4G 6M）
   - 适合中小规模
   - 自带快照功能

3. **Vultr / DigitalOcean**（海外无需备案）
   - 东京/新加坡节点
   - $10-20/月
   - 国内访问延迟 100-200ms

---

## 二、Coolify 部署架构

### 1. Coolify 安装和初始化

```bash
# SSH 登录服务器
ssh root@your-server-ip

# 安装 Coolify（一键脚本）
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# 访问 Coolify Web UI
# http://your-server-ip:8000
# 初始用户名：admin
# 密码：在安装日志中查看

# 建议修改默认端口并启用 HTTPS
# Coolify → Settings → Configuration
# Port: 8443
# Enable HTTPS: Yes
```

**安全加固**：

```bash
# 1. 修改 SSH 端口（避免暴力破解）
vim /etc/ssh/sshd_config
# Port 22 → Port 2222
systemctl restart sshd

# 2. 禁用密码登录，仅允许 SSH Key
# PasswordAuthentication no
# PubkeyAuthentication yes

# 3. 配置防火墙（仅开放必要端口）
ufw enable
ufw allow 2222/tcp   # SSH
ufw allow 80/tcp     # HTTP
ufw allow 443/tcp    # HTTPS
ufw allow 8443/tcp   # Coolify UI
ufw status
```

---

### 2. PostgreSQL 配置（Docker 容器）

**Coolify 部署 PostgreSQL**：

```yaml
# Coolify → New Resource → Database → PostgreSQL

配置项：
  Name: topseller-postgres
  Version: 16-alpine（推荐最新稳定版）
  Port: 5432
  Username: topseller_user
  Password: <strong-password>（至少 16 位）
  Database: topseller_db

资源限制：
  Memory: 2GB（小规模），4GB（中等规模）
  CPU: 1 核

持久化存储：
  Volume: /var/lib/postgresql/data
  Host Path: /data/coolify/postgresql
```

**PostgreSQL 安全配置**：

```bash
# 进入 PostgreSQL 容器
docker exec -it <postgres-container-id> psql -U topseller_user -d topseller_db

-- 创建只读用户（用于备份和监控）
CREATE USER readonly_user WITH PASSWORD 'readonly_password';
GRANT CONNECT ON DATABASE topseller_db TO readonly_user;
GRANT USAGE ON SCHEMA public TO readonly_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_user;

-- 限制最大连接数
ALTER SYSTEM SET max_connections = 200;

-- 启用慢查询日志（调试用）
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- 记录超过 1 秒的查询

-- 重启生效
SELECT pg_reload_conf();
```

**数据库连接池配置**（服务端）：

```javascript
// server/db.mjs
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, {
  max: 20,                    // 最大连接数
  idle_timeout: 60,           // 空闲超时 60 秒
  connect_timeout: 10,        // 连接超时 10 秒
  prepare: false,             // 禁用 prepared statements（避免内存泄漏）
  ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
});

export const db = drizzle(sql);
```

---

### 3. 应用部署（Express + React）

**Coolify 部署配置**：

```yaml
# Coolify → New Resource → Application → Docker Compose

项目配置：
  Name: topseller-studio
  Git Repository: https://github.com/yourname/topseller-studio
  Branch: main
  Build Pack: Dockerfile

Docker Compose 配置（docker-compose.yml）：
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://topseller_user:password@postgres:5432/topseller_db

      # 认证
      AUTH_JWT_SECRET: ${AUTH_JWT_SECRET}
      AUTH_USER: ${AUTH_USER}
      AUTH_PASSWORD: ${AUTH_PASSWORD}

      # 上游 API
      UPSTREAM_API_BASE_URL: ${UPSTREAM_API_BASE_URL}
      UPSTREAM_AUTHORIZATION: ${UPSTREAM_AUTHORIZATION}

      # Cloudflare R2
      R2_ACCOUNT_ID: ${R2_ACCOUNT_ID}
      R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID}
      R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY}
      R2_BUCKET_NAME: ${R2_BUCKET_NAME}
      R2_PUBLIC_URL: ${R2_PUBLIC_URL}

    volumes:
      - /data/coolify/logs:/app/logs

    restart: unless-stopped

    depends_on:
      - postgres

    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

    deploy:
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 512M

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: topseller_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: topseller_db
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U topseller_user"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
    driver: local
```

**Dockerfile**（多阶段构建，优化镜像大小）：

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制源代码
COPY . .

# 构建前端
RUN npm run build

# 生产镜像
FROM node:20-alpine

WORKDIR /app

# 仅复制必要文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY package.json ./

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server/index.mjs"]
```

**健康检查接口**（server/index.mjs）：

```javascript
// server/index.mjs
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 数据库健康检查
app.get('/health/db', async (req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(503).json({ status: 'error', database: 'disconnected', error: error.message });
  }
});
```

---

### 4. Traefik 反向代理配置

Coolify 自带 Traefik，自动配置 HTTPS 和路由。

**自定义 Traefik 配置**（可选）：

```yaml
# /data/coolify/proxy/traefik/traefik.yml

# 启用访问日志
accessLog:
  filePath: "/var/log/traefik/access.log"
  format: json

# 启用 Prometheus 监控
metrics:
  prometheus:
    addEntryPointsLabels: true
    addRoutersLabels: true
    addServicesLabels: true

# 配置 Rate Limiting（防止滥用）
http:
  middlewares:
    rate-limit:
      rateLimit:
        average: 100      # 平均每秒 100 请求
        burst: 200        # 突发最大 200 请求
        period: 1s
```

**应用 Rate Limiting**（Coolify UI）：

```yaml
# Coolify → topseller-studio → Labels

添加 Label：
  traefik.http.routers.topseller.middlewares: rate-limit@file
```

---

## 三、安全防护方案

### 1. 网络安全

#### A. Cloudflare CDN + DDoS 防护

```bash
# 1. 将域名 DNS 托管到 Cloudflare
# https://dash.cloudflare.com → Add a Site

# 2. 修改 NS 记录到 Cloudflare
# 在域名注册商处修改 Name Servers：
#   ns1.cloudflare.com
#   ns2.cloudflare.com

# 3. 添加 DNS 记录
#   Type: A
#   Name: @
#   Value: <your-server-ip>
#   Proxy status: Proxied（橙色云朵）✅

#   Type: CNAME
#   Name: cdn
#   Value: yourdomain.com
#   Proxy status: Proxied ✅

# 4. 启用安全功能
#   - SSL/TLS: Full (strict)
#   - Always Use HTTPS: On
#   - Automatic HTTPS Rewrites: On
#   - DDoS Protection: Automatic（自动开启）
#   - Bot Fight Mode: On（防止爬虫）
#   - Challenge Passage: 30 minutes
```

**Cloudflare 防火墙规则**：

```javascript
// Cloudflare → Security → WAF → Custom Rules

规则 1：阻止高频请求（防止爬虫）
  (http.request.uri.path contains "/api/" and rate() > 100)
  → Action: Block

规则 2：阻止海外注册国家（可选）
  (ip.geoip.country ne "CN" and ip.geoip.country ne "HK")
  → Action: Challenge（人机验证）

规则 3：保护管理接口
  (http.request.uri.path contains "/admin" and ip.src ne <your-office-ip>)
  → Action: Block
```

#### B. 服务器防火墙（UFW）

```bash
# 默认拒绝所有入站，允许所有出站
ufw default deny incoming
ufw default allow outgoing

# 仅开放必要端口
ufw allow 2222/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow from <cloudflare-ip-range> to any port 80 proto tcp comment 'Cloudflare HTTP'
ufw allow from <cloudflare-ip-range> to any port 443 proto tcp comment 'Cloudflare HTTPS'

# Coolify UI 仅允许特定 IP 访问
ufw allow from <your-office-ip> to any port 8443 proto tcp comment 'Coolify Admin'

ufw enable
ufw status numbered
```

**Cloudflare IP 段**（定期更新）：

```bash
# 下载 Cloudflare IP 列表并自动配置防火墙
curl https://www.cloudflare.com/ips-v4 -o /tmp/cloudflare-ips.txt
curl https://www.cloudflare.com/ips-v6 -o /tmp/cloudflare-ips-v6.txt

while read ip; do
  ufw allow from $ip to any port 80 proto tcp
  ufw allow from $ip to any port 443 proto tcp
done < /tmp/cloudflare-ips.txt

# 添加到定时任务
crontab -e
# 每周更新一次
0 3 * * 0 /root/scripts/update-cloudflare-ips.sh
```

#### C. Fail2Ban（防止暴力破解）

```bash
# 安装 Fail2Ban
apt install fail2ban -y

# 配置 SSH 保护
cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = 2222
logpath = /var/log/auth.log

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
logpath = /var/log/traefik/access.log
maxretry = 10
EOF

systemctl restart fail2ban
systemctl enable fail2ban

# 查看封禁列表
fail2ban-client status sshd
```

---

### 2. 应用安全

#### A. 环境变量加密

```bash
# 使用 Coolify 的 Secrets 功能存储敏感信息
# Coolify → topseller-studio → Environment Variables → Add Secret

# 推荐使用强密码生成器
openssl rand -base64 32  # 生成 JWT Secret
openssl rand -hex 16      # 生成其他密钥
```

#### B. JWT 安全配置

```javascript
// server/auth.mjs

// 使用短期 Token + Refresh Token 机制
const accessToken = jwt.sign(
  { userId, teamId, username },
  process.env.AUTH_JWT_SECRET,
  {
    expiresIn: '1h',        // Access Token 1 小时过期
    issuer: 'topseller',
    audience: 'topseller-api'
  }
);

const refreshToken = jwt.sign(
  { userId },
  process.env.REFRESH_TOKEN_SECRET,
  { expiresIn: '30d' }     // Refresh Token 30 天过期
);

// HttpOnly Cookie（防止 XSS）
res.cookie('auth_token', accessToken, {
  httpOnly: true,          // 禁止 JavaScript 访问
  secure: true,            // 仅 HTTPS 传输
  sameSite: 'strict',      // CSRF 防护
  maxAge: 3600000          // 1 小时
});

res.cookie('refresh_token', refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/auth/refresh',   // 仅用于刷新接口
  maxAge: 30 * 24 * 3600000
});
```

#### C. SQL 注入防护

```javascript
// 使用 Drizzle ORM 参数化查询（自动防护）
import { eq } from 'drizzle-orm';

// ✅ 安全：参数化查询
const job = await db.select()
  .from(batchJobs)
  .where(eq(batchJobs.id, jobId))
  .limit(1);

// ❌ 不安全：字符串拼接
const job = await db.execute(
  sql`SELECT * FROM batch_jobs WHERE id = '${jobId}'`  // 易受 SQL 注入
);
```

#### D. XSS 防护

```javascript
// 前端：使用 React 自动转义
// React 默认会转义所有变量，防止 XSS
<div>{userInput}</div>  // 自动转义

// 如果必须渲染 HTML，使用 DOMPurify
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlContent) }} />

// 后端：设置 CSP 头
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline';"
  );
  next();
});
```

#### E. CSRF 防护

```javascript
// 使用 csurf 中间件
import csrf from 'csurf';

const csrfProtection = csrf({ cookie: { httpOnly: true, secure: true } });

app.post('/api/batch-jobs', csrfProtection, requireAuth, async (req, res) => {
  // 自动验证 CSRF Token
  // ...
});

// 前端获取 CSRF Token
app.get('/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});
```

---

### 3. 数据安全

#### A. 敏感数据加密

```javascript
// 存储前加密敏感字段
import crypto from 'crypto';

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // 32 bytes
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  const [ivHex, encrypted] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// 使用示例：加密 API Key
const encryptedApiKey = encrypt(process.env.UPSTREAM_AUTHORIZATION);
await db.insert(teams).values({
  id: teamId,
  apiKey: encryptedApiKey  // 加密后存储
});
```

#### B. 数据脱敏（日志）

```javascript
// 日志中自动脱敏敏感字段
import winston from 'winston';

const maskSensitiveData = winston.format((info) => {
  const sensitive = ['password', 'token', 'authorization', 'apiKey'];

  for (const key of sensitive) {
    if (info[key]) {
      info[key] = '***REDACTED***';
    }
  }

  return info;
});

const logger = winston.createLogger({
  format: winston.format.combine(
    maskSensitiveData(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/app.log' })
  ]
});
```

---

## 四、备份和容灾方案

### 1. 数据库备份策略

#### A. 自动备份脚本（每日全量 + 增量）

```bash
#!/bin/bash
# /root/scripts/backup-postgres.sh

set -e

# 配置
BACKUP_DIR="/data/backups/postgres"
RETENTION_DAYS=7
POSTGRES_CONTAINER="coolify-postgres"
DB_NAME="topseller_db"
DB_USER="topseller_user"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# 创建备份目录
mkdir -p $BACKUP_DIR

# 全量备份
echo "Starting backup at $TIMESTAMP"
docker exec $POSTGRES_CONTAINER pg_dump -U $DB_USER -Fc $DB_NAME > $BACKUP_DIR/backup_$TIMESTAMP.dump

# 压缩备份
gzip $BACKUP_DIR/backup_$TIMESTAMP.dump

# 上传到远程存储（Cloudflare R2）
aws s3 cp $BACKUP_DIR/backup_$TIMESTAMP.dump.gz \
  s3://topseller-backups/postgres/backup_$TIMESTAMP.dump.gz \
  --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com

# 清理本地旧备份
find $BACKUP_DIR -name "backup_*.dump.gz" -mtime +$RETENTION_DAYS -delete

# 验证备份
BACKUP_SIZE=$(stat -f%z "$BACKUP_DIR/backup_$TIMESTAMP.dump.gz" 2>/dev/null || stat -c%s "$BACKUP_DIR/backup_$TIMESTAMP.dump.gz")
if [ $BACKUP_SIZE -lt 1024 ]; then
  echo "ERROR: Backup file is too small ($BACKUP_SIZE bytes)"
  exit 1
fi

echo "Backup completed: backup_$TIMESTAMP.dump.gz ($BACKUP_SIZE bytes)"
```

**配置定时任务**：

```bash
chmod +x /root/scripts/backup-postgres.sh

crontab -e
# 每天凌晨 3 点备份
0 3 * * * /root/scripts/backup-postgres.sh >> /var/log/postgres-backup.log 2>&1

# 每周日凌晨 4 点验证备份（恢复到测试数据库）
0 4 * * 0 /root/scripts/verify-backup.sh >> /var/log/backup-verify.log 2>&1
```

#### B. 备份验证脚本

```bash
#!/bin/bash
# /root/scripts/verify-backup.sh

set -e

BACKUP_DIR="/data/backups/postgres"
LATEST_BACKUP=$(ls -t $BACKUP_DIR/backup_*.dump.gz | head -1)

if [ -z "$LATEST_BACKUP" ]; then
  echo "ERROR: No backup found"
  exit 1
fi

echo "Verifying backup: $LATEST_BACKUP"

# 创建测试数据库
docker exec coolify-postgres psql -U topseller_user -c "DROP DATABASE IF EXISTS test_restore;"
docker exec coolify-postgres psql -U topseller_user -c "CREATE DATABASE test_restore;"

# 恢复到测试数据库
gunzip -c $LATEST_BACKUP | docker exec -i coolify-postgres pg_restore -U topseller_user -d test_restore --no-owner --no-acl

# 验证表是否存在
TABLE_COUNT=$(docker exec coolify-postgres psql -U topseller_user -d test_restore -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")

if [ $TABLE_COUNT -lt 5 ]; then
  echo "ERROR: Backup verification failed (only $TABLE_COUNT tables found)"
  exit 1
fi

echo "✅ Backup verified successfully ($TABLE_COUNT tables)"

# 清理测试数据库
docker exec coolify-postgres psql -U topseller_user -c "DROP DATABASE test_restore;"
```

---

### 2. 应用备份

#### A. Docker 镜像备份

```bash
#!/bin/bash
# /root/scripts/backup-images.sh

# 导出所有应用镜像
docker save topseller-studio:latest | gzip > /data/backups/images/topseller-$(date +%Y%m%d).tar.gz

# 上传到 R2
aws s3 cp /data/backups/images/topseller-$(date +%Y%m%d).tar.gz \
  s3://topseller-backups/images/ \
  --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com

# 清理 30 天前的镜像备份
find /data/backups/images -name "topseller-*.tar.gz" -mtime +30 -delete
```

#### B. 配置文件备份

```bash
#!/bin/bash
# /root/scripts/backup-configs.sh

BACKUP_DIR="/data/backups/configs"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

mkdir -p $BACKUP_DIR

# 备份关键配置
tar -czf $BACKUP_DIR/configs_$TIMESTAMP.tar.gz \
  /data/coolify \
  /root/.env \
  /root/scripts

# 上传到 R2
aws s3 cp $BACKUP_DIR/configs_$TIMESTAMP.tar.gz \
  s3://topseller-backups/configs/ \
  --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
```

---

### 3. 容灾方案

#### A. 主备架构（推荐）

```
┌─────────────────┐         复制         ┌─────────────────┐
│   主服务器       │  ◄───────────────►  │   备份服务器     │
│  (Production)   │    PostgreSQL       │   (Standby)     │
│                 │    Streaming        │                 │
│  - App          │    Replication      │  - PostgreSQL   │
│  - PostgreSQL   │                     │    (只读副本)    │
│  - R2 Images    │                     │                 │
└─────────────────┘                     └─────────────────┘
```

**PostgreSQL 流复制配置**：

```bash
# 主服务器配置
# docker exec -it coolify-postgres bash
# vim /var/lib/postgresql/data/postgresql.conf

wal_level = replica
max_wal_senders = 3
wal_keep_size = 1GB

# pg_hba.conf（允许备份服务器连接）
host replication replica_user <backup-server-ip>/32 md5

# 创建复制用户
psql -U topseller_user
CREATE USER replica_user REPLICATION LOGIN PASSWORD 'replica_password';
```

```bash
# 备份服务器配置（只读副本）
docker run -d \
  --name postgres-replica \
  -e POSTGRES_PASSWORD=replica_password \
  -v /data/postgres-replica:/var/lib/postgresql/data \
  postgres:16-alpine

# 配置 standby.signal
docker exec -it postgres-replica bash
touch /var/lib/postgresql/data/standby.signal

cat > /var/lib/postgresql/data/postgresql.auto.conf <<EOF
primary_conninfo = 'host=<main-server-ip> port=5432 user=replica_user password=replica_password'
restore_command = 'cp /var/lib/postgresql/archive/%f %p'
EOF

# 重启生效
docker restart postgres-replica
```

**健康检查**：

```bash
# 主服务器查看复制状态
psql -U topseller_user -c "SELECT * FROM pg_stat_replication;"

# 备份服务器查看同步状态
psql -U topseller_user -c "SELECT * FROM pg_stat_wal_receiver;"
```

#### B. 故障切换流程

**自动故障转移（使用 Patroni）**：

```yaml
# docker-compose.patroni.yml（高级用户）
version: '3.8'

services:
  etcd:
    image: quay.io/coreos/etcd:v3.5.0
    environment:
      ETCD_LISTEN_CLIENT_URLS: http://0.0.0.0:2379
      ETCD_ADVERTISE_CLIENT_URLS: http://etcd:2379

  patroni-1:
    image: patroni/patroni:3.0.0
    environment:
      PATRONI_NAME: patroni-1
      PATRONI_POSTGRESQL_DATA_DIR: /data/postgres
      PATRONI_ETCD3_HOSTS: etcd:2379
      PATRONI_SCOPE: topseller-cluster
    volumes:
      - postgres1_data:/data/postgres

  patroni-2:
    image: patroni/patroni:3.0.0
    environment:
      PATRONI_NAME: patroni-2
      PATRONI_POSTGRESQL_DATA_DIR: /data/postgres
      PATRONI_ETCD3_HOSTS: etcd:2379
      PATRONI_SCOPE: topseller-cluster
    volumes:
      - postgres2_data:/data/postgres

  haproxy:
    image: haproxy:2.8-alpine
    ports:
      - "5432:5432"
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg

volumes:
  postgres1_data:
  postgres2_data:
```

**手动故障转移**：

```bash
# 1. 检测主服务器是否宕机
ping <main-server-ip>
curl http://<main-server-ip>:3000/health

# 2. 提升备份服务器为主服务器
docker exec -it postgres-replica bash
pg_ctl promote -D /var/lib/postgresql/data

# 3. 修改应用连接到新主服务器
# Coolify → topseller-studio → Environment Variables
# DATABASE_URL=postgresql://...<backup-server-ip>:5432/...

# 4. 重启应用
docker restart topseller-studio

# 5. 通知监控系统
curl -X POST https://your-monitoring-service/alert \
  -d "message=主服务器已切换到备份节点"
```

---

### 4. 灾难恢复演练

**每月执行一次恢复演练**：

```bash
#!/bin/bash
# /root/scripts/disaster-recovery-drill.sh

echo "========== 灾难恢复演练 =========="
echo "开始时间: $(date)"

# 1. 从 R2 下载最新备份
echo "1. 下载备份..."
LATEST_BACKUP=$(aws s3 ls s3://topseller-backups/postgres/ \
  --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com \
  | sort | tail -1 | awk '{print $4}')

aws s3 cp s3://topseller-backups/postgres/$LATEST_BACKUP /tmp/ \
  --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com

# 2. 创建临时测试环境
echo "2. 创建测试环境..."
docker run -d --name test-postgres \
  -e POSTGRES_USER=test_user \
  -e POSTGRES_PASSWORD=test_pass \
  -e POSTGRES_DB=test_db \
  postgres:16-alpine

sleep 10

# 3. 恢复数据
echo "3. 恢复数据库..."
gunzip -c /tmp/$LATEST_BACKUP | docker exec -i test-postgres pg_restore \
  -U test_user -d test_db --no-owner --no-acl

# 4. 验证数据完整性
echo "4. 验证数据..."
BATCH_JOB_COUNT=$(docker exec test-postgres psql -U test_user -d test_db -t -c "SELECT COUNT(*) FROM batch_jobs;")
SESSION_COUNT=$(docker exec test-postgres psql -U test_user -d test_db -t -c "SELECT COUNT(*) FROM sessions;")

echo "   - Batch Jobs: $BATCH_JOB_COUNT"
echo "   - Sessions: $SESSION_COUNT"

# 5. 清理
echo "5. 清理测试环境..."
docker stop test-postgres
docker rm test-postgres
rm /tmp/$LATEST_BACKUP

echo "========== 演练完成 =========="
echo "结束时间: $(date)"
```

---

## 五、监控和告警

### 1. 系统监控（Prometheus + Grafana）

**Prometheus 配置**：

```yaml
# docker-compose.monitoring.yml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'

  grafana:
    image: grafana/grafana:latest
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana-dashboards:/etc/grafana/provisioning/dashboards
    ports:
      - "3001:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin123
      GF_INSTALL_PLUGINS: grafana-clock-panel

  node-exporter:
    image: prom/node-exporter:latest
    ports:
      - "9100:9100"

  postgres-exporter:
    image: prometheuscommunity/postgres-exporter:latest
    environment:
      DATA_SOURCE_NAME: postgresql://topseller_user:password@postgres:5432/topseller_db?sslmode=disable
    ports:
      - "9187:9187"

volumes:
  prometheus_data:
  grafana_data:
```

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']

  - job_name: 'app'
    static_configs:
      - targets: ['app:3000']  # 需要应用暴露 /metrics 接口
```

**应用暴露 Metrics**：

```javascript
// server/index.mjs
import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

// 自定义指标
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration.labels(req.method, req.route?.path || req.path, res.statusCode).observe(duration);
  });
  next();
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

---

### 2. 日志聚合（Loki + Promtail）

```yaml
# docker-compose.logging.yml
version: '3.8'

services:
  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"
    volumes:
      - ./loki-config.yml:/etc/loki/local-config.yaml
      - loki_data:/loki

  promtail:
    image: grafana/promtail:latest
    volumes:
      - ./promtail-config.yml:/etc/promtail/config.yml
      - /var/log:/var/log:ro
      - /data/coolify/logs:/app/logs:ro
    command: -config.file=/etc/promtail/config.yml

volumes:
  loki_data:
```

---

### 3. 告警配置（Alertmanager）

```yaml
# alertmanager.yml
route:
  receiver: 'default'
  group_by: ['alertname', 'severity']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h

receivers:
  - name: 'default'
    webhook_configs:
      - url: 'https://your-webhook-url'  # 企业微信/钉钉/Slack

  - name: 'email'
    email_configs:
      - to: 'admin@yourdomain.com'
        from: 'alert@yourdomain.com'
        smarthost: 'smtp.gmail.com:587'
        auth_username: 'your-email@gmail.com'
        auth_password: 'your-app-password'
```

**告警规则**：

```yaml
# prometheus-rules.yml
groups:
  - name: system
    interval: 30s
    rules:
      - alert: HighCPU
        expr: 100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "CPU 使用率过高 (instance {{ $labels.instance }})"

      - alert: LowDisk
        expr: (node_filesystem_avail_bytes / node_filesystem_size_bytes) * 100 < 20
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "磁盘空间不足 (instance {{ $labels.instance }})"

      - alert: DatabaseDown
        expr: up{job="postgres"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "数据库不可用"

      - alert: HighRequestLatency
        expr: histogram_quantile(0.95, http_request_duration_seconds_bucket) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "API 响应时间过长 (P95 > 2s)"
```

---

## 六、性能优化

### 1. PostgreSQL 性能调优

```sql
-- 优化配置（根据服务器规格调整）
ALTER SYSTEM SET shared_buffers = '1GB';              -- 25% 内存
ALTER SYSTEM SET effective_cache_size = '3GB';        -- 75% 内存
ALTER SYSTEM SET work_mem = '16MB';                   -- 每个查询的工作内存
ALTER SYSTEM SET maintenance_work_mem = '256MB';      -- 维护操作内存
ALTER SYSTEM SET max_connections = 200;

-- 启用查询计划缓存
ALTER SYSTEM SET plan_cache_mode = 'auto';

-- 重启生效
SELECT pg_reload_conf();
```

**索引优化**：

```sql
-- 批量任务表索引
CREATE INDEX idx_batch_jobs_team_status ON batch_jobs(team_id, status);
CREATE INDEX idx_batch_jobs_updated ON batch_jobs(team_id, updated_at DESC);

-- 会话表索引
CREATE INDEX idx_sessions_team_created ON sessions(team_id, created_at DESC);

-- 分析表统计信息
ANALYZE batch_jobs;
ANALYZE sessions;

-- 查看慢查询
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

---

### 2. 应用性能优化

#### A. 连接池配置

```javascript
// server/db.mjs
const sql = postgres(process.env.DATABASE_URL, {
  max: 20,                    // 最大连接数（根据 max_connections 调整）
  idle_timeout: 60,
  connect_timeout: 10,
  prepare: false,
  onnotice: () => {},         // 禁用 NOTICE 日志
});
```

#### B. 缓存策略

```javascript
// 内存缓存（node-cache）
import NodeCache from 'node-cache';
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

app.get('/api/models', requireAuth, async (req, res) => {
  const cacheKey = `models:${req.teamId}`;

  // 尝试从缓存读取
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  // 从数据库查询
  const models = await db.select().from(modelsTable).where(eq(modelsTable.teamId, req.teamId));

  // 写入缓存
  cache.set(cacheKey, models);

  res.json(models);
});

// 更新时清除缓存
app.post('/api/models', requireAuth, async (req, res) => {
  // ... 创建模型 ...
  cache.del(`models:${req.teamId}`);
  res.json(newModel);
});
```

#### C. 图片 CDN 优化

```javascript
// Cloudflare R2 自动图片处理
function getOptimizedImageUrl(key, options = {}) {
  const { width, quality = 80, format = 'auto' } = options;

  // Cloudflare 图片处理（需要开通 Cloudflare Images）
  // 或使用 R2 + Workers 自定义处理

  let url = `${process.env.R2_PUBLIC_URL}/${key}`;

  const params = new URLSearchParams();
  if (width) params.append('width', width);
  if (quality) params.append('quality', quality);
  if (format) params.append('format', format);

  if (params.toString()) {
    url += `?${params.toString()}`;
  }

  return url;
}
```

---

## 七、运维清单

### 日常运维（每日）

- [ ] 检查 Grafana 监控面板（CPU、内存、磁盘）
- [ ] 查看应用日志是否有 ERROR
- [ ] 验证备份是否成功执行
- [ ] 检查 Cloudflare Analytics（流量、攻击）

### 每周运维

- [ ] 查看慢查询日志并优化
- [ ] 清理 Docker 未使用镜像/容器
- [ ] 检查磁盘空间，清理旧日志
- [ ] 更新系统安全补丁

### 每月运维

- [ ] 执行灾难恢复演练
- [ ] 更新 Docker 镜像到最新版本
- [ ] 审查告警规则是否需要调整
- [ ] 检查 SSL 证书有效期（Cloudflare 自动续期，但需确认）

### 每季度运维

- [ ] 数据库 VACUUM FULL（回收空间）
- [ ] 审查安全日志（登录失败、异常访问）
- [ ] 性能压测并优化瓶颈
- [ ] 更新 Coolify 到最新版本

---

## 八、成本总结

### 最小可用配置（50 用户以内）

| 服务 | 配置 | 月成本 |
|------|------|--------|
| 服务器 | 腾讯云轻量 2核4G | ¥112 |
| 数据库 | 同服务器 Docker | ¥0 |
| 图片存储 | Cloudflare R2 (50GB) | ¥0.8 ($0.75) |
| 备份存储 | R2 (10GB) | ¥0.2 |
| Cloudflare CDN | 免费套餐 | ¥0 |
| **总计** | | **¥113/月 ($16)** |

### 生产级配置（200 用户）

| 服务 | 配置 | 月成本 |
|------|------|--------|
| 主服务器 | 阿里云 ECS 4核8G | ¥200 |
| 备份服务器 | 阿里云 ECS 2核4G | ¥100 |
| 图片存储 | Cloudflare R2 (200GB) | ¥3 |
| 备份存储 | R2 (50GB) | ¥0.8 |
| 监控 | Grafana Cloud Free | ¥0 |
| **总计** | | **¥304/月 ($42)** |

---

## 九、快速部署命令汇总

```bash
# 1. 安装 Coolify
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# 2. 安装 AWS CLI（用于 R2）
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# 3. 配置 AWS CLI
aws configure
# 输入 R2 的 Access Key + Secret Key
# Region: auto
# Output format: json

# 4. 部署应用
git clone https://github.com/yourname/topseller-studio
cd topseller-studio

# 在 Coolify UI 中：
# - 新建项目
# - 导入 docker-compose.yml
# - 设置环境变量
# - 部署

# 5. 配置备份
crontab -e
0 3 * * * /root/scripts/backup-postgres.sh
0 4 * * 0 /root/scripts/verify-backup.sh

# 6. 配置防火墙
ufw enable
ufw allow 2222/tcp
ufw allow 80/tcp
ufw allow 443/tcp

# 7. 安装监控
docker-compose -f docker-compose.monitoring.yml up -d

echo "✅ 部署完成！访问 https://yourdomain.com"
```

---

需要我帮你编写具体的脚本或配置文件吗？