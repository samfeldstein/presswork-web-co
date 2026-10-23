const base = process.argv[2]?.replace(/\/$/, "");
if (!base) {
  console.error("Usage: node send-test.mjs <base url>   (a preview URL sends two real test emails)");
  process.exit(1);
}

const stamp = new Date().toISOString();
const fields = (mode) => ({
  name: "Test Script",
  email: "test@example.com",
  business: "Presswork test",
  message: `Automated test message (${mode}) sent ${stamp} by send-test.mjs. Safe to delete.`,
});

const send = async (mode) => {
  const page = await (await fetch(`${base}/contact/`)).text();
  const renderedAt = page.match(/name="renderedAt" value="(\d{13})"/)?.[1];
  if (!renderedAt) return `${mode}: no renderedAt in the page`;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const form = new FormData();
  for (const [key, value] of Object.entries(fields(mode))) form.set(key, value);
  form.set("renderedAt", renderedAt);
  const json = mode === "with JS";
  const response = await fetch(`${base}/contact/`, {
    method: "POST",
    body: form,
    redirect: "manual",
    headers: json ? { accept: "application/json" } : {},
  });
  if (json) {
    const body = await response.json().catch(() => null);
    return response.status === 200 && body?.sent === true
      ? `${mode}: sent (200)`
      : `${mode}: FAILED ${response.status} ${JSON.stringify(body)}`;
  }
  const where = response.headers.get("location") ?? "";
  return response.status === 303 && where.endsWith("/contact/?sent=1")
    ? `${mode}: sent (303 to ${where})`
    : `${mode}: FAILED ${response.status} ${where}`;
};

for (const mode of ["with JS", "without JS"]) console.log(await send(mode));
