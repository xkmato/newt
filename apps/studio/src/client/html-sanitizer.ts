const ALLOWED_ARTICLE_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "em",
  "strong",
  "b",
  "i",
  "a",
  "br",
  "hr",
];

const ALLOWED_ARTICLE_ATTRS = ["href", "title", "class"];

function isSafeHref(href: string): boolean {
  const trimmed = href.trim().toLowerCase();
  return (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("#")
  );
}

function sanitizeNodeFallback(node: Node, targetDoc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return targetDoc.createTextNode(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (!ALLOWED_ARTICLE_TAGS.includes(tag)) {
    // Match native Sanitizer API behavior: drop disallowed elements together with their content
    return null;
  }

  const clean = targetDoc.createElement(tag);
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (!ALLOWED_ARTICLE_ATTRS.includes(name)) continue;
    if (name === "href" && !isSafeHref(attr.value)) continue;
    clean.setAttribute(name, attr.value);
  }
  if (tag === "a" && clean.hasAttribute("href")) {
    clean.setAttribute("rel", "noopener noreferrer");
  }

  for (const child of Array.from(el.childNodes)) {
    const cleanChild = sanitizeNodeFallback(child, targetDoc);
    if (cleanChild) clean.appendChild(cleanChild);
  }
  return clean;
}

/**
 * Safely sanitizes and inserts untrusted article HTML using the native
 * Sanitizer API (`Element.prototype.setHTML`) when available, with a strict
 * allowlist fallback for browsers without native `setHTML()`.
 */
export function safeSetArticleHtml(container: HTMLElement, rawHtml: string): void {
  const withSanitizer = container as HTMLElement & {
    setHTML?: (
      input: string,
      options?: { sanitizer?: { elements?: string[]; attributes?: string[] } }
    ) => void;
  };

  if ("setHTML" in Element.prototype && typeof withSanitizer.setHTML === "function") {
    withSanitizer.setHTML(rawHtml, {
      sanitizer: {
        elements: ALLOWED_ARTICLE_TAGS,
        attributes: ALLOWED_ARTICLE_ATTRS,
      },
    });
    return;
  }

  const parsed = new DOMParser().parseFromString(rawHtml, "text/html");
  const frag = document.createDocumentFragment();
  for (const child of Array.from(parsed.body.childNodes)) {
    const cleanChild = sanitizeNodeFallback(child, document);
    if (cleanChild) frag.appendChild(cleanChild);
  }
  container.replaceChildren(frag);
}
