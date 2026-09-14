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
      ],
    };
  });
  expect(result).toEqual({
    defined: true,
    editors: 1,
    viewDom: true,
    contentEditable: "true",
    gutters: 1,
    defaults: ["", "plain", "light", false, true, 4],
  });
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
