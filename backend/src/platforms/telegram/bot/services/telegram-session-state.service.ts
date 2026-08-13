import { Injectable } from '@nestjs/common';

export type ImportSource = 'text' | 'photo_qr' | 'photo_caption';

export type PendingImportState = {
  chatId: number;
  userId: number | null;
  content: string;
  source: ImportSource;
  forceRecreateOnExisting?: boolean;
  importAsChild?: boolean;
  expireAt: number;
};

@Injectable()
export class TelegramSessionStateService {
  private readonly pendingImports = new Map<string, PendingImportState>();
  private readonly pendingMarkupTargets = new Map<
    string,
    {
      collectionId: string;
      promptMessageId?: number;
      originalCardMessageId?: number;
      expireAt: number;
    }[]
  >();
  private readonly maxPendingImports = 2000;
  private readonly maxPendingMarkupTargets = 2000;

  createPendingImport(params: {
    chatId: number;
    userId: number | null;
    content: string;
    source: ImportSource;
    ttlMs: number;
    forceRecreateOnExisting?: boolean;
    importAsChild?: boolean;
  }): string {
    this.cleanupPendingImports();
    const token = `${params.chatId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.pendingImports.set(token, {
      chatId: params.chatId,
      userId: params.userId,
      content: params.content,
      source: params.source,
      forceRecreateOnExisting: params.forceRecreateOnExisting,
      importAsChild: params.importAsChild,
      expireAt: Date.now() + params.ttlMs,
    });
    this.trimPendingImportsIfNeeded();
    return token;
  }

  takePendingImport(params: {
    token: string;
    chatId?: number;
    userId?: number | null;
  }): PendingImportState | null {
    this.cleanupPendingImports();
    const pending = this.pendingImports.get(params.token);
    if (!pending) return null;
    if (pending.chatId !== params.chatId) return null;
    if (pending.userId !== (params.userId ?? null)) return null;
    this.pendingImports.delete(params.token);
    return pending;
  }

  setPendingMarkupTarget(params: {
    chatId?: number;
    userId?: number;
    collectionId: string;
    ttlMs: number;
    promptMessageId?: number;
    originalCardMessageId?: number;
  }) {
    const key = this.buildUserKey(params.chatId, params.userId);
    if (!key) return;
    this.cleanupPendingMarkupTargets();

    let targets = this.pendingMarkupTargets.get(key);
    if (!targets) {
      targets = [];
      this.pendingMarkupTargets.set(key, targets);
    }

    // Check if there's already an active prompt for this collection to avoid duplicates
    const existingIndex = targets.findIndex(
      (t) => t.collectionId === params.collectionId,
    );
    const newTarget = {
      collectionId: params.collectionId,
      promptMessageId: params.promptMessageId,
      originalCardMessageId: params.originalCardMessageId,
      expireAt: Date.now() + params.ttlMs,
    };

    if (existingIndex >= 0) {
      targets[existingIndex] = newTarget;
    } else {
      targets.push(newTarget);
    }

    this.trimPendingMarkupTargetsIfNeeded();
  }

  takePendingMarkupTarget(params: {
    chatId?: number;
    userId?: number;
    repliedMessageId?: number;
  }): {
    collectionId: string;
    promptMessageId?: number;
    originalCardMessageId?: number;
  } | null {
    const key = this.buildUserKey(params.chatId, params.userId);
    if (!key) return null;
    this.cleanupPendingMarkupTargets();

    const targets = this.pendingMarkupTargets.get(key);
    if (!targets || targets.length === 0) return null;

    let targetIndex = -1;

    // If the user replied to a specific bot message, try to match it
    if (params.repliedMessageId) {
      targetIndex = targets.findIndex(
        (t) => t.promptMessageId === params.repliedMessageId,
      );
    }

    // If no explicit reply match or they didn't reply, just take the most recently added one
    if (targetIndex === -1) {
      targetIndex = targets.length - 1;
    }

    const target = targets[targetIndex];
    if (!target) return null;

    // Remove it from the list
    targets.splice(targetIndex, 1);
    if (targets.length === 0) {
      this.pendingMarkupTargets.delete(key);
    }

    if (Date.now() > target.expireAt) {
      return null;
    }

    return {
      collectionId: target.collectionId,
      promptMessageId: target.promptMessageId,
      originalCardMessageId: target.originalCardMessageId,
    };
  }

  private buildUserKey(chatId?: number, userId?: number): string {
    if (!chatId || !userId) return '';
    return `${chatId}:${userId}`;
  }

  private cleanupPendingImports() {
    const now = Date.now();
    for (const [key, value] of this.pendingImports.entries()) {
      if (value.expireAt <= now) {
        this.pendingImports.delete(key);
      }
    }
  }

  private cleanupPendingMarkupTargets() {
    const now = Date.now();
    for (const [key, targets] of this.pendingMarkupTargets.entries()) {
      const validTargets = targets.filter((t) => t.expireAt > now);
      if (validTargets.length === 0) {
        this.pendingMarkupTargets.delete(key);
      } else if (validTargets.length !== targets.length) {
        this.pendingMarkupTargets.set(key, validTargets);
      }
    }
  }

  private trimPendingImportsIfNeeded() {
    if (this.pendingImports.size <= this.maxPendingImports) return;
    const overflow = this.pendingImports.size - this.maxPendingImports;
    let removed = 0;
    for (const key of this.pendingImports.keys()) {
      this.pendingImports.delete(key);
      removed += 1;
      if (removed >= overflow) {
        break;
      }
    }
  }

  private trimPendingMarkupTargetsIfNeeded() {
    if (this.pendingMarkupTargets.size <= this.maxPendingMarkupTargets) return;
    const overflow =
      this.pendingMarkupTargets.size - this.maxPendingMarkupTargets;
    let removed = 0;
    for (const key of this.pendingMarkupTargets.keys()) {
      this.pendingMarkupTargets.delete(key);
      removed += 1;
      if (removed >= overflow) {
        break;
      }
    }
  }
}
