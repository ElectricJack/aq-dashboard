import { expect, test } from "@playwright/test";

// The fixture must be a disposable queued task running a shell in its real PTY.
const sessionId = process.env.AQ_DISPOSABLE_TERMINAL_SESSION;

test("running queued task terminal retains output and accepts input across reconnect", async ({ page, request, baseURL }) => {
  test.skip(!sessionId, "Requires an explicitly configured disposable PTY fixture");
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);
  const sessionResponse = await request.get(`/api/v1/sessions/${sessionId}`);
  expect(sessionResponse.ok()).toBe(true);
  const session = (await sessionResponse.json()).data;
  const terminalResponse = await request.get(`/api/v1/terminals/${session.terminal.id}`);
  expect(terminalResponse.ok()).toBe(true);
  const terminal = (await terminalResponse.json()).terminal;
  expect(terminal.session.kind).toBe("remote");

  const attemptPath = `/api/attempt-terminals/${terminal.session.attempt_id}/terminal`;
  const acquisitions: string[] = [];
  const sockets: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === `${attemptPath}/connect`) {
      acquisitions.push(req.postDataJSON().client_id);
    }
  });
  page.on("websocket", (socket) => {
    const url = new URL(socket.url());
    if (url.pathname === `${attemptPath}/live`) sockets.push(url.searchParams.get("client_id")!);
  });

  await page.goto(`/agents/${sessionId}`);
  const pane = page.getByRole("region", { name: "Interactive agent terminal", exact: true });
  const rows = pane.locator(".xterm-rows");
  await expect(rows).toContainText("AQ_TERMINAL_PILOT_READY", { timeout: 15_000 });
  await expect(pane).toHaveAttribute("data-controlling", "true");
  expect(acquisitions).toEqual(sockets);
  expect(sockets).toHaveLength(1);

  async function command(text: string) {
    await pane.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  }

  // The joined marker can only come from command output, not the echoed input.
  await command("printf '%s%s\\n' AQ_TERMINAL_ PILOT_INPUT");
  await expect(rows).toContainText("AQ_TERMINAL_PILOT_INPUT");
  await page.screenshot({ path: test.info().outputPath("running-task-terminal-desktop.png") });

  await pane.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(pane.getByLabel("Last observation")).toContainText("AQ_TERMINAL_PILOT_INPUT");
  await expect(pane).not.toHaveAttribute("data-controlling", "true");
  await pane.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(rows).toContainText("AQ_TERMINAL_PILOT_INPUT");
  await expect(pane).toHaveAttribute("data-controlling", "true");
  expect(acquisitions).toEqual(sockets);
  expect(sockets).toHaveLength(2);
  expect(new Set(sockets).size).toBe(2);

  await command("printf '%s%s\\n' AQ_TERMINAL_ PILOT_RECONNECTED");
  await expect(rows).toContainText("AQ_TERMINAL_PILOT_RECONNECTED");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(pane).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("running-task-terminal-phone.png") });
});
