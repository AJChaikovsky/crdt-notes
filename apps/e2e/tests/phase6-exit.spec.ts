import { expect, test, type Page } from "@playwright/test";

// Phase 6 exit (roadmap): two browser contexts, network disabled on both, divergent edits
// to the same sentence, network restored, both DOMs identical.
//
// Each context is a separate browser profile, so the two have separate IndexedDB storage
// and separate replica IDs, like two people on two computers.

const SENTENCE = "The quick brown fox jumps over the lazy dog.";

/** Moves the cursor to `index` characters into the note, from the very start. */
async function cursorAt(page: Page, index: number): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  for (let i = 0; i < index; i += 1) await page.keyboard.press("ArrowRight");
}

async function select(page: Page, index: number, length: number): Promise<void> {
  await cursorAt(page, index);
  for (let i = 0; i < length; i += 1) await page.keyboard.press("Shift+ArrowRight");
}

/**
 * The editor's content as HTML, without other people's cursors and selections: those
 * are meant to differ, since each window shows the *other* person's.
 */
function editorHtml(page: Page): Promise<string> {
  return page.locator(".cm-content").evaluate((content) => {
    const copy = content.cloneNode(true) as HTMLElement;
    for (const caret of copy.querySelectorAll(".peer-caret")) caret.remove();
    for (const mark of copy.querySelectorAll(".peer-selection"))
      mark.replaceWith(...mark.childNodes);
    // CodeMirror puts an empty image beside a widget, and a <br> after one at the end of
    // a line, so the browser's own cursor behaves there. They go with the caret.
    for (const buffer of copy.querySelectorAll(".cm-widgetBuffer")) buffer.remove();
    for (const line of copy.querySelectorAll(".cm-line"))
      if (line.childNodes.length > 1 && line.lastChild?.nodeName === "BR")
        line.lastChild.remove();
    copy.normalize(); // joins the text split around removed selections
    return copy.innerHTML;
  });
}

test("two offline windows edit the same sentence and merge cleanly", async ({
  browser,
}) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  // Alice starts a note and shares it; Bob opens the link.
  await alice.goto("./");
  await alice.getByRole("button", { name: "New note" }).click();
  await alice.locator(".cm-content").click();
  await alice.keyboard.type(SENTENCE);
  await expect(alice.getByTestId("status")).toHaveText("Synced");
  await bob.goto(alice.url());
  await expect(bob.locator(".cm-content")).toHaveText(SENTENCE);
  await expect(bob.getByTestId("status")).toHaveText("Synced");

  // Both lose the network.
  await aliceContext.setOffline(true);
  await bobContext.setOffline(true);
  await expect(alice.getByTestId("status")).toHaveText("Offline");
  await expect(bob.getByTestId("status")).toHaveText("Offline");

  // Alice: "quick" becomes "slow", and she ends the sentence with "!".
  await select(alice, 4, 5);
  await alice.keyboard.type("slow");
  await alice.keyboard.press("End");
  await alice.keyboard.type("!");
  // Bob: deletes "brown ", adds "very " before "lazy", and ends the sentence with "?".
  await select(bob, 10, 6);
  await bob.keyboard.press("Backspace");
  await cursorAt(bob, 29);
  await bob.keyboard.type("very ");
  await bob.keyboard.press("End");
  await bob.keyboard.type("?");

  await expect(alice.locator(".cm-content")).toHaveText(
    "The slow brown fox jumps over the lazy dog.!",
  );
  await expect(bob.locator(".cm-content")).toHaveText(
    "The quick fox jumps over the very lazy dog.?",
  );
  // Still offline, so still apart: nothing got through.
  await alice.waitForTimeout(500);
  expect(await alice.locator(".cm-content").textContent()).not.toBe(
    await bob.locator(".cm-content").textContent(),
  );

  // The network comes back. Both reconnect by themselves and merge.
  await aliceContext.setOffline(false);
  await bobContext.setOffline(false);
  await expect(alice.getByTestId("status")).toHaveText("Synced", { timeout: 15_000 });
  await expect(bob.getByTestId("status")).toHaveText("Synced", { timeout: 15_000 });

  // Every edit survives. The two inserts at the same place ("!" and "?") come out in the
  // same order on both sides, whichever order that is.
  const merged = /^The slow fox jumps over the very lazy dog\.(!\?|\?!)$/;
  await expect(alice.locator(".cm-content")).toHaveText(merged);
  await expect(bob.locator(".cm-content")).toHaveText(merged);
  await expect.poll(async () => editorHtml(bob)).toBe(await editorHtml(alice));

  await aliceContext.close();
  await bobContext.close();
});

test("the app opens and edits a note with no network at all", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("./");
  // The service worker has saved the app's files for next time.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole("button", { name: "New note" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("# Written online");
  await expect(page.getByTestId("status")).toHaveText("Synced");

  await context.setOffline(true);
  await page.reload(); // served by the service worker, the note from IndexedDB
  await expect(page.locator(".cm-content")).toHaveText("# Written online");
  await expect(page.getByTestId("status")).toHaveText("Offline");
  await page.goto("./");
  await expect(page.getByTestId("notes")).toContainText("Written online");
  await context.close();
});
