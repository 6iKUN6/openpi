import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MODEL_ID,
  PROVIDER_ID,
  startFakeProvider,
} from "./provider-e2e-support.ts";
import { questionFixture } from "./question-fixtures.ts";

const headers = { Authorization: `Bearer ${process.env.OPENPI_WEB_E2E_TOKEN}` };
function stream(_body: unknown, index: number, handoff = false) {
  const delta =
    index === 0
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "ask-browser",
              type: "function",
              function: {
                name: handoff ? "human_handoff" : "ask_user",
                arguments: JSON.stringify(
                  handoff
                    ? {
                        title: "登录测试账户",
                        instructions: "请在测试页面完成登录。",
                        completionSignal: "页面出现账户名称",
                      }
                    : { questions: questionFixture },
                ),
              },
            },
          ],
        }
      : {
          role: "assistant",
          content: "Answers received. No settings were changed.",
        };
  const envelope = (choices: unknown[]) => ({
    id: "chatcmpl-questions",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: MODEL_ID,
    choices,
  });
  return (
    [
      envelope([{ index: 0, delta, finish_reason: null }]),
      envelope([
        {
          index: 0,
          delta: {},
          finish_reason: index === 0 ? "tool_calls" : "stop",
        },
      ]),
    ]
      .map((value) => `data: ${JSON.stringify(value)}\n\n`)
      .join("") + "data: [DONE]\n\n"
  );
}

async function startQuestions(
  page: Page,
  workspace: string,
  prompt = "/openpi-setup 请先询问我的偏好，不要修改配置。",
) {
  const imported = await page.request.post("/api/workspaces", {
    headers,
    data: { path: workspace },
  });
  expect(imported.status()).toBe(201);
  const { path } = await imported.json();
  const created = await page.request.post("/api/sessions", {
    headers,
    data: { workspacePath: path, commandId: `questions-${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { sessionId } = await created.json();
  expect(
    (
      await page.request.post("/api/model", {
        headers,
        data: { sessionId, provider: PROVIDER_ID, modelId: MODEL_ID },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "描述任务" });
  await input.fill(prompt);
  await input.press("Enter");
  await expect(page.locator(".question-card")).toBeVisible();
  return sessionId as string;
}

for (const theme of ["light", "dark"] as const) {
  test(`native ask_user waits for reviewed Web answers in ${theme}, with refresh and controller isolation`, async ({
    page,
    context,
  }, testInfo) => {
    const provider = await startFakeProvider(stream);
    const workspace = await mkdtemp(join(tmpdir(), "openpi-questions-e2e-"));
    try {
      await page.emulateMedia({ colorScheme: theme });
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await startQuestions(page, workspace);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(provider.requests.length).toBe(1);
      expect(JSON.stringify(provider.requests[0]!.body)).toContain(
        '"ask_user"',
      );
      const other = await context.newPage();
      await other.goto("/");
      await expect(
        other.getByRole("textbox", { name: "描述任务" }),
      ).toBeVisible();
      await expect(other.locator(".question-card")).toHaveCount(0);
      await other.close();
      await page.reload();
      await expect(page.locator(".question-card")).toBeVisible();
      expect(provider.requests.length).toBe(1);
      const card = page.locator(".question-card");
      await page.screenshot({
        path: testInfo.outputPath(`questions-initial-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await card.getByRole("radio", { name: /完整交互/ }).check();
      await expect(card.getByRole("textbox")).toHaveCount(0);
      await card.getByRole("button", { name: "补充说明（选填）" }).click();
      await card
        .getByRole("textbox", { name: "补充说明（选填）" })
        .fill("沿用当前主题");
      await page.screenshot({
        path: testInfo.outputPath(`questions-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      expect(
        (await new AxeBuilder({ page }).include(".question-panel").analyze())
          .violations,
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.body.scrollWidth <= document.body.clientWidth,
        ),
      ).toBe(true);
      await card.getByRole("button", { name: "下一题" }).click();
      await card.getByRole("radio", { name: /或自行撰写回复/ }).check();
      await card
        .getByRole("textbox", { name: "你的答案" })
        .fill("桌面和手机都要验证");
      await card.getByRole("button", { name: "复核答案" }).click();
      expect(provider.requests.length).toBe(1);
      await page.screenshot({
        path: testInfo.outputPath(`review-${theme}.png`),
        animations: "disabled",
      });
      await card.getByRole("button", { name: "提交答案", exact: true }).click();
      await expect.poll(() => provider.requests.length).toBe(2);
      const next = JSON.stringify(provider.requests[1]!.body);
      expect(next).toContain("沿用当前主题");
      expect(next).toContain("桌面和手机都要验证");
      await expect(
        page.getByText("Answers received. No settings were changed.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(card).toHaveCount(0);
    } finally {
      await provider.close();
      await rm(workspace, { recursive: true, force: true });
    }
  });
}

for (const command of ["/openpi-setup", "/plan"]) {
  test(`Stop cancels the actual pending ask_user in ${command} without manufacturing answers`, async ({
    page,
  }) => {
    const provider = await startFakeProvider(stream);
    const workspace = await mkdtemp(join(tmpdir(), "openpi-questions-stop-"));
    try {
      await startQuestions(
        page,
        workspace,
        `${command} 请先询问我的偏好，不要修改代码或配置。`,
      );
      const cancellation = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/turns/cancel") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "停止当前轮次" }).click();
      expect((await (await cancellation).json()).state).toBe("accepted");
      await expect(page.locator(".question-card")).toHaveCount(0);
      expect(provider.requests.length).toBe(1);
      const snapshot = await (
        await page.request.get("/api/snapshot", { headers })
      ).json();
      expect(snapshot.runtime.status).toBe("idle");
      // stopReason belongs to native evidence, not the bounded UI projection.
      const entries = (await readFile(snapshot.selectedSession.path, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const assistants = entries.filter(
        (entry) => entry.message?.role === "assistant",
      );
      expect(assistants.at(-1).message.stopReason).toBe("aborted");
      const result = entries.find(
        (entry) => entry.message?.toolName === "ask_user",
      );
      expect(result.message.content).toEqual([
        { type: "text", text: "Cancelled" },
      ]);
      await expect(
        page.getByText(
          "The active turn failed while cancellation was requested",
          { exact: true },
        ),
      ).toHaveCount(0);
      const input = page.getByRole("textbox", { name: "描述任务" });
      await input.fill("你好");
      await input.press("Enter");
      await expect(
        page.getByText("Answers received. No settings were changed.", {
          exact: true,
        }),
      ).toBeVisible();
      expect(provider.requests.length).toBe(2);
    } finally {
      await provider.close();
      await rm(workspace, { recursive: true, force: true });
    }
  });
}

test("human_handoff reviews a status, restores its pending card and returns verification guidance", async ({
  page,
}, info) => {
  const provider = await startFakeProvider((body, index) =>
    stream(body, index, true),
  );
  const workspace = await mkdtemp(join(tmpdir(), "openpi-handoff-e2e-"));
  try {
    await startQuestions(page, workspace);
    await page.reload();
    const card = page.locator(".question-card");
    await expect(
      card.getByText("页面出现账户名称", { exact: false }),
    ).toBeVisible();
    await expect(card.getByRole("radio")).toHaveCount(2);
    await card.getByRole("radio", { name: /已完成/ }).check();
    await card.getByRole("button", { name: "复核状态" }).click();
    expect(provider.requests).toHaveLength(1);
    expect(
      (await new AxeBuilder({ page }).include(".question-card").analyze())
        .violations,
    ).toEqual([]);
    await card.screenshot({ path: info.outputPath("handoff-review.png") });
    await card.getByRole("button", { name: "提交状态", exact: true }).click();
    await expect.poll(() => provider.requests.length).toBe(2);
    expect(JSON.stringify(provider.requests[1]?.body)).toContain(
      "This is not proof of completion",
    );
    await expect(card).toHaveCount(0);
  } finally {
    await provider.close();
    await rm(workspace, { recursive: true, force: true });
  }
});
