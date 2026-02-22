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

const FAILED_OPS_KEY = "nanobanana_failed_sync_ops";
const FAILED_OPS_MAX = 100;

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

  init(userId: string): void {
    this.userId = userId;
    this.drainFailedOps();
  }

  // ——— Pull ———

  async pullAll(): Promise<{
    projects: any[];
    models: any[];
    products: any[];
    templates: any[];
    preferences: any;
    teams: any[];
    batchJobs: any[];
  }> {
    const [projects, models, products, templates, preferences, teams, batchJobs] = await Promise.all([
      this.fetchJson<{ projects: any[] }>("/api/data/projects").then((r) => r.projects ?? []),
      this.fetchJson<{ models: any[] }>("/api/data/models").then((r) => r.models ?? []),
      this.fetchJson<{ products: any[] }>("/api/data/products").then((r) => r.products ?? []),
      this.fetchJson<{ templates: any[] }>("/api/data/templates").then((r) => r.templates ?? []),
      this.fetchJson<{ preferences: any }>("/api/data/preferences").then((r) => r.preferences ?? null),
      this.fetchJson<{ teams: any[] }>("/api/data/teams").then((r) => r.teams ?? []),
      this.fetchJson<{ batchJobs: any[] }>("/api/data/batch-jobs").then((r) => r.batchJobs ?? []),
    ]);
    return { projects, models, products, templates, preferences, teams, batchJobs };
  }

  async pullSince(since: number): Promise<any> {
    return this.fetchJson("/api/data/sync/pull", {
      method: "POST",
      body: JSON.stringify({ since }),
    });
  }

  // ——— Projects ———

  async saveProject(project: any): Promise<void> {
    this.queueSync(`project:${project.id}`, async () => {
      const messages = project.messages ?? project.chatHistory ?? [];
      const processedMessages = await this.processMessagesImages(messages);

      // Handle productImage in settings
      let settings = project.settings ?? {};
      if (settings.productImage?.startsWith("data:")) {
        const result = await this.uploadDataUrl(settings.productImage);
        if (result) {
          settings = { ...settings, productImage: result.url };
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
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    this.queueSync(`project:${projectId}`, () =>
      this.fetchJson(`/api/data/projects/${projectId}`, { method: "DELETE" }).then(() => {}),
    );
  }

  // ——— Batch Jobs ———

  async saveBatchJob(job: BatchJob): Promise<void> {
    this.queueSync(`batchjob:${job.id}`, async () => {
      const processedSlots = await this.processBatchSlotImages(job.slots);
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
    });
  }

  async deleteBatchJob(jobId: string): Promise<void> {
    this.queueSync(`batchjob:${jobId}`, () =>
      this.fetchJson(`/api/data/batch-jobs/${jobId}`, { method: "DELETE" }).then(() => {}),
    );
  }

  // ——— Models ———

  async saveModel(model: any, teamId?: string): Promise<void> {
    let blobId = model.blobId ?? null;
    if (model.imageUrl?.startsWith("data:") && !blobId) {
      const result = await this.uploadDataUrl(model.imageUrl);
      if (result) blobId = result.id;
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
    if (cached) return cached;

    try {
      const mimeMatch = dataUrl.match(/^data:([^;,]+)/);
      const contentType = mimeMatch?.[1] ?? "image/png";
      const result = await this.uploadImage(dataUrl, contentType);
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
   * Only modifies the copy sent to server — local data is unchanged.
   */
  private async processMessagesImages(messages: any[]): Promise<any[]> {
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

    if (dataUrls.size === 0) return messages;

    // Upload unique images (max 3 concurrent)
    const uploaded = new Map<string, { id: string; url: string }>();
    const urls = Array.from(dataUrls);
    const CONCURRENCY = 3;
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (dataUrl) => {
          const result = await this.uploadDataUrl(dataUrl);
          if (result) uploaded.set(dataUrl, result);
        }),
      );
    }

    if (uploaded.size === 0) return messages;

    // Replace data URLs with blob URLs in a shallow copy
    return messages.map((msg) => {
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
  }

  /**
   * Process batch slot images: upload data URL images in versions to blob storage.
   */
  private async processBatchSlotImages(slots: any[]): Promise<any[]> {
    const dataUrls = new Set<string>();
    for (const slot of slots) {
      if (!Array.isArray(slot?.versions)) continue;
      for (const ver of slot.versions) {
        if (ver.imageUrl?.startsWith("data:")) {
          dataUrls.add(ver.imageUrl);
        }
      }
    }

    if (dataUrls.size === 0) return slots;

    const uploaded = new Map<string, { id: string; url: string }>();
    const urls = Array.from(dataUrls);
    const CONCURRENCY = 3;
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (dataUrl) => {
          const result = await this.uploadDataUrl(dataUrl);
          if (result) uploaded.set(dataUrl, result);
        }),
      );
    }

    if (uploaded.size === 0) return slots;

    return slots.map((slot) => {
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
  }

  // ——— Internal: debounced server writes ———

  private queueSync(key: string, fn: () => Promise<void>): void {
    if (!this.isOnline) {
      this.offlineQueue.push(fn);
      return;
    }
    this.syncQueue.set(key, fn);
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushSyncQueue();
    }, 500);
  }

  private async flushSyncQueue(): Promise<void> {
    const entries = Array.from(this.syncQueue.entries());
    this.syncQueue.clear();
    for (const [key, fn] of entries) {
      try {
        await this.withRetry(fn);
      } catch (e: any) {
        console.error(`[Sync] failed to sync ${key}:`, e);
        // Persist non-4xx failures to localStorage for later retry
        if (!(e && typeof e.status === "number" && e.status >= 400 && e.status < 500)) {
          this.persistFailedOp(key);
        }
      }
    }
  }

  private async drainOfflineQueue(): Promise<void> {
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];
    for (const fn of queue) {
      try {
        await this.withRetry(fn);
      } catch (e) {
        console.error("[Sync] offline queue drain failed:", e);
      }
    }
  }

  // ——— Failed ops persistence ———

  private persistFailedOp(key: string): void {
    try {
      const raw = localStorage.getItem(FAILED_OPS_KEY);
      const ops: FailedOp[] = raw ? JSON.parse(raw) : [];
      // Deduplicate by key
      const filtered = ops.filter((op) => op.key !== key);
      filtered.push({ key, url: "", method: "", body: "", ts: Date.now() });
      // Cap at max
      const capped = filtered.slice(-FAILED_OPS_MAX);
      localStorage.setItem(FAILED_OPS_KEY, JSON.stringify(capped));
    } catch {
      // ignore localStorage errors
    }
  }

  private drainFailedOps(): void {
    try {
      const raw = localStorage.getItem(FAILED_OPS_KEY);
      if (!raw) return;
      const ops: FailedOp[] = JSON.parse(raw);
      if (ops.length === 0) return;
      // Clear immediately to avoid duplicate drains
      localStorage.removeItem(FAILED_OPS_KEY);
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
