(function () {
  "use strict";

  const TRIGGER_ID = "cxs-trigger";
  const STORAGE_KEY = "cxs.settings.v1";
  const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
  const APP_TITLE = "cxxdraft-search";

  const DEFAULTS = {
    apiKey: "",
    smallModel: "openrouter/free",
    bigModel: "openrouter/free",
    candidateCount: 25,
    excerptChars: 280,
    rerankKeep: 10,
    qaKeep: 8,
  };

  function loadSettings() {
    try {
      return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
    } catch {
      return { ...DEFAULTS };
    }
  }
  function saveSettings(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  let pagefindMod = null;
  async function getPagefind(prefix) {
    if (pagefindMod) return pagefindMod;
    pagefindMod = await import(`${prefix}/pagefind/pagefind.js`);
    await pagefindMod.options({ bundlePath: `${prefix}/pagefind/` });
    pagefindMod.init();
    return pagefindMod;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function rewriteCitations(text, prefix) {
    return text.replace(/\[([a-z][a-z0-9._-]*?)#([0-9.]+)\]/gi, (_, abbr, n) => {
      const href = `${prefix}/${encodeURIComponent(abbr)}/#${encodeURIComponent(n)}`;
      return `<a class="cxs-cite" href="${href}">${escapeHtml(abbr)}#${escapeHtml(n)}</a>`;
    });
  }

  function modalTemplate() {
    return `
<div id="cxs-modal" role="dialog" aria-modal="true" aria-label="Search the C++ standard">
  <div class="cxs-tabs" role="tablist">
    <button class="cxs-tab" role="tab" data-tab="keyword" aria-selected="true">Keyword</button>
    <button class="cxs-tab" role="tab" data-tab="semantic" aria-selected="false">Semantic <span class="cxs-tab-hint">LLM</span></button>
    <button class="cxs-tab" role="tab" data-tab="ask" aria-selected="false">Ask <span class="cxs-tab-hint">LLM</span></button>
    <span class="cxs-spacer"></span>
    <button class="cxs-icon-button" id="cxs-close" aria-label="Close" title="Close (Esc)">&times;</button>
  </div>
  <div class="cxs-input-row">
    <input class="cxs-input" id="cxs-query" type="search" placeholder="Search the standard..." autocomplete="off" spellcheck="false">
    <button class="cxs-go" id="cxs-go" hidden>Run</button>
  </div>
  <div class="cxs-body" id="cxs-body"></div>
  <div class="cxs-settings" id="cxs-settings"></div>
</div>`;
  }

  function settingsPanelHtml(s) {
    return `
<details>
  <summary>Settings &middot; bring your own OpenRouter key</summary>
  <div class="cxs-row">
    <label for="cxs-apikey">OpenRouter key</label>
    <input id="cxs-apikey" type="password" placeholder="sk-or-v1-..." value="${escapeHtml(s.apiKey)}">
  </div>
  <div class="cxs-row">
    <label for="cxs-small">Retrieval model</label>
    <input id="cxs-small" type="text" value="${escapeHtml(s.smallModel)}">
  </div>
  <div class="cxs-row">
    <label for="cxs-big">Answer model</label>
    <input id="cxs-big" type="text" value="${escapeHtml(s.bigModel)}">
  </div>
  <div class="cxs-help">
    Your key is stored in this browser only and posted directly to <code>openrouter.ai</code>.
    Default models are <code>openrouter/free</code> (auto-routed to free models, no credit card required).
    Swap for any model on <a href="https://openrouter.ai/models" target="_blank" rel="noopener">openrouter.ai/models</a>
    (e.g. <code>anthropic/claude-sonnet-4-5</code>, <code>google/gemini-2.5-pro</code>, <code>openai/gpt-5.2</code>,
    or <code>deepseek/deepseek-r1:free</code>). Get a key at
    <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>.
  </div>
</details>`;
  }

  function bindSettings(root, getSettings, setSettings) {
    const wire = (id, key) => {
      const el = root.querySelector(id);
      if (!el) return;
      el.addEventListener("change", () => {
        const s = getSettings();
        s[key] = el.value.trim();
        setSettings(s);
      });
    };
    wire("#cxs-apikey", "apiKey");
    wire("#cxs-small", "smallModel");
    wire("#cxs-big", "bigModel");
  }

  async function openrouterChat({ apiKey, model, system, user, stream = false, max_tokens = 1024, responseFormat, signal, onText }) {
    if (!apiKey) throw new Error("Set your OpenRouter API key in Settings below.");
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: user });

    const body = { model, messages, max_tokens };
    if (stream) body.stream = true;
    if (responseFormat) body.response_format = responseFormat;

    const res = await fetch(OR_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": window.location.origin,
        "X-Title": APP_TITLE,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      let detail = await res.text();
      try { detail = JSON.parse(detail).error?.message || detail; } catch {}
      throw new Error(`OpenRouter ${res.status}: ${detail}`);
    }

    if (!stream) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload);
          const delta = ev.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onText?.(delta, full);
          }
        } catch { /* ignore keep-alives */ }
      }
    }
    return full;
  }

  async function hydeExpand({ settings, query, signal }) {
    const text = await openrouterChat({
      apiKey: settings.apiKey,
      model: settings.smallModel,
      max_tokens: 220,
      system:
        "You are an expert on the ISO C++ working draft. Given a question, write 1-2 sentences that could plausibly appear in the standard and would address the question. Use the standard's vocabulary (terms like 'function template', 'odr-use', 'prvalue', 'narrowing conversion', 'translation unit', 'point of declaration'). Reply with only the paragraph itself; no preamble, no quotes, no headings.",
      user: query,
      signal,
    });
    return text.trim();
  }

  async function pagefindCandidates(pf, query, max) {
    const search = await pf.debouncedSearch(query, undefined, 0);
    if (!search) return [];
    const slice = search.results.slice(0, max);
    const data = await Promise.all(slice.map((r) => r.data()));
    const out = [];
    for (const d of data) {
      const subs = (d.sub_results && d.sub_results.length) ? d.sub_results : [{ url: d.url, title: d.meta?.title || "", excerpt: d.excerpt }];
      for (const sr of subs) {
        out.push({
          url: sr.url || d.url,
          abbr: d.meta?.abbr || "",
          breadcrumb: d.meta?.breadcrumb || d.meta?.title || "",
          title: sr.title || d.meta?.title || "",
          excerpt: stripHtml(sr.excerpt || d.excerpt || ""),
        });
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  function stripHtml(s) {
    const div = document.createElement("div");
    div.innerHTML = s;
    return div.textContent.replace(/\s+/g, " ").trim();
  }

  function anchorFromUrl(url) {
    const u = new URL(url, window.location.href);
    const m = u.pathname.match(/\/([a-z0-9._-]+)\/?$/i);
    const abbr = m ? m[1] : "";
    const para = u.hash ? u.hash.replace(/^#/, "") : "";
    return para ? `${abbr}#${para}` : abbr;
  }

  function compactCandidates(cands, settings) {
    return cands.slice(0, settings.candidateCount).map((c, i) => ({
      idx: i + 1,
      anchor: c.abbr ? (c.url.includes("#") ? `${c.abbr}#${c.url.split("#")[1]}` : c.abbr) : anchorFromUrl(c.url),
      url: c.url,
      breadcrumb: c.breadcrumb,
      excerpt: c.excerpt.slice(0, settings.excerptChars),
    }));
  }

  function parseFirstJson(s) {
    const start = s.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
          }
        }
      }
    }
    return null;
  }

  async function rerank({ settings, query, candidates, signal }) {
    if (candidates.length === 0) return [];
    const blob = candidates.map(c => `[${c.idx}] ${c.anchor}\n${c.breadcrumb}\n${c.excerpt}`).join("\n\n");
    const text = await openrouterChat({
      apiKey: settings.apiKey,
      model: settings.smallModel,
      max_tokens: 1500,
      responseFormat: { type: "json_object" },
      system:
        `You are reranking search results from the ISO C++ working draft. Return the most relevant ${settings.rerankKeep} paragraphs to the user query as JSON. For each, give the original index from the candidate list and a single short sentence (<= 18 words) explaining the relevance. Output ONLY valid JSON of the form {"results":[{"idx":N,"why":"..."},...]}. Do not include unrelated candidates.`,
      user: `Query: ${query}\n\nCandidates:\n\n${blob}`,
      signal,
    });
    const json = parseFirstJson(text);
    if (!json || !Array.isArray(json.results)) return candidates.slice(0, settings.rerankKeep);
    const seen = new Set();
    const ranked = [];
    for (const r of json.results) {
      const idx = Number(r.idx);
      if (!Number.isFinite(idx)) continue;
      const c = candidates.find((x) => x.idx === idx);
      if (!c || seen.has(idx)) continue;
      seen.add(idx);
      ranked.push({ ...c, why: String(r.why || "").slice(0, 200) });
      if (ranked.length >= settings.rerankKeep) break;
    }
    return ranked.length ? ranked : candidates.slice(0, settings.rerankKeep);
  }

  async function answerWithRag({ settings, query, picks, onText, signal }) {
    const sources = picks.slice(0, settings.qaKeep)
      .map((p) => `[${p.anchor}] ${p.breadcrumb}\n${p.excerpt}`)
      .join("\n\n");

    return openrouterChat({
      apiKey: settings.apiKey,
      model: settings.bigModel,
      max_tokens: 1500,
      stream: true,
      system:
        "You are answering questions about the ISO C++ working draft. Use ONLY the supplied paragraphs as your source of truth. Cite every claim inline with [abbr#N] tokens (square brackets, no extra words inside) where abbr#N matches one of the supplied paragraph anchors. Be precise and concise. If the supplied paragraphs do not answer the question, say so plainly.",
      user: `Question: ${query}\n\nSource paragraphs:\n\n${sources}`,
      onText,
      signal,
    });
  }

  function renderCandidates(body, picks) {
    if (picks.length === 0) {
      body.innerHTML = `<div class="cxs-status">No matches.</div>`;
      return;
    }
    body.innerHTML = picks.map((p) => `
      <div class="cxs-result">
        <div class="cxs-result-head">
          <a class="cxs-result-link" href="${escapeHtml(p.url)}">${escapeHtml(p.breadcrumb || p.anchor)}</a>
          <span class="cxs-result-abbr">[${escapeHtml(p.anchor)}]</span>
        </div>
        ${p.why ? `<div class="cxs-result-why">${escapeHtml(p.why)}</div>` : ""}
        <div class="cxs-excerpt">${escapeHtml(p.excerpt)}</div>
      </div>`).join("");
  }

  function renderPagefindResults(body, results) {
    if (results.length === 0) {
      body.innerHTML = `<div class="cxs-status">No matches.</div>`;
      return;
    }
    body.innerHTML = results.map((r) => `
      <div class="cxs-result">
        <div class="cxs-result-head">
          <a class="cxs-result-link" href="${escapeHtml(r.url)}">${escapeHtml(r.breadcrumb || r.title || r.url)}</a>
          ${r.abbr ? `<span class="cxs-result-abbr">[${escapeHtml(r.abbr)}]</span>` : ""}
        </div>
        <div class="cxs-excerpt">${r.excerpt}</div>
      </div>`).join("");
  }

  class SearchUI {
    constructor(prefix) {
      this.prefix = prefix;
      this.overlay = null;
      this.modal = null;
      this.body = null;
      this.input = null;
      this.tab = "keyword";
      this.settings = loadSettings();
      this.abort = null;
    }

    ensureModal() {
      if (this.overlay) return;
      const div = document.createElement("div");
      div.id = "cxs-overlay";
      div.hidden = true;
      div.innerHTML = modalTemplate();
      document.body.appendChild(div);
      this.overlay = div;
      this.modal = div.querySelector("#cxs-modal");
      this.body = div.querySelector("#cxs-body");
      this.input = div.querySelector("#cxs-query");
      this.go = div.querySelector("#cxs-go");
      const settingsEl = div.querySelector("#cxs-settings");
      settingsEl.innerHTML = settingsPanelHtml(this.settings);
      bindSettings(settingsEl, () => this.settings, (s) => { this.settings = s; saveSettings(s); });

      div.addEventListener("click", (e) => { if (e.target === div) this.close(); });
      div.querySelector("#cxs-close").addEventListener("click", () => this.close());
      div.querySelectorAll(".cxs-tab").forEach((btn) => {
        btn.addEventListener("click", () => this.switchTab(btn.dataset.tab));
      });
      this.input.addEventListener("input", () => {
        if (this.tab === "keyword") this.runKeyword();
      });
      this.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          if (this.tab === "semantic") this.runSemantic();
          else if (this.tab === "ask") this.runAsk();
        }
        if (e.key === "Escape") this.close();
      });
      this.go.addEventListener("click", () => {
        if (this.tab === "semantic") this.runSemantic();
        else if (this.tab === "ask") this.runAsk();
      });
    }

    open() {
      this.ensureModal();
      this.overlay.hidden = false;
      setTimeout(() => this.input?.focus(), 0);
    }
    close() {
      if (!this.overlay) return;
      this.abort?.abort();
      this.overlay.hidden = true;
    }
    switchTab(tab) {
      this.tab = tab;
      this.modal.querySelectorAll(".cxs-tab").forEach((b) => {
        b.setAttribute("aria-selected", String(b.dataset.tab === tab));
      });
      this.go.hidden = tab === "keyword";
      this.body.innerHTML = "";
      this.abort?.abort();
      const v = this.input.value.trim();
      if (tab === "keyword" && v) this.runKeyword();
      this.input.focus();
    }

    setStatus(msg, isError = false) {
      this.body.innerHTML = `<div class="cxs-status${isError ? " cxs-error" : ""}">${escapeHtml(msg)}</div>`;
    }

    async runKeyword() {
      const q = this.input.value.trim();
      if (!q) { this.body.innerHTML = ""; return; }
      try {
        const pf = await getPagefind(this.prefix);
        const search = await pf.debouncedSearch(q);
        if (!search) return;
        const slice = search.results.slice(0, 25);
        const data = await Promise.all(slice.map((r) => r.data()));
        const flat = [];
        for (const d of data) {
          const subs = (d.sub_results && d.sub_results.length) ? d.sub_results : [{ url: d.url, title: d.meta?.title, excerpt: d.excerpt }];
          for (const sr of subs) {
            flat.push({
              url: sr.url || d.url,
              abbr: d.meta?.abbr || "",
              breadcrumb: d.meta?.breadcrumb || d.meta?.title || "",
              title: sr.title || "",
              excerpt: sr.excerpt || d.excerpt || "",
            });
            if (flat.length >= 30) break;
          }
          if (flat.length >= 30) break;
        }
        renderPagefindResults(this.body, flat);
      } catch (e) {
        this.setStatus(`Search failed: ${e.message}`, true);
      }
    }

    async runSemantic() {
      const q = this.input.value.trim();
      if (!q) return;
      this.abort?.abort();
      this.abort = new AbortController();
      const signal = this.abort.signal;
      try {
        if (!this.settings.apiKey) throw new Error("Set your OpenRouter API key in Settings below.");
        this.setStatus("Writing hypothetical paragraph...");
        const hyde = await hydeExpand({ settings: this.settings, query: q, signal });
        this.setStatus("Searching the draft...");
        const pf = await getPagefind(this.prefix);
        const cands = await pagefindCandidates(pf, hyde, this.settings.candidateCount);
        if (cands.length === 0) {
          this.setStatus("No paragraphs surfaced from the keyword index for the hypothetical query.");
          return;
        }
        const compact = compactCandidates(cands, this.settings);
        this.setStatus("Reranking with the LLM...");
        const ranked = await rerank({ settings: this.settings, query: q, candidates: compact, signal });
        renderCandidates(this.body, ranked);
      } catch (e) {
        if (e.name === "AbortError") return;
        this.setStatus(e.message, true);
      }
    }

    async runAsk() {
      const q = this.input.value.trim();
      if (!q) return;
      this.abort?.abort();
      this.abort = new AbortController();
      const signal = this.abort.signal;
      try {
        if (!this.settings.apiKey) throw new Error("Set your OpenRouter API key in Settings below.");
        this.setStatus("Retrieving relevant paragraphs...");
        const hyde = await hydeExpand({ settings: this.settings, query: q, signal });
        const pf = await getPagefind(this.prefix);
        const cands = await pagefindCandidates(pf, hyde, this.settings.candidateCount);
        if (cands.length === 0) {
          this.setStatus("No paragraphs surfaced for the question.");
          return;
        }
        const compact = compactCandidates(cands, this.settings);
        const ranked = await rerank({ settings: this.settings, query: q, candidates: compact, signal });

        this.body.innerHTML = `
          <div class="cxs-answer" id="cxs-answer"></div>
          <div class="cxs-sources">
            <h4>Sources</h4>
            <div id="cxs-sources-list"></div>
          </div>`;
        const ansEl = this.body.querySelector("#cxs-answer");
        const srcEl = this.body.querySelector("#cxs-sources-list");
        renderCandidates(srcEl, ranked);

        await answerWithRag({
          settings: this.settings,
          query: q,
          picks: ranked,
          signal,
          onText: (_, full) => {
            ansEl.innerHTML = rewriteCitations(escapeHtml(full), this.prefix);
          },
        });
      } catch (e) {
        if (e.name === "AbortError") return;
        this.setStatus(e.message, true);
      }
    }
  }

  function init() {
    const trigger = document.getElementById(TRIGGER_ID);
    if (!trigger) return;
    const prefix = trigger.dataset.cxsPrefix || ".";
    const ui = new SearchUI(prefix);
    trigger.addEventListener("click", () => ui.open());
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea, [contenteditable]")) return;
      if (e.key === "/") {
        e.preventDefault();
        ui.open();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
