import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");

const local = (refs) =>
  refs.filter((ref) => !/^[a-z]+:/i.test(ref) && !ref.startsWith("#")).map((r) => r.split("#")[0]);

/** Local files the README points at, markdown links and HTML images separately. */
function refs(markdown) {
  return {
    links: local([...markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1])),
    images: local([...markdown.matchAll(/<img[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1])),
  };
}

test("every local file the README points at exists", () => {
  const { links, images } = refs(README);
  // Each sweep is asserted to have found something, rather than a total count:
  // a regex that stops matching returns an empty list, and an empty list walks
  // through the check below without a word. A count would also go red the day
  // somebody legitimately removes a link.
  assert.ok(links.length > 0, "the markdown-link sweep found nothing");
  assert.ok(images.length > 0, "the HTML-image sweep found nothing");
  const all = [...new Set([...links, ...images])];
  const missing = all.filter((ref) => !existsSync(join(ROOT, ref)));
  assert.deepEqual({ checked: all.length, missing }, { checked: all.length, missing: [] });
});

test("the README opens with the icon on the title line, and the icon is there", () => {
  // The one failure worth guarding: the file moves and the mark silently
  // becomes a broken image. Style is not guarded — getting the order of the
  // sections wrong costs a correction, not a product.
  //
  // The heading is HTML rather than `# Kyber` because the icon has to sit on
  // the same line and centred, and markdown cannot size an image. Checked
  // against GitHub's own renderer: it keeps align on both elements and the
  // width, and wraps the image in a link to itself.
  const head = README.split("\n").slice(0, 5).join("\n");
  assert.match(head, /<h1[^>]*>/, "the README does not open with an h1");
  const img = head.match(/<img[^>]*\bsrc="([^"]+)"/);
  assert.ok(img !== null, "no icon on the title line");
  assert.ok(/\bKyber\b/.test(head), "the name is not on the title line");
  assert.ok(existsSync(join(ROOT, img[1])), `${img[1]} is referenced but not in the repo`);
});
