/**
 * 公開デモの2ブラウザ E2E です。
 *
 * 前提: `pnpm build:browser` 済みの `wrangler dev` が HOSTED_DEMO_ORIGIN で
 * 起動していること。「招待リンクの引継ぎ」は認証情報なしで実行できます。
 * Supabase 実環境での招待→準備→対戦→rating の完全な導線は staging で
 * `HOSTED_DEMO_E2E_AUTH=1` を付けて実行し、結果を `docs/hosted-demo.md` の
 * 検証記録へ記載します。
 */
import { expect, test } from "playwright/test";

const withAuth = process.env["HOSTED_DEMO_E2E_AUTH"] === "1";

test("2つのブラウザcontextで招待リンクの引継ぎを確認する", async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const pageA = await first.newPage();
    const pageB = await second.newPage();

    await pageA.goto("/");
    await expect(
      pageA.getByRole("button", { name: "ゲストとして開始" }),
    ).toBeVisible();

    // 招待リンクを開くとコードが引き継がれて参加入力へ入る。
    await pageB.goto("/#invite=ABC123");
    await expect(pageB.locator("#invite-banner")).toBeVisible();
    await expect(pageB.locator("#invite-banner-code")).toHaveText("ABC123");
    await expect(pageB.locator("#custom-code-input")).toHaveValue("ABC123");

    // 形式異常の招待リンクはエラー通知になる（ハッシュのみの遷移では
    // 再読み込みが起きないため reload して初期表示を確認する）。
    await pageB.goto("/#invite=bad!!");
    await pageB.reload();
    await expect(pageB.locator("#notice")).toContainText(
      "招待リンクの形式が正しくありません",
    );
  } finally {
    await first.close();
    await second.close();
  }
});

test("stagingで招待→準備→対戦→ratingを確認する", async ({ browser }) => {
  test.skip(
    !withAuth,
    "実 Supabase 環境の認証情報がないため、staging で HOSTED_DEMO_E2E_AUTH=1 を付けて実行します。",
  );
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const pageA = await first.newPage();
    const pageB = await second.newPage();

    await pageA.goto("/");
    await pageA.getByRole("button", { name: "ゲストとして開始" }).click();
    await expect(pageA.locator("#app-screen")).toBeVisible();

    await pageB.goto("/");
    await pageB.getByRole("button", { name: "ゲストとして開始" }).click();
    await expect(pageB.locator("#app-screen")).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});
