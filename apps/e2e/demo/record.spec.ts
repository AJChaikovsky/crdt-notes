import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The Phase 7 demo (roadmap): two people on one note, both go offline, both edit the same
// sentence, they come back online and the edits merge. Each window is a separate browser
// profile, so separate devices as far as the app can tell. Frames from both windows are
// put side by side and turned into docs/demo.gif with ffmpeg.

const OUTPUT = join(import.meta.dirname, "../../../docs/demo.gif");
const FPS = 8;
const SIZE = { width: 560, height: 300 };

test("record docs/demo.gif", async ({ browser }) => {
  const frames = mkdtempSync(join(tmpdir(), "crdt-notes-demo-"));
  const open = async () => {
    const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
    return { context, page: await context.newPage() };
  };
  const alice = await open();
  const bob = await open();
  let frame = 0;

  /** A banner over each window, so a viewer can tell who is who and what is happening. */
  const caption = async (page: Page, who: string, text: string) => {
    await page.evaluate(
      ([who, text]) => {
        let banner = document.getElementById("demo-banner");
        if (banner === null) {
          banner = document.createElement("div");
          banner.id = "demo-banner";
          banner.style.cssText =
            "position:fixed;bottom:0;left:0;right:0;padding:6px 12px;font:600 14px system-ui;" +
            "background:#1f1d1a;color:#fdfcfa;z-index:10";
          document.body.append(banner);
        }
        banner.textContent = `${who}: ${text}`;
      },
      [who, text],
    );
  };
  const captions = async (forAlice: string, forBob = forAlice) => {
    await caption(alice.page, "Alice", forAlice);
    await caption(bob.page, "Bob", forBob);
  };

  /** One frame of each window. */
  const snap = async () => {
    frame += 1;
    const name = String(frame).padStart(4, "0");
    await alice.page.screenshot({ path: join(frames, `a_${name}.png`) });
    await bob.page.screenshot({ path: join(frames, `b_${name}.png`) });
  };
  /** Keeps the current picture on screen for `seconds`. */
  const hold = async (seconds: number) => {
    await snap();
    const last = String(frame).padStart(4, "0");
    for (let i = 1; i < seconds * FPS; i += 1) {
      frame += 1;
      const name = String(frame).padStart(4, "0");
      for (const side of ["a", "b"])
        copyFileSync(
          join(frames, `${side}_${last}.png`),
          join(frames, `${side}_${name}.png`),
        );
    }
  };
  /** Types like a person, one frame per character. */
  const type = async (page: Page, text: string) => {
    for (const char of text) {
      await page.keyboard.type(char);
      await snap();
    }
  };
  const cursorAt = async (page: Page, index: number) => {
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+Home");
    for (let i = 0; i < index; i += 1) await page.keyboard.press("ArrowRight");
  };
  const select = async (page: Page, index: number, length: number) => {
    await cursorAt(page, index);
    for (let i = 0; i < length; i += 1) await page.keyboard.press("Shift+ArrowRight");
    await snap();
  };

  // Alice starts a note; Bob opens her link.
  await alice.page.goto("./");
  await bob.page.goto("./");
  await captions("starts a new note", "waiting for a link");
  await hold(1.5);
  await alice.page.getByRole("button", { name: "New note" }).click();
  await alice.page.locator(".cm-content").click();
  await captions("starts a new note", "waiting for a link");
  await type(alice.page, "# Picnic\n");
  await type(alice.page, "Bring bread and cheese.");
  await expect(alice.page.getByTestId("status")).toHaveText("Synced");
  await bob.page.goto(alice.page.url());
  await expect(bob.page.locator(".cm-content")).toContainText("cheese");
  await bob.page.locator(".cm-content").click();
  await captions("online", "opened Alice's link");
  await hold(2);

  // Both lose the network.
  await alice.context.setOffline(true);
  await bob.context.setOffline(true);
  await expect(alice.page.getByTestId("status")).toHaveText("Offline");
  await expect(bob.page.getByTestId("status")).toHaveText("Offline");
  await captions("offline", "offline");
  await hold(2);

  // Both edit the same sentence, neither seeing the other.
  const line = "# Picnic\n".length; // where the sentence starts
  await captions("offline, swaps bread for sourdough", "offline");
  await select(alice.page, line + 6, 5); // "bread"
  await type(alice.page, "sourdough");
  await captions("offline", "offline, adds apples, Bring becomes Pack");
  await cursorAt(bob.page, line + 22); // after "cheese"
  await type(bob.page, " and apples");
  await select(bob.page, line, 5); // "Bring"
  await type(bob.page, "Pack");
  await captions("offline, two different versions", "offline, two different versions");
  await hold(2.5);

  // Back online: both reconnect by themselves and merge.
  await alice.context.setOffline(false);
  await bob.context.setOffline(false);
  const merged = "Pack sourdough and cheese and apples.";
  await expect(alice.page.locator(".cm-content")).toContainText(merged, {
    timeout: 15_000,
  });
  await expect(bob.page.locator(".cm-content")).toContainText(merged, {
    timeout: 15_000,
  });
  await expect(alice.page.getByTestId("status")).toHaveText("Synced");
  await expect(bob.page.getByTestId("status")).toHaveText("Synced");
  await captions("back online, merged", "back online, merged");
  await hold(4);

  // Side by side with a thin divider, one shared palette, looping forever.
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    String(FPS),
    "-i",
    join(frames, "a_%04d.png"),
    "-framerate",
    String(FPS),
    "-i",
    join(frames, "b_%04d.png"),
    "-filter_complex",
    "[0]pad=iw+4:ih:0:0:color=#6b6760[l];[l][1]hstack=inputs=2,split[x][y];" +
      "[x]palettegen=max_colors=64:stats_mode=diff[p];[y][p]paletteuse=dither=none:diff_mode=rectangle",
    "-loop",
    "0",
    OUTPUT,
  ]);
  rmSync(frames, { recursive: true, force: true });
  const mb = statSync(OUTPUT).size / 1e6;
  console.info(`docs/demo.gif: ${frame} frames, ${mb.toFixed(2)} MB`);
  expect(mb).toBeLessThan(5); // the roadmap's limit
});
