// Thin wrapper around the native (Tauri) side, so the UI can also run in a
// plain browser during development (`npm run dev`) with limited features.

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let api = null;

async function loadTauri() {
  if (api) return api;
  const [core, dialog, opener, webview, win, event, webviewWindow] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-opener"),
    import("@tauri-apps/api/webview"),
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/webviewWindow"),
  ]);
  api = { core, dialog, opener, webview, win, event, webviewWindow };
  return api;
}

const browserFiles = new Map(); // path -> content (dev mode only)

export const platform = {
  isTauri,

  /** { paths, scroll, heading } this window should open at startup, or null. */
  async initialOpen() {
    if (!isTauri) return null;
    const { core } = await loadTauri();
    return core.invoke("initial_open");
  },

  /** Files opened from Windows while the app is already running. */
  async onOpenFiles(cb) {
    if (!isTauri) return;
    const { webviewWindow } = await loadTauri();
    await webviewWindow.getCurrentWebviewWindow().listen("open-files", (e) => cb(e.payload));
  },

  /** Open a new app window, optionally with { paths, scroll, heading }. */
  async openWindow(request = null) {
    if (!isTauri) {
      window.open(location.href, "_blank");
      return null;
    }
    const { core } = await loadTauri();
    return core.invoke("open_window", { request });
  },

  windowLabel() {
    return isTauri && api ? api.win.getCurrentWindow().label : "main";
  },

  async readMarkdown(path) {
    if (!isTauri) {
      const content = browserFiles.get(path);
      if (content == null) throw new Error(`Not available in browser mode: ${path}`);
      return { path, name: path, dir: "", content, modified: 0 };
    }
    const { core } = await loadTauri();
    return core.invoke("read_markdown", { path });
  },

  async fileModified(path) {
    if (!isTauri) return 0;
    const { core } = await loadTauri();
    return core.invoke("file_modified", { path });
  },

  async loadSettings() {
    if (!isTauri) {
      try { return JSON.parse(localStorage.getItem("files-md.settings") || "{}"); } catch { return {}; }
    }
    const { core } = await loadTauri();
    return core.invoke("load_settings");
  },

  /** Send only the changed keys; the app merges them and saves once. */
  async updateSettings(changes) {
    if (!isTauri) {
      try {
        const cur = JSON.parse(localStorage.getItem("files-md.settings") || "{}");
        localStorage.setItem("files-md.settings", JSON.stringify({ ...cur, ...changes }));
      } catch {}
      return "browser storage";
    }
    const { core } = await loadTauri();
    return core.invoke("update_settings", { changes });
  },

  /** Called with (settings, sourceWindowLabel) whenever any window changes settings. */
  async onSettingsChanged(cb) {
    if (!isTauri) return;
    const { event } = await loadTauri();
    await event.listen("settings-changed", (e) => cb(e.payload.settings, e.payload.source));
  },

  async pickFile() {
    if (!isTauri) {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".md,.markdown,.mdown,.mkd,.txt";
        input.multiple = true;
        input.onchange = async () => {
          const files = [...(input.files || [])];
          for (const f of files) browserFiles.set(f.name, await f.text());
          resolve(files.map((f) => f.name));
        };
        input.click();
      });
    }
    const { dialog } = await loadTauri();
    const picked = await dialog.open({
      multiple: true,
      directory: false,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mkdn", "mdx", "txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!picked) return [];
    return (Array.isArray(picked) ? picked : [picked]).map((p) => (typeof p === "string" ? p : p.path));
  },

  async detectEditors() {
    if (!isTauri) return ["notepad", "vscode", "notepadpp"];
    const { core } = await loadTauri();
    return core.invoke("detect_editors");
  },

  async openInEditor(path, editor, customPath) {
    if (!isTauri) throw new Error("Opening an editor only works in the desktop app");
    const { core } = await loadTauri();
    return core.invoke("open_in_editor", { path, editor, customPath: customPath || null });
  },

  async pickExecutable() {
    if (!isTauri) return null;
    const { dialog } = await loadTauri();
    const picked = await dialog.open({
      multiple: false,
      directory: false,
      title: "Choose your editor",
      filters: [{ name: "Programs", extensions: ["exe"] }],
    });
    return typeof picked === "string" ? picked : picked?.path ?? null;
  },

  async openExternal(url) {
    if (!isTauri) return window.open(url, "_blank", "noopener");
    const { opener } = await loadTauri();
    return opener.openUrl(url);
  },

  /** Open a local file with its default Windows app. */
  async openPath(path) {
    if (!isTauri) throw new Error("Opening local files only works in the desktop app");
    const { opener } = await loadTauri();
    return opener.openPath(path);
  },

  /** Show a file selected in File Explorer. */
  async revealFile(path) {
    if (!isTauri) throw new Error("Only works in the desktop app");
    const { opener } = await loadTauri();
    return opener.revealItemInDir(path);
  },

  async print() {
    if (!isTauri) return window.print();
    const { core } = await loadTauri();
    return core.invoke("print_page");
  },

  // ---- read aloud
  async ttsVoices() {
    if (!isTauri) return [];
    const { core } = await loadTauri();
    return core.invoke("tts_voices");
  },
  async ttsLookup(req) {
    if (!isTauri) return null;
    const { core } = await loadTauri();
    return core.invoke("tts_lookup", { req });
  },
  async ttsGenerate(req) {
    if (!isTauri) throw new Error("Read aloud only works in the desktop app");
    const { core } = await loadTauri();
    return core.invoke("tts_generate", { req });
  },
  async ttsCacheInfo() {
    if (!isTauri) return { dir: "", files: 0, bytes: 0 };
    const { core } = await loadTauri();
    return core.invoke("tts_cache_info");
  },
  async ttsCacheClear() {
    if (!isTauri) return;
    const { core } = await loadTauri();
    return core.invoke("tts_cache_clear");
  },

  async setTitle(title) {
    document.title = title;
    if (!isTauri) return;
    const { win } = await loadTauri();
    return win.getCurrentWindow().setTitle(title);
  },

  async quit() {
    if (!isTauri) return window.close();
    const { win } = await loadTauri();
    return win.getCurrentWindow().close();
  },

  /** Convert a local file path into a URL the webview can load (for images). */
  fileUrl(path) {
    if (!isTauri || !api) return path;
    return api.core.convertFileSrc(path);
  },

  /** Native drag & drop gives real file paths; browser mode reads the file. */
  async onDragDrop({ enter, leave, drop }) {
    if (!isTauri) {
      window.addEventListener("dragover", (e) => { e.preventDefault(); enter(); });
      window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) leave(); });
      window.addEventListener("drop", async (e) => {
        e.preventDefault();
        leave();
        const files = [...(e.dataTransfer?.files || [])];
        for (const f of files) browserFiles.set(f.name, await f.text());
        if (files.length) drop(files.map((f) => f.name));
      });
      return;
    }
    const { webview } = await loadTauri();
    await webview.getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") enter();
      else if (p.type === "leave") leave();
      else if (p.type === "drop") {
        leave();
        if (p.paths?.length) drop(p.paths);
      }
    });
  },

  async ready() {
    if (isTauri) await loadTauri();
  },
};
