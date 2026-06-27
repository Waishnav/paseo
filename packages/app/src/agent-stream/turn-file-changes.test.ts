import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { deriveTurnWorkTraceLayout } from "./turn-work-traces";
import {
  buildTurnFileChangeSummariesByTurnKey,
  deriveTurnFileChangeSummary,
  shouldShowTurnFileChangesCard,
} from "./turn-file-changes";

function ts(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function user(id: string, seed: number): StreamItem {
  return { kind: "user_message", id, text: id, timestamp: ts(seed) };
}

function assistant(id: string, seed: number): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp: ts(seed) };
}

function agentEditTool(
  id: string,
  seed: number,
  input: { filePath: string; unifiedDiff?: string; oldString?: string; newString?: string },
): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: ts(seed),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: id,
        name: "apply_patch",
        status: "completed",
        error: null,
        detail: {
          type: "edit",
          filePath: input.filePath,
          unifiedDiff: input.unifiedDiff,
          oldString: input.oldString,
          newString: input.newString,
        },
      },
    },
  };
}

function agentWriteTool(id: string, seed: number, filePath: string, content: string): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: ts(seed),
    payload: {
      source: "agent",
      data: {
        provider: "pi",
        callId: id,
        name: "write",
        status: "completed",
        error: null,
        detail: {
          type: "write",
          filePath,
          content,
        },
      },
    },
  };
}

describe("deriveTurnFileChangeSummary", () => {
  it("aggregates completed edit and write tools in a turn", () => {
    const items = [
      user("u1", 1),
      agentWriteTool("w1", 2, "/repo/src/new.ts", "line1\nline2\n"),
      agentEditTool("e1", 3, {
        filePath: "/repo/README.md",
        oldString: "a\n",
        newString: "a\nb\n",
      }),
      assistant("a1", 4),
    ];
    const layout = deriveTurnWorkTraceLayout({ agentStatus: "idle", items });
    const bundle = layout.userMessageIdToBundle.get("u1")!;
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const summary = deriveTurnFileChangeSummary({
      bundle,
      itemsById,
      cwd: "/repo",
    });
    expect(summary?.files).toHaveLength(2);
    expect(summary?.files.map((f) => f.relativePath).sort()).toEqual(["README.md", "src/new.ts"]);
    expect(summary?.titleVariant).toBe("mixed");
    expect(summary?.totalAdditions).toBeGreaterThan(0);
  });

  it("returns null for in-flight turns", () => {
    const items = [user("u1", 1), agentWriteTool("w1", 2, "/repo/a.ts", "x"), assistant("a1", 3)];
    const layout = deriveTurnWorkTraceLayout({ agentStatus: "running", items });
    const bundle = layout.userMessageIdToBundle.get("u1")!;
    const itemsById = new Map(items.map((item) => [item.id, item]));
    expect(deriveTurnFileChangeSummary({ bundle, itemsById, cwd: "/repo" })).toBeNull();
  });

  it("merges multiple edits to the same path", () => {
    const items = [
      user("u1", 1),
      agentEditTool("e1", 2, { filePath: "/repo/foo.ts", oldString: "a\n", newString: "a\nb\n" }),
      agentEditTool("e2", 3, {
        filePath: "/repo/foo.ts",
        oldString: "a\nb\n",
        newString: "a\nb\nc\n",
      }),
      assistant("a1", 4),
    ];
    const layout = deriveTurnWorkTraceLayout({ agentStatus: "idle", items });
    const bundle = layout.userMessageIdToBundle.get("u1")!;
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const summary = deriveTurnFileChangeSummary({ bundle, itemsById, cwd: "/repo" });
    expect(summary?.files).toHaveLength(1);
    expect(summary?.files[0]?.additions).toBe(2);
    expect(summary?.files[0]?.kind).toBe("edited");
  });
});

describe("shouldShowTurnFileChangesCard", () => {
  it("resolves summary for assistant messages in a completed turn", () => {
    const items = [
      user("u1", 1),
      agentWriteTool("w1", 2, "/repo/x.ts", "hello"),
      assistant("a1", 3),
    ];
    const layout = deriveTurnWorkTraceLayout({ agentStatus: "idle", items });
    const summaries = buildTurnFileChangeSummariesByTurnKey({
      bundlesByTurnKey: layout.bundlesByTurnKey,
      items,
      cwd: "/repo",
    });
    expect(
      shouldShowTurnFileChangesCard({
        assistantMessageId: "a1",
        bundlesByTurnKey: layout.bundlesByTurnKey,
        summariesByTurnKey: summaries,
      })?.turnKey,
    ).toBe("u1");
  });
});
