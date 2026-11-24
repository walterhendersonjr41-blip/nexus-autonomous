/* NEXUS Autonomous Agent Ledger UI. All data lives in localStorage on this device. */
(function () {
  'use strict';
  const C = window.NexusCore;
  const K = { entries: 'nexus.entries.v1', agents: 'nexus.agents.v1', ai: 'nexus.ai.v1' };
  const $ = (id) => document.getElementById(id);
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  let entries = load(K.entries, []);
  let meta = load(K.agents, {});
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + (n >= 100 ? Math.round(n) : n.toFixed(2));
  const safeUrl = (u) => /^https?:\/\//i.test(u || '') ? u : '';
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }
  function ago(t) { const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + 'm ago'; const h = Math.round(m / 60); if (h < 48) return h + 'h ago'; return Math.round(h / 24) + 'd ago'; }

  function addEntries(list, label) {
    if (!list.length) { toast('Found nothing to log in that. Each line needs an agent name.'); return 0; }
    const r = C.merge(entries, list); entries = r.all; save(K.entries, entries); render();
    toast(`${label}: added ${r.added}${r.skipped ? `, skipped ${r.skipped} duplicate${r.skipped > 1 ? 's' : ''}` : ''}.`);
    return r.added;
  }

  function render() {
    const L = C.computeLedger(entries, meta, Date.now());
    const f = L.fleet;
    const st = $('status');
    st.className = 'status' + (f.runs ? (L.alerts.length ? ' alert' : ' live') : '');
    st.querySelector('span').textContent = !f.runs ? 'No data yet' : L.alerts.length ? `${L.alerts.length} alert${L.alerts.length > 1 ? 's' : ''}` : `Tracking ${L.agents.length}`;
    $('ringValue').textContent = f.runs ? f.provenRate + '%' : '—';
    $('ring').style.setProperty('--p', (f.runs ? f.provenRate : 0) + '%');
    $('ringSub').innerHTML = f.runs ? `${f.proven} of ${f.runs} logged actions were done <i>and</i> came with proof.` : 'Share of logged actions that succeeded <i>and</i> came with proof. Log something below to start.';
    $('vSuccess').textContent = f.successRate == null ? '—' : f.successRate + '%';
    $('vHands').textContent = f.runs ? f.handsFree + '%' : '—';
    $('vSpend').textContent = f.runs ? money(f.cost) : '—';
    $('agentCount').textContent = L.agents.length ? `(${L.agents.length})` : '';

    const box = $('agents');
    if (!L.agents.length) box.innerHTML = '<p class="empty">No agents yet. Log one action from any bot (ChatGPT, Grok, Claude, Gemini, Copilot, a Cursor bot, anything) and it shows up here with an honest trust score.</p>';
    else box.innerHTML = L.agents.map((a, i) => {
      const recent = entries.filter((e) => e.agent === a.name).sort((x, y) => y.time - x.time).slice(0, 8);
      return `<div class="agent${a.paused ? ' paused' : ''}">
        <div class="agent-header"><span class="agent-name">${esc(a.name)}${a.vendor ? ` <span class="muted">· ${esc(a.vendor)}</span>` : ''}</span><span class="score">${a.trust}/100</span></div>
        <div class="word"><b>${esc(a.word)}</b>${a.paused ? ' · <span style="color:var(--orange)">paused</span>' : ''} · last seen ${ago(a.lastSeen)}</div>
        <div class="progress"><div class="progress-fill" style="width:${a.trust}%"></div></div>
        <div class="meta"><span>${a.runs} action${a.runs > 1 ? 's' : ''}</span><span>${a.proven} proven</span><span>${a.success - a.proven} unproven</span><span>${a.fail} failed</span><span>${a.human} needed you</span>${a.cost ? `<span>${money(a.cost)}</span>` : ''}</div>
        <div class="agent-tools">
          <button class="ghost small" data-pause="${i}">${a.paused ? 'Resume' : 'Pause'}</button>
          <button class="ghost small" data-stop="${i}">${a.stopUrl ? 'Edit off-switch link' : 'Add off-switch link'}</button>
          ${a.stopUrl ? `<a class="ghost small" href="${esc(a.stopUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Open off switch</a>` : ''}
          <button class="ghost small warn" data-forget="${i}">Remove</button>
        </div>
        <details><summary>Recent actions</summary><ul>${recent.map((e) => `<li><span class="tag ${e.outcome}">${e.outcome}</span>${esc(e.action || '(no description)')} <span class="muted">· ${new Date(e.time).toLocaleString()}${e.cost ? ' · ' + money(e.cost) : ''}${e.human ? ' · needed you' : ''}</span>${e.proof ? `<br>proof: ${safeUrl(e.proof) ? `<a href="${esc(e.proof)}" target="_blank" rel="noopener noreferrer" style="color:var(--cyan)">${esc(e.proof)}</a>` : esc(e.proof)}` : ''}</li>`).join('')}</ul></details>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-pause]').forEach((b) => b.onclick = () => togglePause(L.agents[+b.dataset.pause].name));
    box.querySelectorAll('[data-stop]').forEach((b) => b.onclick = () => editStop(L.agents[+b.dataset.stop].name));
    box.querySelectorAll('[data-forget]').forEach((b) => b.onclick = () => forgetAgent(L.agents[+b.dataset.forget].name));

    $('alertsCard').hidden = !L.alerts.length;
    $('alerts').innerHTML = L.alerts.map((a) => `<li class="sev${a.severity}">${esc(a.text)}</li>`).join('');
    $('insights').innerHTML = L.insights.length ? L.insights.map((t) => `<li>${esc(t)}</li>`).join('') : '<li>No insights yet. They come only from what you log, never made up.</li>';
    $('action').hidden = !L.action;
    $('action').textContent = L.action ? 'Suggested action: ' + L.action : '';
    $('agentList').innerHTML = L.agents.map((a) => `<option value="${esc(a.name)}">`).join('');
    $('stoplist').innerHTML = L.agents.filter((a) => a.paused).map((a) => `<li><span>${esc(a.name)} <span class="muted">paused</span></span>${a.stopUrl ? `<a class="ghost small" href="${esc(a.stopUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Open off switch</a>` : '<span class="muted">no off-switch link saved</span>'}</li>`).join('');
  }

  function setMeta(name, patch) { meta[name] = Object.assign({}, meta[name], patch); save(K.agents, meta); render(); }
  function togglePause(name) { const p = !(meta[name] || {}).paused; setMeta(name, { paused: p, pausedAt: p ? Date.now() : null }); toast(p ? `${name} paused. If it logs anything now, you'll get an alert.` : `${name} resumed.`); }
  function editStop(name) {
    const cur = (meta[name] || {}).stopUrl || '';
    const v = prompt(`Link to the page where you turn ${name} off (its settings, routine, or API key page):`, cur);
    if (v === null) return;
    if (v && !safeUrl(v.trim())) { toast('That needs to start with https://'); return; }
    setMeta(name, { stopUrl: v.trim() });
  }
  function forgetAgent(name) {
    if (!confirm(`Remove ${name} and all ${entries.filter((e) => e.agent === name).length} of its logged actions?`)) return;
    entries = entries.filter((e) => e.agent !== name); delete meta[name]; save(K.entries, entries); save(K.agents, meta); render();
  }

  // Tabs
  document.querySelectorAll('.tab').forEach((t) => t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
    ['quick', 'paste', 'file'].forEach((n) => ($('pane-' + n).hidden = n !== t.dataset.tab));
  });

  // Quick log
  let outcome = 'success';
  $('qOutcome').querySelectorAll('button').forEach((b) => b.onclick = () => { outcome = b.dataset.v; $('qOutcome').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('pane-quick').onsubmit = (ev) => {
    ev.preventDefault();
    const e = C.normalize({ time: Date.now(), agent: $('qAgent').value, action: $('qAction').value, outcome, proof: $('qProof').value, cost: $('qCost').value, human: $('qHuman').checked });
    if (!e) return toast('Add the agent name.');
    if (addEntries([e], 'Logged')) { $('qAction').value = ''; $('qProof').value = ''; $('qCost').value = ''; $('qHuman').checked = false; }
  };

  // Paste
  $('pasteGo').onclick = () => {
    const r = C.parseAny($('pasteBox').value, Date.now(), $('pasteAgent').value.trim());
    $('pasteMsg').textContent = r.entries.length ? `Read as ${r.format.toUpperCase()}: ${r.entries.length} action${r.entries.length > 1 ? 's' : ''}.` : 'Nothing found. Put one action per line and start it with the agent name, like "Grok Bot: sent the email, done".';
    if (addEntries(r.entries, 'Imported')) $('pasteBox').value = '';
  };

  // File
  $('fileIn').onchange = async () => {
    const f = $('fileIn').files[0]; if (!f) return;
    if (f.size > 5e6) { $('fileMsg').textContent = 'That file is over 5 MB. Split it into smaller files.'; return; }
    const text = await f.text();
    let r;
    try { const v = JSON.parse(text); if (v && v.app === 'nexus-agent-ledger') { return restore(v); } } catch (e) { /* not a backup */ }
    r = C.parseAny(text, Date.now(), f.name.replace(/\.[^.]+$/, ''));
    $('fileMsg').textContent = `${f.name}: read as ${r.format.toUpperCase()}, found ${r.entries.length} action${r.entries.length === 1 ? '' : 's'}.`;
    addEntries(r.entries, 'Imported');
    $('fileIn').value = '';
  };
  function restore(v) {
    if (!confirm(`Restore backup with ${(v.entries || []).length} actions? It merges with what's here.`)) return;
    const clean = (v.entries || []).map((e) => C.normalize(e)).filter(Boolean);
    meta = Object.assign({}, meta, v.agents || {}); save(K.agents, meta);
    addEntries(clean, 'Restored');
  }

  // Kill switch
  $('pauseAll').onclick = () => {
    const names = Object.keys(C.computeLedger(entries, meta).agents.reduce((o, a) => (o[a.name] = 1, o), {}));
    if (!names.length) return toast('No agents to pause yet.');
    const now = Date.now(); names.forEach((n) => (meta[n] = Object.assign({}, meta[n], { paused: true, pausedAt: now }))); save(K.agents, meta); render();
    toast(`Paused ${names.length}. Now open each off-switch link below.`);
    $('stoplist').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  $('resumeAll').onclick = () => { Object.keys(meta).forEach((n) => (meta[n].paused = false, meta[n].pausedAt = null)); save(K.agents, meta); render(); };

  // Data
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('exportCsv').onclick = () => entries.length ? download(`nexus-ledger-${stamp()}.csv`, C.toCSV(entries), 'text/csv') : toast('Nothing to export yet.');
  $('backup').onclick = () => download(`nexus-backup-${stamp()}.json`, JSON.stringify({ app: 'nexus-agent-ledger', version: 1, saved: new Date().toISOString(), entries, agents: meta }, null, 1), 'application/json');
  $('clearAll').onclick = () => { if (confirm('Delete every logged action and agent from this device? This cannot be undone.')) { entries = []; meta = {}; save(K.entries, entries); save(K.agents, meta); render(); } };

  // Optional AI cleanup with the user's own key
  const ai = load(K.ai, {});
  $('aiBase').value = ai.base || ''; $('aiModel').value = ai.model || ''; $('aiKey').value = ai.key || '';
  $('aiSave').onclick = () => { save(K.ai, { base: $('aiBase').value.trim().replace(/\/+$/, ''), model: $('aiModel').value.trim(), key: $('aiKey').value.trim() }); toast('Saved on this device only.'); };
  $('aiForget').onclick = () => { localStorage.removeItem(K.ai); $('aiKey').value = ''; toast('Key forgotten.'); };
  $('aiGo').onclick = async () => {
    const cfg = load(K.ai, {}); const text = $('pasteBox').value.trim();
    if (!text) return toast('Paste something first.');
    if (!cfg.key || !cfg.base || !cfg.model) { document.querySelector('.settings').open = true; document.querySelector('.settings').scrollIntoView({ behavior: 'smooth' }); return toast('Add your API address, model and key first.'); }
    if (!/^https:\/\//.test(cfg.base)) return toast('API address must start with https://');
    $('pasteMsg').textContent = `Sending the pasted text to ${new URL(cfg.base).host}…`;
    try {
      const res = await fetch(cfg.base + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
        body: JSON.stringify({ model: cfg.model, temperature: 0, messages: [
          { role: 'system', content: 'Extract every distinct action an AI agent or bot reports doing. Reply with ONLY a JSON array of objects with keys: time (ISO 8601 or empty), agent, vendor, action, outcome (success|fail|partial|unknown), proof (URL or reference if one is stated, else empty), cost (number USD, 0 if not stated), human (true only if a person had to step in or approve). Never guess success: if the text does not clearly say it worked, use unknown. Never invent proof.' },
          { role: 'user', content: text.slice(0, 20000) }] }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json(); const out = ((j.choices || [])[0] || {}).message?.content || '';
      const m = out.match(/\[[\s\S]*\]/); const list = m ? C.parseJSON(m[0], Date.now()) : [];
      $('pasteMsg').textContent = `AI found ${list.length} action${list.length === 1 ? '' : 's'}.`;
      if (addEntries(list, 'AI import')) $('pasteBox').value = '';
    } catch (e) { $('pasteMsg').textContent = 'AI cleanup failed (' + e.message + '). Check the address, model and key, or use "Read it" instead.'; }
  };

  render();
  setInterval(render, 60000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
