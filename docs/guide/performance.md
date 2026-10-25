English · [Português](../pt-BR/guia/desempenho.md)

# Performance and scale

Kabul is built for many agents at once: the target is **100 workspaces and 30 agents running together**, with
trees of subagents, without the interface losing fluidity or the computer struggling. These targets are
measured, and the budgets run in CI so a regression fails the build.

## What you get

- **Only what you see is mounted.** The visible workspace and its active tab are rendered; the others keep
  their state (tabs, draft, scroll, queue, model, plan mode) and come back exactly as they were. Background chats
  keep running and their queues keep moving; they only update status and counters.
- **Events in batches.** Agent output is applied once per frame, not once per event. Long lists (chat, diff,
  file tree, changes, sidebar) are drawn in blocks near the visible area.
- **A fast terminal.** Output is written once per frame, with the WebGL renderer for heavy output.
- **Concurrency limit.** Set how many agents may run at the same time; the rest wait in a **queue** ("Waiting
  for a slot · 2nd in line") and the focused workspace goes first. Agents out of focus run at lower priority,
  and idle ones can be suspended after a while and resumed later.
- **Agents panel.** Sidebar › **Agents**: every active chat of every workspace, with filters, subagent trees
  (status, time, tokens and cost of each), open and **stop in bulk**.
- **Events instead of polling.** One file watcher per repository, one listing of terminal sessions for all of
  them, caches for model lists, PRs and checks.

## Measured

Interface, production build in headless Chromium on one Mac, 100 workspaces and 30 synthetic agents emitting
about 25 events per second each, plus a saved 2,000-message conversation:

| Metric | Before | Now | Budget |
|---|---|---|---|
| Time to a usable screen | 90 ms | 93 ms | 1,000 ms |
| CPU with everything idle | 0% | 0% | 2% |
| CPU with 30 agents emitting | 100% | 8% | 30% |
| Frames per second with 30 agents | 9.7 | 60 | ≥ 50 |
| Switching workspace (p50 / p95) | 462 / 1,098 ms | 34 / 48 ms | 100 / 150 ms |
| Key press in the composer to frame (p95) | 178 ms | 19 ms | 33 ms |
| Opening the 2,000-message conversation | 1,530 ms | 68 ms | 250 ms |
| Scrolling it | 8 fps | 60 fps | ≥ 50 |
| JS heap | 174 MB | 20 MB | 60 MB |
| Initial JS (gzip) | 274 KB | 179 KB | 200 KB |

Server (`kabuld`), load test with 100 workspaces, 30 fake agents at 20 events per second, 30 terminal sessions
and 3 connected clients for 20 s on macOS:

| Metric | Result |
|---|---|
| Server CPU (average) | 6.5% (was 17.2% before the session-scan optimization) |
| Server memory | about 24 MB |
| Event to client latency (p95) | 0.17 ms |
| Events delivered | 99.98% |

These are synthetic loads on one machine. Real agents spend most of their time waiting on the model and emit far
fewer events than this, so the load test is a deliberately heavy case.

## Measure it yourself

```sh
cd apps/web && npm run perf          # interface: production build + Playwright with 100 workspaces and 30 agents
cargo run --release -p kabul-cli -- loadtest   # server: real kabuld, synthetic workspaces, fake agents, WebSocket clients
```

Interface budgets live in `apps/web/perf-budgets.json`; the server load test has its own budgets and both run
in CI. The full reports (JSON) are in
[`docs/perf/`](https://github.com/valteracetto/kabul/tree/main/docs/perf), and the frontend ↔ backend contract
for queues, subagents and bulk stop is in the [scale reference](../escala.md) (in Portuguese).
