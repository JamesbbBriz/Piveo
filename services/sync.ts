/**
 * SyncService — Server-first with IndexedDB cache fallback.
 *
 * Write: IndexedDB first (instant) -> async queue to server
 * Read: Server first -> fallback to IndexedDB cache
 *
 * Images: data URL images are uploaded as blobs before saving to server.
 * An in-memory cache prevents re-uploading the same image within a session.
 */

import type { BatchJob } from "@/types";
import { addPendingSyncId, removePendingSyncId, getPendingSyncIds } from "./storage";

const FAILED_OPS_MAX = 100;

export interface SyncStatus {
  /** 当前还在 syncQueue + offlineQueue 中等待发送的项数（瞬时） */
  pending: number;
  /** withRetry 耗尽后写入 localStorage 的 project/batchJob ID 数（持久） */
  failed: number;
  /** 最近一次 sync 失败的错误信息，UI 可以悬停展示 */
  lastError: string | null;
  /** 上次成功 flush 的时间戳；用于"刚刚保存"提示 */
  lastSyncedAt: number | null;
  /** IDB / localStorage 配额满，本地保存失效——这是最高优先级的红条提示 */
  quotaExceeded: boolean;
}

interface FailedOp {
  key: string;
  url: string;
  method: string;
  body: string;
  ts: number;
}

class SyncService {
  private userId: string | null = null;
  private syncQueue: Map<string, () => Promise<void>> = new Map();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isOnline: boolean = typeof navigator !== "undefined" ? navigator.onLine : true;
  private offlineQueue: Array<() => Promise<void>> = [];
  /** Cache: data URL fingerprint → blob { id, url } */
  private blobCache = new Map<string, { id: string; url: string }>();
  /** Callback fired after images are uploaded, providing dataUrl → blobUrl replacements */
  private onImagesUploaded?: (type: 'project' | 'batch', id: string, replacements: Map<string, string>) => void;
  /** Sync 状态订阅者；UI 用它显示"未同步：N 项"。 */
  private onSyncStatusChange?: (status: SyncStatus) => void;
  private lastError: string | null = null;
  private lastSyncedAt: number | null = null;
  private quotaExceeded: boolean = false;

  // ⑥ 多 tab 防覆盖：本 tab 写入后广播，其他 tab 拉取最新。
  // 只在浏览器支持 BroadcastChannel 时启用（Safari < 15.4 无；rare）。
  private tabId: string =
    typeof crypto !== "undefined" && (crypto as any).randomUUID
      ? (crypto as any).randomUUID()
      : `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  private bc: BroadcastChannel | null = null;
  private onRemoteProjectChanged?: (id: string) => void;

  setOnRemoteProjectChanged(cb: (id: string) => void): void {
    this.onRemoteProjectChanged = cb;
  }

  private handleBroadcast(msg: any): void {
    if (!msg || typeof msg !== "object") return;
    if (msg.from === this.tabId) return; // 别响应自己发的
    if (msg.kind === "project_saved" && typeof msg.id === "string") {
      // 异步触发 refetch；处理函数在 AppContext 里实现
      this.onRemoteProjectChanged?.(msg.id);
    }
  }

  private broadcast(msg: any): void {
    if (!this.bc) return;
    try {
      this.bc.postMessage({ ...msg, from: this.tabId });
    } catch {
      // BroadcastChannel postMessage 在浏览器关闭瞬间可能 throw，吞掉
    }
  }

  /** 由 AppContext 在 storage.setOnStorageQuotaExceeded 回调里调用 */
  markQuotaExceeded(): void {
    if (this.quotaExceeded) return;
    this.quotaExceeded = true;
    this.emitStatus();
  }

  setOnImagesUploaded(cb: (type: 'project' | 'batch', id: string, replacements: Map<string, string>) => void) {
    this.onImagesUploaded = cb;
  }

  setOnSyncStatusChange(cb: (status: SyncStatus) => void): void {
    this.onSyncStatusChange = cb;
    // 初始推一次，UI 可以拿到当前 failed 计数
    this.emitStatus();
  }

  private emitStatus(): void {
    if (!this.onSyncStatusChange) return;
    const failed = getPendingSyncIds("projects").length + getPendingSyncIds("batch_jobs").length;
    this.onSyncStatusChange({
      pending: this.syncQueue.size + this.offlineQueue.length,
      failed,
      lastError: this.lastError,
      lastSyncedAt: this.lastSyncedAt,
      quotaExceeded: this.quotaExceeded,
    });
  }

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        this.isOnline = true;
        this.drainOfflineQueue();
        this.drainFailedOps();
      });
      window.addEventListener("offline", () => {
        this.isOnline = false;
      });
    }
  }

  /** Clear all internal state — call before switching users */
  reset(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.syncQueue.clear();
    this.offlineQueue = [];
    this.blobCache.clear();
    this.lastError = null;
    this.lastSyncedAt = null;
    if (this.bc) {
      try { this.bc.close(); } catch { /* ignore */ }
      this.bc = null;
    }
    this.userId = null;
  }

  init(userId: string): void {
    this.reset();
    this.userId = userId;
    // ⑥ 每个用户独立 channel，防止串账号
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.bc = new BroadcastChannel(`nanobanana_sync_${userId}`);
        this.bc.onmessage = (ev) => this.handleBroadcast(ev.data);
      } catch {
        // 创建失败就退化成单 tab；不影响主功能
      }
    }
    this.drainFailedOps();
    this.emitStatus();
  }

  /** 给 AppContext 用：拿到当前 user 还有哪些项目/矩阵任务 sync 没成功 */
  getPendingProjectIds(): string[] {
    return getPendingSyncIds("projects");
  }

  getPendingBatchJobIds(): string[] {
    return getPendingSyncIds("batch_jobs");
  }

  /** Per-user localStorage key for failed sync ops */
  private get failedOpsKey(): string {
    return `nanobanana_failed_sync_ops_${this.userId || "anon"}`;
  }

  // ——— Pull ———

  async pullAll(activeSessionId?: string | null): Promise<{
    projects: any[];
    models: any[];
    products: any[];
    templates: any[];
    preferences: any;
    teams: any[];
    batchJobs: any[];
    brandKits: any[];
    /** 当传入 activeSessionId 时，并行拉它的 chat_history_json，省一次首屏往返 */
    activeSessionMessages?: any[] | null;
  }> {
    // 把活跃会话的 messages 跟列表请求并行拉，首屏就能把当前 session 完整渲染出来，
    // 不再依赖 lazy-load effect 跑完才显示——一次往返直接到位。
    // 拿不到也不会让整个 pullAll 失败，单独 try/catch 包住。
    const activeMessagesPromise: Promise<any[] | null> = activeSessionId
      ? this.fetchJson<{ chat_history_json: string }>(`/api/data/projects/${activeSessionId}/messages`)
          .then((r) => {
            if (!r?.chat_history_json) return [];
            try { return JSON.parse(r.chat_history_json); } catch { return []; }
          })
          .catch(() => null)
      : Promise.resolve(null);

    const [projects, models, products, templates, preferences, teams, batchJobs, brandKits, activeSessionMessages] = await Promise.all([
      this.fetchJson<{ projects: any[] }>("/api/data/projects").then((r) => r.projects ?? []),
      this.fetchJson<{ models: any[] }>("/api/data/models").then((r) => r.models ?? []),
      this.fetchJson<{ products: any[] }>("/api/data/products").then((r) => r.products ?? []),
      this.fetchJson<{ templates: any[] }>("/api/data/templates").then((r) => r.templates ?? []),
      this.fetchJson<{ preferences: any }>("/api/data/preferences").then((r) => r.preferences ?? null),
      this.fetchJson<{ teams: any[] }>("/api/data/teams").then((r) => r.teams ?? []),
      this.fetchJson<{ batchJobs: any[] }>("/api/data/batch-jobs").then((r) => r.batchJobs ?? []),
      this.fetchJson<{ brandKits: any[] }>("/api/data/brand-kits").then((r) => r.brandKits ?? []),
      activeMessagesPromise,
    ]);
    return { projects, models, products, templates, preferences, teams, batchJobs, brandKits, activeSessionMessages };
  }

  async pullProjectMessages(projectId: string): Promise<any[]> {
    const data = await this.fetchJson<{ chat_history_json: string }>(`/api/data/projects/${projectId}/messages`);
    if (data.chat_history_json) {
      try {
        return JSON.parse(data.chat_history_json);
      } catch {
        return [];
      }
    }
    return [];
  }

  async pullSince(since: number): Promise<any> {
    return this.fetchJson("/api/data/sync/pull", {
      method: "POST",
      body: JSON.stringify({ since }),
    });
  }

  // ——— Projects ———

  async saveProject(project: any): Promise<void> {
    // Hard guard: only push when messagesLoaded is explicitly true. A session
    // whose chat history hasn't been lazy-loaded (false) OR whose flag is
    // missing (undefined, e.g. legacy IndexedDB data) has messages: [] as a
    // placeholder, not real state — pushing would wipe server chat_history_json.
    if (project?.messagesLoaded !== true) {
      console.warn(`[Sync] skip saveProject(${project?.id}): messagesLoaded=${project?.messagesLoaded}`);
      return;
    }
    this.queueSync(`project:${project.id}`, async () => {
      const messages = project.messages ?? project.chatHistory ?? [];
      const { messages: processedMessages, uploaded, failedCount } = await this.processMessagesImages(messages);

      // Fire callback to write blob URLs back into local state
      if (this.onImagesUploaded && uploaded.size > 0) {
        const replacements = new Map<string, string>();
        for (const [dataUrl, { url }] of uploaded) {
          replacements.set(dataUrl, url);
        }
        this.onImagesUploaded('project', project.id, replacements);
      }

      // 任一图片上传失败都放弃本次 PUT：宁可保留本地 dataURL 等待下次 debounced
      // 重试，也不把内联 base64 写进 chat_history_json。历史原因：单条 session
      // 一旦膨胀到 >10MB，lazy-load 会失败，刷新后整段聊天历史"消失"。
      if (failedCount > 0) {
        throw new Error(
          `图片上传未完成（失败 ${failedCount} 张），已放弃本次保存以避免数据膨胀；将在下次变更时重试。`
        );
      }

      // Handle productImage in settings
      let settings = project.settings ?? {};
      if (settings.productImage?.startsWith("data:")) {
        const result = await this.uploadDataUrl(settings.productImage);
        if (result) {
          settings = { ...settings, productImage: result.url };
        } else {
          throw new Error("产品图上传失败，已放弃本次保存以避免 settings 泄漏 base64。");
        }
      }

      await this.fetchJson(`/api/data/projects/${project.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: project.title ?? "",
          settings_json: JSON.stringify(settings),
          chat_history_json: JSON.stringify(processedMessages),
          batch_config_json: project.batchConfig ? JSON.stringify(project.batchConfig) : null,
          team_id: project.teamId ?? null,
        }),
      });
      // 成功了：从待同步注册表里摘掉，让 UI 的"未同步：N 项"自动减
      removePendingSyncId("projects", project.id);
      this.emitStatus();
      // ⑥ 广播给同账号其他 tab，让它们 refetch 这个 session 防覆盖
      this.broadcast({ kind: "project_saved", id: project.id });
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    this.queueSync(`project:${projectId}`, () =>
      this.fetchJson(`/api/data/projects/${projectId}`, { method: "DELETE" }).then(() => {
        removePendingSyncId("projects", projectId);
        this.emitStatus();
      }),
    );
  }

  // ——— Batch Jobs ———

  async saveBatchJob(job: BatchJob): Promise<void> {
    this.queueSync(`batchjob:${job.id}`, async () => {
      const { slots: processedSlots, uploaded, failedCount } = await this.processBatchSlotImages(job.slots);

      // Fire callback to write blob URLs back into local state
      if (this.onImagesUploaded && uploaded.size > 0) {
        const replacements = new Map<string, string>();
        for (const [dataUrl, { url }] of uploaded) {
          replacements.set(dataUrl, url);
        }
        this.onImagesUploaded('batch', job.id, replacements);
      }

      // 与 saveProject 一致：任一图片上传失败即放弃本次保存
      if (failedCount > 0) {
        throw new Error(
          `矩阵图片上传未完成（失败 ${failedCount} 张），已放弃本次保存；将在下次变更时重试。`
        );
      }

      const refUrl = await this.maybeUploadDataUrl(job.referenceImageUrl);
      const prodUrl = await this.maybeUploadDataUrl(job.productImageUrl);
      const modelUrl = await this.maybeUploadDataUrl(job.modelImageUrl);

      await this.fetchJson(`/api/data/batch-jobs/${job.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: job.title ?? "",
          status: job.status,
          base_prompt: job.basePrompt ?? "",
          project_id: job.projectId ?? null,
          product_id: job.productId ?? null,
          reference_image_url: refUrl,
          product_image_url: prodUrl,
          model_image_url: modelUrl,
          slots_json: JSON.stringify(processedSlots),
          action_logs_json: JSON.stringify(job.actionLogs ?? []),
          tags_json: JSON.stringify(job.tags ?? []),
          team_id: null,
          archived_at: job.archivedAt ?? null,
          deleted_at: job.deletedAt ?? null,
        }),
      });
      removePendingSyncId("batch_jobs", job.id);
      this.emitStatus();
    });
  }

  async deleteBatchJob(jobId: string): Promise<void> {
    this.queueSync(`batchjob:${jobId}`, () =>
      this.fetchJson(`/api/data/batch-jobs/${jobId}`, { method: "DELETE" }).then(() => {
        removePendingSyncId("batch_jobs", jobId);
        this.emitStatus();
      }),
    );
  }

  // ——— Models ———

  async saveModel(model: any, teamId?: string): Promise<void> {
    let blobId = model.blobId ?? null;
    if (model.imageUrl && !blobId) {
      if (model.imageUrl.startsWith("data:")) {
        const result = await this.uploadDataUrl(model.imageUrl);
        if (result) blobId = result.id;
      } else if (/^https?:\/\//i.test(model.imageUrl)) {
        // HTTP URL (e.g. temporary signed URL from API) — download and re-upload to blob storage
        try {
          const resp = await fetch(model.imageUrl);
          if (resp.ok) {
            const blob = await resp.blob();
            const reader = new FileReader();
            const dataUrl: string = await new Promise((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            const result = await this.uploadDataUrl(dataUrl);
            if (result) blobId = result.id;
          }
        } catch (e) {
          console.warn("[Sync] 模特图 HTTP URL 下载失败:", e);
        }
      }
    }
    this.queueSync(`model:${model.id}`, () =>
      this.fetchJson(`/api/data/models/${model.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: model.name,
          blob_id: blobId,
          team_id: teamId ?? null,
        }),
      }).then(() => {}),
    );
  }

  async deleteModel(modelId: string): Promise<void> {
    this.queueSync(`model:${modelId}`, () =>
      this.fetchJson(`/api/data/models/${modelId}`, { method: "DELETE" }).then(() => {}),
    );
  }

  // ——— Products ———

  async saveProduct(product: any, teamId?: string): Promise<void> {
    let blobId = product.blobId ?? null;
    if (product.imageUrl?.startsWith("data:") && !blobId) {
      const result = await this.uploadDataUrl(product.imageUrl);
      if (result) blobId = result.id;
    }
    this.queueSync(`product:${product.id}`, () =>
      this.fetchJson(`/api/data/products/${product.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: product.name,
          blob_id: blobId,
          team_id: teamId ?? null,
          category: product.category ?? null,
          dimensions_json: product.dimensions ? JSON.stringify(product.dimensions) : null,
          size: product.size ?? null,
          description: product.description ?? null,
        }),
      }).then(() => {}),
    );
  }

  async deleteProduct(productId: string): Promise<void> {
    this.queueSync(`product:${productId}`, () =>
      this.fetchJson(`/api/data/products/${productId}`, { method: "DELETE" }).then(() => {}),
    );
  }

  // ——— Templates (bulk) ———

  async saveTemplates(templates: any[], teamId?: string): Promise<void> {
    this.queueSync("templates", () =>
      this.fetchJson("/api/data/templates", {
        method: "PUT",
        body: JSON.stringify({ templates, team_id: teamId ?? null }),
      }).then(() => {}),
    );
  }

  // ——— Preferences ———

  async savePreferences(prefs: any): Promise<void> {
    this.queueSync("preferences", () =>
      this.fetchJson("/api/data/preferences", {
        method: "PUT",
        body: JSON.stringify(prefs),
      }).then(() => {}),
    );
  }

  // ——— Brand Kits ———

  async fetchBrandKits(): Promise<any[]> {
    const res = await this.fetchJson<{ brandKits: any[] }>("/api/data/brand-kits");
    return res.brandKits ?? [];
  }

  async saveBrandKit(kit: any): Promise<void> {
    this.queueSync(`brandkit:${kit.id}`, async () => {
      // Upload reference images if they are data URLs
      const processedImages: any[] = [];
      if (Array.isArray(kit.images)) {
        for (const img of kit.images) {
          let blobId = img.blobId ?? null;
          if (img.imageUrl?.startsWith("data:") && !blobId) {
            const result = await this.uploadDataUrl(img.imageUrl);
            if (result) blobId = result.id;
          }
          processedImages.push({
            id: img.id,
            blob_id: blobId,
            image_type: img.imageType ?? "reference",
            sort_order: img.sortOrder ?? 0,
          });
        }
      }

      await this.fetchJson(`/api/data/brand-kits/${kit.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: kit.name ?? "默认品牌",
          description: kit.description ?? null,
          style_keywords: JSON.stringify(kit.styleKeywords ?? []),
          color_palette_json: JSON.stringify(kit.colorPalette ?? []),
          mood_keywords: JSON.stringify(kit.moodKeywords ?? []),
          is_active: kit.isActive ? 1 : 0,
          team_id: kit.teamId ?? null,
        }),
      });

      // Update images separately
      if (processedImages.length > 0) {
        await this.fetchJson(`/api/data/brand-kits/${kit.id}/images`, {
          method: "PUT",
          body: JSON.stringify({ images: processedImages }),
        });
      }
    });
  }

  async deleteBrandKit(kitId: string): Promise<void> {
    this.queueSync(`brandkit:${kitId}`, () =>
      this.fetchJson(`/api/data/brand-kits/${kitId}`, { method: "DELETE" }).then(() => {}),
    );
  }

  async activateBrandKit(kitId: string): Promise<void> {
    await this.fetchJson(`/api/data/brand-kits/${kitId}/activate`, { method: "POST" });
  }

  // ——— Brand Taste Ratings ———

  async fetchBrandKitRatings(kitId: string): Promise<any[]> {
    const res = await this.fetchJson<{ ratings: any[] }>(`/api/data/brand-kits/${kitId}/ratings`);
    return res.ratings ?? [];
  }

  async saveBrandTasteRating(kitId: string, rating: any): Promise<void> {
    let blobId = rating.blobId ?? null;
    let imageUrl = rating.imageUrl ?? null;
    if (imageUrl?.startsWith("data:") && !blobId) {
      const result = await this.uploadDataUrl(imageUrl);
      if (result) {
        blobId = result.id;
        imageUrl = result.url;
      }
    }
    await this.fetchJson(`/api/data/brand-kits/${kitId}/ratings/${rating.id}`, {
      method: "PUT",
      body: JSON.stringify({
        blob_id: blobId,
        image_url: imageUrl,
        prompt: rating.prompt ?? null,
        model: rating.model ?? null,
        rating: rating.rating,
      }),
    });
  }

  async deleteBrandTasteRating(kitId: string, ratingId: string): Promise<void> {
    await this.fetchJson(`/api/data/brand-kits/${kitId}/ratings/${ratingId}`, { method: "DELETE" });
  }

  async saveTasteProfile(kitId: string, profile: any): Promise<void> {
    await this.fetchJson(`/api/data/brand-kits/${kitId}/taste-profile`, {
      method: "PUT",
      body: JSON.stringify({
        taste_profile_json: profile ? JSON.stringify(profile) : null,
      }),
    });
  }

  // ——— Blobs ———

  async uploadImage(base64: string, contentType?: string): Promise<{ id: string; url: string }> {
    // Strip data URI prefix if present
    const raw = base64.includes(",") ? base64.split(",")[1] : base64;
    return await this.withRetry(() =>
      this.fetchJson<{ id: string; url: string }>("/api/data/blobs", {
        method: "POST",
        body: JSON.stringify({ data: raw, contentType: contentType ?? "image/png" }),
      }),
    );
  }

  /**
   * 把任意外部图片 URL（上游返回的 http(s) URL）持久化为本站 blob URL。
   * 失败时抛错，由调用方决定降级策略（使用 data URL 或原 URL）。
   * 目的：让 chat message 从诞生起就只携带 `/api/data/blobs/<id>` 引用，
   * 避免 base64 临时内联带来的 chat_history_json 膨胀 + lazy-load 失败。
   */
  async remoteUrlToBlobUrl(remoteUrl: string): Promise<string> {
    if (!/^https?:\/\//i.test(remoteUrl)) return remoteUrl;
    const proxyUrl = `/auth/image-proxy?url=${encodeURIComponent(remoteUrl)}`;
    const resp = await fetch(proxyUrl, { credentials: "include" });
    if (!resp.ok) throw new Error(`远程图片下载失败：HTTP ${resp.status}`);
    const blob = await resp.blob();
    const contentType = blob.type || "image/png";
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("FileReader 返回非字符串"));
      };
      reader.onerror = () => reject(new Error("读取 Blob 失败"));
      reader.readAsDataURL(blob);
    });
    const result = await this.uploadImage(dataUrl, contentType);
    return result.url;
  }

  // ——— Admin (super admin only) ———

  async createUser(username: string, password: string, displayName?: string): Promise<any> {
    const res = await this.fetchJson<{ user: any }>("/api/data/users", {
      method: "POST",
      body: JSON.stringify({ username, password, displayName: displayName || undefined }),
    });
    return res.user;
  }

  async updateUserQuota(userId: string, monthlyLimit: number, dailyLimit: number): Promise<void> {
    await this.fetchJson(`/api/data/users/${userId}/quota`, {
      method: "PUT",
      body: JSON.stringify({ monthlyLimit, dailyLimit }),
    });
  }

  async backfillUsage(userId: string, count: number, model?: string): Promise<{ inserted: number }> {
    return this.fetchJson(`/api/data/users/${userId}/usage-backfill`, {
      method: "POST",
      body: JSON.stringify({ count, model: model || null }),
    });
  }

  async fetchMyUsage(): Promise<{ monthlyPercent: number; dailyPercent: number }> {
    const res = await this.fetchJson<{ usage: { monthlyPercent: number; dailyPercent: number } }>("/api/data/usage/me");
    return res.usage;
  }

  async fetchAllUsers(): Promise<any[]> {
    const res = await this.fetchJson<{ users: any[] }>("/api/data/users");
    return res.users ?? [];
  }

  async fetchAllTeams(): Promise<any[]> {
    const res = await this.fetchJson<{ teams: any[] }>("/api/data/teams?all=true");
    return res.teams ?? [];
  }

  async fetchAllProjects(): Promise<any[]> {
    const res = await this.fetchJson<{ projects: any[] }>("/api/data/projects?all=true");
    return res.projects ?? [];
  }

  // ——— Default Templates (admin-managed system defaults) ———

  async fetchDefaultTemplates(): Promise<any[]> {
    const res = await this.fetchJson<{ templates: any[] }>("/api/data/default-templates");
    return res.templates ?? [];
  }

  async fetchAdminDefaultTemplates(): Promise<any[]> {
    const res = await this.fetchJson<{ templates: any[] }>("/api/data/admin/default-templates");
    return res.templates ?? [];
  }

  async saveAdminDefaultTemplates(templates: any[]): Promise<void> {
    await this.fetchJson("/api/data/admin/default-templates", {
      method: "PUT",
      body: JSON.stringify({ templates }),
    });
  }

  async addAdminDefaultTemplate(name: string, content: string, isFeatured?: boolean): Promise<any> {
    const res = await this.fetchJson<{ template: any }>("/api/data/admin/default-templates", {
      method: "POST",
      body: JSON.stringify({ name, content, is_featured: isFeatured ? 1 : 0 }),
    });
    return res.template;
  }

  async deleteAdminDefaultTemplate(id: string): Promise<void> {
    await this.fetchJson(`/api/data/admin/default-templates/${id}`, { method: "DELETE" });
  }

  // ——— Providers (super admin) ———

  async fetchProviders(): Promise<any[]> {
    const res = await this.fetchJson<{ providers: any[] }>("/api/data/providers");
    return res.providers ?? [];
  }

  async activateProvider(id: string): Promise<void> {
    await this.fetchJson(`/api/data/providers/${id}/activate`, { method: "POST" });
  }

  async fetchProviderModels(id: string): Promise<string[]> {
    const res = await this.fetchJson<{ models: string[] }>(`/api/data/providers/${id}/models`, {
      method: "POST",
    });
    return res.models ?? [];
  }

  async updateProviderAllowedModels(id: string, models: string[]): Promise<void> {
    await this.fetchJson(`/api/data/providers/${id}/allowed-models`, {
      method: "PUT",
      body: JSON.stringify({ models }),
    });
  }

  async fetchAllAllowedModels(): Promise<string[] | null> {
    const res = await this.fetchJson<{ models: string[] | null }>("/api/data/providers/allowed-models");
    return res.models ?? null;
  }

  // ——— Teams ———

  async fetchTeams(): Promise<any[]> {
    const res = await this.fetchJson<{ teams: any[] }>("/api/data/teams");
    return res.teams ?? [];
  }

  async createTeam(name: string): Promise<any> {
    const res = await this.fetchJson<{ team: any }>("/api/data/teams", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return res.team;
  }

  async updateTeam(teamId: string, name: string): Promise<void> {
    await this.fetchJson(`/api/data/teams/${teamId}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
  }

  async deleteTeam(teamId: string): Promise<void> {
    await this.fetchJson(`/api/data/teams/${teamId}`, { method: "DELETE" });
  }

  async addTeamMember(teamId: string, username: string, role?: string): Promise<void> {
    await this.fetchJson(`/api/data/teams/${teamId}/members`, {
      method: "POST",
      body: JSON.stringify({ username, role: role ?? "member" }),
    });
  }

  async removeTeamMember(teamId: string, userId: string): Promise<void> {
    await this.fetchJson(`/api/data/teams/${teamId}/members/${userId}`, {
      method: "DELETE",
    });
  }

  async fetchTeamMembers(teamId: string): Promise<any[]> {
    const res = await this.fetchJson<{ members: any[] }>(`/api/data/teams/${teamId}/members`);
    return res.members ?? [];
  }

  // ——— Image Processing ———

  /**
   * Upload a data URL image to blob storage. Returns blob info or null on failure.
   * Results are cached in memory to avoid re-uploading the same image.
   */
  private async uploadDataUrl(dataUrl: string): Promise<{ id: string; url: string } | null> {
    if (!dataUrl.startsWith("data:")) return null;

    const cacheKey = this.blobCacheKey(dataUrl);
    const cached = this.blobCache.get(cacheKey);
    if (cached) {
      // Move to end (most recently used)
      this.blobCache.delete(cacheKey);
      this.blobCache.set(cacheKey, cached);
      return cached;
    }

    try {
      const mimeMatch = dataUrl.match(/^data:([^;,]+)/);
      const contentType = mimeMatch?.[1] ?? "image/png";
      const result = await this.uploadImage(dataUrl, contentType);
      if (this.blobCache.size >= 50) {
        // Delete oldest entry (first key in Map iteration order)
        const oldest = this.blobCache.keys().next().value;
        if (oldest !== undefined) this.blobCache.delete(oldest);
      }
      this.blobCache.set(cacheKey, result);
      return result;
    } catch (e) {
      console.warn("[Sync] 图片上传失败:", e);
      return null;
    }
  }

  /**
   * If the URL is a data: URL, upload and return the blob URL. Otherwise return as-is.
   */
  private async maybeUploadDataUrl(url?: string): Promise<string | undefined> {
    if (!url) return url;
    if (!url.startsWith("data:")) return url;
    const result = await this.uploadDataUrl(url);
    return result ? result.url : url;
  }

  /** Create a cache key from a data URL without storing the entire string */
  private blobCacheKey(dataUrl: string): string {
    return `${dataUrl.length}:${dataUrl.substring(0, 200)}`;
  }

  /**
   * Process messages: upload data URL images to blob storage and replace with blob URLs.
   * 返回已处理消息、已上传映射，以及是否有任何图片未成功上传。
   * 调用方应在 failedCount > 0 时**放弃本次保存**，以免把内联 base64 泄漏到 chat_history_json
   * （那会让单条 session JSON 膨胀到几十 MB，进而让 lazy-load 失败，用户刷新后看到空历史）。
   */
  private async processMessagesImages(messages: any[]): Promise<{
    messages: any[];
    uploaded: Map<string, { id: string; url: string }>;
    failedCount: number;
  }> {
    const emptyUploaded = new Map<string, { id: string; url: string }>();

    // Collect all data URL images
    const dataUrls = new Set<string>();
    for (const msg of messages) {
      if (!Array.isArray(msg?.parts)) continue;
      for (const part of msg.parts) {
        if (part.type === "image" && part.imageUrl?.startsWith("data:")) {
          dataUrls.add(part.imageUrl);
        }
      }
    }

    if (dataUrls.size === 0) return { messages, uploaded: emptyUploaded, failedCount: 0 };

    // Upload unique images (max 3 concurrent)
    const uploaded = new Map<string, { id: string; url: string }>();
    let failedCount = 0;
    const urls = Array.from(dataUrls);
    const CONCURRENCY = 3;
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (dataUrl) => {
          const result = await this.uploadDataUrl(dataUrl);
          if (result) uploaded.set(dataUrl, result);
          else failedCount += 1;
        }),
      );
    }

    if (uploaded.size === 0) return { messages, uploaded: emptyUploaded, failedCount };

    // Replace data URLs with blob URLs in a shallow copy
    const processedMessages = messages.map((msg) => {
      if (!Array.isArray(msg?.parts)) return msg;
      const hasDataUrl = msg.parts.some(
        (p: any) => p.type === "image" && uploaded.has(p.imageUrl),
      );
      if (!hasDataUrl) return msg;

      return {
        ...msg,
        parts: msg.parts.map((part: any) => {
          if (part.type !== "image" || !uploaded.has(part.imageUrl)) return part;
          return { ...part, imageUrl: uploaded.get(part.imageUrl)!.url };
        }),
      };
    });

    return { messages: processedMessages, uploaded, failedCount };
  }

  /**
   * Process batch slot images: upload data URL images in versions to blob storage.
   * Returns both the processed slots (for server), the uploaded map, and failedCount.
   * 同 processMessagesImages，调用方应在 failedCount > 0 时放弃本次保存。
   */
  private async processBatchSlotImages(slots: any[]): Promise<{
    slots: any[];
    uploaded: Map<string, { id: string; url: string }>;
    failedCount: number;
  }> {
    const emptyUploaded = new Map<string, { id: string; url: string }>();

    const dataUrls = new Set<string>();
    for (const slot of slots) {
      if (!Array.isArray(slot?.versions)) continue;
      for (const ver of slot.versions) {
        if (ver.imageUrl?.startsWith("data:")) {
          dataUrls.add(ver.imageUrl);
        }
      }
    }

    if (dataUrls.size === 0) return { slots, uploaded: emptyUploaded, failedCount: 0 };

    const uploaded = new Map<string, { id: string; url: string }>();
    let failedCount = 0;
    const urls = Array.from(dataUrls);
    const CONCURRENCY = 3;
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (dataUrl) => {
          const result = await this.uploadDataUrl(dataUrl);
          if (result) uploaded.set(dataUrl, result);
          else failedCount += 1;
        }),
      );
    }

    if (uploaded.size === 0) return { slots, uploaded: emptyUploaded, failedCount };

    const processedSlots = slots.map((slot) => {
      if (!Array.isArray(slot?.versions)) return slot;
      const hasDataUrl = slot.versions.some((v: any) => uploaded.has(v.imageUrl));
      if (!hasDataUrl) return slot;

      return {
        ...slot,
        versions: slot.versions.map((ver: any) => {
          if (!uploaded.has(ver.imageUrl)) return ver;
          return { ...ver, imageUrl: uploaded.get(ver.imageUrl)!.url };
        }),
      };
    });

    return { slots: processedSlots, uploaded, failedCount };
  }

  // ——— Internal: debounced server writes ———

  private queueSync(key: string, fn: () => Promise<void>): void {
    if (!this.isOnline) {
      if (this.offlineQueue.length >= 50) {
        this.offlineQueue.shift(); // Drop oldest
      }
      this.offlineQueue.push(fn);
      this.emitStatus();
      return;
    }
    this.syncQueue.set(key, fn);
    this.emitStatus();
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushSyncQueue();
    }, 500);
  }

  /** key 形如 "project:abc-123" / "batchjob:xyz" → 拆出 kind + id */
  private parseSyncKey(key: string): { kind: "projects" | "batch_jobs"; id: string } | null {
    if (key.startsWith("project:")) return { kind: "projects", id: key.slice("project:".length) };
    if (key.startsWith("batchjob:")) return { kind: "batch_jobs", id: key.slice("batchjob:".length) };
    return null;
  }

  private async flushSyncQueue(): Promise<void> {
    const entries = Array.from(this.syncQueue.entries());
    this.syncQueue.clear();
    for (const [key, fn] of entries) {
      try {
        await this.withRetry(fn);
        this.lastSyncedAt = Date.now();
        this.lastError = null;
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[Sync] failed to sync ${key}:`, e);
        this.lastError = msg;
        // Persist non-4xx failures to localStorage for later retry
        if (!(e && typeof e.status === "number" && e.status >= 400 && e.status < 500)) {
          this.persistFailedOp(key);
          // 同时把 project/batchJob id 写入 per-user 待同步注册表，
          // 下次 bootstrap 完成时会从最新 React state 找到对应实体重新发送
          const parsed = this.parseSyncKey(key);
          if (parsed) addPendingSyncId(parsed.kind, parsed.id);
        }
      }
    }
    this.emitStatus();
  }

  private async drainOfflineQueue(): Promise<void> {
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];
    this.emitStatus();
    for (const fn of queue) {
      try {
        await this.withRetry(fn);
        this.lastSyncedAt = Date.now();
        this.lastError = null;
      } catch (e) {
        console.error("[Sync] offline queue drain failed:", e);
        this.lastError = e instanceof Error ? e.message : String(e);
      }
    }
    this.emitStatus();
  }

  // ——— Failed ops persistence ———

  private persistFailedOp(key: string): void {
    try {
      const raw = localStorage.getItem(this.failedOpsKey);
      const ops: FailedOp[] = raw ? JSON.parse(raw) : [];
      // Deduplicate by key
      const filtered = ops.filter((op) => op.key !== key);
      filtered.push({ key, url: "", method: "", body: "", ts: Date.now() });
      // Cap at max
      const capped = filtered.slice(-FAILED_OPS_MAX);
      localStorage.setItem(this.failedOpsKey, JSON.stringify(capped));
    } catch {
      // ignore localStorage errors
    }
  }

  private drainFailedOps(): void {
    try {
      const raw = localStorage.getItem(this.failedOpsKey);
      if (!raw) return;
      const ops: FailedOp[] = JSON.parse(raw);
      if (ops.length === 0) return;
      // Clear immediately to avoid duplicate drains
      localStorage.removeItem(this.failedOpsKey);
      console.log(`[Sync] 重试 ${ops.length} 个之前失败的同步操作`);
      // We only have the key — the actual data needs to come from the next save cycle.
      // This is a signal that data may be out of sync. The next full pullAll + save cycle
      // will reconcile. For now, just log and clear.
    } catch {
      // ignore
    }
  }

  // ——— Internal: retry with exponential backoff ———

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        lastError = e;
        // Don't retry on 4xx client errors
        if (e && typeof e.status === "number" && e.status >= 400 && e.status < 500) {
          throw e;
        }
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastError;
  }

  // ——— Internal: fetch helper ———

  private async fetchJson<T = any>(path: string, init?: RequestInit): Promise<T> {
    const resp = await fetch(path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
      ...init,
    });

    if (!resp.ok) {
      const err: any = new Error(`HTTP ${resp.status}`);
      err.status = resp.status;
      try {
        const body = await resp.json();
        if (body?.message) err.message = body.message;
      } catch {
        // ignore parse errors
      }
      throw err;
    }

    return resp.json() as Promise<T>;
  }
}

export const syncService = new SyncService();
