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

test("the README opens with the mark, and the file is there", () => {
  // The one failure worth guarding: the image moves or the generator changes
  // its output path, and the README opens with a broken image — which nobody
  // notices, because the person who last looked at it knows what it says.
  //
  // Style is not guarded. Getting the order of the sections wrong costs a
  // correction; a mark that does not load costs the first impression.
  const head = README.split("\n").slice(0, 4).join("\n");
  const img = head.match(/<img[^>]*\bsrc="([^"]+)"[^>]*>/);
  assert.ok(img !== null, `the README does not open with an image:\n${head}`);
  // Relative, never a raw URL. The two look identical on GitHub and differ
  // everywhere else, and a raw URL pins a branch that can be renamed or a sha
  // that freezes the image. This was caught by the existence check on its own,
  // by accident; saying it here makes the failure name the actual problem.
  assert.doesNotMatch(img[1], /^[a-z]+:\/\//i, `${img[1]} is a URL; the src must be a path in this repo`);
  assert.ok(existsSync(join(ROOT, img[1])), `${img[1]} is referenced but not in the repo`);
  // The banner carries the name, so the alt text has to as well: it is the
  // title for anyone whose images do not load, and for a screen reader.
  assert.match(img[0], /\balt="[^"]+"/, "the mark has no alt text, and it is the title");
});
