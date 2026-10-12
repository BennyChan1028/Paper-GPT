/* Local UI-only controls. Does not change annotation content or PDF coordinates. */
var AnnotationPopupControls = (() => {
  const ID = "paper-web-assistant@local.customization";
  const PREFIX = "extensions.annotationPopupControls.";
  const contexts = new Map();
  const css = `
    @-moz-document url("resource://zotero/reader/reader.html") {
      .annotation-popup.ap-enhanced {
        width: var(--ap-width, 400px) !important;
        max-width: calc(100vw - 16px) !important;
        padding-bottom: 12px !important;
      }
      .annotation-popup.ap-enhanced .comment .editor,
      .annotation-popup.ap-enhanced .comment .content {
        font-size: var(--ap-font-size, 18px) !important;
        line-height: 1.5 !important;
        --note-font-size: var(--ap-font-size, 18px);
      }
      .annotation-popup.ap-enhanced .comment .content {
        box-sizing: border-box;
        height: var(--ap-content-height, 320px) !important;
        min-height: 72px !important;
        max-height: var(--ap-content-height, 320px) !important;
        overflow-y: auto !important;
      }
      .annotation-popup.ap-enhanced header { cursor: move !important; touch-action: none !important; }
      .annotation-popup.ap-enhanced header button { cursor: pointer !important; }
      .annotation-popup.ap-enhanced.ap-moved::before,
      .annotation-popup.ap-enhanced.ap-moved::after { display: none !important; }
      .annotation-popup .ap-resize-handle {
        position: absolute !important; right: 0 !important; bottom: 0 !important;
        left: auto !important; top: auto !important; width: 20px !important; height: 20px !important;
        padding: 0 !important; border: 0 !important; border-radius: 0 0 6px 0 !important;
        background: transparent !important; color: var(--fill-secondary, #666) !important;
        cursor: nwse-resize !important; touch-action: none !important; z-index: 10 !important;
        font-size: 16px !important; line-height: 20px !important; text-align: center !important;
      }
      .annotation-popup .ap-resize-handle:focus-visible { outline: 2px solid #668bdb; }
    }
  `;
  let timer = null;
  let sheetURI;
  let lastGesture = null;
  const sheetService = Components.classes["@mozilla.org/content/style-sheet-service;1"]
    .getService(Components.interfaces.nsIStyleSheetService);
  const clamp = (n, min, max) => Math.max(min, Math.min(n, Math.max(min, max)));
  function read(name, fallback) {
    try { const value = Zotero.Prefs.get(PREFIX + name, true); return Number.isFinite(value) ? value : fallback; }
    catch (_) { return fallback; }
  }
  function write(name, value) { Zotero.Prefs.set(PREFIX + name, Math.round(value), true); }
  function geometry(ctx, popup) {
    const rect = popup.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }
  function popupState(ctx, popup) {
    let state = ctx.popupStates.get(popup);
    if (!state) {
      state = { annotationID: null, auto: true, position: null, size: null };
      ctx.popupStates.set(popup, state);
    }
    return state;
  }
  function annotationBounds(ctx, popup) {
    const internal = ctx.reader._internalReader;
    const secondary = !!popup.closest('.secondary-view');
    const params = internal?._state?.[secondary ? 'secondaryViewAnnotationPopup' : 'primaryViewAnnotationPopup'];
    if (!params?.annotation || !['highlight', 'underline'].includes(params.annotation.type)) return null;
    const view = secondary ? internal._secondaryView : internal._primaryView;
    const frame = view?._iframeWindow?.frameElement;
    const origin = (frame || popup.parentNode).getBoundingClientRect();
    // The reader updates these screen coordinates as the PDF scrolls or zooms.
    const rect = params.rect;
    if (!rect || rect.length !== 4 || !Array.from(rect).every(Number.isFinite)) return null;
    return {
      id: params.annotation.id,
      left: origin.left + rect[0], top: origin.top + rect[1],
      right: origin.left + rect[2], bottom: origin.top + rect[3],
      view: { left: Math.max(8, origin.left), top: Math.max(8, origin.top),
        right: Math.min(ctx.win.innerWidth - 8, origin.right), bottom: Math.min(ctx.win.innerHeight - 8, origin.bottom) }
    };
  }
  function fitToAnnotation(ctx, popup) {
    const bounds = annotationBounds(ctx, popup);
    if (!bounds) return false;
    const state = popupState(ctx, popup);
    if (state.annotationID !== bounds.id) {
      Object.assign(state, { annotationID: bounds.id, auto: true, position: null, size: null, fitKey: null });
    }
    if (!state.auto) return false;
    const content = popup.querySelector('.comment .content');
    if (!content) return false;
    const chromeHeight = popup.getBoundingClientRect().height - content.getBoundingClientRect().height;
    const { view } = bounds;
    const key = [bounds.left, bounds.top, bounds.right, bounds.bottom, ...Object.values(view), chromeHeight].join(',');
    if (state.fitKey === key) return true;
    state.fitKey = key;
    const left = clamp(bounds.left, view.left, view.right - 240);
    const top = clamp(bounds.top, view.top, view.bottom - chromeHeight - 72);
    const width = clamp(bounds.right - bounds.left, 240, view.right - left);
    const height = clamp(bounds.bottom - bounds.top, chromeHeight + 72, view.bottom - top);
    popup.style.setProperty('--ap-width', width + 'px');
    popup.style.setProperty('--ap-content-height', Math.max(72, height - chromeHeight) + 'px');
    position(ctx, popup, left, top);
    return true;
  }
  function keepManual(ctx, popup) {
    const state = popupState(ctx, popup);
    state.auto = false;
    state.fitKey = null;
    state.size = { width: popup.getBoundingClientRect().width,
      contentHeight: popup.querySelector('.comment .content')?.getBoundingClientRect().height || 320 };
    return state;
  }
  function position(ctx, popup, x, y) {
    const rect = popup.getBoundingClientRect();
    const state = popupState(ctx, popup);
    state.position = {
      x: clamp(x, 8, ctx.win.innerWidth - rect.width - 8),
      y: clamp(y, 8, ctx.win.innerHeight - rect.height - 8)
    };
    popup.classList.add("ap-moved");
    popup.style.setProperty("position", "fixed", "important");
    popup.style.setProperty("left", state.position.x + "px", "important");
    popup.style.setProperty("top", state.position.y + "px", "important");
    popup.style.setProperty("transform", "none", "important");
  }
  function refresh(ctx, popup) {
    popup.style.setProperty("--ap-font-size", read("fontSize", 18) + "px");
    if (fitToAnnotation(ctx, popup)) return;
    const state = popupState(ctx, popup);
    const chromeHeight = popup.getBoundingClientRect().height - (popup.querySelector('.comment .content')?.getBoundingClientRect().height || 0);
    popup.style.setProperty("--ap-width", clamp(state.size?.width ?? read("width", 400), 240, ctx.win.innerWidth - 16) + "px");
    popup.style.setProperty("--ap-content-height", clamp(state.size?.contentHeight ?? read("contentHeight", 320), 72, ctx.win.innerHeight - chromeHeight - 16) + "px");
    if (state.position) position(ctx, popup, state.position.x, state.position.y);
  }
  function refreshAll() {
    for (const ctx of contexts.values()) {
      for (const popup of ctx.doc.querySelectorAll(".annotation-popup.ap-enhanced")) refresh(ctx, popup);
    }
  }
  function attachPopup(ctx, popup) {
    if (!popup.classList.contains("ap-enhanced")) {
      ctx.originalStyles.set(popup, ["position", "left", "top", "transform"].map(prop => [prop, popup.style.getPropertyValue(prop), popup.style.getPropertyPriority(prop)]));
      popup.classList.add("ap-enhanced");
      refresh(ctx, popup);
    }
    const header = popup.querySelector("header");
    if (header && !ctx.boundHeaders.has(header)) {
      ctx.boundHeaders.add(header);
      header.title = "拖动此处移动译文弹窗";
      const down = event => {
        if (event.button !== 0 || event.target.closest("button, input, select, a")) return;
        beginGesture(ctx, popup, event, "move");
      };
      header.addEventListener("pointerdown", down, true);
      ctx.headerCleanup.set(header, () => { header.removeEventListener("pointerdown", down, true); header.removeAttribute("title"); ctx.boundHeaders.delete(header); });
    }
    if (!popup.querySelector(".ap-resize-handle")) {
      const handle = ctx.doc.createElement("button");
      handle.className = "ap-resize-handle";
      handle.type = "button";
      handle.textContent = "◢";
      handle.title = "拖动调整弹窗大小；聚焦后方向键可微调";
      handle.setAttribute("aria-label", "调整译文弹窗大小");
      handle.addEventListener("pointerdown", event => beginGesture(ctx, popup, event, "resize"));
      handle.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); });
      handle.addEventListener("keydown", event => {
        const changes = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
        if (!changes[event.key]) return;
        event.preventDefault(); event.stopPropagation();
        const [dx, dy] = changes[event.key];
        const state = keepManual(ctx, popup);
        state.size.width = clamp(state.size.width + dx, 240, ctx.win.innerWidth - 16);
        state.size.contentHeight = clamp(state.size.contentHeight + dy, 72, ctx.win.innerHeight - 160);
        write("width", state.size.width); write("contentHeight", state.size.contentHeight);
        refreshAll();
      });
      popup.append(handle);
    }
  }
  function beginGesture(ctx, popup, event, mode) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    ctx.cancelGesture?.();
    keepManual(ctx, popup);
    const captureTarget = event.currentTarget;
    try { captureTarget.setPointerCapture(event.pointerId); } catch (_) {}
    const start = geometry(ctx, popup);
    const x = event.clientX, y = event.clientY;
    const contentHeight = popup.querySelector(".comment .content")?.getBoundingClientRect().height || 320;
    const pointerID = event.pointerId;
    lastGesture = { mode, x, y, start, pointerID, moves: 0 };
    const move = e => {
      if (e.pointerId !== pointerID) return;
      lastGesture.moves++;
      e.preventDefault(); e.stopPropagation();
      const dx = e.clientX - x, dy = e.clientY - y;
      if (mode === "move") position(ctx, popup, start.x + dx, start.y + dy);
      else {
        popup.style.setProperty("--ap-width", clamp(start.width + dx, 240, ctx.win.innerWidth - start.x - 8) + "px");
        popup.style.setProperty("--ap-content-height", clamp(contentHeight + dy, 72, ctx.win.innerHeight - start.y - (start.height - contentHeight) - 8) + "px");
        position(ctx, popup, start.x, start.y);
      }
    };
    const finish = e => {
      if (e.pointerId !== pointerID) return;
      e.stopPropagation();
      if (mode === "resize") {
        popupState(ctx, popup).size = { width: popup.getBoundingClientRect().width,
          contentHeight: popup.querySelector('.comment .content')?.getBoundingClientRect().height || contentHeight };
        write("width", popup.getBoundingClientRect().width);
        write("contentHeight", popup.querySelector(".comment .content")?.getBoundingClientRect().height || contentHeight);
        refreshAll();
      }
      cancel();
    };
    const cancel = () => {
      ctx.doc.removeEventListener("pointermove", move, true);
      ctx.doc.removeEventListener("pointerup", finish, true);
      ctx.doc.removeEventListener("pointercancel", finish, true);
      try { if (captureTarget.hasPointerCapture(pointerID)) captureTarget.releasePointerCapture(pointerID); } catch (_) {}
      ctx.cancelGesture = null;
    };
    ctx.cancelGesture = cancel;
    ctx.doc.addEventListener("pointermove", move, true);
    ctx.doc.addEventListener("pointerup", finish, true);
    ctx.doc.addEventListener("pointercancel", finish, true);
  }
  function ensureReader(reader) {
    const win = reader._iframeWindow;
    if (!win?.document || win.document.readyState === "loading") return;
    const existing = contexts.get(reader);
    if (existing?.doc === win.document) { existing.scan(); return; }
    if (existing) detach(existing);
    const ctx = { reader, win, doc: win.document, cleanup: [], popupStates: new WeakMap(), headerCleanup: new Map(), boundHeaders: new WeakSet(), originalStyles: new WeakMap() };
    contexts.set(reader, ctx);
    const scan = () => {
      for (const [header, cleanup] of ctx.headerCleanup) if (!header.isConnected) { cleanup(); ctx.headerCleanup.delete(header); }
      for (const popup of ctx.doc.querySelectorAll(".annotation-popup")) attachPopup(ctx, popup);
      if (!ctx.cancelGesture) for (const popup of ctx.doc.querySelectorAll('.annotation-popup.ap-enhanced')) fitToAnnotation(ctx, popup);
      for (const group of ctx.doc.querySelectorAll(".context-menu .group")) {
        if (![...group.querySelectorAll(".row.basic")].some(node => node.textContent.startsWith("译文字号"))) continue;
        const label = group.querySelector(".row.slider > div:first-child");
        if (label && label.textContent !== "字号：") label.textContent = "字号：";
        group.querySelector('input[type="range"]')?.setAttribute("aria-label", "译文字号");
      }
    };
    // Avoid observing the reader's entire DOM: text editing and native popups
    // continuously mutate it. A bounded periodic scan cannot create a feedback loop.
    ctx.scan = scan;
    const resize = () => { for (const popup of ctx.doc.querySelectorAll(".annotation-popup.ap-enhanced")) refresh(ctx, popup); };
    win.addEventListener("resize", resize);
    ctx.cleanup.push(() => win.removeEventListener("resize", resize));
    scan();
  }
  function detach(ctx) {
    ctx.observer?.disconnect(); ctx.cancelGesture?.();
    for (const cleanup of ctx.headerCleanup.values()) { try { cleanup(); } catch (_) {} }
    ctx.headerCleanup.clear();
    for (const cleanup of ctx.cleanup) { try { cleanup(); } catch (_) {} }
    for (const popup of ctx.doc.querySelectorAll(".annotation-popup.ap-enhanced")) {
      popup.classList.remove("ap-enhanced", "ap-moved");
      for (const prop of ["--ap-font-size", "--ap-width", "--ap-content-height"]) popup.style.removeProperty(prop);
      restorePosition(ctx, popup);
      popup.querySelector(".ap-resize-handle")?.remove();
    }
    contexts.delete(ctx.reader);
  }
  function restorePosition(ctx, popup) {
    for (const [prop, value, priority] of ctx.originalStyles.get(popup) || []) {
      if (value) popup.style.setProperty(prop, value, priority);
      else popup.style.removeProperty(prop);
    }
  }
  function menuHandler({ reader, append }) {
    ensureReader(reader);
    const current = read("fontSize", 18);
    const setFont = size => { write("fontSize", size); refreshAll(); };
    append({
      label: "译文字号（" + current + "）…",
      onCommand() {
        const result = { value: String(read("fontSize", 18)) };
        if (!Services.prompt.prompt(reader._window || Zotero.getMainWindow(), "译文字号", "输入字号（10–48）：", result, null, {})) return;
        const value = Number(result.value);
        if (Number.isInteger(value) && value >= 10 && value <= 48) setFont(value);
        else Services.prompt.alert(reader._window || Zotero.getMainWindow(), "译文字号", "请输入 10 到 48 之间的整数。");
      }
    }, { slider: true, size: current, steps: Array.from({ length: 39 }, (_, index) => index + 10), onCommand: setFont },
    { label: "对齐所选文段", onCommand() {
      write("width", 400); write("contentHeight", 320);
      const ctx = contexts.get(reader);
      if (ctx) {
        for (const popup of ctx.doc.querySelectorAll(".annotation-popup.ap-enhanced")) {
          Object.assign(popupState(ctx, popup), { auto: true, position: null, size: null, fitKey: null });
          popup.classList.remove("ap-moved");
          restorePosition(ctx, popup);
        }
      }
      refreshAll();
    } });
  }
  function scanReaders() {
    const readers = Zotero.Reader._readers || [];
    for (const [reader, ctx] of contexts) if (!readers.includes(reader)) detach(ctx);
    for (const reader of readers) { try { ensureReader(reader); } catch (e) { Zotero.logError(e); } }
  }
  return {
    diagnostics() {
      return { lastGesture, readers: [...contexts.values()].map(ctx => ({
        window: [ctx.win.innerWidth, ctx.win.innerHeight],
        popups: [...ctx.doc.querySelectorAll(".annotation-popup")].map(popup => ({
          rect: geometry(ctx, popup), style: popup.getAttribute("style"),
          anchor: annotationBounds(ctx, popup), auto: popupState(ctx, popup).auto,
          handle: popup.querySelector(".ap-resize-handle")?.getBoundingClientRect().toJSON()
        }))
      })) };
    },
    start() {
      if (timer !== null) return;
      sheetURI = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(css));
      if (!sheetService.sheetRegistered(sheetURI, sheetService.USER_SHEET)) sheetService.loadAndRegisterSheet(sheetURI, sheetService.USER_SHEET);
      Zotero.Reader.registerEventListener("createAnnotationContextMenu", menuHandler, ID);
      scanReaders();
      timer = Zotero.getMainWindow().setInterval(scanReaders, 300);
    },
    stop() {
      if (timer !== null) { Zotero.getMainWindow()?.clearInterval(timer); timer = null; }
      Zotero.Reader._unregisterEventListenerByPluginID(ID);
      for (const ctx of [...contexts.values()]) detach(ctx);
      if (sheetURI && sheetService.sheetRegistered(sheetURI, sheetService.USER_SHEET)) sheetService.unregisterSheet(sheetURI, sheetService.USER_SHEET);
    }
  };
})();
