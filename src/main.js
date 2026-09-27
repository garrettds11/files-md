import MarkdownIt from "markdown-it";
import { platform } from "./platform.js";

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
  autoReload: true,
  editor: "notepad", // notepad | vscode | notepadpp | custom
  editorPath: "",
  recent: [],
};

let settings = { ...DEFAULTS };
let saveTimer = null;

function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const where = await platform.saveSettings(settings);
      $("#prefs-note").textContent = `Saved to ${where}`;
    } catch (e) {
      $("#prefs-note").textContent = `Couldn't save settings: ${e}`;
    }
  }, 250);
}

function setPref(key, value) {
  settings[key] = value;
  applySettings();
  saveSettings();
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
    } else if (el.type === "text") {
      el.addEventListener("change", () => setPref(key, el.value.trim().replace(/^"|"$/g, "")));
    } else if (el.type === "range") {
      el.addEventListener("input", () => setPref(key, Number(el.value)));
    } else {
      el.addEventListener("change", () => setPref(key, el.value));
    }
  }
}

// ---------------------------------------------------------------- markdown

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

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
    const text = inline.children
      .filter((c) => c.type === "text" || c.type === "code_inline")
      .map((c) => c.content)
      .join("");
    let id = slugify(text);
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

async function openFile(path, { keepScroll = false } = {}) {
  let file;
  try {
    file = await platform.readMarkdown(path);
  } catch (e) {
    toast(String(e));
    settings.recent = settings.recent.filter((p) => p !== path);
    saveSettings();
    renderRecent();
    return;
  }
  const content = $("#content");
  const scroll = keepScroll ? content.scrollTop : 0;

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
  updateActiveHeading();

  settings.recent = [file.path, ...settings.recent.filter((p) => p !== file.path)].slice(0, 10);
  saveSettings();
  renderRecent();
}

function fixupContent(article) {
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

$("#doc").addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href");
  if (href.startsWith("#")) {
    scrollToHeading(decodeURIComponent(href.slice(1)));
  } else if (isExternal(href)) {
    platform.openExternal(href);
  } else if (doc.dir) {
    const [file, hash] = href.split("#");
    const target = joinPath(doc.dir, decodeURI(file));
    if (/\.(md|markdown|mdown|mkd|mkdn|mdx|txt)$/i.test(file)) {
      openFile(target).then(() => hash && scrollToHeading(hash));
    } else {
      platform.openExternal(target);
    }
  }
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
  filterToc();
}

function filterToc() {
  const q = $("#toc-filter").value.trim().toLowerCase();
  for (const li of $("#toc-list").children) {
    li.hidden = q && !li.textContent.toLowerCase().includes(q);
  }
}

$("#toc-filter").addEventListener("input", filterToc);

$("#toc-list").addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;
  e.preventDefault();
  scrollToHeading(a.parentElement.dataset.id);
});

function scrollToHeading(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (m && m !== doc.modified) openFile(doc.path, { keepScroll: true });
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
    const p = await platform.pickFile();
    if (p) openFile(p);
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
  reload() { if (doc.path) openFile(doc.path, { keepScroll: true }); },
  async "copy-path"() {
    if (!doc.path) return;
    await navigator.clipboard.writeText(doc.path);
    toast("File path copied");
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
        <tr><td><kbd>F5</kbd></td><td>Reload</td></tr>
        <tr><td><kbd>Ctrl+B</kbd></td><td>Show / hide headings pane</td></tr>
        <tr><td><kbd>Ctrl+,</kbd></td><td>Preferences</td></tr>
        <tr><td><kbd>Ctrl+F</kbd></td><td>Filter headings</td></tr>
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
    showDialog(`<h2>Files.md</h2><p>Version 0.1.1</p>
      <p>A clean, portable Markdown reader for Windows.</p>
      <p><a href="https://github.com/garrettds11/files-md" data-external>github.com/garrettds11/files-md</a></p>`);
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
    closeMenus();
    document.body.classList.remove("prefs-open");
    return;
  }
  if (e.key === "F5") { e.preventDefault(); actions.reload(); return; }
  if (!ctrl) return;
  const map = {
    o: "open", e: "edit", b: "toggle-toc", ",": "toggle-prefs", q: "quit", r: "reload",
    "=": "zoom-in", "+": "zoom-in", "-": "zoom-out", "0": "zoom-reset",
  };
  if (key === "f" && settings.showToc && doc.path) {
    e.preventDefault();
    $("#toc-filter").focus();
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
  settings = { ...DEFAULTS, ...(await platform.loadSettings().catch(() => ({}))) };
  bindPrefControls();
  applySettings();
  renderRecent();
  markInstalledEditors();

  await platform.onDragDrop({
    enter: () => document.body.classList.add("dragging"),
    leave: () => document.body.classList.remove("dragging"),
    drop: (path) => openFile(path),
  });

  const initial = await platform.initialFile().catch(() => null);
  if (initial) await openFile(initial);
}

start();
