import { expect, test } from "@playwright/test";

const LONG_DOC = Array.from({ length: 200 }, (_, i) => `line_${i} = ${i}`).join(
  "\n",
);

test.beforeEach(async ({ page }) => {
  await page.goto("/dist/index.html");
  await page.waitForFunction(() => customElements.get("spaday-codemirror"));
  await page.evaluate(() => {
    document.body.replaceChildren();
    const el = document.createElement("spaday-codemirror");
    el.id = "cm";
    el.style.height = "200px";
    window.events = [];
    for (const type of ["editor-change", "editor-selection"]) {
      document.addEventListener(type, (event) => {
        window.events.push({
          type,
          detail: event.detail,
          bubbles: event.bubbles,
          composed: event.composed,
        });
      });
    }
    document.body.append(el);
  });
});

const events = (page) => page.evaluate(() => window.events);

test("registers and renders a CodeMirror editor", async ({ page }) => {
  const result = await page.evaluate(() => {
    const el = document.getElementById("cm");
    return {
      defined: customElements.get("spaday-codemirror") === el.constructor,
      editors: el.querySelectorAll(".cm-editor").length,
      viewDom: el.view.dom === el.querySelector(".cm-editor"),
      contentEditable: el
        .querySelector(".cm-content")
        .getAttribute("contenteditable"),
      gutters: el.querySelectorAll(".cm-lineNumbers").length,
      defaults: [
        el.doc,
        el.language,
        el.theme,
        el.read_only,
        el.line_numbers,
        el.tab_size,
        el.remote_cursors,
      ],
    };
  });
  expect(result).toEqual({
    defined: true,
    editors: 1,
    viewDom: true,
    contentEditable: "true",
    gutters: 1,
    defaults: ["", "plain", "light", false, true, 4, []],
  });

  await page.locator("#cm .cm-content").click();
  await expect(page.locator("#cm")).toHaveCSS(
    "border-color",
    "rgb(9, 105, 218)",
  );
});

test("editor colors follow shell and package tokens", async ({ page }) => {
  const result = await page.evaluate(() => {
    const el = document.getElementById("cm");
    document.body.style.setProperty("--spa-surface", "rgb(1, 2, 3)");
    document.body.style.setProperty("--spa-border", "rgb(4, 5, 6)");
    document.body.style.setProperty("--spa-muted", "rgb(7, 8, 9)");
    document.body.style.setProperty("--spa-accent", "rgb(10, 11, 12)");
    const editor = el.querySelector(".cm-editor");
    const fromShell = {
      surface: getComputedStyle(editor).backgroundColor,
      text: getComputedStyle(editor).color,
      border: getComputedStyle(el).borderColor,
    };
    el.style.setProperty("--spa-codemirror-surface", "rgb(13, 14, 15)");
    el.style.setProperty("--spa-codemirror-active-line", "rgb(16, 17, 18)");
    const fromPackage = {
      surface: getComputedStyle(editor).backgroundColor,
      activeLine: getComputedStyle(el.querySelector(".cm-activeLine"))
        .backgroundColor,
    };
    return { fromShell, fromPackage };
  });
  expect(result).toEqual({
    fromShell: {
      surface: "rgb(1, 2, 3)",
      text: "rgb(7, 8, 9)",
      border: "rgb(4, 5, 6)",
    },
    fromPackage: {
      surface: "rgb(13, 14, 15)",
      activeLine: "rgb(16, 17, 18)",
    },
  });

  await page.locator("#cm .cm-content").click();
  await expect(page.locator("#cm")).toHaveCSS(
    "border-color",
    "rgb(10, 11, 12)",
  );
});

test("applies syntax modes", async ({ page }) => {
  await page.evaluate(() => {
    const el = document.getElementById("cm");
    el.language = "python";
    el.doc = "def f(x):\n    return 'hi'\n";
  });
  const content = page.locator("#cm .cm-content");
  await expect(content).toHaveAttribute("data-language", "python");
  // highlighted tokens render as styled spans inside lines
  await expect(page.locator("#cm .cm-line span").first()).toBeVisible();
  const keyword = await page
    .locator("#cm .cm-line span", { hasText: "def" })
    .first()
    .evaluate((node) => getComputedStyle(node).color);
  const plain = await page
    .locator("#cm .cm-content")
    .evaluate((node) => getComputedStyle(node).color);
  expect(keyword).not.toBe(plain);

  for (const language of ["javascript", "json", "markdown"]) {
    await page.evaluate(
      (language) => (document.getElementById("cm").language = language),
      language,
    );
    await expect(content).toHaveAttribute("data-language", language);
  }
  await page.evaluate(() => (document.getElementById("cm").language = "plain"));
  await expect(content).not.toHaveAttribute("data-language", /.*/);
  expect(await events(page)).toEqual([]);
});

test("emits editor-change for user edits", async ({ page }) => {
  await page.evaluate(() => (document.getElementById("cm").doc = "ab"));
  await page.locator("#cm .cm-content").click();
  await page.keyboard.press("End");
  await page.evaluate(() => (window.events = []));
  await page.keyboard.type("c");
  const [event] = await events(page);
  expect(event).toEqual({
    type: "editor-change",
    detail: {
      doc: "abc",
      changes: [{ from: 2, to: 2, insert: "c" }],
      selection: { anchor: 3, head: 3 },
    },
    bubbles: true,
    composed: true,
  });
  expect(await page.evaluate(() => document.getElementById("cm").doc)).toBe(
    "abc",
  );
});

test("emits editor-selection for user selection changes", async ({ page }) => {
  await page.evaluate(() => (document.getElementById("cm").doc = "hello"));
  await page.locator("#cm .cm-content").click();
  await page.keyboard.press("End");
  await page.evaluate(() => (window.events = []));
  await page.keyboard.press("Shift+ArrowLeft");
  const all = await events(page);
  expect(all).toEqual([
    {
      type: "editor-selection",
      detail: { selection: { anchor: 5, head: 4 } },
      bubbles: true,
      composed: true,
    },
  ]);
  expect(
    await page.evaluate(() => document.getElementById("cm").selection),
  ).toEqual({ anchor: 5, head: 4 });
});

test("programmatic updates keep the view, focus, and scroll without feedback", async ({
  page,
}) => {
  await page.evaluate(
    (doc) => (document.getElementById("cm").doc = doc),
    LONG_DOC,
  );
  await page.locator("#cm .cm-content").click();
  const before = await page.evaluate(() => {
    const el = document.getElementById("cm");
    el.view.scrollDOM.scrollTop = 1000;
    window.originalView = el.view;
    window.events = [];
    return el.view.scrollDOM.scrollTop;
  });
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => new Promise(requestAnimationFrame));

  const after = await page.evaluate((doc) => {
    const el = document.getElementById("cm");
    el.doc = `${doc}\nappended = 1`;
    el.selection = { anchor: 3, head: 7 };
    el.language = "python";
    el.theme = "dark";
    el.tab_size = 2;
    el.line_numbers = false;
    return {
      sameView: el.view === window.originalView,
      focused: el.view.hasFocus,
      doc: el.doc.endsWith("appended = 1"),
      selection: el.selection,
    };
  }, LONG_DOC);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const scroll = await page.evaluate(
    () => document.getElementById("cm").view.scrollDOM.scrollTop,
  );

  expect(after).toEqual({
    sameView: true,
    focused: true,
    doc: true,
    selection: { anchor: 3, head: 7 },
  });
  expect(scroll).toBe(before);
  expect(await events(page)).toEqual([]);
});

test("programmatic document updates do not enter local undo history", async ({
  page,
}) => {
  await page.evaluate(() => (document.getElementById("cm").doc = "start"));
  await page.locator("#cm .cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" local");
  await page.evaluate(
    () => (document.getElementById("cm").doc = "remote start local"),
  );

  await page.keyboard.press("ControlOrMeta+z");

  expect(await page.evaluate(() => document.getElementById("cm").doc)).toBe(
    "remote start",
  );
});

test("configures read_only, line_numbers, tab_size, and theme", async ({
  page,
}) => {
  const el = page.locator("#cm");
  await page.evaluate(() => {
    const el = document.getElementById("cm");
    el.doc = "x";
    el.read_only = true;
    el.line_numbers = false;
    el.tab_size = 2;
    el.theme = "dark";
  });
  await expect(el.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(el.locator(".cm-lineNumbers")).toHaveCount(0);
  const state = await page.evaluate(() => {
    const view = document.getElementById("cm").view;
    return {
      tabSize: view.state.tabSize,
      readOnly: view.state.readOnly,
      dark:
        view.dom.classList.contains("cm-editor") &&
        getComputedStyle(view.dom).backgroundColor,
    };
  });
  expect(state).toEqual({
    tabSize: 2,
    readOnly: true,
    dark: "rgb(40, 44, 52)",
  });

  await el.locator(".cm-content").click();
  await page.keyboard.type("y");
  expect(await page.evaluate(() => document.getElementById("cm").doc)).toBe(
    "x",
  );

  await page.evaluate(() => {
    const el = document.getElementById("cm");
    el.read_only = false;
    el.line_numbers = true;
    el.theme = "light";
  });
  await expect(el.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expect(el.locator(".cm-lineNumbers")).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        getComputedStyle(document.getElementById("cm").view.dom)
          .backgroundColor,
    ),
  ).not.toBe("rgb(40, 44, 52)");
});

test("reads configuration from attributes", async ({ page }) => {
  const result = await page.evaluate(() => {
    const el = document.getElementById("cm");
    el.setAttribute("language", "json");
    el.setAttribute("theme", "dark");
    el.setAttribute("read_only", "");
    el.setAttribute("line_numbers", "false");
    el.setAttribute("tab_size", "8");
    el.setAttribute("doc", "{}");
    return [
      el.language,
      el.theme,
      el.read_only,
      el.line_numbers,
      el.tab_size,
      el.doc,
      el.view.state.tabSize,
    ];
  });
  expect(result).toEqual(["json", "dark", true, false, 8, "{}", 8]);
});

test("sets and clamps selection", async ({ page }) => {
  const result = await page.evaluate(() => {
    const el = document.getElementById("cm");
    el.doc = "0123456789";
    el.selection = { anchor: 2, head: 5 };
    const range = el.view.state.selection.main;
    const explicit = [range.anchor, range.head, el.selection];
    el.selection = { anchor: 4 };
    const cursor = el.selection;
    el.selection = { anchor: 50, head: -3 };
    const clamped = el.selection;
    el.selection = null;
    return { explicit, cursor, clamped, afterNull: el.selection };
  });
  expect(result).toEqual({
    explicit: [2, 5, { anchor: 2, head: 5 }],
    cursor: { anchor: 4, head: 4 },
    clamped: { anchor: 10, head: 0 },
    afterNull: { anchor: 10, head: 0 },
  });
  expect(await events(page)).toEqual([]);
});

test("renders and tracks remote cursors without feedback", async ({ page }) => {
  await page.evaluate(() => {
    const el = document.getElementById("cm");
    el.doc = "abcdef";
    el.remote_cursors = [
      {
        peer: "alice",
        anchor: 1,
        head: 4,
        label: "Alice",
        color: "#b42318",
      },
      { peer: "bob", anchor: 5, color: "#175cd3" },
    ];
  });

  await expect(
    page.locator('#cm .cm-remote-selection[data-peer="alice"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('#cm .cm-remote-cursor[data-peer="alice"]'),
  ).toHaveCount(1);
  await expect(page.locator("#cm .cm-remote-cursor-label")).toHaveText("Alice");
  await expect(
    page.locator('#cm .cm-remote-cursor[data-peer="bob"]'),
  ).toHaveCount(1);

  const mapped = await page.evaluate(() => {
    const el = document.getElementById("cm");
    el.doc = `XX${el.doc}`;
    return el.remote_cursors;
  });
  expect(mapped).toEqual([
    {
      peer: "alice",
      anchor: 3,
      head: 6,
      label: "Alice",
      color: "#b42318",
    },
    { peer: "bob", anchor: 7, head: 7, color: "#175cd3" },
  ]);

  const sanitized = await page.evaluate(() => {
    const el = document.getElementById("cm");
    el.remote_cursors = [
      {
        peer: "unsafe",
        anchor: 2,
        color: "red; background-image: url(https://invalid.example)",
      },
    ];
    return el.remote_cursors;
  });
  expect(sanitized).toEqual([{ peer: "unsafe", anchor: 2, head: 2 }]);

  await page.evaluate(() => {
    document.getElementById("cm").remote_cursors = [
      { peer: "bob", anchor: 2, color: "#175cd3" },
    ];
  });
  await expect(page.locator('[data-peer="alice"]')).toHaveCount(0);
  await expect(page.locator('[data-peer="bob"]')).toHaveCount(1);
  expect(await events(page)).toEqual([]);
});

test("applies remote cursors assigned before connection", async ({ page }) => {
  await page.evaluate(() => {
    const el = document.createElement("spaday-codemirror");
    el.id = "preconfigured";
    el.doc = "abcdef";
    el.remote_cursors = [{ peer: "alice", anchor: 3, label: "Alice" }];
    document.body.append(el);
  });

  await expect(
    page.locator('#preconfigured .cm-remote-cursor[data-peer="alice"]'),
  ).toHaveCount(1);
});

test("connects cursor state to generic awareness", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { connectCursorAwareness } = await import("/dist/cdn/index.js");
    const el = document.getElementById("cm");
    el.doc = "abcdef";
    el.selection = { anchor: 2 };
    const sent = [];
    const awarenessListeners = new Set();
    const changeListeners = new Set();
    const client = {
      awareness: () =>
        new Map([["existing", { selection: { anchor: 1 }, name: "Existing" }]]),
      onAwareness(listener) {
        awarenessListeners.add(listener);
        return () => awarenessListeners.delete(listener);
      },
      onChange(listener) {
        changeListeners.add(listener);
        return () => changeListeners.delete(listener);
      },
      setAwareness(id, state) {
        sent.push({ id, state });
        return true;
      },
    };
    const binding = connectCursorAwareness(el, client, 7, {
      local: () => ({ role: "writer" }),
      remote: (_peer, state) => ({ label: state.name }),
    });
    const initial = el.remote_cursors;

    el.view.dispatch({ selection: { anchor: 3 } });
    for (const listener of awarenessListeners)
      listener({
        id: 7,
        peer: "alice",
        state: { selection: { anchor: 4, head: 6 }, name: "Alice" },
      });
    const received = el.remote_cursors;
    el.doc = `XX${el.doc}`;
    for (const listener of awarenessListeners)
      listener({
        id: 7,
        peer: "bob",
        state: { selection: { anchor: 2 }, name: "Bob" },
      });
    const mapped = el.remote_cursors;
    for (const listener of changeListeners) listener({ id: 7 });
    binding.disconnect();
    const publishedAfterDisconnect = binding.publish();
    for (const listener of awarenessListeners)
      listener({ id: 7, peer: "late", state: { selection: { anchor: 5 } } });

    return {
      initial,
      received,
      mapped,
      afterDisconnect: el.remote_cursors,
      publishedAfterDisconnect,
      sent,
      listenerCounts: [awarenessListeners.size, changeListeners.size],
    };
  });

  expect(result.initial).toEqual([
    { peer: "existing", anchor: 1, head: 1, label: "Existing" },
  ]);
  expect(result.received).toEqual([
    { peer: "existing", anchor: 1, head: 1, label: "Existing" },
    { peer: "alice", anchor: 4, head: 6, label: "Alice" },
  ]);
  expect(result.mapped).toEqual([
    { peer: "existing", anchor: 3, head: 3, label: "Existing" },
    { peer: "alice", anchor: 6, head: 8, label: "Alice" },
    { peer: "bob", anchor: 2, head: 2, label: "Bob" },
  ]);
  expect(result.afterDisconnect).toEqual([]);
  expect(result.publishedAfterDisconnect).toBe(false);
  expect(result.sent).toEqual([
    { id: 7, state: { role: "writer", selection: { anchor: 2, head: 2 } } },
    { id: 7, state: { role: "writer", selection: { anchor: 3, head: 3 } } },
    { id: 7, state: { role: "writer", selection: { anchor: 5, head: 5 } } },
    { id: 7, state: null },
  ]);
  expect(result.listenerCounts).toEqual([0, 0]);
  expect(await events(page)).toHaveLength(1);
});

test("destroys the view on disconnect and restores it on reconnect", async ({
  page,
}) => {
  const disconnected = await page.evaluate(() => {
    const el = document.getElementById("cm");
    window.el = el;
    el.language = "python";
    el.doc = "abcdef";
    el.selection = { anchor: 1, head: 3 };
    window.oldView = el.view;
    el.remove();
    return {
      view: el.view,
      editors: el.querySelectorAll(".cm-editor").length,
      doc: el.doc,
      selection: el.selection,
      detached: !window.oldView.dom.isConnected,
    };
  });
  expect(disconnected).toEqual({
    view: null,
    editors: 0,
    doc: "abcdef",
    selection: { anchor: 1, head: 3 },
    detached: true,
  });

  const reconnected = await page.evaluate(() => {
    const el = window.el;
    el.doc = "abcdefg";
    document.body.append(el);
    return {
      newView: el.view !== null && el.view !== window.oldView,
      editors: el.querySelectorAll(".cm-editor").length,
      doc: el.view.state.doc.toString(),
      selection: el.selection,
      language: el.querySelector(".cm-content").getAttribute("data-language"),
    };
  });
  expect(reconnected).toEqual({
    newView: true,
    editors: 1,
    doc: "abcdefg",
    selection: { anchor: 1, head: 3 },
    language: "python",
  });

  await page.locator("#cm .cm-content").click();
  await page.keyboard.press("End");
  await page.evaluate(() => (window.events = []));
  await page.keyboard.type("h");
  const [event] = await events(page);
  expect(event.type).toBe("editor-change");
  expect(event.detail.doc).toBe("abcdefgh");
});
