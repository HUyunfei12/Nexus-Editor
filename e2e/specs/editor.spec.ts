import { test, expect } from "@playwright/test";

test.describe("Nexus-Editor live preview & document", () => {
  test("renders a GFM table from the initial markdown", async ({ page }) => {
    await page.goto("/");
    const table = page.locator(".nexus-table-wrapper");
    await expect(table).toHaveCount(1);
    await expect(table).toContainText("Alpha");
    await expect(table).toContainText("Beta");
  });

  test("setDocument swaps the rendered table", async ({ page }) => {
    await page.goto("/");
    const table = page.locator(".nexus-table-wrapper");
    await expect(table).toHaveCount(1);
    await expect(table).toContainText("Alpha");

    await page.evaluate(() =>
      window.__nexus.setDocument("| A | B |\n| --- | --- |\n| one | two |")
    );
    await expect(table).toContainText("one");
    await expect(table).toContainText("two");
    await expect(table).not.toContainText("Alpha");
  });

  test("typing into the content surface updates the underlying markdown", async ({ page }) => {
    await page.goto("/");
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Trailing");

    await expect.poll(
      () => page.evaluate(() => window.__nexus.getDocument())
    ).toContain("Trailing");
  });

  test("undo reverts a typed edit", async ({ page }) => {
    await page.goto("/");
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" hello");
    await expect.poll(
      () => page.evaluate(() => window.__nexus.getDocument())
    ).toContain("hello");

    await page.keyboard.press("Control+z");
    await expect.poll(
      () => page.evaluate(() => window.__nexus.getDocument())
    ).not.toContain("hello");
  });
});

test.describe("Nexus-Editor search", () => {
  test("opens the search panel and highlights a match", async ({ page }) => {
    await page.goto("/");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+f");

    const panel = page.locator(".nexus-search-panel");
    await expect(panel).toBeVisible();

    const input = panel.locator('input[main-field="true"]');
    await input.fill("Todo");
    await input.press("Enter");

    await expect(panel).toBeVisible();
    const selected = await page.evaluate(() => {
      const el = document.activeElement ?? (null as unknown as Element);
      return el !== null ? el.textContent : "";
    });
    expect(selected).not.toBeNull();
  });
});

test.describe("Nexus-Editor theming", () => {
  test("switching theme changes the base font color", async ({ page }) => {
    await page.goto("/");
    const light = await page.evaluate(() => window.__nexus.fontColor());
    await page.evaluate(() => window.__nexus.setTheme("dark"));
    const dark = await page.evaluate(() => window.__nexus.fontColor());

    expect(light).not.toBe("");
    expect(dark).not.toBe("");
    expect(light).not.toBe(dark);
  });
});

test.describe("Nexus-Editor accessibility", () => {
  test("reports no critical axe violations on the editor", async ({ page }) => {
    test.skip(!!process.env.CI_PW_SKIP_A11Y, "a11y axe scan disabled in CI");
    const AxeBuilder = (await import("@axe-core/playwright")).default;
    await page.goto("/");
    await page.locator(".cm-editor").waitFor();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "best-practice"])
      .analyze();

    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical).toEqual([]);
  });
});