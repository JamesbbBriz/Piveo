# TopSeller Studio 自部署完整操作手册

**目标**：从零到上线，一步步完成 Coolify + PostgreSQL + Cloudflare R2 的生产级部署

**预计时间**：2-3 小时（首次部署）

---

## 📋 前置准备清单

### 需要准备的资源

- [ ] 一台云服务器（2核4G 起，推荐 4核8G）
- [ ] 一个域名（可选，用于 HTTPS 和 Cloudflare CDN）
- [ ] Cloudflare 账号（用于 R2 存储和 CDN）
- [ ] 本地电脑（Mac/Linux/Windows）

### 服务器推荐

| 服务商 | 配置 | 地域 | 月成本 | 备注 |
|--------|------|------|--------|------|
| 腾讯云轻量 | 2核4G 6M | 上海 | ¥112 | 性价比高 |
| 阿里云 ECS | 4核8G 5M | 上海 | ¥200 | 生产推荐 |
| Vultr | 2核4G | 东京 | $12 | 海外无需备案 |

---

## 第一阶段：服务器初始化和安全加固（30分钟）

### 1.1 首次登录服务器

**在本地电脑执行**：

```bash
# 使用服务商提供的 root 密码登录
ssh root@你的服务器IP

# 例如：
ssh root@123.45.67.89
```

首次登录会提示是否信任服务器，输入 `yes` 并回车。

---

### 1.2 更新系统（必须执行）

**在服务器上执行**：

```bash
# Ubuntu/Debian 系统
apt update && apt upgrade -y

# CentOS/RHEL 系统（如果你用的是）
# yum update -y

# 安装必要工具
apt install -y curl wget git vim ufw net-tools
```

等待更新完成（约 5-10 分钟）。

---

### 1.3 生成 SSH 密钥对（本地电脑）

**在本地电脑执行**（不是服务器！）：

```bash
# 生成新的 SSH 密钥对（如果已有可跳过）
ssh-keygen -t ed25519 -C "你的邮箱@example.com"

# 提示输入保存路径时，直接回车使用默认路径：
# ~/.ssh/id_ed25519

# 提示输入密码时，可以留空（直接回车）或设置密码

# 查看生成的公钥
cat ~/.ssh/id_ed25519.pub
```

**复制公钥内容**（整行，以 `ssh-ed25519` 开头的那一长串）。

---

### 1.4 上传公钥到服务器

**在服务器上执行**：

```bash
# 创建 .ssh 目录（如果不存在）
mkdir -p ~/.ssh

# 设置正确权限
chmod 700 ~/.ssh

# 编辑授权文件
vim ~/.ssh/authorized_keys
```

**在 vim 中**：
1. 按 `i` 进入插入模式
2. 粘贴刚才复制的公钥（整行）
3. 按 `ESC` 退出插入模式
4. 输入 `:wq` 保存并退出

**设置文件权限**：

```bash
chmod 600 ~/.ssh/authorized_keys
```

---

### 1.5 测试密钥登录

**在本地电脑新开一个终端窗口**（不要关闭原来的连接）：

```bash
# 测试密钥登录
ssh root@你的服务器IP

# 如果能直接登录（不需要输入密码），说明配置成功
# 如果失败，检查上一步是否正确粘贴公钥
```

✅ **确认密钥登录成功后，再继续下一步！**

---

### 1.6 禁用密码登录（安全加固）

**在服务器上执行**：

```bash
# 备份 SSH 配置文件
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# 编辑 SSH 配置
vim /etc/ssh/sshd_config
```

**在 vim 中修改以下配置**：

1. 按 `/` 进入搜索模式，输入 `PasswordAuthentication`，按回车
2. 按 `i` 进入编辑模式
3. 将 `#PasswordAuthentication yes` 改为 `PasswordAuthentication no`（去掉 `#`）
4. 按 `ESC`，输入 `/PubkeyAuthentication`，回车
5. 将 `#PubkeyAuthentication yes` 改为 `PubkeyAuthentication yes`
6. 按 `ESC`，输入 `:wq` 保存退出

**重启 SSH 服务**：

```bash
systemctl restart sshd

# 验证 SSH 服务正常
systemctl status sshd
```

✅ **保持当前 SSH 连接不要断开！新开一个终端测试能否登录。**

---

### 1.7 修改 SSH 端口（防止扫描）

**在服务器上执行**：

```bash
# 编辑 SSH 配置
vim /etc/ssh/sshd_config
```

**在 vim 中**：
1. 搜索 `Port 22`（按 `/` 输入 `Port 22`）
2. 改为 `Port 2222`（或其他 1024-65535 之间的端口）
3. 保存退出（`:wq`）

**重启 SSH**：

```bash
systemctl restart sshd
```

**⚠️ 重要：先配置防火墙再断开连接！**

---

### 1.8 配置防火墙

**在服务器上执行**：

```bash
# 启用防火墙（先不要 enable，防止把自己锁在外面）
ufw --force reset  # 重置规则

# 允许新的 SSH 端口（重要！）
ufw allow 2222/tcp comment 'SSH'

# 允许 HTTP 和 HTTPS
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# 允许 Coolify Web UI（临时，部署完后可关闭）
ufw allow 8000/tcp comment 'Coolify UI'

# 查看规则（确认 2222 已添加）
ufw show added

# 启用防火墙
ufw --force enable

# 检查状态
ufw status numbered
```

**应该看到类似输出**：

```
Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 2222/tcp                   ALLOW IN    Anywhere                   # SSH
[ 2] 80/tcp                     ALLOW IN    Anywhere                   # HTTP
[ 3] 443/tcp                    ALLOW IN    Anywhere                   # HTTPS
[ 4] 8000/tcp                   ALLOW IN    Anywhere                   # Coolify UI
```

---

### 1.9 测试新 SSH 端口

**在本地电脑新开终端**：

```bash
# 使用新端口登录
ssh -p 2222 root@你的服务器IP

# 如果成功，说明配置正确
# 可以关闭旧的 SSH 连接了
```

**配置本地 SSH 快捷登录**（可选）：

```bash
# 在本地电脑执行
vim ~/.ssh/config
```

**添加以下内容**：

```
Host topseller
    HostName 你的服务器IP
    Port 2222
    User root
    IdentityFile ~/.ssh/id_ed25519
```

保存后，以后可以直接用 `ssh topseller` 登录。

---

### 1.10 安装 Fail2Ban（防止暴力破解）

**在服务器上执行**：

```bash
# 安装 Fail2Ban
apt install -y fail2ban

# 创建本地配置
cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = 2222
logpath = /var/log/auth.log
EOF

# 启动服务
systemctl enable fail2ban
systemctl start fail2ban

# 查看状态
fail2ban-client status sshd
```

✅ **第一阶段完成！服务器已安全加固。**

---

## 第二阶段：安装 Docker 和 Coolify（20分钟）

### 2.1 安装 Docker

**在服务器上执行**：

```bash
# 卸载旧版本（如果有）
apt remove -y docker docker-engine docker.io containerd runc

# 安装依赖
apt update
apt install -y ca-certificates curl gnupg lsb-release

# 添加 Docker 官方 GPG 密钥
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 添加 Docker 仓库
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 验证安装
docker --version
docker compose version
```

**应该看到类似输出**：

```
Docker version 24.0.7, build afdd53b
Docker Compose version v2.23.0
```

**启动 Docker 服务**：

```bash
systemctl enable docker
systemctl start docker

# 测试 Docker
docker run hello-world
```

如果看到 "Hello from Docker!"，说明安装成功。

---

### 2.2 安装 Coolify

**在服务器上执行**：

```bash
# 下载并执行 Coolify 安装脚本
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

**安装过程说明**：
- 脚本会自动安装 Coolify 及其依赖
- 安装时间约 5-10 分钟
- 安装完成后会显示访问地址和初始密码

**记录以下信息**：

```
Coolify 访问地址: http://你的服务器IP:8000
初始用户名: (脚本输出中会显示，通常是生成的邮箱)
初始密码: (脚本输出中会显示，一个随机字符串)
```

⚠️ **立即保存初始密码！**

---

### 2.3 首次登录 Coolify

**在本地浏览器访问**：

```
http://你的服务器IP:8000
```

1. 输入初始用户名和密码登录
2. 首次登录会要求修改密码，设置一个强密码
3. 设置你的邮箱（用于接收通知）
4. 完成初始化向导

---

### 2.4 配置 Coolify HTTPS（可选但推荐）

**如果你有域名**：

1. 在 Cloudflare/阿里云/腾讯云 DNS 控制台添加 A 记录：
   ```
   类型: A
   主机记录: coolify（或 admin）
   记录值: 你的服务器IP
   TTL: 600
   ```

2. 在 Coolify UI 中：
   - **Settings** → **Configuration**
   - **Instance Domain**: 填入 `coolify.yourdomain.com`
   - **Enable Automatic HTTPS**: 打开
   - **Save**

3. Coolify 会自动申请 Let's Encrypt 证书

4. 等待 2-5 分钟后，访问 `https://coolify.yourdomain.com`

**如果没有域名**：

继续使用 `http://IP:8000` 访问即可（不影响功能）。

✅ **第二阶段完成！Coolify 已安装并运行。**

---

## 第三阶段：配置 Cloudflare R2 存储（30分钟）

### 3.1 创建 Cloudflare 账号

**在本地浏览器**：

1. 访问 https://dash.cloudflare.com/sign-up
2. 注册账号（需要邮箱验证）
3. 完成邮箱验证

---

### 3.2 创建 R2 Bucket

**在 Cloudflare Dashboard**：

1. 左侧菜单 → **R2**（Object Storage）
2. 如果是首次使用，点击 **Purchase R2 Plan**（免费 10GB）
3. 点击 **Create bucket**
4. **Bucket name**: `topseller-images`（全局唯一，如果被占用加数字）
5. **Location**: 选择 **Automatic**（Cloudflare 自动选择最优位置）
6. 点击 **Create bucket**

记录 Bucket 名称：`topseller-images`

---

### 3.3 创建 R2 API Token

**在 Cloudflare Dashboard**：

1. **R2** → **Manage R2 API Tokens**
2. 点击 **Create API token**
3. **Token name**: `topseller-upload-token`
4. **Permissions**:
   - 选择 **Object Read & Write**
   - **Apply to specific buckets only**: 选择 `topseller-images`
5. 点击 **Create API Token**

**保存以下信息**（⚠️ 只显示一次！）：

```
R2_ACCOUNT_ID = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_ACCESS_KEY_ID = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_SECRET_ACCESS_KEY = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**立即保存到本地文件**：

```bash
# 在本地电脑执行
vim ~/topseller-r2-credentials.txt
```

粘贴上面的三个值，保存。

---

### 3.4 配置 R2 自定义域名（可选）

**如果你有域名并想要自定义 CDN 域名**：

1. **R2** → 点击 `topseller-images` Bucket
2. **Settings** → **Public Access** → **Custom Domains**
3. 点击 **Connect Domain**
4. 输入 `cdn.yourdomain.com`
5. 点击 **Continue**
6. Cloudflare 会自动添加 DNS 记录（需要域名托管在 Cloudflare）
7. 等待 DNS 生效（1-5 分钟）

记录 CDN URL：`https://cdn.yourdomain.com`

**如果没有域名**：

使用 R2 自带的公共域名（在 Bucket 页面可以看到）：
```
https://pub-xxxxxxxxxxxxxxxx.r2.dev
```

---

### 3.5 配置 R2 CORS（允许前端上传）

**在 Cloudflare Dashboard**：

1. **R2** → `topseller-images` → **Settings** → **CORS Policy**
2. 点击 **Add CORS policy**
3. **Allowed origins**:
   ```
   *
   ```
   （生产环境改为你的域名：`https://yourdomain.com`）

4. **Allowed methods**: 勾选
   ```
   GET
   POST
   PUT
   DELETE
   HEAD
   ```

5. **Allowed headers**:
   ```
   *
   ```

6. **Max age**: `3600`

7. 点击 **Save**

---

### 3.6 安装 AWS CLI（用于 R2 管理）

**在服务器上执行**：

```bash
# 下载 AWS CLI
cd /tmp
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"

# 解压
apt install -y unzip
unzip awscliv2.zip

# 安装
./aws/install

# 验证安装
aws --version
```

应该看到类似输出：`aws-cli/2.x.x`

---

### 3.7 配置 AWS CLI 连接 R2

**在服务器上执行**：

```bash
aws configure
```

**按提示输入**（从步骤 3.3 保存的信息）：

```
AWS Access Key ID: (粘贴 R2_ACCESS_KEY_ID)
AWS Secret Access Key: (粘贴 R2_SECRET_ACCESS_KEY)
Default region name: auto
Default output format: json
```

---

### 3.8 测试 R2 连接

**在服务器上执行**：

```bash
# 创建测试文件
echo "Hello from TopSeller Studio" > /tmp/test.txt

# 上传到 R2
aws s3 cp /tmp/test.txt s3://topseller-images/test/test.txt \
  --endpoint-url https://你的R2_ACCOUNT_ID.r2.cloudflarestorage.com

# 列出文件
aws s3 ls s3://topseller-images/test/ \
  --endpoint-url https://你的R2_ACCOUNT_ID.r2.cloudflarestorage.com

# 应该看到：
# 2024-01-01 12:00:00         29 test.txt
```

✅ **第三阶段完成！R2 存储已配置。**

---

## 第四阶段：部署应用到 Coolify（40分钟）

### 4.1 准备代码仓库

**在 GitHub 创建私有仓库**（如果还没有）：

1. 访问 https://github.com/new
2. **Repository name**: `topseller-studio`
3. **Private**: 勾选
4. 点击 **Create repository**

**在本地电脑推送代码**：

```bash
cd /Users/jameslee/nanobanana-studio

# 初始化 Git（如果还没有）
git init

# 添加远程仓库
git remote add origin https://github.com/你的用户名/topseller-studio.git

# 提交代码
git add .
git commit -m "Initial commit"

# 推送
git branch -M main
git push -u origin main
```

---

### 4.2 在 Coolify 创建项目

**在 Coolify UI**：

1. 点击左上角 **+ New** → **Project**
2. **Project Name**: `TopSeller Studio`
3. **Description**: `图销冠工作台 - 电商图片生成平台`
4. 点击 **Save**

---

### 4.3 添加 Git Source

**在 Coolify UI**：

1. **Sources** → **+ Add**
2. **Type**: 选择 **GitHub**
3. 点击 **Connect with GitHub**
4. 授权 Coolify 访问你的 GitHub 仓库
5. 选择 `topseller-studio` 仓库
6. 点击 **Save**

---

### 4.4 创建 PostgreSQL 数据库

**在 Coolify UI**：

1. 回到 `TopSeller Studio` 项目
2. 点击 **+ New** → **Database** → **PostgreSQL**
3. 配置：
   - **Name**: `topseller-db`
   - **Version**: `16-alpine`（选最新稳定版）
   - **Username**: `topseller_user`
   - **Password**: 点击生成随机密码（记录下来）
   - **Database**: `topseller_db`
   - **Port**: `5432`
4. **Resources**:
   - **Memory Limit**: `2GB`（如果服务器内存充足）
   - **CPU Limit**: `1`
5. 点击 **Deploy**

等待数据库启动（约 1-2 分钟），状态变为 **Running**。

**记录连接信息**：

在数据库详情页，复制 **Connection String**：

```
postgresql://topseller_user:密码@topseller-db:5432/topseller_db
```

---

### 4.5 创建应用

**在 Coolify UI**：

1. 回到 `TopSeller Studio` 项目
2. 点击 **+ New** → **Application**
3. **Type**: 选择 **Public Repository** 或 **Private Repository**（如果是私有的）
4. **Git Repository**: 选择 `你的用户名/topseller-studio`
5. **Branch**: `main`
6. **Build Pack**: 选择 **Dockerfile**（Coolify 会自动检测）
7. **Port**: `3000`（应用监听的端口）
8. 点击 **Save**

---

### 4.6 配置环境变量

**在 Coolify UI - 应用详情页**：

1. 点击 **Environment Variables**
2. 点击 **+ Add Variable**

**逐个添加以下变量**：

#### 数据库连接
```
DATABASE_URL = postgresql://topseller_user:你的数据库密码@topseller-db:5432/topseller_db
```

#### Node 环境
```
NODE_ENV = production
PORT = 3000
```

#### 认证配置
```
AUTH_JWT_SECRET = （点击生成随机值，至少 32 位）
AUTH_USER = admin（或你想要的用户名）
AUTH_PASSWORD = （设置一个强密码）
```

#### 上游 API（你现有的图片生成服务）
```
UPSTREAM_API_BASE_URL = https://s.lconai.com（你的上游地址）
UPSTREAM_AUTHORIZATION = Bearer your-token（你的 API Token）
```

#### Cloudflare R2
```
R2_ACCOUNT_ID = （步骤 3.3 记录的值）
R2_ACCESS_KEY_ID = （步骤 3.3 记录的值）
R2_SECRET_ACCESS_KEY = （步骤 3.3 记录的值）
R2_BUCKET_NAME = topseller-images
R2_PUBLIC_URL = https://cdn.yourdomain.com（或 R2 公共 URL）
```

#### 前端配置（如果需要）
```
VITE_API_BASE_URL = /api
VITE_DEFAULT_IMAGE_MODEL = gemini-2.5-flash-image
```

**保存所有环境变量**。

---

### 4.7 创建 Dockerfile

**在本地项目根目录创建 `Dockerfile`**：

```bash
cd /Users/jameslee/nanobanana-studio
vim Dockerfile
```

**粘贴以下内容**：

```dockerfile
# 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖
RUN npm ci

# 复制源代码
COPY . .

# 构建前端
RUN npm run build

# 生产阶段
FROM node:20-alpine

WORKDIR /app

# 安装 dumb-init（优雅处理信号）
RUN apk add --no-cache dumb-init

# 复制依赖和构建产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 使用 dumb-init 启动
CMD ["dumb-init", "node", "server/index.mjs"]
```

**保存文件，推送到 GitHub**：

```bash
git add Dockerfile
git commit -m "Add Dockerfile for production deployment"
git push
```

---

### 4.8 添加健康检查接口

**编辑 `server/index.mjs`**，在路由部分添加：

```bash
vim server/index.mjs
```

**在文件末尾添加**：

```javascript
// 健康检查接口
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});
```

**推送更新**：

```bash
git add server/index.mjs
git commit -m "Add health check endpoint"
git push
```

---

### 4.9 部署应用

**在 Coolify UI - 应用详情页**：

1. 点击 **Deploy**（右上角大按钮）
2. 观察 **Deployment Logs**（实时构建日志）
3. 等待构建完成（首次约 5-10 分钟）

**构建过程**：
- Pulling code from GitHub...
- Building Docker image...
- Starting container...
- Health check passed ✓

**如果构建失败**：
- 查看日志中的错误信息
- 常见问题：
  - 缺少依赖：检查 `package.json`
  - 端口冲突：确认 `PORT=3000`
  - 环境变量错误：检查拼写

---

### 4.10 配置域名和 HTTPS

**如果你有域名**：

1. 在 Cloudflare/阿里云 DNS 控制台添加 A 记录：
   ```
   类型: A
   主机记录: @（或 app）
   记录值: 你的服务器IP
   TTL: 600
   ```

2. 在 Coolify - 应用详情页：
   - **Domains** → **+ Add Domain**
   - 输入 `yourdomain.com` 或 `app.yourdomain.com`
   - **Enable Automatic HTTPS**: 打开
   - 点击 **Save**

3. Coolify 会自动申请 Let's Encrypt 证书

4. 等待 2-5 分钟，访问 `https://yourdomain.com`

**如果没有域名**：

可以使用服务器 IP 访问：`http://你的服务器IP:3000`

---

### 4.11 验证部署

**在浏览器访问**：

```
https://yourdomain.com
或
http://你的服务器IP:3000
```

**测试以下功能**：

1. [ ] 登录页面正常显示
2. [ ] 可以登录（用 `AUTH_USER` 和 `AUTH_PASSWORD`）
3. [ ] 可以创建新会话
4. [ ] 可以生成图片（测试上游 API）
5. [ ] 可以创建矩阵任务
6. [ ] 检查浏览器控制台无错误

✅ **第四阶段完成！应用已上线。**

---

## 第五阶段：配置自动备份（30分钟）

### 5.1 创建备份目录

**在服务器上执行**：

```bash
# 创建备份目录结构
mkdir -p /data/backups/postgres
mkdir -p /data/backups/configs
mkdir -p /data/backups/images
mkdir -p /root/scripts

# 设置权限
chmod 700 /data/backups
chmod 700 /root/scripts
```

---

### 5.2 创建数据库备份脚本

**在服务器上执行**：

```bash
vim /root/scripts/backup-postgres.sh
```

**粘贴以下内容**（完整脚本）：

```bash
#!/bin/bash
# PostgreSQL 自动备份脚本

set -e

# ========== 配置区 ==========
BACKUP_DIR="/data/backups/postgres"
RETENTION_DAYS=7
DB_CONTAINER="topseller-db"  # Coolify 中的数据库容器名
DB_NAME="topseller_db"
DB_USER="topseller_user"
R2_ACCOUNT_ID="你的R2_ACCOUNT_ID"
R2_BUCKET="topseller-backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
# ============================

# 创建备份目录
mkdir -p $BACKUP_DIR

# 记录开始时间
echo "========================================" | tee -a /var/log/postgres-backup.log
echo "开始备份: $(date)" | tee -a /var/log/postgres-backup.log

# 查找数据库容器 ID
CONTAINER_ID=$(docker ps | grep "$DB_CONTAINER" | awk '{print $1}' | head -1)

if [ -z "$CONTAINER_ID" ]; then
  echo "错误: 找不到数据库容器 $DB_CONTAINER" | tee -a /var/log/postgres-backup.log
  exit 1
fi

echo "数据库容器ID: $CONTAINER_ID" | tee -a /var/log/postgres-backup.log

# 执行备份
echo "正在备份数据库..." | tee -a /var/log/postgres-backup.log
docker exec $CONTAINER_ID pg_dump -U $DB_USER -Fc $DB_NAME > $BACKUP_DIR/backup_$TIMESTAMP.dump

# 压缩备份
echo "正在压缩备份..." | tee -a /var/log/postgres-backup.log
gzip $BACKUP_DIR/backup_$TIMESTAMP.dump

# 验证备份文件
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.dump.gz"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "错误: 备份文件不存在" | tee -a /var/log/postgres-backup.log
  exit 1
fi

BACKUP_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
if [ $BACKUP_SIZE -lt 1024 ]; then
  echo "错误: 备份文件过小 ($BACKUP_SIZE bytes)" | tee -a /var/log/postgres-backup.log
  exit 1
fi

echo "备份完成: $BACKUP_FILE ($BACKUP_SIZE bytes)" | tee -a /var/log/postgres-backup.log

# 上传到 R2
echo "正在上传到 Cloudflare R2..." | tee -a /var/log/postgres-backup.log
aws s3 cp $BACKUP_FILE \
  s3://$R2_BUCKET/postgres/backup_$TIMESTAMP.dump.gz \
  --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com

if [ $? -eq 0 ]; then
  echo "✓ 上传成功" | tee -a /var/log/postgres-backup.log
else
  echo "✗ 上传失败" | tee -a /var/log/postgres-backup.log
fi

# 清理本地旧备份（保留最近 N 天）
echo "清理本地旧备份（保留 $RETENTION_DAYS 天）..." | tee -a /var/log/postgres-backup.log
find $BACKUP_DIR -name "backup_*.dump.gz" -mtime +$RETENTION_DAYS -delete

echo "备份流程结束: $(date)" | tee -a /var/log/postgres-backup.log
echo "========================================" | tee -a /var/log/postgres-backup.log
```

**修改脚本中的配置**：

1. 将 `R2_ACCOUNT_ID="你的R2_ACCOUNT_ID"` 改为你的实际值
2. 将 `DB_CONTAINER="topseller-db"` 改为 Coolify 中实际的容器名（如果不同）

**保存并设置权限**：

```bash
chmod +x /root/scripts/backup-postgres.sh
```

---

### 5.3 创建 R2 备份 Bucket

**在 Cloudflare Dashboard**：

1. **R2** → **Create bucket**
2. **Bucket name**: `topseller-backups`
3. 点击 **Create**

---

### 5.4 测试备份脚本

**在服务器上执行**：

```bash
# 手动执行一次备份
/root/scripts/backup-postgres.sh

# 查看日志
tail -20 /var/log/postgres-backup.log

# 检查本地备份文件
ls -lh /data/backups/postgres/

# 验证 R2 上传
aws s3 ls s3://topseller-backups/postgres/ \
  --endpoint-url https://你的R2_ACCOUNT_ID.r2.cloudflarestorage.com
```

应该看到备份文件已上传。

---

### 5.5 配置定时自动备份

**在服务器上执行**：

```bash
# 编辑 crontab
crontab -e
```

**添加以下行**（在文件末尾）：

```
# 每天凌晨 3 点自动备份数据库
0 3 * * * /root/scripts/backup-postgres.sh >> /var/log/postgres-backup.log 2>&1

# 每周日凌晨 4 点备份配置文件
0 4 * * 0 tar -czf /data/backups/configs/config_$(date +\%Y\%m\%d).tar.gz /data/coolify /root/.env /root/scripts
```

**保存退出**（`:wq`）。

**验证定时任务**：

```bash
crontab -l
```

应该看到刚才添加的两行。

---

### 5.6 创建备份恢复脚本

**在服务器上执行**：

```bash
vim /root/scripts/restore-postgres.sh
```

**粘贴以下内容**：

```bash
#!/bin/bash
# PostgreSQL 备份恢复脚本

set -e

if [ -z "$1" ]; then
  echo "用法: $0 <备份文件名>"
  echo "示例: $0 backup_20240101_030000.dump.gz"
  exit 1
fi

BACKUP_FILE=$1
BACKUP_DIR="/data/backups/postgres"
DB_CONTAINER="topseller-db"
DB_NAME="topseller_db"
DB_USER="topseller_user"
R2_ACCOUNT_ID="你的R2_ACCOUNT_ID"
R2_BUCKET="topseller-backups"

# 查找容器 ID
CONTAINER_ID=$(docker ps | grep "$DB_CONTAINER" | awk '{print $1}' | head -1)

if [ -z "$CONTAINER_ID" ]; then
  echo "错误: 找不到数据库容器"
  exit 1
fi

# 如果本地没有备份文件，从 R2 下载
if [ ! -f "$BACKUP_DIR/$BACKUP_FILE" ]; then
  echo "从 R2 下载备份文件..."
  aws s3 cp s3://$R2_BUCKET/postgres/$BACKUP_FILE $BACKUP_DIR/$BACKUP_FILE \
    --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
fi

# 解压备份
echo "解压备份文件..."
gunzip -c $BACKUP_DIR/$BACKUP_FILE > /tmp/restore.dump

# 创建临时恢复数据库
echo "创建临时恢复数据库..."
docker exec $CONTAINER_ID psql -U $DB_USER -c "DROP DATABASE IF EXISTS ${DB_NAME}_restore;"
docker exec $CONTAINER_ID psql -U $DB_USER -c "CREATE DATABASE ${DB_NAME}_restore;"

# 恢复到临时数据库
echo "恢复数据..."
docker exec -i $CONTAINER_ID pg_restore -U $DB_USER -d ${DB_NAME}_restore --no-owner --no-acl < /tmp/restore.dump

# 验证恢复
echo "验证恢复结果..."
TABLE_COUNT=$(docker exec $CONTAINER_ID psql -U $DB_USER -d ${DB_NAME}_restore -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")

echo "恢复完成，共 $TABLE_COUNT 张表"
echo ""
echo "⚠️  数据已恢复到临时数据库: ${DB_NAME}_restore"
echo ""
echo "如需切换到生产数据库，执行以下命令:"
echo "docker exec $CONTAINER_ID psql -U $DB_USER -c \"ALTER DATABASE $DB_NAME RENAME TO ${DB_NAME}_old;\""
echo "docker exec $CONTAINER_ID psql -U $DB_USER -c \"ALTER DATABASE ${DB_NAME}_restore RENAME TO $DB_NAME;\""
echo ""
echo "然后重启应用容器"

# 清理
rm /tmp/restore.dump
```

**修改配置并保存**：

```bash
chmod +x /root/scripts/restore-postgres.sh
```

---

### 5.7 测试恢复脚本（可选）

**在服务器上执行**：

```bash
# 列出所有备份
aws s3 ls s3://topseller-backups/postgres/ \
  --endpoint-url https://你的R2_ACCOUNT_ID.r2.cloudflarestorage.com

# 选择一个最新的备份测试恢复
/root/scripts/restore-postgres.sh backup_20240101_030000.dump.gz
```

⚠️ **这只是测试，不会影响生产数据库。**

✅ **第五阶段完成！自动备份已配置。**

---

## 第六阶段：配置 Cloudflare CDN 加速（20分钟）

### 6.1 将域名托管到 Cloudflare

**如果域名已在其他服务商（阿里云/腾讯云）**：

1. 登录 Cloudflare Dashboard
2. 点击 **Add a Site**
3. 输入你的域名（如 `yourdomain.com`）
4. 选择 **Free** 计划
5. Cloudflare 会扫描现有 DNS 记录
6. 点击 **Continue**
7. 记录 Cloudflare 的 Name Servers：
   ```
   ns1.cloudflare.com
   ns2.cloudflare.com
   ```

8. 登录域名注册商（阿里云/腾讯云）
9. 找到 **DNS 设置** → **修改 DNS 服务器**
10. 将 NS 记录改为 Cloudflare 的 Name Servers
11. 等待 DNS 生效（最多 24 小时，通常 1-2 小时）

---

### 6.2 配置 DNS 记录

**在 Cloudflare Dashboard**：

1. 选择你的域名
2. **DNS** → **Records**
3. 添加以下记录：

#### 主应用域名
```
类型: A
名称: @（或 app）
IPv4 地址: 你的服务器IP
代理状态: 已代理（橙色云朵）✅
TTL: 自动
```

#### CDN 图片域名（如果用自定义域名）
```
类型: CNAME
名称: cdn
目标: topseller-images.你的R2账号ID.r2.cloudflarestorage.com
代理状态: 已代理（橙色云朵）✅
TTL: 自动
```

#### Coolify 管理后台（可选）
```
类型: A
名称: coolify
IPv4 地址: 你的服务器IP
代理状态: 仅 DNS（灰色云朵）
TTL: 自动
```

---

### 6.3 配置 SSL/TLS

**在 Cloudflare Dashboard**：

1. **SSL/TLS** → **Overview**
2. 加密模式选择：**Full (strict)**（推荐）
3. **Edge Certificates**:
   - **Always Use HTTPS**: 打开 ✅
   - **Automatic HTTPS Rewrites**: 打开 ✅
   - **Minimum TLS Version**: TLS 1.2
   - **TLS 1.3**: 打开 ✅

---

### 6.4 配置缓存规则

**在 Cloudflare Dashboard**：

1. **Caching** → **Configuration**
2. **Caching Level**: Standard
3. **Browser Cache TTL**: Respect Existing Headers

**创建缓存规则**（针对静态资源）：

1. **Caching** → **Cache Rules** → **Create rule**
2. **Rule name**: `Cache Static Assets`
3. **When incoming requests match**:
   ```
   (http.request.uri.path matches ".*\.(jpg|jpeg|png|gif|svg|webp|css|js|woff|woff2|ttf)$")
   ```
4. **Then**:
   - **Cache eligibility**: Eligible for cache
   - **Edge TTL**: 1 month
   - **Browser TTL**: 1 day
5. 点击 **Deploy**

---

### 6.5 配置 WAF 防火墙规则

**在 Cloudflare Dashboard**：

1. **Security** → **WAF** → **Custom rules** → **Create rule**

#### 规则 1: 限制 API 请求频率

```
规则名称: Rate Limit API
When incoming requests match:
  (http.request.uri.path contains "/api/")
Then:
  Rate limit: 100 requests per 60 seconds
  Action: Block for 1 hour
```

#### 规则 2: 阻止常见攻击

```
规则名称: Block SQL Injection
When incoming requests match:
  (http.request.uri.query contains "union select" or
   http.request.uri.query contains "drop table" or
   http.request.uri.query contains "<script")
Then:
  Action: Block
```

#### 规则 3: 保护管理接口

```
规则名称: Protect Admin
When incoming requests match:
  (http.request.uri.path eq "/admin" and
   ip.src ne 你的办公室IP)
Then:
  Action: Challenge (Managed)
```

---

### 6.6 开启 DDoS 防护

**在 Cloudflare Dashboard**：

1. **Security** → **DDoS**
2. **HTTP DDoS Attack Protection**: 已自动开启 ✅
3. **Network-layer DDoS Attack Protection**: 已自动开启 ✅

**敏感度设置**：

- **HTTP DDoS**: 保持默认（Medium）
- **Network DDoS**: 保持默认（Medium）

---

### 6.7 配置 Bot 防护

**在 Cloudflare Dashboard**：

1. **Security** → **Bots**
2. **Bot Fight Mode**: 打开 ✅（免费版）
3. **Super Bot Fight Mode**: 需要付费版（可选）

---

### 6.8 配置页面规则（可选优化）

**在 Cloudflare Dashboard**：

1. **Rules** → **Page Rules** → **Create Page Rule**

#### 规则 1: 不缓存 API 接口

```
URL pattern: yourdomain.com/api/*
Settings:
  - Cache Level: Bypass
```

#### 规则 2: 强制 HTTPS

```
URL pattern: http://yourdomain.com/*
Settings:
  - Always Use HTTPS: On
```

---

### 6.9 测试 CDN 加速效果

**在本地电脑执行**：

```bash
# 测试 DNS 解析
nslookup yourdomain.com

# 应该返回 Cloudflare 的 IP（非你的服务器 IP）

# 测试 HTTP 响应头
curl -I https://yourdomain.com

# 应该看到：
# cf-cache-status: HIT（缓存命中）
# server: cloudflare
```

**浏览器测试**：

1. 访问 `https://yourdomain.com`
2. 打开开发者工具（F12） → **Network**
3. 刷新页面
4. 查看静态资源（JS/CSS/图片）的响应头
5. 应该看到 `cf-cache-status: HIT`

✅ **第六阶段完成！CDN 加速已生效。**

---

## 第七阶段：配置监控和告警（30分钟）

### 7.1 安装 Prometheus 和 Grafana

**在服务器上执行**：

```bash
# 创建监控目录
mkdir -p /data/monitoring
cd /data/monitoring

# 创建 docker-compose.yml
vim docker-compose.monitoring.yml
```

**粘贴以下内容**：

```yaml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin123456
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - grafana_data:/var/lib/grafana
    restart: unless-stopped

  node-exporter:
    image: prom/node-exporter:latest
    container_name: node-exporter
    ports:
      - "9100:9100"
    command:
      - '--path.rootfs=/host'
    volumes:
      - /:/host:ro,rslave
    restart: unless-stopped

volumes:
  prometheus_data:
  grafana_data:
```

**保存文件**。

---

### 7.2 配置 Prometheus

**在服务器上执行**：

```bash
# 创建 Prometheus 配置文件
vim /data/monitoring/prometheus.yml
```

**粘贴以下内容**：

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  # 监控 Node Exporter（系统指标）
  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

  # 监控 Docker 容器
  - job_name: 'docker'
    static_configs:
      - targets: ['host.docker.internal:9323']

  # 监控应用（如果应用暴露了 /metrics 接口）
  - job_name: 'app'
    static_configs:
      - targets: ['你的服务器IP:3000']
    metrics_path: '/metrics'
```

**保存文件**。

---

### 7.3 启动监控服务

**在服务器上执行**：

```bash
cd /data/monitoring

# 启动服务
docker compose -f docker-compose.monitoring.yml up -d

# 查看服务状态
docker compose -f docker-compose.monitoring.yml ps

# 应该看到 3 个容器都在运行：
# - prometheus
# - grafana
# - node-exporter
```

---

### 7.4 开放监控端口（防火墙）

**在服务器上执行**：

```bash
# 允许 Grafana 访问（仅限你的办公室 IP）
ufw allow from 你的办公室IP to any port 3001 proto tcp comment 'Grafana'

# 或者允许所有（不推荐）
# ufw allow 3001/tcp comment 'Grafana'

# 不要开放 Prometheus 9090 端口（仅内部访问）
```

---

### 7.5 登录 Grafana

**在本地浏览器访问**：

```
http://你的服务器IP:3001
```

**登录信息**：
- 用户名: `admin`
- 密码: `admin123456`（在 docker-compose 中设置的）

**首次登录后修改密码**。

---

### 7.6 配置 Prometheus 数据源

**在 Grafana 中**：

1. 左侧菜单 → **Configuration**（齿轮图标） → **Data Sources**
2. 点击 **Add data source**
3. 选择 **Prometheus**
4. 配置：
   - **URL**: `http://prometheus:9090`
   - **Access**: `Server (default)`
5. 点击 **Save & Test**
6. 应该看到 "Data source is working" ✅

---

### 7.7 导入 Dashboard

**在 Grafana 中**：

1. 左侧菜单 → **Dashboards** → **Import**
2. 输入 Dashboard ID: `1860`（Node Exporter Full）
3. 点击 **Load**
4. 选择 **Prometheus** 数据源
5. 点击 **Import**

现在可以看到服务器的实时监控面板（CPU、内存、磁盘、网络）。

---

### 7.8 创建告警规则

**在服务器上执行**：

```bash
# 创建告警规则文件
vim /data/monitoring/alert.rules.yml
```

**粘贴以下内容**：

```yaml
groups:
  - name: system_alerts
    interval: 30s
    rules:
      # CPU 使用率过高
      - alert: HighCPU
        expr: 100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "CPU 使用率过高 ({{ $value }}%)"

      # 内存使用率过高
      - alert: HighMemory
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "内存使用率过高 ({{ $value }}%)"

      # 磁盘空间不足
      - alert: LowDisk
        expr: (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100 < 20
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "磁盘空间不足 (剩余 {{ $value }}%)"
```

**保存文件**。

**更新 Prometheus 配置引用告警规则**：

```bash
vim /data/monitoring/prometheus.yml
```

**在文件末尾添加**：

```yaml
rule_files:
  - 'alert.rules.yml'
```

**重启 Prometheus**：

```bash
docker restart prometheus
```

---

### 7.9 配置告警通知（可选）

**如果要接收告警通知（企业微信/钉钉/邮件）**：

1. 在 Grafana 中：
   - **Alerting** → **Contact points** → **New contact point**
2. 选择通知方式：
   - **Webhook**: 企业微信/钉钉 Webhook URL
   - **Email**: 配置 SMTP
3. 保存并测试

---

### 7.10 验证监控

**在 Grafana 中查看**：

1. CPU 使用率实时曲线
2. 内存使用情况
3. 磁盘 I/O
4. 网络流量

**在 Prometheus 中查看告警**：

访问 `http://你的服务器IP:9090/alerts`

✅ **第七阶段完成！监控系统已运行。**

---

## 第八阶段：日常运维操作指南（参考）

### 8.1 查看应用日志

**在 Coolify UI**：

1. 进入应用详情页
2. 点击 **Logs**
3. 查看实时日志输出

**在服务器命令行**：

```bash
# 查看应用容器日志
docker logs -f --tail 100 容器ID

# 查看数据库日志
docker logs -f --tail 100 topseller-db
```

---

### 8.2 重启应用

**在 Coolify UI**：

1. 进入应用详情页
2. 点击 **Restart**

**在服务器命令行**：

```bash
# 重启应用容器
docker restart 容器ID

# 重启数据库
docker restart topseller-db
```

---

### 8.3 更新应用代码

**在本地电脑**：

```bash
# 修改代码后推送到 GitHub
git add .
git commit -m "Update feature"
git push
```

**在 Coolify UI**：

1. 进入应用详情页
2. 点击 **Deploy**（会自动拉取最新代码并重新构建）

---

### 8.4 手动触发备份

**在服务器上执行**：

```bash
# 立即执行备份
/root/scripts/backup-postgres.sh

# 查看备份日志
tail -50 /var/log/postgres-backup.log

# 查看本地备份文件
ls -lh /data/backups/postgres/

# 查看 R2 上的备份
aws s3 ls s3://topseller-backups/postgres/ \
  --endpoint-url https://你的R2_ACCOUNT_ID.r2.cloudflarestorage.com
```

---

### 8.5 恢复备份

**在服务器上执行**：

```bash
# 列出所有备份
aws s3 ls s3://topseller-backups/postgres/ \
  --endpoint-url https://你的R2_ACCOUNT_ID.r2.cloudflarestorage.com

# 恢复指定备份
/root/scripts/restore-postgres.sh backup_20240101_030000.dump.gz

# 按照脚本提示切换数据库
```

---

### 8.6 清理 Docker 垃圾

**在服务器上执行**：

```bash
# 清理未使用的镜像、容器、网络
docker system prune -a --volumes -f

# 查看磁盘空间
df -h
```

---

### 8.7 查看资源使用情况

**在服务器上执行**：

```bash
# 查看 CPU 和内存
htop

# 查看磁盘使用
df -h

# 查看容器资源使用
docker stats

# 查看数据库连接数
docker exec topseller-db psql -U topseller_user -d topseller_db -c "SELECT count(*) FROM pg_stat_activity;"
```

---

### 8.8 更新 SSL 证书

**Coolify 会自动续期 Let's Encrypt 证书**，无需手动操作。

**如果证书过期了**：

1. 在 Coolify UI - 应用详情页
2. **Domains** → 点击域名旁的 **Refresh Certificate**

---

## 第九阶段：故障处理手册

### 9.1 应用无法访问

**排查步骤**：

```bash
# 1. 检查容器是否运行
docker ps -a | grep topseller

# 2. 如果容器停止，查看日志
docker logs 容器ID --tail 100

# 3. 检查端口是否监听
netstat -tlnp | grep 3000

# 4. 检查防火墙
ufw status

# 5. 检查 Nginx/Traefik 代理
docker logs traefik --tail 100

# 6. 测试本地访问
curl http://localhost:3000/health
```

**常见原因**：
- 环境变量错误：检查 Coolify 中的环境变量
- 数据库连接失败：检查 `DATABASE_URL`
- 端口冲突：检查其他进程是否占用 3000 端口
- 内存不足：查看 `docker stats`

---

### 9.2 数据库连接失败

**排查步骤**：

```bash
# 1. 检查数据库容器
docker ps -a | grep postgres

# 2. 如果容器停止，重启
docker start topseller-db

# 3. 测试数据库连接
docker exec topseller-db psql -U topseller_user -d topseller_db -c "SELECT 1;"

# 4. 查看数据库日志
docker logs topseller-db --tail 100

# 5. 检查磁盘空间（数据库可能写满）
df -h
```

---

### 9.3 磁盘空间不足

**应急处理**：

```bash
# 1. 查看磁盘使用
df -h

# 2. 查找大文件
du -sh /* | sort -hr | head -10

# 3. 清理 Docker
docker system prune -a --volumes -f

# 4. 清理日志
find /var/log -name "*.log" -mtime +30 -delete

# 5. 清理旧备份（保留最近 3 天）
find /data/backups/postgres -name "*.dump.gz" -mtime +3 -delete

# 6. 清理 npm 缓存
rm -rf ~/.npm
```

---

### 9.4 网站被攻击（DDoS）

**应急操作**：

1. **开启 Cloudflare Under Attack 模式**：
   - 登录 Cloudflare Dashboard
   - 选择域名
   - **Overview** → **Quick Actions** → **Under Attack Mode** → 打开

2. **查看攻击日志**：
   - **Security** → **Events**
   - 记录攻击 IP

3. **添加封禁规则**：
   - **Security** → **WAF** → **Custom rules**
   - 创建规则封禁攻击 IP

---

### 9.5 数据库误删除

**恢复步骤**：

```bash
# 1. 立即停止应用（防止数据覆盖）
docker stop 应用容器ID

# 2. 找到最近的备份
aws s3 ls s3://topseller-backups/postgres/ \
  --endpoint-url https://你的R2_ACCOUNT_ID.r2.cloudflarestorage.com \
  | sort | tail -5

# 3. 恢复备份
/root/scripts/restore-postgres.sh backup_最新时间戳.dump.gz

# 4. 验证数据
docker exec topseller-db psql -U topseller_user -d topseller_db_restore -c "SELECT COUNT(*) FROM batch_jobs;"

# 5. 切换数据库
docker exec topseller-db psql -U topseller_user -c "ALTER DATABASE topseller_db RENAME TO topseller_db_damaged;"
docker exec topseller-db psql -U topseller_user -c "ALTER DATABASE topseller_db_restore RENAME TO topseller_db;"

# 6. 重启应用
docker start 应用容器ID
```

---

### 9.6 服务器被黑

**应急处理**：

```bash
# 1. 立即断开网络（慎重！会导致服务中断）
# ufw deny out from any to any
# ufw deny in from any to any

# 2. 查看可疑进程
ps aux | grep -E 'bitcoin|miner|xmrig'

# 3. 查看可疑连接
netstat -tulnp

# 4. 查看最近登录记录
last -20

# 5. 查看系统日志
tail -100 /var/log/auth.log

# 6. 修改所有密码
passwd root
# 修改数据库密码
# 修改 Coolify 密码

# 7. 检查 crontab
crontab -l

# 8. 重装系统（最彻底方案）
```

---

## 第十阶段：性能优化清单

### 10.1 数据库优化

**在服务器上执行**：

```bash
# 进入数据库容器
docker exec -it topseller-db psql -U topseller_user -d topseller_db

# 查看慢查询
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

# 分析表统计信息
ANALYZE batch_jobs;
ANALYZE sessions;

# 检查索引使用情况
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0;
```

---

### 10.2 应用优化

**在 Coolify 中调整资源限制**：

1. 进入应用详情页
2. **Resources**:
   - **Memory Limit**: `1GB` → `2GB`（如果服务器内存充足）
   - **CPU Limit**: `1` → `2`

---

### 10.3 CDN 缓存优化

**在 Cloudflare Dashboard**：

1. **Caching** → **Configuration**
2. **Browser Cache TTL**: `4 hours` → `1 day`
3. **Caching Level**: `Standard` → `Aggressive`（测试后使用）

---

## ✅ 部署完成检查清单

### 安全检查

- [ ] SSH 已改为非标准端口（2222）
- [ ] SSH 已禁用密码登录（仅密钥）
- [ ] UFW 防火墙已启用，仅开放必要端口
- [ ] Fail2Ban 已安装并运行
- [ ] Cloudflare CDN 已启用（防 DDoS）
- [ ] SSL 证书已配置（HTTPS）
- [ ] 环境变量中的密码已使用强密码
- [ ] 数据库仅限内部访问（未开放 5432 端口）

### 备份检查

- [ ] 自动备份脚本已配置
- [ ] Crontab 定时任务已添加
- [ ] 备份已成功上传到 R2
- [ ] 恢复脚本已测试可用
- [ ] 备份保留策略已设置（7 天）

### 监控检查

- [ ] Prometheus 已运行
- [ ] Grafana 已配置数据源
- [ ] Dashboard 可以正常显示监控数据
- [ ] 告警规则已配置
- [ ] 告警通知已测试（可选）

### 功能检查

- [ ] 应用可以正常访问（HTTPS）
- [ ] 可以登录
- [ ] 可以创建会话
- [ ] 可以生成图片
- [ ] 可以创建矩阵任务
- [ ] 图片可以正常上传到 R2
- [ ] 浏览器控制台无错误

---

## 📞 紧急联系信息

### 保存以下信息（打印或保存到安全的地方）

```
=================================
TopSeller Studio 部署信息
=================================

服务器信息：
  - IP: __________________
  - SSH 端口: 2222
  - SSH 密钥路径: ~/.ssh/id_ed25519

域名信息：
  - 主域名: __________________
  - CDN 域名: __________________
  - Coolify: __________________

数据库信息：
  - 容器名: topseller-db
  - 用户名: topseller_user
  - 密码: __________________
  - 数据库名: topseller_db

Cloudflare R2：
  - Account ID: __________________
  - Access Key: __________________
  - Secret Key: __________________
  - Bucket: topseller-images
  - Backup Bucket: topseller-backups

应用登录：
  - 用户名: __________________
  - 密码: __________________

Coolify 登录：
  - URL: __________________
  - 用户名: __________________
  - 密码: __________________

Grafana 监控：
  - URL: http://IP:3001
  - 用户名: admin
  - 密码: __________________

备份脚本路径：
  - 备份: /root/scripts/backup-postgres.sh
  - 恢复: /root/scripts/restore-postgres.sh
  - 日志: /var/log/postgres-backup.log

重要命令：
  - 登录服务器: ssh -p 2222 root@IP
  - 查看容器: docker ps
  - 查看日志: docker logs -f 容器ID
  - 重启应用: docker restart 容器ID
  - 手动备份: /root/scripts/backup-postgres.sh

=================================
```

---

## 🎉 恭喜！部署完成！

你已经完成了一套生产级的自部署方案，包括：

✅ 服务器安全加固
✅ Coolify + Docker 容器化部署
✅ PostgreSQL 数据库
✅ Cloudflare R2 对象存储
✅ 自动备份和容灾
✅ Cloudflare CDN 加速
✅ Prometheus + Grafana 监控
✅ 完整的故障处理手册

**预计成本**: ¥100-300/月（根据服务器配置）

**下一步建议**：
1. 定期查看 Grafana 监控面板
2. 每月执行一次恢复演练
3. 定期更新 Docker 镜像
4. 关注 Cloudflare 安全事件

需要帮助？重新阅读对应章节或联系技术支持。