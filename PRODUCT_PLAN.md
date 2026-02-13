# TopSeller Studio 产品化计划

## 目标

将现有纯前端应用升级为支持云端同步和团队协作的产品化版本，同时保持离线优先的用户体验。

---

## 存储方案设计

### 架构：混合存储（IndexedDB + 云端同步）

```
Frontend (IndexedDB)
    ↕️ (可选同步)
Backend API (Express)
    ↕️
PostgreSQL + Cloudflare R2
```

**设计原则**：
- ✅ 离线优先：本地 IndexedDB 作为主存储，响应快速
- ✅ 可选同步：用户登录后自动同步到云端
- ✅ 数据安全：跨设备访问，不怕清除浏览器数据
- ✅ 渐进增强：未登录用户仍可完整使用本地功能

### 当前 vs 产品化对比

| 维度 | 当前方案 | 产品化方案 |
|------|---------|-----------|
| 数据存储 | IndexedDB only | IndexedDB + PostgreSQL |
| 图片存储 | data URL | data URL (本地) + R2 (云端) |
| 跨设备 | ❌ 不支持 | ✅ 自动同步 |
| 协作 | ❌ 单人使用 | ✅ Team 工作区 |
| 离线使用 | ✅ 完全支持 | ✅ 完全支持 |
| 数据丢失风险 | ⚠️ 清除浏览器即丢失 | ✅ 云端备份 |

---

## Team 功能设计（简化方案）

### 核心思路：每用户一个隐式工作区

**设计**：
- 用户登录时自动创建一个 "个人工作区" Team
- Team ID = User ID（1:1 映射）
- 所有数据挂在 Team 下，天然隔离
- 无需用户手动创建 Team，零学习成本

**数据模型**：

```sql
-- PostgreSQL Schema
CREATE TABLE teams (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,                    -- "用户名 的工作区"
  slug TEXT UNIQUE NOT NULL,             -- 用户名
  owner_id UUID NOT NULL,                -- 从 JWT 获取
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE team_members (
  team_id UUID REFERENCES teams(id),
  user_id UUID NOT NULL,
  role TEXT DEFAULT 'owner',              -- owner/admin/member（未来扩展）
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- 所有业务表都加 team_id 隔离
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT,
  settings JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

CREATE TABLE messages (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT,                              -- user/assistant/system
  content TEXT,
  images JSONB,                           -- [{url: "https://r2...", aspectRatio: "1:1"}]
  created_at TIMESTAMPTZ
);

CREATE TABLE batch_jobs (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT,
  status TEXT,                            -- draft/running/completed/failed/archived/deleted
  base_prompt TEXT,
  reference_image_url TEXT,
  product_image_url TEXT,
  model_image_url TEXT,
  slots JSONB,                            -- BatchSlot[] 保持现有结构
  action_logs JSONB,                      -- ActionLog[]
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  INDEX idx_team_status (team_id, status),
  INDEX idx_updated (team_id, updated_at DESC)
);

CREATE TABLE models (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  tags JSONB,                             -- string[]
  created_at TIMESTAMPTZ
);

CREATE TABLE products (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_url TEXT,
  tags JSONB,                             -- string[]
  created_at TIMESTAMPTZ
);
```

**Auth 流程改造**：

```javascript
// server/auth.mjs
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;

  // 1. 验证用户
  if (username !== process.env.AUTH_USER || password !== process.env.AUTH_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const userId = generateUserId(username); // 稳定的 UUID

  // 2. 自动创建/获取个人 Team
  let team = await db.teams.findUnique({ where: { ownerId: userId } });
  if (!team) {
    team = await db.teams.create({
      data: {
        id: userId,                          // Team ID = User ID
        name: `${username} 的工作区`,
        slug: username,
        ownerId: userId
      }
    });

    await db.teamMembers.create({
      data: {
        teamId: team.id,
        userId: userId,
        role: 'owner'
      }
    });
  }

  // 3. JWT 包含 teamId
  const token = jwt.sign(
    { userId, teamId: team.id, username },
    process.env.AUTH_JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000  // 30 days
  });

  res.json({ userId, teamId: team.id, username });
});

// 中间件：自动注入 teamId
export function requireAuth(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { userId, teamId, username } = jwt.verify(token, process.env.AUTH_JWT_SECRET);
    req.userId = userId;
    req.teamId = teamId;
    req.username = username;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// 所有 API 自动过滤
app.get('/api/batch-jobs', requireAuth, async (req, res) => {
  const jobs = await db.batchJobs.findMany({
    where: { teamId: req.teamId },
    orderBy: { updatedAt: 'desc' }
  });
  res.json(jobs);
});
```

---

## 图片存储方案

### 开发环境：data URL（保持现状）

- 简单直接，无需外部服务
- 存储在 IndexedDB + PostgreSQL JSONB 字段

### 生产环境：国内方案 vs 国际方案对比

#### 方案对比表

| 维度 | **阿里云 OSS（推荐国内）** | **腾讯云 COS** | **七牛云 Kodo** | **Cloudflare R2（国际）** |
|------|--------------------------|---------------|----------------|--------------------------|
| **存储费用** | ¥0.12/GB/月 | ¥0.099/GB/月 | ¥0.098/GB/月 | ¥0.11/GB/月 ($0.015) |
| **CDN 流量** | ¥0.24/GB | ¥0.21/GB | ¥0.28/GB | **免费** |
| **国内访问速度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ (有时被墙) |
| **备案要求** | ✅ 需要（绑定域名） | ✅ 需要（绑定域名） | ✅ 需要（绑定域名） | ❌ 不需要 |
| **100GB 存储 + 100GB 流量** | ¥36/月 | ¥31/月 | ¥38/月 | ¥11/月 |
| **API 兼容性** | S3 兼容 | S3 兼容 | 独立 API | S3 兼容 |
| **免费额度** | 无 | 50GB 存储（6个月） | 10GB 存储 + 10GB 流量 | 10GB 存储 |
| **文档和生态** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |

#### 推荐方案：阿里云 OSS

**为什么选择阿里云 OSS（国内部署）？**
- ✅ 国内访问速度最快（BGP 多线 + CDN）
- ✅ 生态成熟，官方 SDK 完善
- ✅ 与阿里云其他服务集成好（ECS、RDS、SLS）
- ✅ 企业级可靠性（99.995% 可用性）
- ✅ 支持图片处理（压缩、裁剪、水印）
- ⚠️ 需要域名备案（绑定自定义域名）
- ⚠️ CDN 流量费较高（但可控）

**为什么不选 R2（国内环境）？**
- ❌ 国内访问不稳定（Cloudflare 时常被墙）
- ❌ 延迟较高（最近节点在香港/新加坡）
- ⚠️ 适合海外用户或无备案域名的场景

#### 成本对比（100 用户，每人 1GB 存储 + 1GB 流量/月）

| 服务 | 存储费用 | CDN 流量费用 | 其他费用 | **总计/月** |
|------|---------|------------|---------|-----------|
| **阿里云 OSS** | ¥12 | ¥24 | - | **¥36** ($5) |
| 腾讯云 COS | ¥10 | ¥21 | - | ¥31 ($4.3) |
| 七牛云 | ¥10 | ¥28 | - | ¥38 ($5.3) |
| Cloudflare R2 | ¥11 | ¥0 | - | ¥11 ($1.5) |

**优化成本策略**：
1. **开启阿里云 OSS 归档存储**：历史图片转归档，费用降至 ¥0.033/GB/月
2. **CDN 按量付费 + 预付费包**：买 100GB 流量包 ¥16.2（vs 按量 ¥24）
3. **图片瘦身**：自动转 WebP/AVIF，减少 30-50% 流量
4. **冷热分离**：30 天未访问的图片转低频存储（¥0.08/GB/月）

**优化后成本**：
- 存储：¥12 → ¥6（归档 + 低频）
- 流量：¥24 → ¥16（流量包）
- **总计：¥22/月（$3）**

### 阿里云 OSS 配置步骤（推荐国内方案）

#### 1. 创建 OSS Bucket

```bash
# 登录阿里云控制台
# https://oss.console.aliyun.com → Bucket 列表 → 创建 Bucket

配置项：
  Bucket 名称：topseller-images
  地域：华东2（上海）或就近地域
  存储类型：标准存储
  读写权限：私有（推荐，通过签名 URL 访问）
  服务端加密：AES256（可选）
```

#### 2. 创建 AccessKey（子账号，最小权限）

```bash
# 控制台 → 访问控制（RAM）→ 用户 → 创建用户

用户信息：
  登录名称：topseller-oss-uploader
  访问方式：✅ OpenAPI 调用访问

权限策略（自定义）：
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:PutObject",
        "oss:GetObject",
        "oss:DeleteObject"
      ],
      "Resource": [
        "acs:oss:*:*:topseller-images/*"
      ]
    }
  ]
}

保存以下信息到 .env：
  OSS_REGION=oss-cn-shanghai
  OSS_BUCKET=topseller-images
  OSS_ACCESS_KEY_ID=<your_access_key_id>
  OSS_ACCESS_KEY_SECRET=<your_access_key_secret>
```

#### 3. 配置 CDN 加速域名（推荐）

```bash
# OSS 控制台 → topseller-images → 传输管理 → 域名管理 → 绑定域名

域名配置：
  自定义域名：cdn.yourdomain.com
  自动配置 CNAME：cdn.yourdomain.com.w.kunlunsl.com

# 到你的域名 DNS 服务商（如阿里云 DNS）
添加 CNAME 记录：
  主机记录：cdn
  记录类型：CNAME
  记录值：topseller-images.oss-cn-shanghai.aliyuncs.com
  TTL：10分钟

开启 CDN 加速（可选）：
  OSS 控制台 → 传输管理 → CDN 加速 → 添加域名
  回源地址：topseller-images.oss-cn-shanghai.aliyuncs.com
  CDN 节点：中国境内
  HTTPS：免费证书（Let's Encrypt）
```

**为什么需要 CDN？**
- OSS 直连速度：50-100ms
- CDN 加速后：10-30ms（缓存命中）
- 降低 OSS 出站流量费用（CDN 流量更便宜）

#### 4. 服务端上传代码（阿里云 OSS）

```javascript
// server/upload.mjs
import OSS from 'ali-oss';
import { randomUUID } from 'crypto';
import multer from 'multer';

// 初始化 OSS 客户端
const oss = new OSS({
  region: process.env.OSS_REGION,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
});

// Multer 配置（接收前端文件）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('只允许上传图片'));
    }
    cb(null, true);
  },
});

// 上传接口
export default function uploadRoutes(app) {
  app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // 生成唯一文件名（按团队分目录）
      const ext = file.originalname.split('.').pop();
      const key = `${req.teamId}/${randomUUID()}.${ext}`;

      // 上传到 OSS
      const result = await oss.put(key, file.buffer, {
        headers: {
          'Content-Type': file.mimetype,
          'x-oss-meta-uploaded-by': req.username,
          'x-oss-meta-team-id': req.teamId,
        },
      });

      // 返回 CDN URL（如果配置了自定义域名）
      const url = process.env.OSS_CDN_URL
        ? `${process.env.OSS_CDN_URL}/${key}`
        : result.url; // 默认 OSS 域名

      res.json({ url, key });
    } catch (error) {
      console.error('Upload failed:', error);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  // 删除接口（清理未使用的图片）
  app.delete('/api/upload/:key(*)', requireAuth, async (req, res) => {
    try {
      const key = req.params.key;

      // 验证文件属于当前 team
      if (!key.startsWith(`${req.teamId}/`)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await oss.delete(key);

      res.json({ success: true });
    } catch (error) {
      console.error('Delete failed:', error);
      res.status(500).json({ error: 'Delete failed' });
    }
  });

  // 生成临时签名 URL（用于私有 Bucket）
  app.get('/api/sign-url', requireAuth, async (req, res) => {
    try {
      const { key } = req.query;

      // 验证文件属于当前 team
      if (!key.startsWith(`${req.teamId}/`)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // 生成 1 小时有效期的签名 URL
      const url = oss.signatureUrl(key, { expires: 3600 });

      res.json({ url });
    } catch (error) {
      res.status(500).json({ error: 'Sign failed' });
    }
  });
}
```

**OSS 图片处理（自动压缩和格式转换）**：

```javascript
// 上传时自动转 WebP 并压缩
app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  // ... 上传逻辑 ...

  // 返回带图片处理参数的 URL
  const processedUrl = `${url}?x-oss-process=image/format,webp/quality,q_80`;

  res.json({ url: processedUrl, key });
});
```

阿里云 OSS 图片处理参数：
- `image/format,webp` - 转 WebP 格式
- `image/quality,q_80` - 压缩质量 80%
- `image/resize,w_800` - 缩放宽度到 800px
- 组合：`image/resize,w_800/format,webp/quality,q_80`

#### 5. 前端上传代码

```typescript
// services/upload.ts

/**
 * 上传图片到 R2
 * 开发环境：返回 data URL
 * 生产环境：上传到 R2 并返回 CDN URL
 */
export async function uploadImage(file: File): Promise<string> {
  // 开发环境：直接转 data URL
  if (import.meta.env.DEV) {
    return fileToDataUrl(file);
  }

  // 生产环境：上传到 R2
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('上传失败');
  }

  const { url } = await response.json();
  return url;
}

/**
 * 将 data URL 迁移到 R2（用于生产环境）
 */
export async function migrateDataUrlToR2(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:')) {
    return dataUrl; // 已经是 CDN URL
  }

  if (import.meta.env.DEV) {
    return dataUrl; // 开发环境不迁移
  }

  // 转为 Blob 并上传
  const blob = await fetch(dataUrl).then(r => r.blob());
  const file = new File([blob], 'image.png', { type: blob.type });

  return uploadImage(file);
}

/**
 * 批量迁移（后台任务）
 */
export async function migrateBatchJobImages(job: BatchJob): Promise<BatchJob> {
  const updates: Partial<BatchJob> = {};

  // 迁移产品图
  if (job.productImageUrl?.startsWith('data:')) {
    updates.productImageUrl = await migrateDataUrlToR2(job.productImageUrl);
  }

  // 迁移模特图
  if (job.modelImageUrl?.startsWith('data:')) {
    updates.modelImageUrl = await migrateDataUrlToR2(job.modelImageUrl);
  }

  // 迁移参考图
  if (job.referenceImageUrl?.startsWith('data:')) {
    updates.referenceImageUrl = await migrateDataUrlToR2(job.referenceImageUrl);
  }

  // 迁移生成的图片
  const migratedSlots = await Promise.all(
    job.slots.map(async (slot) => {
      const migratedVersions = await Promise.all(
        slot.versions.map(async (v) => {
          if (v.imageUrl.startsWith('data:')) {
            return { ...v, imageUrl: await migrateDataUrlToR2(v.imageUrl) };
          }
          return v;
        })
      );
      return { ...slot, versions: migratedVersions };
    })
  );

  return { ...job, ...updates, slots: migratedSlots };
}
```

#### 6. .env 配置

```bash
# ===== 阿里云 OSS（国内推荐）=====
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=topseller-images
OSS_ACCESS_KEY_ID=your_access_key_id
OSS_ACCESS_KEY_SECRET=your_access_key_secret
OSS_CDN_URL=https://cdn.yourdomain.com  # 自定义 CDN 域名（可选）

# ===== Cloudflare R2（国际/无备案域名）=====
# R2_ACCOUNT_ID=your_account_id
# R2_ACCESS_KEY_ID=your_access_key_id
# R2_SECRET_ACCESS_KEY=your_secret_access_key
# R2_BUCKET_NAME=topseller-images
# R2_PUBLIC_URL=https://cdn.yourdomain.com
```

**依赖安装**：

```bash
# 阿里云 OSS
npm install ali-oss

# Cloudflare R2 (S3 兼容)
npm install @aws-sdk/client-s3
```

---

## 同步策略

### 乐观更新 + 后台同步

```typescript
// services/storage.ts

import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface StorageDB extends DBSchema {
  batchJobs: { key: string; value: BatchJob };
  sessions: { key: string; value: Session };
  models: { key: string; value: ModelCharacter };
  products: { key: string; value: ProductCatalogItem };
  syncQueue: { key: string; value: SyncTask };
}

interface SyncTask {
  id: string;
  type: 'create' | 'update' | 'delete';
  entity: 'batchJobs' | 'sessions' | 'models' | 'products';
  payload: any;
  retries: number;
  createdAt: number;
}

let db: IDBPDatabase<StorageDB>;
let syncTimer: number | null = null;

// 初始化数据库
export async function initStorage() {
  db = await openDB<StorageDB>('TopSellerStudio', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('batchJobs', { keyPath: 'id' });
        db.createObjectStore('sessions', { keyPath: 'id' });
        db.createObjectStore('models', { keyPath: 'id' });
        db.createObjectStore('products', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('syncQueue', { keyPath: 'id' });
      }
    },
  });

  // 启动时同步
  await syncFromRemote();

  // 启动后台同步任务
  startSyncWorker();
}

// 保存 BatchJob（本地 + 云端）
export async function saveBatchJobs(jobs: BatchJob[]) {
  // 1. 立即写本地（乐观更新）
  const tx = db.transaction('batchJobs', 'readwrite');
  await Promise.all([
    ...jobs.map(job => tx.store.put(job)),
    tx.done,
  ]);

  // 2. 加入同步队列（后台处理）
  if (isAuthenticated()) {
    for (const job of jobs) {
      await enqueueSyncTask({
        type: 'update',
        entity: 'batchJobs',
        payload: job,
      });
    }
  }
}

// 加入同步队列
async function enqueueSyncTask(task: Omit<SyncTask, 'id' | 'retries' | 'createdAt'>) {
  await db.put('syncQueue', {
    id: `${task.entity}-${task.payload.id}-${Date.now()}`,
    retries: 0,
    createdAt: Date.now(),
    ...task,
  });
}

// 后台同步工作线程
function startSyncWorker() {
  if (syncTimer) return;

  syncTimer = window.setInterval(async () => {
    if (!isAuthenticated()) return;

    const tasks = await db.getAll('syncQueue');
    if (tasks.length === 0) return;

    for (const task of tasks.slice(0, 10)) {  // 每次处理 10 个
      try {
        await executeSyncTask(task);
        await db.delete('syncQueue', task.id);
      } catch (error) {
        console.error('Sync failed:', error);

        // 重试机制
        if (task.retries < 3) {
          await db.put('syncQueue', { ...task, retries: task.retries + 1 });
        } else {
          // 放弃并记录错误
          console.error('Sync task failed after 3 retries:', task);
          await db.delete('syncQueue', task.id);
        }
      }
    }
  }, 5000);  // 每 5 秒同步一次
}

// 执行同步任务
async function executeSyncTask(task: SyncTask) {
  const endpoint = `/api/${task.entity}`;

  if (task.type === 'create' || task.type === 'update') {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task.payload),
    });

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.statusText}`);
    }
  } else if (task.type === 'delete') {
    const response = await fetch(`${endpoint}/${task.payload.id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.statusText}`);
    }
  }
}

// 从远程同步数据（启动时）
async function syncFromRemote() {
  if (!isAuthenticated()) return;

  try {
    // 并行拉取所有数据
    const [remoteBatchJobs, remoteSessions, remoteModels, remoteProducts] = await Promise.all([
      fetch('/api/batch-jobs').then(r => r.json()),
      fetch('/api/sessions').then(r => r.json()),
      fetch('/api/models').then(r => r.json()),
      fetch('/api/products').then(r => r.json()),
    ]);

    // 合并策略：以 updated_at 为准
    await mergeBatchJobs(remoteBatchJobs);
    await mergeSessions(remoteSessions);
    await mergeModels(remoteModels);
    await mergeProducts(remoteProducts);

    console.log('✅ Synced from remote');
  } catch (error) {
    console.error('Sync from remote failed:', error);
  }
}

// 合并 BatchJobs（本地优先，但以时间戳为准）
async function mergeBatchJobs(remote: BatchJob[]) {
  const local = await db.getAll('batchJobs');
  const localMap = new Map(local.map(j => [j.id, j]));
  const remoteMap = new Map(remote.map(j => [j.id, j]));

  const merged: BatchJob[] = [];

  // 本地有的
  for (const [id, localJob] of localMap) {
    const remoteJob = remoteMap.get(id);
    if (!remoteJob) {
      merged.push(localJob);  // 仅本地有，保留
    } else {
      // 两边都有，取最新的
      merged.push(
        localJob.updatedAt > remoteJob.updatedAt ? localJob : remoteJob
      );
    }
  }

  // 仅远程有的
  for (const [id, remoteJob] of remoteMap) {
    if (!localMap.has(id)) {
      merged.push(remoteJob);
    }
  }

  // 写回本地
  const tx = db.transaction('batchJobs', 'readwrite');
  await tx.store.clear();
  await Promise.all([
    ...merged.map(job => tx.store.put(job)),
    tx.done,
  ]);
}

// 判断是否已登录
function isAuthenticated(): boolean {
  return document.cookie.includes('auth_token=');
}
```

---

## 实施路线图

### Phase 1: 后端基础设施（2-3 天）

**目标**：搭建数据库 + API 框架，前端暂不改动

**任务**：
- [ ] 安装 Drizzle ORM + PostgreSQL 客户端
- [ ] 编写 Schema（teams, sessions, messages, batch_jobs, models, products）
- [ ] 实现 Auth 中间件（自动注入 teamId）
- [ ] 实现 CRUD API 路由：
  - [ ] `/api/sessions` (GET, POST, PUT, DELETE)
  - [ ] `/api/batch-jobs` (GET, POST, PUT, DELETE)
  - [ ] `/api/models` (GET, POST, DELETE)
  - [ ] `/api/products` (GET, POST, DELETE)
- [ ] Cloudflare R2 配置 + 上传接口 `/api/upload`
- [ ] 测试：Postman/curl 验证所有接口

**产出**：
- `server/db.mjs` - Drizzle 客户端
- `server/schema.mjs` - 数据库 Schema
- `server/routes/*.mjs` - API 路由
- `server/upload.mjs` - 图片上传

---

### Phase 2: 前端同步层（2-3 天）

**目标**：在前端添加云端同步能力，无感知切换

**任务**：
- [ ] 改造 `services/storage.ts`：
  - [ ] 添加 `syncQueue` 表
  - [ ] 实现 `enqueueSyncTask()` 和 `executeSyncTask()`
  - [ ] 实现 `syncFromRemote()` 合并逻辑
  - [ ] 启动时自动同步
- [ ] 改造 `services/upload.ts`：
  - [ ] 实现 `uploadImage()` - 生产环境上传 R2
  - [ ] 实现 `migrateDataUrlToR2()` - data URL 迁移
- [ ] 添加同步状态 UI：
  - [ ] `components/SyncStatus.tsx` - 同步指示器
  - [ ] 显示"同步中"、"已同步"、"同步失败"状态
- [ ] 测试：
  - [ ] 本地修改 → 自动同步到云端
  - [ ] 清除 IndexedDB → 重新登录 → 数据恢复
  - [ ] 离线修改 → 上线后自动同步

**产出**：
- 升级后的 `services/storage.ts`
- 新增 `services/upload.ts`
- 新增 `components/SyncStatus.tsx`

---

### Phase 3: 数据迁移 + 生产部署（1-2 天）

**目标**：现有用户数据无缝迁移到新系统

**任务**：
- [ ] 编写迁移脚本 `scripts/migrate.mjs`：
  - [ ] 从 IndexedDB 导出所有数据
  - [ ] 转换为新 Schema 格式
  - [ ] 批量上传到 PostgreSQL
  - [ ] data URL 图片迁移到 R2（可选，首次加载时懒迁移）
- [ ] 部署生产环境：
  - [ ] Railway/Render 部署后端
  - [ ] Neon/Supabase 部署 PostgreSQL
  - [ ] Cloudflare R2 配置生产 bucket
  - [ ] 配置自定义域名 CDN
- [ ] 回归测试：
  - [ ] 创建套图任务 → 同步到云端
  - [ ] 跨设备登录 → 数据一致
  - [ ] 离线使用 → 上线后同步

**产出**：
- `scripts/migrate.mjs` - 迁移脚本
- 生产环境部署清单
- 监控和报警配置

---

## 技术栈

### 数据库：PostgreSQL + Drizzle ORM

**为什么选 Drizzle？**
- TypeScript-first，类型安全
- 轻量（vs Prisma 生成大量代码）
- SQL-like API，易于理解

**安装**：

```bash
npm install drizzle-orm postgres
npm install -D drizzle-kit
```

**示例 Schema**：

```typescript
// server/schema.mjs
import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  ownerId: uuid('owner_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const batchJobs = pgTable('batch_jobs', {
  id: uuid('id').primaryKey(),
  teamId: uuid('team_id').references(() => teams.id).notNull(),
  title: text('title'),
  status: text('status'),
  basePrompt: text('base_prompt'),
  referenceImageUrl: text('reference_image_url'),
  productImageUrl: text('product_image_url'),
  modelImageUrl: text('model_image_url'),
  slots: jsonb('slots'),
  actionLogs: jsonb('action_logs'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  teamStatusIdx: index('idx_team_status').on(table.teamId, table.status),
  updatedIdx: index('idx_updated').on(table.teamId, table.updatedAt),
}));
```

**生成迁移**：

```bash
npx drizzle-kit generate:pg
npx drizzle-kit push:pg
```

---

## 成本估算（100 活跃用户场景）

### 方案 A：国内全栈（推荐）

| 服务 | 方案 | 月成本 |
|------|------|--------|
| 服务器 | 阿里云 ECS (2核4G) | ¥100 ($14) |
| 数据库 | 阿里云 RDS PostgreSQL (1核2G) | ¥300 ($42) |
| 图片存储 | 阿里云 OSS (100GB 存储 + 100GB CDN 流量) | ¥22 ($3) |
| **总计** | | **¥422/月 ($59)** |

**优化后**（使用优惠和资源包）：
- ECS 包年优惠：¥100 → ¥60/月
- RDS 改用 PolarDB Serverless：¥300 → ¥100/月（按量付费）
- OSS 流量包：¥24 → ¥16/月
- **总计：¥176/月 ($25)** ✅

---

### 方案 B：国内自建（最低成本）

| 服务 | 方案 | 月成本 |
|------|------|--------|
| 服务器 | 腾讯云轻量服务器 (2核4G 6M) | ¥112 ($16) |
| 数据库 | 同服务器 Docker PostgreSQL | ¥0 |
| 图片存储 | 七牛云 (10GB 免费 + 买流量包) | ¥16 ($2.2) |
| **总计** | | **¥128/月 ($18)** |

**优点**：
- 成本最低
- 适合初期验证

**缺点**：
- 数据库无托管，需自己维护
- 服务器压力大时需手动扩容

---

### 方案 C：国际方案（无备案域名）

| 服务 | 方案 | 月成本 |
|------|------|--------|
| 数据库 | Neon Postgres (10GB) | $19 |
| 图片存储 | Cloudflare R2 (100GB) | $1.50 |
| 服务器 | Railway (512MB) | $5 |
| **总计** | | **$25.50/月** |

**优点**：
- 无需备案
- 部署快速（5 分钟上线）
- 适合海外用户

**缺点**：
- 国内访问可能不稳定
- R2 在国内有时被墙

---

### 方案推荐

| 场景 | 推荐方案 | 月成本 | 理由 |
|------|---------|--------|------|
| **国内商业化运营** | 方案 A（优化后） | ¥176 ($25) | 稳定、快速、可扩展 |
| **个人/小团队验证** | 方案 B | ¥128 ($18) | 成本最低，够用 |
| **海外用户为主** | 方案 C | $25.50 | 无需备案，全球加速 |
| **无备案域名临时方案** | 方案 C | $25.50 | 快速上线 |

**最终推荐**：
- 🏆 **方案 A（优化后）** - 国内生产环境首选
- 💰 **方案 B** - 成本敏感型选择
- 🌍 **方案 C** - 海外/无备案场景

---

## 监控和维护

### 监控指标

- [ ] 同步队列长度（超过 100 条报警）
- [ ] 同步失败率（超过 5% 报警）
- [ ] R2 上传失败率
- [ ] API 响应时间（P95 < 500ms）
- [ ] 数据库连接池使用率

### 日志记录

```javascript
// server/logger.mjs
import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// 记录同步失败
logger.error('Sync failed', {
  userId: req.userId,
  teamId: req.teamId,
  entity: 'batchJobs',
  error: error.message,
});
```

---

## 后续优化（Phase 4+）

### 短期（1-3 个月）

- [ ] 图片懒加载和渐进式加载
- [ ] R2 图片 CDN 缓存优化
- [ ] 同步冲突解决 UI（目前以时间戳为准）
- [ ] 离线状态提示
- [ ] 同步进度条（首次同步大量数据）

### 长期（3-6 个月）

- [ ] 真正的多人协作（邀请成员）
- [ ] 实时协作（WebSocket 同步）
- [ ] 版本历史和回滚
- [ ] 批量操作优化（压缩请求）
- [ ] 图片自动压缩和 WebP 转换

---

## 风险和应对

| 风险 | 影响 | 应对方案 |
|------|------|---------|
| 数据库迁移失败 | 高 | 灰度发布，保留本地 IndexedDB 作为回退 |
| R2 上传超时 | 中 | 重试机制 + 降级到 data URL |
| 同步冲突（多设备） | 中 | Last-Write-Wins + 冲突提示 UI |
| IndexedDB 配额不足 | 低 | 自动清理旧数据 + 提示用户 |
| 网络不稳定导致同步卡顿 | 低 | 队列持久化 + 指数退避重试 |

---

## 附录 A：阿里云 OSS 配置检查清单（国内推荐）

### ✅ Step 1: 创建 Bucket

- [ ] 登录 [阿里云 OSS 控制台](https://oss.console.aliyun.com)
- [ ] Bucket 列表 → 创建 Bucket
- [ ] 配置项：
  - Bucket 名称：`topseller-images`
  - 地域：华东2（上海）
  - 存储类型：标准存储
  - 读写权限：私有
  - 服务端加密：AES256（可选）
- [ ] 记录 Bucket 信息到 `.env`

### ✅ Step 2: 创建 RAM 子账号（最小权限）

- [ ] 控制台 → 访问控制（RAM）→ 用户 → 创建用户
- [ ] 登录名称：`topseller-oss-uploader`
- [ ] 访问方式：✅ OpenAPI 调用访问
- [ ] 创建自定义权限策略：
  ```json
  {
    "Version": "1",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["oss:PutObject", "oss:GetObject", "oss:DeleteObject"],
        "Resource": ["acs:oss:*:*:topseller-images/*"]
      }
    ]
  }
  ```
- [ ] 保存 AccessKey 到 `.env`：
  ```bash
  OSS_ACCESS_KEY_ID=xxxxxx
  OSS_ACCESS_KEY_SECRET=xxxxxx
  ```

### ✅ Step 3: 配置 CDN 加速域名

- [ ] OSS 控制台 → topseller-images → 传输管理 → 域名管理
- [ ] 绑定域名：`cdn.yourdomain.com`
- [ ] 到域名 DNS 服务商添加 CNAME 记录：
  - 主机记录：`cdn`
  - 记录类型：`CNAME`
  - 记录值：`topseller-images.oss-cn-shanghai.aliyuncs.com`
- [ ] （可选）开启 CDN 加速：
  - OSS 控制台 → 传输管理 → CDN 加速
  - 添加加速域名
  - 自动申请免费 HTTPS 证书
- [ ] 记录 CDN URL 到 `.env`：
  ```bash
  OSS_CDN_URL=https://cdn.yourdomain.com
  ```

### ✅ Step 4: 配置跨域（CORS）

- [ ] OSS 控制台 → topseller-images → 权限管理 → 跨域设置
- [ ] 创建规则：
  ```
  来源：https://yourdomain.com, http://localhost:3000
  允许 Methods：GET, POST, PUT, DELETE, HEAD
  允许 Headers：*
  暴露 Headers：ETag, x-oss-request-id
  缓存时间：3600 秒
  ```

### ✅ Step 5: 测试上传

```bash
# 安装阿里云 CLI（可选）
npm install -g @alicloud/cli

# 或使用 ossutil 工具
wget http://gosspublic.alicdn.com/ossutil/1.7.14/ossutil64
chmod +x ossutil64

./ossutil64 config
# 按提示输入 Endpoint、AccessKeyId、AccessKeySecret

# 测试上传
./ossutil64 cp test.jpg oss://topseller-images/test/test.jpg

# 验证文件
./ossutil64 ls oss://topseller-images/test/
```

---

## 附录 B：Cloudflare R2 配置检查清单（国际方案）

### ✅ 创建 Bucket

- [ ] 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
- [ ] 进入 R2 → Create bucket
- [ ] Bucket 名称：`topseller-images`
- [ ] 记录 Bucket 名称到 `.env`

### ✅ 创建 API Token

- [ ] R2 → Manage R2 API Tokens → Create API Token
- [ ] 权限：Read & Write
- [ ] 范围：仅限 `topseller-images` bucket
- [ ] 保存以下信息到 `.env`：
  ```bash
  R2_ACCOUNT_ID=xxxxxx
  R2_ACCESS_KEY_ID=xxxxxx
  R2_SECRET_ACCESS_KEY=xxxxxx
  R2_BUCKET_NAME=topseller-images
  ```

### ✅ 配置自定义域名

- [ ] Bucket Settings → Public Access → Custom Domains
- [ ] 添加域名：`cdn.yourdomain.com`
- [ ] Cloudflare 自动配置 DNS CNAME
- [ ] 记录 CDN URL 到 `.env`：
  ```bash
  R2_PUBLIC_URL=https://cdn.yourdomain.com
  ```

### ✅ CORS 配置

```json
// Bucket Settings → CORS Policy
[
  {
    "AllowedOrigins": ["https://yourdomain.com", "http://localhost:3000"],
    "AllowedMethods": ["GET", "POST", "PUT", "DELETE"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## 附录 C：国内其他存储方案对比

### 腾讯云 COS

**优点**：
- 价格略低于阿里云（¥0.099/GB 存储）
- 6 个月免费 50GB 存储
- CDN 与腾讯云 CDN 深度集成

**缺点**：
- 生态不如阿里云完善
- 图片处理功能较弱

**配置步骤**：
```bash
# 安装 SDK
npm install cos-nodejs-sdk-v5

# 代码示例
const COS = require('cos-nodejs-sdk-v5');
const cos = new COS({
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY,
});

// 上传文件
cos.putObject({
  Bucket: 'topseller-images-1234567890',
  Region: 'ap-shanghai',
  Key: 'path/to/file.jpg',
  Body: buffer,
});
```

---

### 七牛云 Kodo

**优点**：
- 10GB 免费存储 + 10GB 免费流量
- 图片处理功能强大（Fop）
- 适合小规模项目

**缺点**：
- 企业级稳定性不如阿里云/腾讯云
- CDN 流量略贵（¥0.28/GB）

**配置步骤**：
```bash
# 安装 SDK
npm install qiniu

# 代码示例
const qiniu = require('qiniu');
const mac = new qiniu.auth.digest.Mac(
  process.env.QINIU_ACCESS_KEY,
  process.env.QINIU_SECRET_KEY
);

const config = new qiniu.conf.Config({ zone: qiniu.zone.Zone_z2 });
const formUploader = new qiniu.form_up.FormUploader(config);

// 生成上传凭证
const putPolicy = new qiniu.rs.PutPolicy({
  scope: 'topseller-images',
});
const uploadToken = putPolicy.uploadToken(mac);

// 上传文件
formUploader.put(uploadToken, key, buffer, null, (err, body, info) => {
  // ...
});
```

---

## 下一步行动

1. **确认方案**：是否按推荐方案（混合存储 + 简化 Team + Drizzle + R2）实施？
2. **时间规划**：预计 1-2 周完成所有 3 个 Phase
3. **优先级**：先做 Phase 1（后端 API）还是先做 R2 配置？

需要我开始实施 Phase 1（搭建后端 API）吗？
