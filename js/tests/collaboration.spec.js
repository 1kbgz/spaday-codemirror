import { expect, test } from "@playwright/test";

const URL = "http://127.0.0.1:8032";

const doc = (page) =>
  page.evaluate(() => document.getElementById("shared-editor").doc);

async function open(page, user = "") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${URL}/${user}`);
  await expect(page.locator("#shared-editor .cm-editor")).toHaveCount(1);
  await expect.poll(() => doc(page)).toContain("Shared notes");
  return errors;
}

async function insertAt(page, anchor, text) {
  await page.evaluate((anchor) => {
    const editor = document.getElementById("shared-editor");
    editor.selection = { anchor };
    editor.view.focus();
  }, anchor);
  await page.keyboard.insertText(text);
}

const insertAfterEmoji = async (page, text) => {
  const anchor = await page.evaluate(() => {
    const doc = document.getElementById("shared-editor").doc;
    return doc.indexOf("🙂") + "🙂".length;
  });
  await insertAt(page, anchor, text);
};

test("two editors converge and the viewer remains read-only", async ({
  browser,
}) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const viewer = await viewerContext.newPage();
  const marker = Math.random().toString(36).slice(2);
  const aliceEdit = `<alice-edit-${marker}>`;
  const bobEdit = `<bob-λ-${marker}>`;
  const aliceUndo = `<alice-undo-${marker}>`;
  const bobRemote = `<bob-remote-${marker}>`;
  const aliceErrors = await open(alice);
  const bobErrors = await open(bob, "bob");

  await Promise.all([
    aliceContext.setOffline(true),
    bobContext.setOffline(true),
  ]);
  await Promise.all([
    insertAfterEmoji(alice, ` ${aliceEdit}`),
    insertAfterEmoji(bob, ` ${bobEdit}`),
  ]);
  await expect.poll(() => doc(alice)).toContain(`🙂 ${aliceEdit}`);
  await expect.poll(() => doc(bob)).toContain(`🙂 ${bobEdit}`);
  await expect.poll(() => doc(alice)).not.toContain(bobEdit);
  await expect.poll(() => doc(bob)).not.toContain(aliceEdit);

  await Promise.all([
    aliceContext.setOffline(false),
    bobContext.setOffline(false),
  ]);
  await expect.poll(() => doc(alice)).toContain(aliceEdit);
  await expect.poll(() => doc(alice)).toContain(bobEdit);
  await expect
    .poll(async () => (await doc(bob)) === (await doc(alice)))
    .toBe(true);

  await insertAt(alice, (await doc(alice)).length, ` ${aliceUndo}`);
  await expect.poll(() => doc(bob)).toContain(aliceUndo);
  await insertAt(bob, 0, `${bobRemote} `);
  await expect.poll(() => doc(alice)).toContain(bobRemote);
  await alice.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => doc(alice)).not.toContain(aliceUndo);
  await expect.poll(() => doc(alice)).toContain(aliceEdit);
  await expect.poll(() => doc(alice)).toContain(bobEdit);
  await expect.poll(() => doc(alice)).toContain(bobRemote);
  await expect
    .poll(async () => (await doc(bob)) === (await doc(alice)))
    .toBe(true);

  await alice.evaluate(() => {
    document.getElementById("shared-editor").view.dispatch({
      selection: { anchor: 2, head: 7 },
    });
  });
  await expect
    .poll(() =>
      bob.evaluate(() =>
        document
          .getElementById("shared-editor")
          .remote_cursors.find((cursor) => cursor.label === "Alice"),
      ),
    )
    .toMatchObject({ anchor: 2, head: 7, color: "#b42318" });
  await expect(
    bob.locator("#shared-editor .cm-remote-cursor-label", {
      hasText: "Alice",
    }),
  ).toBeVisible();

  const viewerErrors = await open(viewer, "viewer");
  await expect
    .poll(async () => (await doc(viewer)) === (await doc(alice)))
    .toBe(true);
  await expect(viewer.locator("#shared-editor .cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(viewer.locator("#current-access")).toHaveText("Read only");
  await expect(
    viewer.locator("#shared-editor .cm-remote-cursor-label", {
      hasText: "Alice",
    }),
  ).toBeVisible();
  await viewer.evaluate(() => {
    document.getElementById("shared-editor").view.dispatch({
      selection: { anchor: 1, head: 4 },
    });
  });
  await expect
    .poll(() =>
      bob.evaluate(() =>
        document
          .getElementById("shared-editor")
          .remote_cursors.find((cursor) => cursor.label === "Viewer"),
      ),
    )
    .toMatchObject({ anchor: 1, head: 4, color: "#067647" });
  expect([...aliceErrors, ...bobErrors, ...viewerErrors]).toEqual([]);
  await aliceContext.close();
  await expect(
    bob.locator("#shared-editor .cm-remote-cursor-label", {
      hasText: "Alice",
    }),
  ).toHaveCount(0);
  await Promise.all([bobContext.close(), viewerContext.close()]);
});
