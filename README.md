# NEXUS Autonomous · Agent Ledger

One honest, private scorecard for every AI agent you run, from any company.

**Open it:** https://walterhendersonjr41-blip.github.io/nexus-autonomous/

The big platforms each show you only their own agents (OpenAI traces, Microsoft Agent 365, Google, Anthropic), and the cross-vendor tools are built for companies and cost money. NEXUS is for one person running a lot of bots:

- **Log what any bot did**: quick form, paste chat summaries or logs, or open a CSV / JSON / JSONL / text file.
- **Proven done**: counts a job as truly done only when it comes with proof (a link, receipt, or reference).
- **Trust score per agent (0–100)**: proven done = full credit, done without proof = half, partly = quarter, failed or unclear = zero. Under 5 actions it says "too early to tell".
- **Drift alerts**: last 7 days vs the 21 days before. Success drops, needing you more, cost per job doubling, or going quiet.
- **Kill switch**: pause every agent, keep each bot's off-switch link in one list, and get flagged if a paused agent keeps working.
- **Today's insights and one suggested action**, written only from your data.

No server, no account, no tracking, no fake numbers. Data stays in your browser (export CSV or JSON backup any time). An optional AI key (any OpenAI-compatible service, including free tiers) can clean up messy text; it's stored only on your device and used only when you press the button.

Install: Share → Add to Home Screen (iPhone) or ⋮ → Install app (Android).

## Tests

```
npm test   # node --test, scoring and import logic in core.js
```

Made by Walt Henderson Jr.
