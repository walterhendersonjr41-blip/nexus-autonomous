const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const NOW = Date.parse('2026-11-24T12:00:00Z');
const D = C.DAY;
const E = (agent, daysAgo, outcome, extra) => Object.assign({ time: NOW - daysAgo * D, agent, vendor: '', action: 'x' + Math.random(), outcome, proof: '', cost: 0, human: false }, extra || {});

test('outcome words are read conservatively', () => {
  assert.equal(C.parseOutcome('done'), 'success');
  assert.equal(C.parseOutcome('Sent the email'), 'success');
  assert.equal(C.parseOutcome('did not send, API error'), 'fail');
  assert.equal(C.parseOutcome('partly done'), 'partial');
  assert.equal(C.parseOutcome('working on it'), 'unknown');
  assert.equal(C.parseOutcome(''), 'unknown');
  assert.equal(C.parseOutcome('no'), 'fail');
  assert.equal(C.parseOutcome('done, no issues'), 'success');
  assert.equal(C.parseOutcome(true), 'success');
});

test('trust score: proof full, unproven half, partial quarter, fail zero', () => {
  assert.equal(C.trustScore({ runs: 0 }), null);
  assert.equal(C.trustScore({ runs: 4, proven: 4, success: 4, partial: 0 }), 100);
  assert.equal(C.trustScore({ runs: 4, proven: 0, success: 4, partial: 0 }), 50);
  assert.equal(C.trustScore({ runs: 4, proven: 2, success: 2, partial: 2 }), 63);
  assert.equal(C.trustScore({ runs: 4, proven: 0, success: 0, partial: 0 }), 0);
  assert.equal(C.trustWord(90, 3), 'Too early to tell');
  assert.equal(C.trustWord(90, 10), 'Trustworthy');
  assert.equal(C.trustWord(30, 10), 'Do not trust yet');
});

test('empty ledger produces no numbers and no insights', () => {
  const L = C.computeLedger([], {}, NOW);
  assert.equal(L.fleet.runs, 0);
  assert.equal(L.fleet.successRate, null);
  assert.equal(L.fleet.trust, null);
  assert.deepEqual(L.agents, []);
  assert.deepEqual(L.insights, []);
  assert.equal(L.action, null);
});

test('fleet totals are computed from entries only', () => {
  const es = [
    E('A', 1, 'success', { proof: 'https://p/1', cost: 0.1 }),
    E('A', 1, 'success', { cost: 0.3 }),
    E('A', 1, 'fail', { human: true }),
    E('B', 1, 'unknown'),
  ];
  const L = C.computeLedger(es, {}, NOW);
  assert.equal(L.fleet.runs, 4);
  assert.equal(L.fleet.provenRate, 25);
  assert.equal(L.fleet.successRate, 67); // 2 of 3 known outcomes
  assert.equal(L.fleet.handsFree, 75);
  assert.ok(Math.abs(L.fleet.cost - 0.4) < 1e-9);
  const A = L.agents.find((a) => a.name === 'A');
  assert.equal(A.trust, 50); // (1 + 0.5) / 3
  assert.ok(L.insights.some((t) => t.includes('1 of 2 "done" claims have no proof')));
});

test('drift: success drop week over week raises an alert and the suggested action', () => {
  const es = [];
  for (let i = 0; i < 6; i++) es.push(E('Router', 10 + i, 'success'));
  for (let i = 0; i < 4; i++) es.push(E('Router', 1 + i, i === 0 ? 'success' : 'fail'));
  const L = C.computeLedger(es, {}, NOW);
  const a = L.alerts.find((x) => x.kind === 'success-drop');
  assert.ok(a, 'expected success-drop alert');
  assert.match(a.text, /100% to 25%/);
  assert.match(L.action, /Router/);
});

test('drift: no alert with too few runs', () => {
  const es = [E('R', 10, 'success'), E('R', 11, 'success'), E('R', 12, 'success'), E('R', 1, 'fail')];
  assert.equal(C.computeLedger(es, {}, NOW).alerts.length, 0);
});

test('drift: cost spike and going quiet', () => {
  const es = [];
  for (let i = 0; i < 4; i++) es.push(E('Spender', 10 + i, 'success', { cost: 0.1 }));
  for (let i = 0; i < 4; i++) es.push(E('Spender', 1 + i, 'success', { cost: 0.5 }));
  for (let i = 0; i < 4; i++) es.push(E('Quiet', 9 + i, 'success'));
  const L = C.computeLedger(es, {}, NOW);
  assert.ok(L.alerts.some((a) => a.kind === 'cost-spike' && a.agent === 'Spender'));
  assert.ok(L.alerts.some((a) => a.kind === 'silent' && a.agent === 'Quiet'));
});

test('kill switch: activity after pause is flagged first', () => {
  const es = [E('Bot', 3, 'success'), E('Bot', 1, 'success')];
  const L = C.computeLedger(es, { Bot: { paused: true, pausedAt: NOW - 2 * D } }, NOW);
  assert.equal(L.alerts[0].kind, 'paused-active');
  assert.match(L.action, /off switch/);
  const ok = C.computeLedger(es, { Bot: { paused: true, pausedAt: NOW - 0.5 * D } }, NOW);
  assert.ok(!ok.alerts.some((a) => a.kind === 'paused-active'));
});

test('CSV import with flexible headers and quotes', () => {
  const csv = 'Timestamp,Bot,Task,Status,Cost USD,Evidence,Needs Human\n2026-11-20 10:00,Ops Monitor,"Sent invoice, #42",done,$0.02,https://mail/1,no\n2026-11-21T09:00:00Z,Ops Monitor,Post reply,error,0,,yes';
  const r = C.parseAny(csv, NOW);
  assert.equal(r.format, 'csv');
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[0].action, 'Sent invoice, #42');
  assert.equal(r.entries[0].outcome, 'success');
  assert.equal(r.entries[0].cost, 0.02);
  assert.equal(r.entries[0].proof, 'https://mail/1');
  assert.equal(r.entries[1].outcome, 'fail');
  assert.equal(r.entries[1].human, true);
});

test('JSON, JSONL and plain text import', () => {
  assert.equal(C.parseAny('[{"agent":"A","status":"ok"},{"bot":"B","result":"failed"}]', NOW).entries.length, 2);
  const jl = C.parseAny('{"agent":"A","outcome":"success"}\n{"agent":"B","outcome":"fail"}', NOW);
  assert.equal(jl.entries.length, 2);
  const tx = C.parseAny('Grok Bot: sent the rent reminder, done https://x.co/r $0.01\n2026-11-23 08:00 | Router | posted reply | failed\nno agent on this line', NOW);
  assert.equal(tx.format, 'text');
  assert.equal(tx.entries[0].agent, 'Grok Bot');
  assert.equal(tx.entries[0].proof, 'https://x.co/r');
  assert.equal(tx.entries[0].cost, 0.01);
  assert.equal(tx.entries[1].agent, 'Router');
  assert.equal(tx.entries[1].outcome, 'fail');
  assert.equal(tx.entries[1].time, Date.parse('2026-11-23T08:00'));
  const withDefault = C.parseText('waiting on approval from me', NOW, 'Mail Bot');
  assert.equal(withDefault[0].agent, 'Mail Bot');
  assert.equal(withDefault[0].human, true);
});

test('merge skips duplicates and CSV export round-trips', () => {
  const a = [E('A', 1, 'success', { action: 'one' })];
  const r = C.merge(a, [a[0], E('A', 2, 'fail', { action: 'two' })]);
  assert.equal(r.added, 1); assert.equal(r.skipped, 1);
  const back = C.parseCSV(C.toCSV(r.all), NOW);
  assert.equal(back.length, 2);
  assert.equal(back[1].outcome, 'fail');
});
