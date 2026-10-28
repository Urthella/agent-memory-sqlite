#!/usr/bin/env node
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { type Memory, MemoryStore } from "./store.ts";

export function createServer(store: MemoryStore, defaultProject: string): McpServer {
  const server = new McpServer({ name: "agent-memory-sqlite", version: "0.1.0" });
  const scope = (project?: string) => (project === "*" ? null : (project ?? defaultProject));
  const reply = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const format = (memories: Memory[]) =>
    memories.length === 0
      ? "No memories found."
      : memories
          .map((m) => `#${m.id} [${m.project}] ${m.updatedAt}${m.tags.length ? ` (${m.tags.join(", ")})` : ""}\n${m.content}`)
          .join("\n\n");
  const project = z.string().optional().describe(`Project name. Defaults to "${defaultProject}". Use "*" for all projects.`);

  server.registerTool(
    "remember",
    {
      description:
        "Save a durable fact, decision or convention for future sessions. Saving the same text again refreshes it instead of duplicating.",
      inputSchema: { content: z.string().min(1), tags: z.array(z.string()).optional(), project },
    },
    ({ content, tags, project }) => {
      if (project === "*") return { ...reply('Pick one project to save into, not "*".'), isError: true };
      return reply(`Saved as #${store.remember(scope(project)!, content, tags).id}.`);
    },
  );

  server.registerTool(
    "recall",
    {
      description: "Search saved memories by keywords. Best matches first (BM25), with recent memories ranked higher.",
      inputSchema: { query: z.string(), project, limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ query, project, limit }) => reply(format(store.recall(query, scope(project), limit))),
  );

  server.registerTool(
    "recent",
    {
      description: "List the most recently saved or refreshed memories.",
      inputSchema: { project, limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ project, limit }) => reply(format(store.recent(scope(project), limit))),
  );

  server.registerTool(
    "forget",
    {
      description: "Delete a memory by its id (the #number shown by recall and recent).",
      inputSchema: { id: z.number().int() },
      annotations: { destructiveHint: true },
    },
    ({ id }) => reply(store.forget(id) ? `Forgot #${id}.` : `No memory #${id}.`),
  );

  return server;
}

if (import.meta.main) {
  const dbPath = process.env.AGENT_MEMORY_DB ?? join(homedir(), ".agent-memory", "memory.db");
  const project = process.env.AGENT_MEMORY_PROJECT ?? basename(process.cwd());
  await createServer(new MemoryStore(dbPath), project).connect(new StdioServerTransport());
}
