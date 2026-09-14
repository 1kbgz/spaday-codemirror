import { expect, test } from "@playwright/test";

const URL = "http://127.0.0.1:8031/";

async function open(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const sent = [];
  const received = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => sent.push(JSON.parse(frame.payload)));
    socket.on("framereceived", (frame) =>
      received.push(JSON.parse(frame.payload)),
    );
  });
  await page.goto(URL);
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#source-editor .cm-editor")).toHaveCount(1);
  return { errors, sent, received };
}

const doc = (page, id) =>
  page.evaluate((id) => document.getElementById(id).doc, id);

async function typeAtEnd(page, text) {
  await page.locator("#source-editor .cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

test("editor input round-trips through Python over the websocket", async ({
  page,
}) => {
  const { errors, sent, received } = await open(page);
  const view = await page.evaluateHandle(
    () => document.getElementById("source-editor").view,
  );
  await typeAtEnd(page, "x = 1");
  const expected = await doc(page, "source-editor");
  expect(expected.endsWith("x = 1")).toBe(true);

  await expect(page.locator("#metric-characters")).toHaveText(
    String(expected.length),
  );
  await expect(page.locator("#metric-lines")).toHaveText(
    String(expected.split("\n").length),
  );
  await expect(page.locator("#metric-words")).toHaveText(
    String(expected.split(/\s+/).filter(Boolean).length),
  );
  await expect(page.locator("#metric-revision")).toHaveText("5");
  await expect(page.locator("#status")).toHaveText(
    "Edited in browser · revision 5",
  );
  expect(await doc(page, "preview-editor")).toContain("x = 1");

  const edits = sent.filter(
    (m) => m.type === "spaday:patch" && m.detail.field === "doc",
  );
  // one intent per keystroke, each carrying the full document
  expect(edits.map((m) => m.detail.value)).toEqual(
    [4, 3, 2, 1, 0].map((cut) => expected.slice(0, expected.length - cut)),
  );
  expect(edits.at(-1).detail).toEqual({
    model: "editor",
    field: "doc",
    value: expected,
  });
  expect(received[0].type).toBe("snapshot");
  expect(received.filter((m) => m.type === "patch")).toHaveLength(edits.length);

  // Python never echoes the user's text back into the source editor
  expect(await doc(page, "source-editor")).toBe(expected);
  expect(
    await page.evaluate(
      (view) => view === document.getElementById("source-editor").view,
      view,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.getElementById("source-editor").view.hasFocus,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("Python normalize and reset rewrite the editor without feedback", async ({
  page,
}) => {
  const { errors, sent } = await open(page);
  const initial = await doc(page, "source-editor");
  expect(initial).toContain("\t");

  await typeAtEnd(page, "y = 2   ");
  await expect(page.locator("#metric-revision")).toHaveText("8");
  const edited = await doc(page, "source-editor");
  const view = await page.evaluateHandle(
    () => document.getElementById("source-editor").view,
  );

  sent.length = 0;
  await page.locator("#normalize").click();
  await expect(page.locator("#status")).toHaveText(
    "Normalized in Python · revision 9",
  );
  const normalized = await doc(page, "source-editor");
  expect(normalized).not.toBe(edited);
  expect(normalized).not.toContain("\t");
  expect(normalized).not.toMatch(/ +\n/);
  expect(normalized.endsWith("y = 2\n")).toBe(true);
  expect(normalized).toBe(await doc(page, "preview-editor"));
  expect(sent.map((m) => m.detail.field)).toEqual(["sync", "action"]);
  expect(sent[0].detail.value).toBe(edited);
  expect(sent[1].detail.value).toBe("normalize");

  await page.locator("#normalize").click();
  await expect(page.locator("#status")).toHaveText(
    "Normalized in Python · no change",
  );
  await expect(page.locator("#metric-revision")).toHaveText("9");

  sent.length = 0;
  await page.locator("#reset").click();
  await expect(page.locator("#status")).toHaveText(
    "Reset in Python · revision 10",
  );
  expect(await doc(page, "source-editor")).toBe(initial);
  await expect(page.locator("#metric-characters")).toHaveText(
    String(initial.length),
  );
  // Python-authored doc changes don't come back as editor-change intents
  await page.waitForTimeout(100);
  expect(sent.map((m) => m.detail.field)).toEqual(["sync", "action"]);
  expect(
    await page.evaluate(
      (view) => view === document.getElementById("source-editor").view,
      view,
    ),
  ).toBe(true);

  // editing continues to work after a Python rewrite
  await typeAtEnd(page, "z");
  await expect(page.locator("#metric-revision")).toHaveText("11");
  expect(errors).toEqual([]);
});

test("gallery renders every language as a real CodeMirror editor", async ({
  page,
}) => {
  const { errors } = await open(page);
  const gallery = page.locator("#gallery");
  await expect(gallery.locator("spaday-codemirror .cm-editor")).toHaveCount(5);
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll("#gallery spaday-codemirror")].map((el) => ({
      language: el.querySelector(".cm-content").getAttribute("data-language"),
      editable: el.querySelector(".cm-content").getAttribute("contenteditable"),
      gutter: el.querySelectorAll(".cm-lineNumbers").length,
      background: getComputedStyle(el.querySelector(".cm-editor"))
        .backgroundColor,
      tabSize: el.view.state.tabSize,
      lines: el.querySelectorAll(".cm-line").length,
    })),
  );
  const dark = "rgb(40, 44, 52)";
  expect(
    cards.map(({ lines, background, ...card }) => ({
      ...card,
      dark: background === dark,
      rendered: lines > 1,
    })),
  ).toEqual([
    {
      language: "python",
      editable: "true",
      gutter: 1,
      tabSize: 4,
      dark: false,
      rendered: true,
    },
    {
      language: "javascript",
      editable: "true",
      gutter: 1,
      tabSize: 2,
      dark: true,
      rendered: true,
    },
    {
      language: "json",
      editable: "false",
      gutter: 1,
      tabSize: 2,
      dark: false,
      rendered: true,
    },
    {
      language: "markdown",
      editable: "true",
      gutter: 0,
      tabSize: 4,
      dark: false,
      rendered: true,
    },
    {
      language: null,
      editable: "false",
      gutter: 0,
      tabSize: 8,
      dark: true,
      rendered: true,
    },
  ]);
  expect(errors).toEqual([]);
});

test("mobile layout does not overflow horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await open(page);
  await expect(page.locator("#gallery .cm-editor")).toHaveCount(5);
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const wide = [...document.querySelectorAll("#codemirror-example *")]
      .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1)
      .filter((el) => !el.closest(".cm-scroller"));
    return {
      scroll: root.scrollWidth - root.clientWidth,
      wide: wide.map((el) => el.tagName),
    };
  });
  expect(overflow).toEqual({ scroll: 0, wide: [] });
  expect(errors).toEqual([]);
});

test("scroll stays stable when Python patches the page", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  const { errors } = await open(page);
  await page.locator("#source-editor .cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(
    Array.from({ length: 80 }, (_, i) => `\nvalue_${i} = ${i}`).join(""),
  );
  await expect(page.locator("#metric-revision")).toHaveText("1");
  await page.evaluate(() => window.scrollTo(0, 120));

  const before = await page.evaluate(() => ({
    editor: document.getElementById("source-editor").view.scrollDOM.scrollTop,
    window: window.scrollY,
  }));
  expect(before.editor).toBeGreaterThan(0);
  expect(before.window).toBe(120);

  await page.keyboard.type("0");
  await expect(page.locator("#metric-revision")).toHaveText("2");
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const after = await page.evaluate(() => ({
    editor: document.getElementById("source-editor").view.scrollDOM.scrollTop,
    window: window.scrollY,
  }));
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});
