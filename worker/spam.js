export const HONEYPOT = "referral";

export function tooFast(renderedAt, now = Date.now()) {
  if (typeof renderedAt !== "string" || !/^\d{13}$/.test(renderedAt)) return { bot: true, age: null };
  const age = now - Number(renderedAt);
  return { bot: age < 2000, age };
}

export function botReason(form, now = Date.now()) {
  const trap = form.get(HONEYPOT);
  if (typeof trap === "string" && trap !== "") return "hidden field filled";
  const renderedAt = form.get("renderedAt");
  const { bot, age } = tooFast(typeof renderedAt === "string" ? renderedAt : undefined, now);
  return bot ? `submitted too fast or without a valid timestamp (${age === null ? "none" : `${age} ms`})` : null;
}

const LINK = /https?:|\/\/|\bwww\.|[\p{L}\p{N}-]\.(?:com|net|org|info|biz|io|ly|gl|app|dev|xyz|top|site|online|shop|link|click|ru|cn|google)(?![\p{L}\p{N}])/iu;
const MONEY = /[$€£¥₹₿]\s?\d|\d\s?(?:usd|eur|gbp|btc)\b/i;

export const looksLikeSpam = (value) => {
  const text = value.normalize("NFKC").replace(/\p{Cf}/gu, "");
  return LINK.test(text) || MONEY.test(text) || /[<>]/.test(text);
};
