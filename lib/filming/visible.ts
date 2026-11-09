/**
 * What a page shows a viewer, from its HTML: the text plus the words in
 * alt, title, placeholder and aria-label attributes. Scripts, styles and
 * link targets are left out (a link may point at a store; its words may not
 * name one in filming mode).
 */
export function visibleText(html: string): string {
  const attrs = [...html.matchAll(/\s(?:alt|title|placeholder|aria-label)="([^"]*)"/g)].map((m) => m[1]);
  const text = html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return decode([text, ...attrs].join(" "))
    .replace(/\s+/g, " ")
    .trim();
}

function decode(s: string): string {
  return s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}
