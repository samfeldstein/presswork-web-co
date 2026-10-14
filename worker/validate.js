import { looksLikeSpam } from "./spam.js";

/* Flatten line breaks so a name can't fake extra "Email:" lines in the message. */
export const oneLine = (value) => value.replace(/[\r\n\u2028\u2029]+/g, " ");

const EMAIL = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

const text = (form, name) => {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
};

export function validate(form) {
  const fields = {};
  const fail = (name, message) => (fields[name] ??= []).push(message);

  const name = text(form, "name")?.trim() ?? "";
  if (!name) fail("name", "Enter your name.");
  else if (name.length > 200) fail("name", "Keep your name under 200 characters.");
  else if (looksLikeSpam(name)) fail("name", "Enter just your name here. Links and other details can go in your message.");

  const email = text(form, "email")?.trim() ?? "";
  if (!EMAIL.test(email)) fail("email", "Enter a valid email address.");

  const business = text(form, "business")?.trim();
  if (business !== undefined && business.length > 200) fail("business", "Keep your business name under 200 characters.");

  const audit = text(form, "audit");

  const siteUrl = text(form, "siteUrl")?.trim();
  if (siteUrl !== undefined && siteUrl.length > 500) fail("siteUrl", "Keep the website address under 500 characters.");
  else if (audit && !siteUrl) fail("siteUrl", "Enter your current website so we can audit it.");

  const message = text(form, "message")?.trim() ?? "";
  if (!message) fail("message", "Tell us a little about what you need.");
  else if (message.length > 5000) fail("message", "Keep your message under 5,000 characters.");

  if (Object.keys(fields).length) return { ok: false, fields };

  return {
    ok: true,
    data: {
      name: oneLine(name),
      email,
      business: business === undefined ? undefined : oneLine(business),
      audit,
      siteUrl: siteUrl === undefined ? undefined : oneLine(siteUrl),
      message,
    },
  };
}

export function typedValues(form) {
  const typed = {};
  for (const key of ["name", "email", "business", "audit", "siteUrl", "message"]) {
    const value = text(form, key);
    if (value !== undefined) typed[key] = value;
  }
  return typed;
}

export function buildEmail(data, siteTitle) {
  const { name, email, business, audit, siteUrl, message } = data;
  return {
    from: { email: "form@presswork.dev", name: `${siteTitle} contact form` },
    replyTo: email,
    subject: `New inquiry from ${name}${business ? `, ${business}` : ""}`,
    text: [
      `Name: ${name}`,
      `Email: ${email}`,
      business ? `Business: ${business}` : null,
      audit ? "Free site audit: requested" : null,
      siteUrl ? `Current site: ${siteUrl}` : null,
      "",
      message,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  };
}
