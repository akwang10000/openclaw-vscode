import { randomBytes } from "crypto";

export interface WebviewHtmlOptions {
  lang?: string;
  title: string;
  cspSource: string;
  nonce: string;
  styles: string;
  body: string;
  script: string;
}

export function createNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function getWebviewCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data: https:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const lang = options.lang ?? "en";
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${getWebviewCsp(options.cspSource, options.nonce)}">
<title>${options.title}</title>
<style>
${options.styles}
</style>
</head>
<body>
${options.body}
<script nonce="${options.nonce}">
${options.script}
</script>
</body>
</html>`;
}
