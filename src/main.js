import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import deflist from "markdown-it-deflist";
import { full as emoji } from "markdown-it-emoji";
import mark from "markdown-it-mark";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import hljs from "highlight.js/lib/common";
import powershell from "highlight.js/lib/languages/powershell";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import dos from "highlight.js/lib/languages/dos";
import nginx from "highlight.js/lib/languages/nginx";
import protobuf from "highlight.js/lib/languages/protobuf";
import { platform } from "./platform.js";
import bmcLogo from "./assets/bmc-logo.png";
import bmcQr from "./assets/bmc-qr.png";
import markdownMark from "./assets/markdown-mark.png";
import { GUIDE, GUIDE_SOURCE } from "./welcome-guide.js";

const SUPPORT_URL = "https://buymeacoffee.com/8i0sxlpmdy";
const REPO_URL = "https://github.com/garrettds11/files-md";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------------------------------------------------------------- settings

const DEFAULTS = {
  theme: "system", // light | dark | system
  font: "sans", // sans | serif | mono
  fontSize: 16,
  lineHeight: 1.6,
  width: "medium", // narrow | medium | wide | full
  showToc: true,
  tocNumbers: false,
  tocWidth: 260,
  wrapCode: false,
  syntax: true,
  showSupport: true,
  showWelcome: true,
  ttsEngine: "local", // local | remote
  ttsVoice: "",
  ttsRate: 1,
  ttsSkipCode: true,
  ttsRemoteUrl: "https://api.openai.com/v1/audio/speech",
  ttsRemoteKey: "",
  ttsRemoteModel: "gpt-4o-mini-tts",
  ttsRemoteVoice: "alloy",
  autoReload: true,
  editor: "notepad", // notepad | vscode | notepadpp | custom
  editorPath: "",
  recent: [],
};

let settings = { ...DEFAULTS };
// Last settings known to be saved by the app. Only keys that differ from
// this are sent, so two windows changing different settings never clobber
// each other.
let synced = {};
let saveTimer = null;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function unsavedChanges() {
  const changes = {};
  for (const k of Object.keys(settings)) if (!same(settings[k], synced[k])) changes[k] = settings[k];
  return changes;
}

function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const changes = unsavedChanges();
    if (!Object.keys(changes).length) return;
    synced = { ...synced, ...changes };
    try {
      const where = await platform.updateSettings(changes);
      $("#prefs-note").textContent = `Saved to ${where}`;
    } catch (e) {
      $("#prefs-note").textContent = `Couldn't save settings: ${e}`;
    }
  }, 250);
}

/** Another window changed settings: adopt them, keeping our own unsaved edits. */
function applyRemoteSettings(remote) {
  const pending = unsavedChanges();
  const before = settings;
  synced = { ...DEFAULTS, ...remote };
  settings = { ...synced, ...pending };
  applySettings();
  renderRecent();
  $("#tts-rate").value = String(settings.ttsRate);
  if (before.syntax !== settings.syntax && doc.path) renderDoc(doc.path, { keepScroll: true });
  const ttsKeys = Object.keys(settings).filter((k) => k.startsWith("tts") && k !== "ttsRate");
  if (ttsKeys.some((k) => !same(before[k], settings[k]))) tts.settingsChanged();
}

function setPref(key, value) {
  settings[key] = value;
  applySettings();
  saveSettings();
  if (key === "syntax" && doc.path) renderDoc(doc.path, { keepScroll: true });
  if (key.startsWith("tts") && key !== "ttsRate") tts.settingsChanged();
}

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
systemDark.addEventListener("change", () => applySettings());

function applySettings() {
  const root = document.documentElement;
  const theme = settings.theme === "system" ? (systemDark.matches ? "dark" : "light") : settings.theme;
  root.dataset.theme = theme;
  root.dataset.font = settings.font;
  root.dataset.width = settings.width;
  root.style.setProperty("--font-size", `${settings.fontSize}px`);
  root.style.setProperty("--line-height", settings.lineHeight);
  root.style.setProperty("--toc-width", `${settings.tocWidth}px`);
  document.body.classList.toggle("toc-hidden", !settings.showToc);
  document.body.classList.toggle("toc-numbers", settings.tocNumbers);
  document.body.classList.toggle("wrap-code", settings.wrapCode);
  document.body.classList.toggle("editor-custom", settings.editor === "custom");
  document.body.classList.toggle("tts-remote-on", settings.ttsEngine === "remote");
  document.body.classList.toggle("hide-support", !settings.showSupport);
  const names = { notepad: "Notepad", vscode: "VS Code", notepadpp: "Notepad++" };
  const customName = settings.editorPath.split(/[\\/]/).pop().replace(/\.exe$/i, "");
  for (const el of $$(".editor-name")) el.textContent = names[settings.editor] || customName || "editor";
  syncPrefControls();
  setupAutoReload();
}

function syncPrefControls() {
  for (const el of $$("[data-pref]")) {
    const key = el.dataset.pref;
    const v = settings[key];
    if (el.classList.contains("segmented")) {
      for (const b of el.querySelectorAll("button")) b.classList.toggle("active", b.value === v);
    } else if (el.type === "checkbox") el.checked = !!v;
    else el.value = v;
  }
  $("#fontSize-out").textContent = `${settings.fontSize}px`;
  $("#lineHeight-out").textContent = Number(settings.lineHeight).toFixed(2);
}

function bindPrefControls() {
  for (const el of $$("[data-pref]")) {
    const key = el.dataset.pref;
    if (el.classList.contains("segmented")) {
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (b) { e.preventDefault(); setPref(key, b.value); }
      });
    } else if (el.type === "checkbox") {
      el.addEventListener("change", () => setPref(key, el.checked));
    } else if (el.type === "text" || el.type === "password") {
      el.addEventListener("change", () => setPref(key, el.value.trim().replace(/^"|"$/g, "")));
    } else if (el.type === "range") {
      el.addEventListener("input", () => setPref(key, Number(el.value)));
    } else {
      el.addEventListener("change", () => setPref(key, el.value));
    }
  }
}

// ---------------------------------------------------------------- markdown

hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("dos", dos);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("protobuf", protobuf);
hljs.registerAliases(["ps1", "pwsh", "ps"], { languageName: "powershell" });
hljs.registerAliases(["bat", "cmd", "batch"], { languageName: "dos" });
hljs.registerAliases(["toml"], { languageName: "ini" });
hljs.registerAliases(["jsonc", "json5"], { languageName: "json" });

const escapeHtml = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  // Colors code blocks by language. Unknown or missing language = plain text
  // (no auto-detection: guessing often colors prose/logs wrongly).
  highlight(code, lang) {
    const name = (lang || "").trim().toLowerCase();
    if (settings.syntax && name && hljs.getLanguage(name)) {
      try {
        return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
      } catch {}
    }
    return escapeHtml(code);
  },
});

// Extended syntax: footnotes, definition lists, :emoji:, ==highlight==, H~2~O, X^2^.
md.use(footnote).use(deflist).use(emoji).use(mark).use(sub).use(sup);

// Auto-link the way GitHub does: full URLs (https://…), www. addresses, and
// email addresses. Bare names like "README.md" or "notes.txt" stay text,
// even though .md and others are real web domains.
md.linkify.set({ fuzzyLink: true, fuzzyEmail: true });
md.core.ruler.after("linkify", "linkify_like_github", (state) => {
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const out = [];
    const kids = block.children;
    for (let i = 0; i < kids.length; i++) {
      const t = kids[i];
      if (t.type === "link_open" && t.markup === "linkify") {
        const text = kids[i + 1]?.content || "";
        const keep = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^www\./i.test(text) || /^mailto:/i.test(text) || /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(text);
        if (!keep) {
          // Drop link_open / link_close, keep the text.
          out.push(kids[i + 1]);
          i += 2;
          continue;
        }
      }
      out.push(t);
    }
    block.children = out;
  }
});

function slugify(text) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-") || "section"
  );
}

// Give every heading a unique id and collect them for the headings pane.
md.core.ruler.push("heading_ids", (state) => {
  const used = new Map();
  const headings = [];
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "heading_open") continue;
    const inline = tokens[i + 1];
    // Custom heading ID: "### My Great Heading {#custom-id}"
    let custom = null;
    const last = inline.children[inline.children.length - 1];
    const m = last?.type === "text" && last.content.match(/\s*\{#([A-Za-z][\w-]*)\}\s*$/);
    if (m) {
      custom = m[1];
      last.content = last.content.slice(0, m.index);
    }
    const text = inline.children
      .filter((c) => c.type === "text" || c.type === "code_inline")
      .map((c) => c.content)
      .join("")
      .trim();
    let id = custom || slugify(text);
    const n = used.get(id) || 0;
    used.set(id, n + 1);
    if (n) id = `${id}-${n}`;
    t.attrSet("id", id);
    headings.push({ level: Number(t.tag.slice(1)), text, id });
  }
  state.env.headings = headings;
});

// ---------------------------------------------------------------- document

const doc = {
  path: null,
  dir: "",
  modified: 0,
  headings: [],
};

function joinPath(dir, rel) {
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith("\\\\") || rel.startsWith("/")) return rel;
  const sep = dir.includes("\\") ? "\\" : "/";
  const parts = dir.split(/[\\/]/);
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join(sep);
}

const isExternal = (href) => /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-zA-Z]:[\\/]/.test(href);

/** Read a file and show it in the document view. Returns false if it couldn't be read. */
async function renderDoc(path, { keepScroll = false, scroll = 0, heading = null } = {}) {
  let file;
  try {
    file = await platform.readMarkdown(path);
  } catch (e) {
    toast(String(e));
    settings.recent = settings.recent.filter((p) => p !== path);
    saveSettings();
    renderRecent();
    return false;
  }
  const content = $("#content");
  if (keepScroll) scroll = content.scrollTop;

  const env = {};
  const html = md.render(file.content, env);
  const article = $("#doc");
  article.innerHTML = html;
  doc.path = file.path;
  doc.dir = file.dir;
  doc.modified = file.modified;
  doc.headings = env.headings || [];

  fixupContent(article);
  document.body.classList.add("has-doc");
  $("#doc-title").textContent = file.name;
  platform.setTitle(`${file.name} — Files.md`);
  buildToc();
  content.scrollTop = scroll;
  if (heading && document.getElementById(heading)) {
    document.getElementById(heading).scrollIntoView({ block: "start" });
    flashHeading(heading);
  }
  updateActiveHeading();

  tts.documentChanged();
  find.refresh();

  settings.recent = [file.path, ...settings.recent.filter((p) => p !== file.path)].slice(0, 10);
  saveSettings();
  renderRecent();
  return true;
}

// ---------------------------------------------------------------- find in document

/**
 * Find bar. Matches are shown with the CSS Custom Highlight API, so the
 * document's DOM is never modified. Matching runs over the whole text of
 * the document, so a phrase spanning **bold** or `code` still matches.
 */
const find = (() => {
  const bar = $("#find-bar");
  const input = $("#find-input");
  const count = $("#find-count");
  const supported = typeof Highlight !== "undefined" && CSS.highlights;
  let ranges = [];
  let current = -1;

  function textIndex() {
    const nodes = [];
    let text = "";
    const walker = document.createTreeWalker($("#doc"), NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest(".code-bar") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n, start: text.length });
      text += n.data;
    }
    return { nodes, text };
  }

  function locate(nodes, offset) {
    let lo = 0, hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (nodes[mid].start <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { node: nodes[lo].node, offset: offset - nodes[lo].start };
  }

  function paint() {
    if (!supported) return;
    CSS.highlights.delete("find");
    CSS.highlights.delete("find-current");
    if (ranges.length) CSS.highlights.set("find", new Highlight(...ranges));
    if (ranges[current]) CSS.highlights.set("find-current", new Highlight(ranges[current]));
  }

  function showCount() {
    const q = input.value;
    count.textContent = !q ? "" : ranges.length ? `${current + 1} of ${ranges.length}` : "No matches";
    bar.classList.toggle("no-match", !!q && !ranges.length);
  }

  function reveal() {
    const r = ranges[current];
    if (!r) return;
    const content = $("#content");
    const box = r.getBoundingClientRect();
    const view = content.getBoundingClientRect();
    if (box.top < view.top + 60 || box.bottom > view.bottom - 40) {
      content.scrollTop += box.top - view.top - view.height / 3;
    }
  }

  function search({ keepPosition = false } = {}) {
    const q = input.value;
    const prevStart = keepPosition && ranges[current] ? current : 0;
    ranges = [];
    current = -1;
    if (q && doc.path) {
      const { nodes, text } = textIndex();
      const hay = $("#find-case").checked ? text : text.toLowerCase();
      const needle = $("#find-case").checked ? q : q.toLowerCase();
      for (let i = hay.indexOf(needle); i !== -1 && ranges.length < 5000; i = hay.indexOf(needle, i + needle.length)) {
        const a = locate(nodes, i);
        const b = locate(nodes, i + needle.length - 1);
        const range = document.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset + 1);
        ranges.push(range);
      }
      if (ranges.length) {
        current = Math.min(prevStart, ranges.length - 1);
        if (!keepPosition) {
          // Start at the first match below the top of the visible area.
          const top = $("#content").getBoundingClientRect().top;
          const idx = ranges.findIndex((r) => r.getBoundingClientRect().top >= top);
          current = idx === -1 ? 0 : idx;
        }
      }
    }
    paint();
    showCount();
    if (!keepPosition) reveal();
  }

  function step(dir) {
    if (!ranges.length) return search();
    current = (current + dir + ranges.length) % ranges.length;
    paint();
    showCount();
    reveal();
  }

  function open() {
    if (!doc.path) return toast("Open a file to search it");
    bar.hidden = false;
    const sel = window.getSelection().toString().trim();
    if (sel && !sel.includes("\n") && sel.length < 100) input.value = sel;
    input.focus();
    input.select();
    search();
  }

  function close() {
    bar.hidden = true;
    ranges = [];
    current = -1;
    paint();
    $("#content").focus({ preventScroll: true });
  }

  let debounce = 0;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(search, 120);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  $("#find-next").addEventListener("click", () => step(1));
  $("#find-prev").addEventListener("click", () => step(-1));
  $("#find-close").addEventListener("click", close);
  $("#find-case").addEventListener("change", () => search());

  return {
    open,
    close,
    isOpen: () => !bar.hidden,
    // Document re-rendered (tab switch, reload, edit on disk): search again.
    refresh() {
      if (bar.hidden) return;
      if (!doc.path) return close();
      search({ keepPosition: true });
    },
  };
})();

// ---------------------------------------------------------------- welcome tab

/** Open (or switch to) the built-in Welcome tab. It is a page, not a file. */
async function openWelcome() {
  let tab = tabs.find((t) => t.kind === "welcome");
  if (!tab) {
    tab = { id: ++tabSeq, kind: "welcome", path: null, name: "Welcome", scroll: 0 };
    tabs.splice(activeTab ? tabs.indexOf(activeTab) + 1 : tabs.length, 0, tab);
  }
  await activateTab(tab);
}

function showWelcomeTab(tab) {
  tts.close();
  if (find.isOpen()) find.close();
  doc.path = null;
  doc.headings = [];
  $("#doc").innerHTML = "";
  document.body.classList.remove("has-doc");
  $("#doc-title").textContent = "Welcome";
  platform.setTitle("Welcome — Files.md");
  if (!$("#welcome-page").childElementCount) buildWelcomePage();
  $("#welcome-show").checked = settings.showWelcome;
  $("#content").scrollTop = tab.scroll || 0;
}

function buildWelcomePage() {
  const page = $("#welcome-page");
  const esc = escapeHtml;
  const sections = GUIDE.map((section) => {
    const rows = section.items.map((item, i) => `
      <div class="gx-row" data-section="${esc(section.title)}" data-index="${i}">
        <div class="gx-name">${esc(item.name)}</div>
        <div class="gx-syntax"><pre><code>${esc(item.md)}</code></pre><button class="copy-btn gx-copy" type="button">Copy</button></div>
        <div class="gx-result markdown-body"></div>
      </div>`).join("");
    return `
      <section class="gx-section">
        <h2>${esc(section.title)}</h2>
        <p class="gx-intro">${esc(section.intro)}</p>
        <div class="gx-table">
          <div class="gx-head"><span>Element</span><span>Markdown</span><span>Result</span></div>
          ${rows}
        </div>
      </section>`;
  }).join("");

  page.innerHTML = `
    <header class="wp-hero">
      <span class="wp-mark" role="img" aria-label="Markdown logo"></span>
      <a class="wp-link" href="${GUIDE_SOURCE.site}">markdownguide.org</a>
    </header>
    <div class="wp-cheatsheet">
      <h1>Markdown cheat sheet</h1>
      <p class="gx-lead">A quick overview of Markdown syntax. For details and edge cases, see the
        <a href="${GUIDE_SOURCE.basicUrl}">basic syntax</a> and
        <a href="${GUIDE_SOURCE.extendedUrl}">extended syntax</a> guides.</p>
      ${sections}
    </div>
    <footer class="wp-footer">
      <p class="wp-credit">Cheat sheet adapted from the
        <a href="${GUIDE_SOURCE.url}">${GUIDE_SOURCE.title}</a> in
        <a href="${GUIDE_SOURCE.site}">The Markdown Guide</a> by ${GUIDE_SOURCE.author},
        licensed under <a href="${GUIDE_SOURCE.licenseUrl}">${GUIDE_SOURCE.license}</a>. Changes were made.</p>
      <label class="check"><input type="checkbox" id="welcome-show" /> Show this page when Files.md starts</label>
    </footer>`;
  page.querySelector(".wp-mark").style.setProperty("--mark", `url("${markdownMark}")`);

  // Live previews, drawn with the same renderer as documents.
  for (const row of page.querySelectorAll(".gx-row")) {
    const section = GUIDE.find((s) => s.title === row.dataset.section);
    const item = section.items[Number(row.dataset.index)];
    const out = row.querySelector(".gx-result");
    out.innerHTML = md.render(item.md, {});
    out.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    if (item.image) {
      const img = out.querySelector("img");
      if (img) { img.src = markdownMark; img.classList.add("gx-img"); }
    }
    for (const li of out.querySelectorAll("li")) {
      const m = li.firstChild?.nodeType === 3 && li.firstChild.textContent.match(/^\[( |x|X)\]\s/);
      if (m) {
        li.firstChild.textContent = li.firstChild.textContent.slice(m[0].length);
        const box = document.createElement("input");
        box.type = "checkbox";
        box.disabled = true;
        box.checked = m[1] !== " ";
        li.prepend(box);
        li.classList.add("task");
      }
    }
    row.querySelector(".gx-copy").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try { await navigator.clipboard.writeText(item.md); btn.textContent = "Copied"; } catch { btn.textContent = "Couldn't copy"; }
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    });
  }

  page.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    e.preventDefault();
    if (/^https?:/i.test(a.getAttribute("href"))) platform.openExternal(a.href);
  });
  $("#welcome-show").addEventListener("change", (e) => setPref("showWelcome", e.target.checked));
}

// ---------------------------------------------------------------- tabs

const tabs = []; // { id, path, name, scroll, heading }
let activeTab = null;
let tabSeq = 0;

const baseName = (p) => p.split(/[\\/]/).pop();
const samePath = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function rememberPosition() {
  if (!activeTab) return;
  activeTab.scroll = $("#content").scrollTop;
  activeTab.heading = activeId;
}

/**
 * Open a file. By default it goes in a new tab (or focuses its existing tab);
 * with { replace: true } it replaces the current tab (following a link).
 */
async function openFile(path, { replace = false, scroll = 0, heading = null, background = false } = {}) {
  const existing = tabs.find((t) => samePath(t.path, path));
  if (existing) {
    // Already open: switch to it (never open the same file twice in one window).
    if (!background && existing !== activeTab) await activateTab(existing);
    if (heading && existing === activeTab) scrollToHeading(heading);
    return existing;
  }
  if (replace && activeTab) {
    const tab = activeTab;
    if (await renderDoc(path, { scroll, heading })) {
      tab.path = doc.path;
      tab.name = baseName(doc.path);
      tab.scroll = 0;
    }
    renderTabs();
    return tab;
  }
  const tab = { id: ++tabSeq, path, name: baseName(path), scroll, heading };
  const at = activeTab ? tabs.indexOf(activeTab) + 1 : tabs.length;
  tabs.splice(at, 0, tab);
  if (background) {
    renderTabs();
    return tab;
  }
  if (!(await activateTab(tab))) {
    tabs.splice(tabs.indexOf(tab), 1);
    activeTab = null;
    const fallback = tabs[at - 1] || tabs[0];
    if (fallback) await activateTab(fallback);
    else showWelcome();
    return null;
  }
  return tab;
}

async function activateTab(tab) {
  if (tab !== activeTab) rememberPosition();
  activeTab = tab;
  renderTabs();
  document.body.classList.toggle("welcome-tab", tab.kind === "welcome");
  if (tab.kind === "welcome") {
    showWelcomeTab(tab);
    return true;
  }
  const ok = await renderDoc(tab.path, { scroll: tab.scroll, heading: tab.scroll ? null : tab.heading });
  if (ok) {
    tab.path = doc.path;
    tab.name = baseName(doc.path);
    renderTabs();
  }
  return ok;
}

async function closeTab(tab = activeTab) {
  if (!tab) return;
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  if (tab !== activeTab) return renderTabs();
  activeTab = null;
  const next = tabs[i] || tabs[i - 1];
  if (next) return activateTab(next);
  showWelcome();
}

function showWelcome() {
  document.body.classList.remove("welcome-tab");
  renderTabs();
  tts.close();
  doc.path = null;
  doc.headings = [];
  $("#doc").innerHTML = "";
  document.body.classList.remove("has-doc");
  $("#doc-title").textContent = "Files.md";
  platform.setTitle("Files.md");
}

function cycleTab(step) {
  if (tabs.length < 2 || !activeTab) return;
  const i = (tabs.indexOf(activeTab) + step + tabs.length) % tabs.length;
  activateTab(tabs[i]);
}

/** Move a tab into its own window, keeping its place in the document. */
async function popOutTab(tab = activeTab) {
  if (!tab || tab.kind === "welcome") return;
  if (tab === activeTab) rememberPosition();
  try {
    await platform.openWindow({ paths: [tab.path], scroll: tab.scroll || 0, heading: tab.heading || null });
    closeTab(tab);
  } catch (e) {
    toast(`Couldn't open a new window: ${e}`);
  }
}

function renderTabs() {
  const bar = $("#tab-list");
  bar.innerHTML = "";
  document.body.classList.toggle("has-tabs", tabs.length > 0);
  for (const tab of tabs) {
    const el = document.createElement("div");
    el.className = "tab";
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", tab === activeTab);
    el.title = tab.path;
    el.dataset.id = tab.id;
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = tab.name;
    const close = document.createElement("button");
    close.className = "tab-close";
    close.setAttribute("aria-label", `Close ${tab.name}`);
    close.textContent = "✕";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab);
    });
    el.append(name, close);
    el.addEventListener("mousedown", (e) => {
      if (e.button === 1) { e.preventDefault(); closeTab(tab); }
    });
    el.addEventListener("click", () => tab !== activeTab && activateTab(tab));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showTabMenu(tab, e.clientX, e.clientY);
    });
    bar.appendChild(el);
    if (tab === activeTab) requestAnimationFrame(() => el.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }
}

function showTabMenu(tab, x, y) {
  const menu = $("#tab-menu");
  const fileItems = tab.kind === "welcome" ? [] : [
    ["Move to new window", () => popOutTab(tab)],
    ["Copy file path", async () => { await navigator.clipboard.writeText(tab.path); toast("File path copied"); }],
    null,
  ];
  const items = [
    ...fileItems,
    ["Close", () => closeTab(tab)],
    ["Close other tabs", () => {
      for (const t of [...tabs]) if (t !== tab) tabs.splice(tabs.indexOf(t), 1);
      tab === activeTab ? renderTabs() : activateTab(tab);
    }],
  ];
  menu.innerHTML = "";
  for (const item of items) {
    if (!item) { menu.appendChild(document.createElement("hr")); continue; }
    const b = document.createElement("button");
    b.textContent = item[0];
    b.addEventListener("click", () => { hideTabMenu(); item[1](); });
    menu.appendChild(b);
  }
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
}
function hideTabMenu() { $("#tab-menu").hidden = true; }
document.addEventListener("mousedown", (e) => { if (!e.target.closest("#tab-menu")) hideTabMenu(); });
window.addEventListener("blur", hideTabMenu);

// Mouse wheel scrolls the tab strip sideways.
$("#tab-list").addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.currentTarget.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}, { passive: false });

async function openPaths(paths, opts = {}) {
  let first = true;
  for (const p of paths) {
    await openFile(p, first ? opts : {});
    first = false;
  }
}

function fixupContent(article) {
  // Hovering a link shows where it goes.
  for (const a of article.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!a.title && href && !href.startsWith("#")) a.title = isExternal(href) ? href : decodeURI(href);
  }

  // Code blocks: language label + Copy button.
  for (const pre of article.querySelectorAll("pre")) {
    const code = pre.querySelector("code");
    if (!code) continue;
    const lang = [...code.classList].find((c) => c.startsWith("language-"))?.slice(9) || "";
    const known = lang && hljs.getLanguage(lang);
    const bar = document.createElement("div");
    bar.className = "code-bar";
    const label = document.createElement("span");
    label.textContent = known ? known.name.split(/[ ,]/)[0] : lang;
    const copy = document.createElement("button");
    copy.className = "copy-btn";
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(code.textContent);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Couldn't copy";
      }
      setTimeout(() => (copy.textContent = "Copy"), 1500);
    });
    bar.append(label, copy);
    pre.classList.add(label.textContent ? "has-bar" : "no-lang");
    pre.prepend(bar);
    if (known && settings.syntax) code.classList.add("hljs");
  }

  // Local images: resolve relative to the Markdown file's folder.
  for (const img of article.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (!isExternal(src) && !src.startsWith("data:") && doc.dir) {
      img.src = platform.fileUrl(joinPath(doc.dir, decodeURI(src)));
    }
    img.loading = "lazy";
  }
  // Wrap tables so wide ones scroll instead of overflowing the page.
  for (const table of article.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.appendChild(table);
  }
  // Task lists: "[ ] item" / "[x] item"
  for (const li of article.querySelectorAll("li")) {
    const first = li.firstChild?.nodeType === 3 ? li.firstChild : li.querySelector(":scope > p")?.firstChild;
    if (first?.nodeType === 3) {
      const m = first.textContent.match(/^\[( |x|X)\]\s/);
      if (m) {
        first.textContent = first.textContent.slice(m[0].length);
        const box = document.createElement("input");
        box.type = "checkbox";
        box.disabled = true;
        box.checked = m[1] !== " ";
        first.parentNode.insertBefore(box, first);
        li.classList.add("task");
      }
    }
  }
}

// Programs and scripts are never launched from a document link; their folder
// is opened instead, so a malicious .md file can't run anything.
const RISKY_FILE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|hta|cpl|lnk|reg|jar|appref-ms)$/i;

async function followLink(a, e) {
  const href = a.getAttribute("href");
  if (!href) return;
  const newTab = e.ctrlKey || e.metaKey || e.button === 1;
  try {
    if (href.startsWith("#")) {
      scrollToHeading(decodeURIComponent(href.slice(1)));
    } else if (isExternal(href)) {
      if (!/^(https?|mailto|tel):/i.test(href)) return toast(`Files.md doesn't open ${href.split(":")[0]}: links`);
      await platform.openExternal(href);
    } else if (doc.dir) {
      const [file, hash] = href.split("#");
      const target = file ? joinPath(doc.dir, decodeURI(file)) : doc.path;
      if (/\.(md|markdown|mdown|mkd|mkdn|mdx|txt)$/i.test(target)) {
        await openFile(target, { replace: !newTab, heading: hash ? decodeURIComponent(hash) : null });
      } else if (RISKY_FILE.test(target)) {
        await platform.revealFile(target);
        toast("Programs aren't opened from links. Its folder was opened instead.");
      } else {
        await platform.openPath(target);
      }
    }
  } catch (err) {
    toast(`Couldn't open the link: ${err?.message || err}`);
  }
}

$("#doc").addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  e.preventDefault();
  followLink(a, e);
});
// Middle-click a link: same as Ctrl+click.
$("#doc").addEventListener("auxclick", (e) => {
  const a = e.target.closest("a[href]");
  if (!a || e.button !== 1) return;
  e.preventDefault();
  followLink(a, e);
});
$("#doc").addEventListener("mousedown", (e) => {
  if (e.button === 1 && e.target.closest("a[href]")) e.preventDefault(); // no autoscroll
});

// ---------------------------------------------------------------- headings pane

function buildToc() {
  const list = $("#toc-list");
  list.innerHTML = "";
  const min = Math.min(...doc.headings.map((h) => h.level), 6);
  const counters = [0, 0, 0, 0, 0, 0];
  // A single top-level title (e.g. one H1) isn't numbered; its sections become 1, 2, 3…
  const skipTitle = doc.headings.filter((h) => h.level === min).length === 1 && doc.headings.length > 1;
  for (const h of doc.headings) {
    const depth = h.level - min;
    counters[depth]++;
    for (let i = depth + 1; i < 6; i++) counters[i] = 0;
    const li = document.createElement("li");
    li.style.setProperty("--depth", depth);
    li.dataset.id = h.id;
    const a = document.createElement("a");
    a.href = `#${h.id}`;
    a.title = h.text;
    const num = document.createElement("span");
    num.className = "num";
    const parts = counters.slice(skipTitle ? 1 : 0, depth + 1).map((n) => n || 1);
    num.textContent = parts.join(".");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = h.text;
    a.append(num, label);
    li.appendChild(a);
    list.appendChild(li);
  }
  $("#toc-empty").hidden = doc.headings.length > 0;
}

$("#toc-list").addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;
  e.preventDefault();
  scrollToHeading(a.parentElement.dataset.id);
});

function scrollToHeading(id) {
  const el = document.getElementById(id);
  if (!el) return toast(`No heading "${id}" in this document`);
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  flashHeading(id);
}

function flashHeading(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

let activeId = null;
function updateActiveHeading() {
  const content = $("#content");
  const top = content.getBoundingClientRect().top + 80;
  let current = doc.headings[0]?.id ?? null;
  for (const h of doc.headings) {
    const el = document.getElementById(h.id);
    if (el && el.getBoundingClientRect().top <= top) current = h.id;
    else break;
  }
  if (current === activeId) return;
  activeId = current;
  for (const li of $("#toc-list").children) {
    const on = li.dataset.id === current;
    li.classList.toggle("active", on);
    if (on) li.scrollIntoView({ block: "nearest" });
  }
}

let scrollRaf = 0;
$("#content").addEventListener("scroll", () => {
  cancelAnimationFrame(scrollRaf);
  scrollRaf = requestAnimationFrame(updateActiveHeading);
});

// Drag the divider to resize the headings pane.
(() => {
  const handle = $("#toc-resizer");
  handle.addEventListener("pointerdown", (e) => {
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const move = (ev) => {
      settings.tocWidth = Math.max(160, Math.min(480, ev.clientX));
      document.documentElement.style.setProperty("--toc-width", `${settings.tocWidth}px`);
    };
    const up = () => {
      document.body.classList.remove("resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      saveSettings();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
})();

// ---------------------------------------------------------------- auto reload

let reloadTimer = null;
function setupAutoReload() {
  clearInterval(reloadTimer);
  if (!settings.autoReload || !platform.isTauri) return;
  reloadTimer = setInterval(async () => {
    if (!doc.path) return;
    const m = await platform.fileModified(doc.path).catch(() => 0);
    if (m && m !== doc.modified) renderDoc(doc.path, { keepScroll: true });
  }, 1000);
}

// ---------------------------------------------------------------- menus

function closeMenus() {
  for (const m of $$(".menu.open")) m.classList.remove("open");
}

for (const menu of $$(".menu")) {
  const btn = menu.querySelector(".menu-button");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = menu.classList.contains("open");
    closeMenus();
    if (!wasOpen) menu.classList.add("open");
  });
  btn.addEventListener("mouseenter", () => {
    if ($(".menu.open") && !menu.classList.contains("open")) {
      closeMenus();
      menu.classList.add("open");
    }
  });
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".submenu-button")) closeMenus();
});

function renderRecent() {
  const list = $("#recent-list");
  list.innerHTML = "";
  if (!settings.recent.length) {
    const b = document.createElement("button");
    b.disabled = true;
    b.textContent = "No recent files";
    list.appendChild(b);
    return;
  }
  for (const p of settings.recent) {
    const b = document.createElement("button");
    b.textContent = p.split(/[\\/]/).pop();
    b.title = p;
    b.addEventListener("click", () => openFile(p));
    if (tabs.some((t) => samePath(t.path, p))) b.classList.add("is-open");
    list.appendChild(b);
  }
  list.appendChild(document.createElement("hr"));
  const clear = document.createElement("button");
  clear.textContent = "Clear recent";
  clear.addEventListener("click", () => { settings.recent = []; saveSettings(); renderRecent(); });
  list.appendChild(clear);
}

const actions = {
  async open() {
    const paths = await platform.pickFile();
    if (paths?.length) openPaths(paths);
  },
  find() { find.open(); },
  welcome() { openWelcome(); },
  "close-tab"() { activeTab ? closeTab() : null; },
  "next-tab"() { cycleTab(1); },
  "prev-tab"() { cycleTab(-1); },
  "pop-out"() { activeTab ? popOutTab() : toast("Open a file first"); },
  async "new-window"() {
    try {
      await platform.openWindow(null);
    } catch (e) {
      toast(`Couldn't open a new window: ${e}`);
    }
  },
  async edit() {
    if (!doc.path) return;
    try {
      await platform.openInEditor(doc.path, settings.editor, settings.editorPath);
    } catch (e) {
      toast(String(e));
    }
  },
  async "browse-editor"() {
    const exe = await platform.pickExecutable();
    if (exe) setPref("editorPath", exe);
  },
  reload() { if (doc.path) renderDoc(doc.path, { keepScroll: true }); },
  async "copy-path"() {
    if (!doc.path) return;
    await navigator.clipboard.writeText(doc.path);
    toast("File path copied");
  },
  async print() {
    if (!doc.path) return toast("Open a file to print it");
    closeMenus();
    try {
      await platform.print();
    } catch (e) {
      toast(`Couldn't open the print dialog: ${e}`);
    }
  },
  "read-aloud"() { tts.toggle(); },
  async "tts-clear-cache"() {
    tts.stop();
    try {
      await platform.ttsCacheClear();
      toast("Audio cache cleared");
    } catch (e) {
      toast(String(e));
    }
    tts.refreshCacheInfo();
    tts.documentChanged();
  },
  quit() { platform.quit(); },
  "toggle-toc"() { setPref("showToc", !settings.showToc); },
  "toggle-prefs"() { document.body.classList.toggle("prefs-open"); },
  "theme:light"() { setPref("theme", "light"); },
  "theme:dark"() { setPref("theme", "dark"); },
  "theme:system"() { setPref("theme", "system"); },
  "zoom-in"() { setPref("fontSize", Math.min(24, settings.fontSize + 1)); },
  "zoom-out"() { setPref("fontSize", Math.max(12, settings.fontSize - 1)); },
  "zoom-reset"() { setPref("fontSize", DEFAULTS.fontSize); },
  "reset-prefs"() {
    const { recent, tocWidth } = settings;
    settings = { ...DEFAULTS, recent, tocWidth };
    applySettings();
    saveSettings();
  },
  shortcuts() {
    showDialog(`<h2>Keyboard shortcuts</h2>
      <table class="kbd-table">
        <tr><td><kbd>Ctrl+O</kbd></td><td>Open a file</td></tr>
        <tr><td><kbd>Ctrl+E</kbd></td><td>Edit in your editor</td></tr>
        <tr><td><kbd>Ctrl+P</kbd></td><td>Print / Save as PDF</td></tr>
        <tr><td><kbd>Ctrl+Shift+U</kbd></td><td>Read aloud</td></tr>
        <tr><td><kbd>Space</kbd></td><td>Play / pause (while reading aloud)</td></tr>
        <tr><td><kbd>Ctrl+W</kbd></td><td>Close tab</td></tr>
        <tr><td><kbd>Ctrl+Tab</kbd> / <kbd>Ctrl+Shift+Tab</kbd></td><td>Next / previous tab</td></tr>
        <tr><td><kbd>Ctrl+1</kbd>…<kbd>Ctrl+9</kbd></td><td>Go to tab (9 = last)</td></tr>
        <tr><td><kbd>Ctrl+N</kbd></td><td>New window</td></tr>
        <tr><td>Ctrl+click a link</td><td>Open linked file in a new tab</td></tr>
        <tr><td><kbd>F5</kbd></td><td>Reload</td></tr>
        <tr><td><kbd>Ctrl+B</kbd></td><td>Show / hide headings pane</td></tr>
        <tr><td><kbd>Ctrl+,</kbd></td><td>Preferences</td></tr>
        <tr><td><kbd>Ctrl+F</kbd></td><td>Find in document</td></tr>
        <tr><td><kbd>Enter</kbd> / <kbd>Shift+Enter</kbd></td><td>Next / previous match</td></tr>
        <tr><td><kbd>Ctrl+=</kbd> / <kbd>Ctrl+-</kbd></td><td>Text size</td></tr>
        <tr><td><kbd>Ctrl+0</kbd></td><td>Reset text size</td></tr>
        <tr><td><kbd>Home</kbd> / <kbd>End</kbd></td><td>Top / bottom of document</td></tr>
        <tr><td><kbd>Ctrl+Q</kbd></td><td>Exit</td></tr>
      </table>`);
  },
  "set-default"() {
    showDialog(`<h2>Make Files.md your .md reader</h2>
      <ol>
        <li>In File Explorer, right-click any <code>.md</code> file.</li>
        <li>Choose <b>Open with</b> → <b>Choose another app</b>.</li>
        <li>Scroll down and pick <b>Choose an app on your PC</b>.</li>
        <li>Browse to <code>files-md.exe</code> and select it.</li>
        <li>Click <b>Always</b>.</li>
      </ol>
      <p>If you move the .exe later, repeat these steps.</p>`);
  },
  about() {
    showDialog(`<div class="about">
      <h2>Files.md</h2>
      <p class="about-version">Version ${__APP_VERSION__}</p>
      <h3>Why Files.md?</h3>
      <p>Markdown is one of the fastest ways to write documentation: it's plain text, easy to learn, and readable even before it's formatted. But reading it well is harder than it should be. Browsers still don't render <code>.md</code> files natively; they show the raw text. Your options are usually a browser extension, which needs permissions and a browser, or a full editor, which is more tool than you need just to read.</p>
      <p>Files.md fills that gap. It's a small, portable Windows app that does one job well: open a Markdown file and present it cleanly, with a headings pane for navigation, find, read-aloud, and printing. No installer, no account, and nothing leaves your computer unless you ask it to.</p>
      <p class="about-links">
        <a href="${REPO_URL}" data-external>GitHub</a>
        <span aria-hidden="true">·</span>
        <a href="${REPO_URL}/releases" data-external>Releases</a>
        <span aria-hidden="true">·</span>
        <a href="${REPO_URL}/issues" data-external>Report an issue</a>
      </p>
      <p class="about-support support-only"><img src="${bmcLogo}" alt="" width="20" height="20" /><span>If Files.md is useful to you, you can <a href="#" data-action="support">buy me a coffee</a>.</span></p>
      <p class="about-license">Free and open source under the MIT License.</p>
    </div>`);
  },
  support() {
    showDialog(`<div class="support">
      <img class="support-logo" src="${bmcLogo}" alt="" width="48" height="48" />
      <h2>Support Files.md</h2>
      <p>Files.md is free and always will be. If it saves you time, a coffee helps keep it going.</p>
      <a class="support-btn" href="${SUPPORT_URL}" data-external>Buy me a coffee ☕</a>
      <div class="support-qr"><img src="${bmcQr}" alt="QR code for buymeacoffee.com/8i0sxlpmdy" width="168" height="168" /></div>
      <p class="support-hint">Scan with your phone, or use the button above.<br /><span>${SUPPORT_URL.replace("https://", "")}</span></p>
    </div>`);
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); closeMenus(); fn(); }
});

$("#dialog").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-external]");
  if (a) { e.preventDefault(); platform.openExternal(a.href); }
});

document.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (key === "escape") {
    if (find.isOpen()) find.close();
    closeMenus();
    document.body.classList.remove("prefs-open");
    return;
  }
  if (e.key === "F5") { e.preventDefault(); actions.reload(); return; }
  if (e.key === "F3") {
    e.preventDefault();
    if (!find.isOpen()) find.open();
    else $(e.shiftKey ? "#find-prev" : "#find-next").click();
    return;
  }
  if (ctrl && (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp")) {
    e.preventDefault();
    cycleTab(e.key === "PageUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1);
    return;
  }
  if (ctrl && !e.shiftKey && /^[1-9]$/.test(e.key) && tabs.length) {
    e.preventDefault();
    activateTab(e.key === "9" ? tabs[tabs.length - 1] : tabs[Math.min(Number(e.key), tabs.length) - 1]);
    return;
  }
  if (ctrl && e.shiftKey && key === "u") { e.preventDefault(); actions["read-aloud"](); return; }
  if (!ctrl) return;
  const map = {
    o: "open", e: "edit", p: "print", w: "close-tab", n: "new-window", b: "toggle-toc", ",": "toggle-prefs", q: "quit", r: "reload",
    "=": "zoom-in", "+": "zoom-in", "-": "zoom-out", "0": "zoom-reset",
  };
  if (key === "f") {
    e.preventDefault();
    actions.find();
    return;
  }
  if (map[key]) { e.preventDefault(); actions[map[key]](); }
});

// Block the webview's default context menu / reload keys in release builds.
if (platform.isTauri && !import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest("input, textarea, .markdown-body")) e.preventDefault();
  });
}

// ---------------------------------------------------------------- ui helpers

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

function showDialog(html) {
  $("#dialog-body").innerHTML = html;
  $("#dialog").showModal();
}

// ---------------------------------------------------------------- read aloud

/** Plain text to speak, built from the rendered document. */
function speechText() {
  const article = $("#doc").cloneNode(true);
  article.querySelectorAll(".code-bar").forEach((n) => n.remove());
  const parts = [];
  const walk = (el) => {
    for (const node of el.children) {
      const tag = node.tagName;
      if (tag === "PRE") {
        parts.push(settings.ttsSkipCode ? "Code sample skipped." : node.textContent.trim());
      } else if (/^H[1-6]$/.test(tag)) {
        parts.push(`${node.textContent.trim()}.`);
      } else if (tag === "UL" || tag === "OL") {
        for (const li of node.children) {
          const clone = li.cloneNode(true);
          clone.querySelectorAll("ul, ol").forEach((n) => n.remove());
          const t = clone.textContent.trim();
          if (t) parts.push(/[.!?:]$/.test(t) ? t : `${t}.`);
          li.querySelectorAll(":scope > ul, :scope > ol").forEach((n) => walk({ children: [n] }));
        }
      } else if (node.classList?.contains("table-wrap") || tag === "TABLE") {
        for (const row of node.querySelectorAll("tr")) {
          const cells = [...row.children].map((c) => c.textContent.trim()).filter(Boolean);
          if (cells.length) parts.push(`${cells.join(", ")}.`);
        }
      } else if (tag === "BLOCKQUOTE" || tag === "DIV") {
        walk(node);
      } else if (tag === "HR") {
        continue;
      } else {
        for (const img of node.querySelectorAll("img[alt]")) {
          if (img.alt.trim()) img.replaceWith(` Image: ${img.alt.trim()}. `);
        }
        const t = node.textContent.replace(/\s+/g, " ").trim();
        if (t) parts.push(t);
      }
    }
  };
  walk(article);
  return parts.join("\n\n");
}

const fmtTime = (sec) => {
  if (!isFinite(sec)) return "0:00";
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}` : `${m}:${String(s2).padStart(2, "0")}`;
};

const fmtBytes = (n) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

const tts = (() => {
  const audio = $("#tts-audio");
  const bar = $("#tts-bar");
  const status = $("#tts-status");
  let open = false;
  let loadedHash = null;
  let busy = false;
  let requestId = 0;

  function request() {
    return {
      text: speechText(),
      engine: settings.ttsEngine,
      voice: settings.ttsVoice,
      remoteUrl: settings.ttsRemoteUrl,
      remoteKey: settings.ttsRemoteKey,
      remoteModel: settings.ttsRemoteModel,
      remoteVoice: settings.ttsRemoteVoice,
    };
  }

  function setStatus(text, kind = "") {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function setPlaying(on) {
    bar.classList.toggle("playing", on);
    $("#tts-play").setAttribute("aria-label", on ? "Pause" : "Play");
  }

  function load(result, autoplay) {
    loadedHash = result.hash;
    audio.src = platform.fileUrl(result.path);
    audio.playbackRate = settings.ttsRate;
    setStatus(result.cached ? "Cached audio" : `Audio ready · ${fmtBytes(result.bytes)}`);
    refreshCacheInfo();
    if (autoplay) audio.play().catch((e) => setStatus(`Couldn't play: ${e.message}`, "error"));
  }

  async function prepare(autoplay) {
    if (!doc.path) return;
    const id = ++requestId;
    const req = request();
    try {
      const hit = await platform.ttsLookup(req);
      if (id !== requestId) return;
      if (hit) return load(hit, autoplay);
    } catch {}
    if (!autoplay) {
      setStatus("Press play to generate audio");
      return;
    }
    busy = true;
    bar.classList.add("busy");
    setStatus(settings.ttsEngine === "remote" ? "Generating audio with remote service…" : "Generating audio…");
    try {
      const result = await platform.ttsGenerate(req);
      if (id !== requestId) return;
      load(result, true);
    } catch (e) {
      if (id === requestId) setStatus(String(e), "error");
    } finally {
      if (id === requestId) {
        busy = false;
        bar.classList.remove("busy");
      }
    }
  }

  function reset() {
    requestId++;
    busy = false;
    bar.classList.remove("busy");
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    loadedHash = null;
    setPlaying(false);
    $("#tts-seek").value = 0;
    $("#tts-time").textContent = "0:00";
    $("#tts-dur").textContent = "0:00";
  }

  function show() {
    if (!doc.path) return toast("Open a file to read it aloud");
    open = true;
    document.body.classList.add("tts-open");
    if (!loadedHash) prepare(true);
    else audio.play();
  }

  function hide() {
    open = false;
    document.body.classList.remove("tts-open");
    reset();
    setStatus("");
  }

  $("#tts-play").addEventListener("click", () => {
    if (busy) return;
    if (!loadedHash) return prepare(true);
    audio.paused ? audio.play() : audio.pause();
  });
  $("#tts-close").addEventListener("click", hide);
  $("#tts-rate").addEventListener("change", (e) => {
    audio.playbackRate = Number(e.target.value);
    setPref("ttsRate", Number(e.target.value));
  });
  $("#tts-seek").addEventListener("input", (e) => {
    if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
  });
  audio.addEventListener("play", () => setPlaying(true));
  audio.addEventListener("pause", () => setPlaying(false));
  audio.addEventListener("ended", () => setPlaying(false));
  audio.addEventListener("loadedmetadata", () => ($("#tts-dur").textContent = fmtTime(audio.duration)));
  audio.addEventListener("timeupdate", () => {
    $("#tts-time").textContent = fmtTime(audio.currentTime);
    if (audio.duration) $("#tts-seek").value = Math.round((audio.currentTime / audio.duration) * 1000);
  });
  audio.addEventListener("error", () => {
    if (audio.getAttribute("src")) setStatus("Couldn't play this audio file", "error");
  });

  document.addEventListener("keydown", (e) => {
    if (!open || e.key !== " " || e.target.closest("input, select, textarea, button")) return;
    e.preventDefault();
    $("#tts-play").click();
  });

  async function refreshCacheInfo() {
    try {
      const info = await platform.ttsCacheInfo();
      $("#tts-cache-out").textContent = info.files ? `${info.files} file${info.files === 1 ? "" : "s"} · ${fmtBytes(info.bytes)}` : "empty";
      $("#tts-cache-out").title = info.dir;
    } catch {
      $("#tts-cache-out").textContent = "";
    }
  }

  async function loadVoices() {
    const sel = $("#tts-voice");
    try {
      const voices = await platform.ttsVoices();
      for (const v of voices) {
        const o = document.createElement("option");
        o.value = v.id;
        o.textContent = `${v.name} (${v.language})`;
        sel.appendChild(o);
      }
    } catch {}
    sel.value = settings.ttsVoice;
    $("#tts-rate").value = String(settings.ttsRate);
  }

  return {
    toggle: () => (open ? hide() : show()),
    close: () => open && hide(),
    stop: reset,
    refreshCacheInfo,
    loadVoices,
    // New document or edited file: drop old audio, look for a cached match.
    documentChanged() {
      if (!open) {
        loadedHash = null;
        return;
      }
      const wasPlaying = !audio.paused;
      reset();
      prepare(false).then(() => wasPlaying && loadedHash && audio.play());
    },
    settingsChanged() {
      if (open) {
        reset();
        prepare(false);
      } else loadedHash = null;
    },
  };
})();

if (import.meta.env.DEV) window.__filesmd = { speechText, applyRemoteSettings, get settings() { return settings; }, get synced() { return synced; }, setPref };

// Label editors that aren't installed so the choice is obvious.
async function markInstalledEditors() {
  const found = new Set(await platform.detectEditors().catch(() => []));
  for (const opt of $("#editor-select").options) {
    if (opt.value === "custom") continue;
    if (!found.has(opt.value)) opt.textContent += " (not found)";
  }
}

// ---------------------------------------------------------------- start

async function start() {
  await platform.ready();
  const saved = await platform.loadSettings().catch(() => ({}));
  // Defaults count as saved, so only real changes are ever sent.
  synced = { ...DEFAULTS, ...saved };
  settings = { ...synced };
  bindPrefControls();
  applySettings();
  renderRecent();
  markInstalledEditors();
  tts.loadVoices();
  tts.refreshCacheInfo();

  await platform.onDragDrop({
    enter: () => document.body.classList.add("dragging"),
    leave: () => document.body.classList.remove("dragging"),
    drop: (paths) => openPaths(paths),
  });
  await platform.onSettingsChanged((remote, source) => {
    if (source === platform.windowLabel()) synced = { ...DEFAULTS, ...remote };
    else applyRemoteSettings(remote);
  });
  await platform.onOpenFiles((req) => openPaths(req.paths));

  const initial = await platform.initialOpen().catch(() => null);
  if (initial?.paths?.length) await openPaths(initial.paths, { scroll: initial.scroll, heading: initial.heading });
  else if (settings.showWelcome && platform.windowLabel() === "main") await openWelcome();
}

start();
