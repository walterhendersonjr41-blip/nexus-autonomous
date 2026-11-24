/* NEXUS Agent Ledger: parsing and scoring. Pure functions, no network, no storage.
   Works in the browser (window.NexusCore) and in Node (module.exports) for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexusCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 86400000;
  const OUTCOMES = ['success', 'fail', 'partial', 'unknown'];

  // ---------- normalising one entry ----------
  const KEYS = {
    time: ['time', 'timestamp', 'date', 'datetime', 'when', 'created_at', 'started_at', 'ts'],
    agent: ['agent', 'bot', 'agent_name', 'name', 'assistant', 'workflow_name', 'who'],
    vendor: ['vendor', 'provider', 'platform', 'company', 'service', 'app'],
    action: ['action', 'task', 'what', 'description', 'summary', 'event', 'message', 'step'],
    outcome: ['outcome', 'status', 'result', 'state', 'success', 'ok'],
    proof: ['proof', 'evidence', 'receipt', 'link', 'url', 'output_url', 'ref'],
    cost: ['cost', 'cost_usd', 'usd', 'spend', 'price', 'amount', 'total_cost'],
    human: ['human', 'needed_human', 'human_needed', 'needs_human', 'approval', 'manual', 'intervention'],
  };
  function pick(obj, field) {
    const lower = {};
    for (const k of Object.keys(obj)) lower[k.toLowerCase().trim().replace(/[\s-]+/g, '_')] = obj[k];
    for (const k of KEYS[field]) if (lower[k] !== undefined && lower[k] !== null && lower[k] !== '') return lower[k];
    return undefined;
  }
  function parseOutcome(v) {
    if (v === true) return 'success';
    if (v === false) return 'fail';
    const s = String(v == null ? '' : v).toLowerCase().trim();
    if (!s) return 'unknown';
    if (/\b(partial|partly|some|half|incomplete)\b/.test(s)) return 'partial';
    if (/\b(fail|failed|failure|error|errored|crash|crashed|broke|broken|denied|rejected|timeout|timed out|blocked|did not|didn't|couldn't|could not)\b/.test(s) || /^(no|false|0|n)$/.test(s)) return 'fail';
    if (/\b(success|succeeded|successful|done|ok|okay|complete|completed|sent|posted|delivered|passed|pass|fixed|shipped|published|finished|worked)\b/.test(s) || /^(yes|true|1|y)$/.test(s)) return 'success';
    return 'unknown';
  }
  function parseBool(v) {
    if (typeof v === 'boolean') return v;
    const s = String(v == null ? '' : v).toLowerCase().trim();
    return /^(y|yes|true|1|needed|required|human|manual)$/.test(s);
  }
  function parseCost(v) {
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : 0;
    const m = String(v == null ? '' : v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    const n = m ? parseFloat(m[0]) : 0;
    return isFinite(n) && n > 0 ? n : 0;
  }
  function parseTime(v, fallback) {
    if (v == null || v === '') return fallback;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    const t = Date.parse(String(v).trim().replace(/^(\d{4}-\d\d-\d\d) (\d)/, '$1T$2'));
    return isNaN(t) ? fallback : t;
  }
  function clean(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || 300); }

  function normalize(raw, now) {
    now = now || Date.now();
    const agent = clean(pick(raw, 'agent'), 60);
    if (!agent) return null;
    const outcomeRaw = pick(raw, 'outcome');
    return {
      time: parseTime(pick(raw, 'time'), now),
      agent,
      vendor: clean(pick(raw, 'vendor'), 40),
      action: clean(pick(raw, 'action'), 300),
      outcome: OUTCOMES.includes(outcomeRaw) ? outcomeRaw : parseOutcome(outcomeRaw),
      proof: clean(pick(raw, 'proof'), 500),
      cost: parseCost(pick(raw, 'cost')),
      human: parseBool(pick(raw, 'human')),
    };
  }

  // ---------- importers ----------
  function splitCsvLine(line, sep) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === sep) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }
  function parseCSV(text, now) {
    now = now || Date.now();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const sep = (lines[0].match(/\t/g) || []).length > (lines[0].match(/,/g) || []).length ? '\t' : ',';
    const head = splitCsvLine(lines[0], sep);
    return lines.slice(1).map((l) => {
      const cells = splitCsvLine(l, sep); const o = {};
      head.forEach((h, i) => { o[h] = cells[i]; });
      return normalize(o, now);
    }).filter(Boolean);
  }
  function parseJSON(text, now) {
    const t = text.trim();
    let items;
    try {
      const v = JSON.parse(t);
      items = Array.isArray(v) ? v : Array.isArray(v.entries) ? v.entries : Array.isArray(v.data) ? v.data : [v];
    } catch (e) {
      items = t.split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    }
    return items.filter((x) => x && typeof x === 'object').map((x) => normalize(x, now)).filter(Boolean);
  }
  // Plain text: one action per line. "time | agent | action | outcome | cost | proof" or free text "Agent: did a thing ...".
  function parseText(text, now, defaultAgent) {
    now = now || Date.now();
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim(); if (!l) continue;
      const url = (l.match(/https?:\/\/\S+/) || [''])[0].replace(/[),.]+$/, '');
      const money = l.match(/\$\s?(\d+(?:\.\d+)?)/);
      const human = /\b(needs?|needed|waiting on|asked)\s+(a\s+)?(human|me|approval|you|walt|owner)\b|\bmanual(ly)?\b|\bapproval\b/i.test(l);
      if (l.includes('|')) {
        const p = l.split('|').map((s) => s.trim());
        let i = 0; let time = now;
        const t0 = parseTime(p[0], NaN);
        if (!isNaN(t0) && /\d/.test(p[0])) { time = t0; i = 1; }
        const e = normalize({ time, agent: p[i], action: p[i + 1], outcome: p[i + 2] || l, cost: money ? money[1] : 0, proof: url, human }, now);
        if (e) out.push(e);
        continue;
      }
      const tm = l.match(/^\[?(\d{4}-\d\d-\d\d(?:[ T]\d\d:\d\d(?::\d\d)?)?)\]?\s*/);
      let rest = tm ? l.slice(tm[0].length) : l;
      const time = tm ? parseTime(tm[1], now) : now;
      const am = rest.match(/^([A-Za-z0-9][\w .'-]{0,40}?)\s*[:>\-–—]\s+/);
      let agent = defaultAgent || '';
      if (am) { agent = am[1].trim(); rest = rest.slice(am[0].length); }
      if (!agent) continue;
      out.push({ time, agent: clean(agent, 60), vendor: '', action: clean(rest, 300), outcome: parseOutcome(rest), proof: url, cost: money ? parseFloat(money[1]) : 0, human });
    }
    return out;
  }
  function parseAny(text, now, defaultAgent) {
    now = now || Date.now();
    const t = (text || '').trim();
    if (!t) return { format: 'empty', entries: [] };
    if (t[0] === '[' || t[0] === '{') return { format: 'json', entries: parseJSON(t, now) };
    const first = t.split(/\r?\n/)[0].toLowerCase();
    if (/(,|\t)/.test(first) && /(agent|bot|name)/.test(first) && /(status|outcome|result|action|task)/.test(first)) return { format: 'csv', entries: parseCSV(t, now) };
    return { format: 'text', entries: parseText(t, now, defaultAgent) };
  }

  // ---------- scoring ----------
  function emptyStats() { return { runs: 0, success: 0, proven: 0, fail: 0, partial: 0, unknown: 0, human: 0, cost: 0 }; }
  function addTo(s, e) {
    s.runs++; s[e.outcome]++; if (e.outcome === 'success' && e.proof) s.proven++;
    if (e.human) s.human++; s.cost += e.cost || 0;
  }
  function pct(n, d) { return d > 0 ? Math.round((100 * n) / d) : null; }
  // Trust: proven success = full credit, unproven success = half, partial = quarter, failure/unknown = 0.
  function trustScore(s) {
    if (!s.runs) return null;
    return Math.round((100 * (s.proven + 0.5 * (s.success - s.proven) + 0.25 * s.partial)) / s.runs);
  }
  function trustWord(score, runs) {
    if (score == null) return 'No data yet';
    if (runs < 5) return 'Too early to tell';
    if (score >= 80) return 'Trustworthy';
    if (score >= 60) return 'Mostly reliable';
    if (score >= 40) return 'Check its work';
    return 'Do not trust yet';
  }
  function derive(s) {
    const known = s.runs - s.unknown;
    return Object.assign({}, s, {
      successRate: pct(s.success, known),
      provenRate: pct(s.proven, s.runs),
      handsFree: pct(s.runs - s.human, s.runs),
      costPerRun: s.runs ? s.cost / s.runs : 0,
      trust: trustScore(s),
    });
  }

  function computeLedger(entries, agentsMeta, now) {
    now = now || Date.now(); agentsMeta = agentsMeta || {};
    const total = emptyStats(); const per = {};
    const sorted = entries.slice().sort((a, b) => a.time - b.time);
    for (const e of sorted) { addTo(total, e); (per[e.agent] = per[e.agent] || { stats: emptyStats(), list: [] }); addTo(per[e.agent].stats, e); per[e.agent].list.push(e); }
    const agents = Object.keys(per).map((name) => {
      const meta = agentsMeta[name] || {};
      const st = derive(per[name].stats);
      const list = per[name].list;
      const last = list[list.length - 1].time;
      const alerts = driftAlerts(list, now);
      if (meta.paused && meta.pausedAt) {
        const after = list.filter((e) => e.time > meta.pausedAt).length;
        if (after) alerts.unshift({ kind: 'paused-active', severity: 3, text: `${name} logged ${after} action${after > 1 ? 's' : ''} after you paused it. Its off switch may not have worked.` });
      }
      return Object.assign(st, { name, lastSeen: last, vendor: (list.find((e) => e.vendor) || {}).vendor || '', paused: !!meta.paused, stopUrl: meta.stopUrl || '', word: trustWord(st.trust, st.runs), alerts });
    }).sort((a, b) => b.runs - a.runs);
    const fleet = derive(total);
    const alerts = agents.flatMap((a) => a.alerts.map((x) => Object.assign({ agent: a.name }, x))).sort((a, b) => b.severity - a.severity);
    return { fleet, agents, alerts, insights: insights(fleet, agents, sorted, now), action: suggestedAction(fleet, agents, alerts) };
  }

  // Drift: compare the last 7 days with the 21 days before that, per agent.
  function driftAlerts(list, now, opts) {
    opts = Object.assign({ recentDays: 7, baseDays: 21, minRuns: 3, dropPts: 20, silentDays: 3 }, opts || {});
    const recentStart = now - opts.recentDays * DAY; const baseStart = recentStart - opts.baseDays * DAY;
    const r = emptyStats(); const b = emptyStats();
    for (const e of list) { if (e.time >= recentStart && e.time <= now) addTo(r, e); else if (e.time >= baseStart && e.time < recentStart) addTo(b, e); }
    const out = []; const name = list[0].agent;
    if (r.runs >= opts.minRuns && b.runs >= opts.minRuns) {
      const rs = derive(r); const bs = derive(b);
      if (rs.successRate != null && bs.successRate != null && bs.successRate - rs.successRate >= opts.dropPts)
        out.push({ kind: 'success-drop', severity: 3, text: `${name} is slipping: success fell from ${bs.successRate}% to ${rs.successRate}% this week.` });
      if (bs.handsFree - rs.handsFree >= opts.dropPts)
        out.push({ kind: 'human-rise', severity: 2, text: `${name} needs you more: hands-free fell from ${bs.handsFree}% to ${rs.handsFree}%.` });
      if (bs.costPerRun > 0 && rs.costPerRun >= 2 * bs.costPerRun && rs.cost >= 0.5)
        out.push({ kind: 'cost-spike', severity: 2, text: `${name} costs more per job: $${rs.costPerRun.toFixed(2)} vs $${bs.costPerRun.toFixed(2)} before.` });
    }
    const last = list[list.length - 1].time;
    if (b.runs >= opts.minRuns && r.runs === 0 && now - last >= opts.silentDays * DAY)
      out.push({ kind: 'silent', severity: 1, text: `${name} went quiet: nothing logged for ${Math.floor((now - last) / DAY)} days.` });
    return out;
  }

  function money(n) { return '$' + (n >= 100 ? Math.round(n) : n.toFixed(2)); }
  function insights(fleet, agents, sorted, now) {
    const out = [];
    if (!fleet.runs) return out;
    const unproven = fleet.success - fleet.proven;
    if (unproven > 0) out.push(`${unproven} of ${fleet.success} "done" claims have no proof attached (no link, receipt, or screenshot).`);
    const fails = agents.filter((a) => a.fail).sort((a, b) => b.fail - a.fail)[0];
    if (fails) out.push(`${fails.name} failed most: ${fails.fail} of ${fails.runs} actions.`);
    if (fleet.human) out.push(`${fleet.human} action${fleet.human > 1 ? 's' : ''} needed a human (${100 - fleet.handsFree}% of all work).`);
    if (fleet.cost > 0) {
      const top = agents.slice().sort((a, b) => b.cost - a.cost)[0];
      out.push(`Total spend ${money(fleet.cost)}; ${top.name} spent the most (${money(top.cost)}).`);
    }
    const best = agents.filter((a) => a.runs >= 5).sort((a, b) => b.trust - a.trust)[0];
    if (best) out.push(`Most trustworthy: ${best.name} at ${best.trust}/100.`);
    if (fleet.unknown) out.push(`${fleet.unknown} entr${fleet.unknown > 1 ? 'ies' : 'y'} had no clear result, so they count as not done.`);
    const span = sorted.length ? Math.max(1, Math.round((sorted[sorted.length - 1].time - sorted[0].time) / DAY)) : 0;
    if (span) out.push(`Covers ${sorted.length} actions from ${agents.length} agent${agents.length > 1 ? 's' : ''} over ${span} day${span > 1 ? 's' : ''}.`);
    return out;
  }
  function suggestedAction(fleet, agents, alerts) {
    if (!fleet.runs) return null;
    const pausedLeak = alerts.find((a) => a.kind === 'paused-active');
    if (pausedLeak) return `Check ${pausedLeak.agent}'s off switch. It kept working after you paused it.`;
    const drop = alerts.find((a) => a.kind === 'success-drop');
    if (drop) return `Pause or re-check ${drop.agent}. Its success rate dropped this week.`;
    const worst = agents.filter((a) => a.runs >= 5 && !a.paused).sort((a, b) => a.trust - b.trust)[0];
    if (worst && worst.trust < 40) return `Stop trusting ${worst.name} on its own: only ${worst.trust}/100. Review its last ${Math.min(worst.runs, 5)} actions.`;
    const unproven = agents.filter((a) => a.success - a.proven > 0).sort((a, b) => (b.success - b.proven) - (a.success - a.proven))[0];
    if (unproven) return `Ask ${unproven.name} for proof on its ${unproven.success - unproven.proven} unproven "done" claim${unproven.success - unproven.proven > 1 ? 's' : ''}.`;
    return 'Nothing urgent. Keep logging so drift alerts stay sharp.';
  }

  function toCSV(entries) {
    const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['time', 'agent', 'vendor', 'action', 'outcome', 'proof', 'cost', 'human']];
    for (const e of entries) rows.push([new Date(e.time).toISOString(), e.agent, e.vendor, e.action, e.outcome, e.proof, e.cost, e.human ? 'yes' : 'no']);
    return rows.map((r) => r.map(esc).join(',')).join('\n');
  }

  function entryKey(e) { return [e.time, e.agent, e.action, e.outcome].join('|'); }
  function merge(existing, incoming) {
    const seen = new Set(existing.map(entryKey)); const added = [];
    for (const e of incoming) { const k = entryKey(e); if (!seen.has(k)) { seen.add(k); added.push(e); } }
    return { all: existing.concat(added), added: added.length, skipped: incoming.length - added.length };
  }

  return { DAY, normalize, parseOutcome, parseCost, parseTime, parseCSV, parseJSON, parseText, parseAny, trustScore, trustWord, computeLedger, driftAlerts, toCSV, merge };
});
