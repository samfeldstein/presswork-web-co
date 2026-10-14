import { validate, typedValues, buildEmail } from "./validate.js";
import { botReason } from "./spam.js";
import { stampTime, sentState, errorState } from "./render.js";

const SITE_TITLE = "Presswork Web Co.";
const GENERIC_ERROR = "Your message couldn't be sent. Try again, or email us directly.";
const TOO_LARGE = "Your message was too large to send. Shorten it and try again.";
const MAX_BODY = 64 * 1024;

const html = (body, status = 200) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const acceptsJson = (request) => (request.headers.get("accept") ?? "").includes("application/json");

async function contactPage(env, request) {
  const asset = await env.ASSETS.fetch(new Request(new URL("/contact/", request.url)));
  if (!asset.ok) throw new Error(`the contact page asset returned ${asset.status}`);
  return asset.text();
}

async function errorResponse(env, request, status, state) {
  if (acceptsJson(request)) return json(state.fields ? { fields: state.fields } : { message: state.message }, status);
  return html(errorState(stampTime(await contactPage(env, request)), state), status);
}

async function readForm(request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  const headers = { "content-type": request.headers.get("content-type") ?? "" };
  return new Response(new Blob(chunks), { headers }).formData();
}

async function handlePost(request, env) {
  let form;
  try {
    form = await readForm(request);
  } catch {
    return errorResponse(env, request, 400, { message: GENERIC_ERROR });
  }
  if (form === null) return errorResponse(env, request, 413, { message: TOO_LARGE });

  const reason = botReason(form);
  if (reason) {
    console.warn(`contact: ${reason}, message dropped`);
  } else {
    const result = validate(form);
    if (!result.ok) {
      console.log(`contact: rejected (${Object.keys(result.fields).join(", ")})`);
      return errorResponse(env, request, 400, { fields: result.fields, typed: typedValues(form) });
    }
    try {
      await env.EMAIL.send({ ...buildEmail(result.data, SITE_TITLE), to: env.CONTACT_TO_EMAIL });
      console.log(`contact: message sent (${Date.now() - Number(form.get("renderedAt"))} ms after render)`);
    } catch (error) {
      console.error(`contact: Email Service rejected the message: ${error?.message ?? "unknown error"}`);
      return errorResponse(env, request, 500, { message: GENERIC_ERROR, typed: typedValues(form) });
    }
  }

  if (acceptsJson(request)) return json({ sent: true });
  return Response.redirect(new URL("/contact/?sent=1", request.url).href, 303);
}

async function route(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/contact") {
    return Response.redirect(new URL(`/contact/${url.search}`, url).href, 301);
  }
  if (url.pathname !== "/contact/") return env.ASSETS.fetch(request);

  if (request.method === "GET" || request.method === "HEAD") {
    const page = await contactPage(env, request);
    return html(url.searchParams.get("sent") === "1" ? sentState(page) : stampTime(page));
  }
  if (request.method === "POST") return handlePost(request, env);
  return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD, POST" } });
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(`contact: unexpected failure: ${error?.message ?? "unknown error"}`);
      if (acceptsJson(request)) return json({ message: GENERIC_ERROR }, 500);
      return new Response(GENERIC_ERROR, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
  },
};
