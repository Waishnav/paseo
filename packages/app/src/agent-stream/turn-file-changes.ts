import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { stripCwdPrefix } from "@getpaseo/protocol/path-utils";
import { parseDiff } from "@/utils/diff-highlighter";
import { isAgentToolCallItem, type StreamItem } from "@/types/stream";
import type { TurnWorkTraceBundle } from "./turn-work-traces";

export type TurnFileChangeKind = "edited" | "created" | "deleted";

export interface TurnFileChangeEntry {
  filePath: string;
  displayName: string;
  relativePath: string;
  kind: TurnFileChangeKind;
  additions: number;
  deletions: number;
}

export type TurnFileChangesTitleVariant = "edited" | "created" | "deleted" | "mixed";

export interface TurnFileChangeSummary {
  turnKey: string;
  files: TurnFileChangeEntry[];
  totalAdditions: number;
  totalDeletions: number;
  titleVariant: TurnFileChangesTitleVariant;
}

function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized.length === 0) {
    return 0;
  }
  const parts = normalized.split("\n");
  if (parts[parts.length - 1] === "") {
    return Math.max(0, parts.length - 1);
  }
  return parts.length;
}

function countLineDelta(
  oldText: string | undefined,
  newText: string | undefined,
): {
  additions: number;
  deletions: number;
} {
  const oldLines = countLines(oldText ?? "");
  const newLines = countLines(newText ?? "");
  if (newLines >= oldLines) {
    return { additions: newLines - oldLines, deletions: 0 };
  }
  return { additions: 0, deletions: oldLines - newLines };
}

function basenameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function mergeKind(
  existing: TurnFileChangeKind | undefined,
  next: TurnFileChangeKind,
): TurnFileChangeKind {
  if (!existing) {
    return next;
  }
  if (existing === next) {
    return existing;
  }
  if (existing === "deleted" || next === "deleted") {
    return existing === "deleted" ? existing : next;
  }
  return "edited";
}

function statsFromEditDetail(detail: Extract<ToolCallDetail, { type: "edit" }>): {
  kind: TurnFileChangeKind;
  additions: number;
  deletions: number;
} {
  if (detail.unifiedDiff?.trim()) {
    const parsed = parseDiff(detail.unifiedDiff);
    const match = parsed.find((file) => file.path === detail.filePath) ?? parsed[0];
    if (match) {
      let kind: TurnFileChangeKind = "edited";
      if (match.isDeleted) {
        kind = "deleted";
      } else if (match.isNew) {
        kind = "created";
      }
      return {
        kind,
        additions: match.additions,
        deletions: match.deletions,
      };
    }
  }

  const delta = countLineDelta(detail.oldString, detail.newString);
  return { kind: "edited", additions: delta.additions, deletions: delta.deletions };
}

function statsFromWriteDetail(detail: Extract<ToolCallDetail, { type: "write" }>): {
  kind: TurnFileChangeKind;
  additions: number;
  deletions: number;
} {
  const lines = countLines(detail.content ?? "");
  return { kind: "created", additions: lines, deletions: 0 };
}

function applyFileChange(input: {
  byPath: Map<string, TurnFileChangeEntry>;
  order: string[];
  filePath: string;
  cwd: string | undefined;
  kind: TurnFileChangeKind;
  additions: number;
  deletions: number;
}): void {
  const relativePath = stripCwdPrefix(input.filePath, input.cwd);
  const key = relativePath || input.filePath;
  const existing = input.byPath.get(key);
  if (existing) {
    input.byPath.set(key, {
      ...existing,
      kind: mergeKind(existing.kind, input.kind),
      additions: existing.additions + input.additions,
      deletions: existing.deletions + input.deletions,
    });
    return;
  }
  input.order.push(key);
  input.byPath.set(key, {
    filePath: input.filePath,
    displayName: basenameFromPath(relativePath || input.filePath),
    relativePath: key,
    kind: input.kind,
    additions: input.additions,
    deletions: input.deletions,
  });
}

function resolveTitleVariant(files: TurnFileChangeEntry[]): TurnFileChangesTitleVariant {
  if (files.length === 0) {
    return "edited";
  }
  const kinds = new Set(files.map((file) => file.kind));
  if (kinds.size > 1) {
    return "mixed";
  }
  const only = files[0]!.kind;
  if (only === "created") {
    return "created";
  }
  if (only === "deleted") {
    return "deleted";
  }
  return "edited";
}

export function deriveTurnFileChangeSummary(input: {
  bundle: TurnWorkTraceBundle;
  itemsById: Map<string, StreamItem>;
  cwd?: string;
}): TurnFileChangeSummary | null {
  const { bundle } = input;
  if (bundle.isInFlight) {
    return null;
  }

  const byPath = new Map<string, TurnFileChangeEntry>();
  const order: string[] = [];

  for (const itemId of bundle.traceItemIds) {
    const item = input.itemsById.get(itemId);
    if (!item || !isAgentToolCallItem(item)) {
      continue;
    }
    const data = item.payload.data;
    if (data.status !== "completed") {
      continue;
    }
    const detail = data.detail;
    if (detail.type !== "edit" && detail.type !== "write") {
      continue;
    }
    const filePath = detail.filePath?.trim();
    if (!filePath) {
      continue;
    }

    if (detail.type === "write") {
      const stats = statsFromWriteDetail(detail);
      applyFileChange({
        byPath,
        order,
        filePath,
        cwd: input.cwd,
        ...stats,
      });
      continue;
    }

    const stats = statsFromEditDetail(detail);
    applyFileChange({
      byPath,
      order,
      filePath,
      cwd: input.cwd,
      ...stats,
    });
  }

  if (order.length === 0) {
    return null;
  }

  const files = order.map((key) => byPath.get(key)!);
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const file of files) {
    totalAdditions += file.additions;
    totalDeletions += file.deletions;
  }

  return {
    turnKey: bundle.turnKey,
    files,
    totalAdditions,
    totalDeletions,
    titleVariant: resolveTitleVariant(files),
  };
}

export function buildTurnFileChangeSummariesByTurnKey(input: {
  bundlesByTurnKey: Map<string, TurnWorkTraceBundle>;
  items: StreamItem[];
  cwd?: string;
}): Map<string, TurnFileChangeSummary> {
  const itemsById = new Map<string, StreamItem>();
  for (const item of input.items) {
    itemsById.set(item.id, item);
  }

  const summaries = new Map<string, TurnFileChangeSummary>();
  for (const bundle of input.bundlesByTurnKey.values()) {
    const summary = deriveTurnFileChangeSummary({
      bundle,
      itemsById,
      cwd: input.cwd,
    });
    if (summary) {
      summaries.set(bundle.turnKey, summary);
    }
  }
  return summaries;
}

export function shouldShowTurnFileChangesCard(input: {
  assistantMessageId: string;
  bundlesByTurnKey: Map<string, TurnWorkTraceBundle>;
  summariesByTurnKey: Map<string, TurnFileChangeSummary>;
}): TurnFileChangeSummary | null {
  for (const bundle of input.bundlesByTurnKey.values()) {
    if (bundle.isInFlight || !bundle.assistantMessageIds.has(input.assistantMessageId)) {
      continue;
    }
    const summary = input.summariesByTurnKey.get(bundle.turnKey);
    if (summary) {
      return summary;
    }
  }
  return null;
}
