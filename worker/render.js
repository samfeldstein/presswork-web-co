export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const stampTime = (html, now = Date.now()) => html.replace("__RENDERED_AT__", () => String(now));

export function sentState(html) {
  return html
    .replace(/(<section class="thanks" data-thanks) hidden/, "$1")
    .replace(/<form\b[\s\S]*?<\/form>\s*/, "");
}

export function errorState(html, { fields = {}, message, typed = {} }) {
  for (const name of ["name", "email", "business", "siteUrl", "message"]) {
    const error = fields[name]?.[0];
    const value = typed[name];
    if (error === undefined && value === undefined) continue;
    const block = new RegExp(`<div class="field">\\s*<label for="field-${name}">[\\s\\S]*?</div>`);
    html = html.replace(block, (field) => {
      if (value !== undefined) {
        field = field.includes("<textarea")
          ? field.replace(/(<textarea\b[^>]*>)(<\/textarea>)/, (_, open, close) => `${open}${escapeHtml(value)}${close}`)
          : field.replace(/<input /, () => `<input value="${escapeHtml(value)}" `);
      }
      if (error !== undefined) {
        field = field
          .replace(/<(input|textarea) /, (_, tag) => `<${tag} aria-invalid="true" aria-describedby="field-${name}-error" `)
          .replace(/(\s*)<\/div>$/, (_, space) => `  <p class="error" id="field-${name}-error">${escapeHtml(error)}</p>${space}</div>`);
      }
      return field;
    });
  }

  if ("audit" in typed || fields.siteUrl) {
    html = html.replace(/<input type="checkbox" name="audit"/, '<input type="checkbox" name="audit" checked');
  }

  const list = Object.entries(fields).filter(([, messages]) => messages?.length);
  const inner = [
    message ? `<p>${escapeHtml(message)}</p>` : "",
    list.length
      ? `<p>Please fix the following:</p><ul>${list
          .map(([name, messages]) => `<li><a href="#field-${name}">${escapeHtml(messages[0])}</a></li>`)
          .join("")}</ul>`
      : "",
  ].join("");
  return html.replace(/(<div class="summary" data-summary\b[^>]*?) hidden>(<\/div>)/, (_, open, close) => `${open} role="alert">${inner}${close}`);
}
