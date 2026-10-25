const SLACK_HOST = "hooks.slack.com";
const SLACK_TEXT_LIMIT = 3000;

/**
 * Posts text to a Slack incoming webhook. The URL must be a Slack webhook:
 * this runs in CI with a secret supplied from outside, so it should not be
 * usable to POST report data to an arbitrary host.
 */
export async function postToSlack(
  webhookUrl: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    throw new Error("Slack webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:" || url.hostname !== SLACK_HOST) {
    throw new Error(`Slack webhook must be an https://${SLACK_HOST} URL`);
  }

  const body = text.length > SLACK_TEXT_LIMIT ? `${text.slice(0, SLACK_TEXT_LIMIT - 20)}\n...(truncated)` : text;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Slack returned HTTP ${res.status}`);
}
