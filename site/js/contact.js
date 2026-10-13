const root = document.querySelector("[data-contact]");
const form = root?.querySelector("[data-form]");
const summary = root?.querySelector("[data-summary]");
const thanks = root?.querySelector("[data-thanks]");
const submit = form?.querySelector("[data-submit]");
const status = form?.querySelector("[data-status]");
const label = submit?.querySelector(".label");
const sendLabel = label?.textContent ?? "Send";
const GENERIC_ERROR =
  "Your message couldn’t be sent. Try again, or email us directly.";

const markInvalid = (name, text) => {
  const input = form?.querySelector(`[name="${name}"]`);
  if (!input) return;
  input.setAttribute("aria-invalid", "true");
  const labelText = input.labels?.[0]?.textContent.trim();
  if (labelText) input.setAttribute("aria-label", `${labelText}, ${text}`);
  const message = document.createElement("p");
  message.className = "field-error";
  message.id = `field-${name}-js-error`;
  message.textContent = text;
  input.closest(".field")?.append(message);
  const described = input.getAttribute("aria-describedby");
  input.setAttribute(
    "aria-describedby",
    [described, message.id].filter(Boolean).join(" "),
  );
};

const clearInvalid = () => {
  form
    ?.querySelectorAll(".field-error, .field > .error")
    .forEach((el) => el.remove());
  form?.querySelectorAll("[aria-invalid]").forEach((el) => {
    el.removeAttribute("aria-invalid");
    el.removeAttribute("aria-label");
    const kept = (el.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter((id) => id && !id.endsWith("-js-error"));
    if (kept.length) el.setAttribute("aria-describedby", kept.join(" "));
    else el.removeAttribute("aria-describedby");
  });
};

const showSummary = (messages) => {
  if (!summary) return;
  const linked = messages.filter((m) => m.id);
  if (linked.length) summary.removeAttribute("role");
  else summary.setAttribute("role", "alert");
  summary.hidden = false;
  summary.replaceChildren();
  const intro = document.createElement("p");
  intro.textContent = linked.length
    ? "Please fix the following:"
    : (messages[0]?.text ?? GENERIC_ERROR);
  summary.append(intro);
  if (linked.length) {
    const list = document.createElement("ul");
    for (const { id, text } of linked) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${id}`;
      link.textContent = text;
      item.append(link);
      list.append(item);
    }
    summary.append(list);
    document.getElementById(linked[0].id)?.focus();
  }
};

const audit = form?.querySelector("[data-audit]");
const siteUrl = form?.querySelector("#field-siteUrl");
const syncAudit = () => {
  if (siteUrl && audit) siteUrl.required = audit.checked;
};
audit?.addEventListener("change", syncAudit);
syncAudit();

let sending = false;

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending || !form.reportValidity()) return;
  sending = true;

  submit?.setAttribute("aria-disabled", "true");
  submit?.classList.add("is-sending");
  if (label) label.textContent = "Sending";
  if (status) status.textContent = "Sending…";
  clearInvalid();

  let result;
  try {
    const response = await fetch(form.action, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new FormData(form),
    });
    result = { ok: response.ok, ...(await response.json()) };
  } catch {
    result = { ok: false, message: GENERIC_ERROR };
  }

  submit?.removeAttribute("aria-disabled");
  submit?.classList.remove("is-sending");
  if (label) label.textContent = sendLabel;
  if (status) status.textContent = "";
  sending = false;

  if (!result.ok) {
    const messages = Object.entries(result.fields ?? {}).flatMap(
      ([name, list]) => {
        if (!list?.length) return [];
        markInvalid(name, list[0]);
        return [{ id: `field-${name}`, text: list[0] }];
      },
    );
    showSummary(
      messages.length ? messages : [{ text: result.message || GENERIC_ERROR }],
    );
    return;
  }

  if (result.sent && thanks) {
    form.remove();
    thanks.hidden = false;
    thanks.classList.add("stamped");
    thanks.focus();
  }
});
