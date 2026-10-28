# agent-memory-sqlite

[![ci](https://github.com/Urthella/agent-memory-sqlite/actions/workflows/ci.yml/badge.svg)](https://github.com/Urthella/agent-memory-sqlite/actions/workflows/ci.yml)

Persistent, searchable memory for coding agents, in a single SQLite file. Built on Node's built-in `node:sqlite` with FTS5, so there are no native dependencies to compile.

## Store API

```ts
import { MemoryStore } from "./src/store.ts";

const store = new MemoryStore(`${process.env.HOME}/.agent-memory/memory.db`);
store.remember("okut", "Bids are applied atomically with a Redis Lua script", ["redis"]);
store.recall("redis bid", "okut"); // best match first
```

## Develop

```bash
npm ci
npm test
```

Requires Node 24+. `nix develop` gives you the same toolchain.

## License

[MIT](LICENSE)
