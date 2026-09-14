import fs from "fs";
import { expect, test } from "@playwright/test";

// Built by `make test-pyodide-example`, which copies dist/lite into js/dist/lite.
test.skip(
  !fs.existsSync("dist/lite/index.html"),
  "run `make test-pyodide-example` to build the Pyodide example",
);

test("CodeMirror edits round-trip through Python in a Pyodide worker", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.workerMessages = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      window.workerMessages.push(message);
      return post.call(this, message, ...rest);
    };
  });

  await page.goto("/dist/lite/index.html");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {
    timeout: 200_000,
  });
  await expect(page.locator("#pyodide-status")).toHaveText(
    "Ready · Python worker connected",
  );
  await expect(
    page.locator("#gallery spaday-codemirror .cm-editor"),
  ).toHaveCount(5);
  await expect(page.locator("#metric-revision")).toHaveText("0");

  const patchesBefore = Number(
    (await page.locator("html").getAttribute("data-worker-patches")) ?? 0,
  );
  await page.locator("#source-editor .cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("x");
  const doc = await page.evaluate(
    () => document.getElementById("source-editor").doc,
  );

  await expect(page.locator("#metric-revision")).toHaveText("1");
  await expect(page.locator("#metric-characters")).toHaveText(
    String(doc.length),
  );
  await expect(page.locator("#status")).toHaveText(
    "Edited in browser · revision 1",
  );
  const intents = await page.evaluate(() =>
    window.workerMessages.filter((m) => m.type === "spaday:patch"),
  );
  expect(intents).toEqual([
    {
      type: "spaday:patch",
      detail: { model: "editor", field: "doc", value: doc },
    },
  ]);
  const patchesAfter = Number(
    await page.locator("html").getAttribute("data-worker-patches"),
  );
  expect(patchesAfter).toBe(patchesBefore + 1);
  expect(
    await page.evaluate(() => document.getElementById("preview-editor").doc),
  ).toContain("x");
  expect(errors).toEqual([]);
});
