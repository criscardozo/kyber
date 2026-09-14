// The dump format: Firestore values to JSON and back.
//
// Pure functions. The Firestore `Timestamp` class is injected rather than
// imported so that this file — and its tests — run in a bare kyber clone with
// nothing installed; the scripts pass the real one from firebase-admin.
//
// Timestamps are TAGGED (`{"$timestamp": "<ISO>"}`) rather than flattened to a
// string, because the flattened form cannot be checked: a restore writes plain
// strings back, the next dump serialises those to the same characters, and
// comparing dump against dump agrees perfectly while every audit field has
// quietly changed type. A round trip would prove nothing, which is the one
// thing it exists to prove.
//
// Anything else Firestore can hold and no consumer uses — GeoPoint,
// DocumentReference, Bytes — throws instead of being mangled into a shape that
// looks fine in JSON. If one ever appears, the backup stops rather than lying.

import { KyberError } from "./errors.mjs";

/** Written into every dump's header. Bump it when the shape changes. */
export const DUMP_FORMAT = 1;

/** A strict ISO-8601 instant, the only string the legacy path ever converts. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (value.constructor === undefined || value.constructor === Object);

export function createCodec({ Timestamp }) {
  /**
   * Firestore values to JSON. `at` names the document, and the path grows as
   * the recursion descends, so a refusal says WHICH field of WHICH document
   * to go and look at, not only which type.
   */
  function serialize(value, at = "") {
    const refuse = (what) =>
      new KyberError(
        `${at === "" ? "value" : at}: ${what} is not supported by the dump format. ` +
          "Teach serialize() about it first, or change the field.",
      );
    if (value instanceof Timestamp) {
      return { $timestamp: value.toDate().toISOString() };
    }
    if (Array.isArray(value)) return value.map((item, i) => serialize(item, `${at}[${i}]`));
    if (value instanceof Uint8Array) throw refuse("Bytes");
    if (value !== null && typeof value === "object") {
      if (!isPlainObject(value)) throw refuse(value.constructor?.name ?? "a non-plain object");
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => {
          const here = at === "" ? key : `${at}.${key}`;
          if (key.startsWith("$")) {
            throw new KyberError(
              `${here}: field names starting with "$" are reserved for the dump format's tags.`,
            );
          }
          return [key, serialize(child, here)];
        }),
      );
    }
    return value;
  }

  /** Tagged shapes back into Firestore values. For dumps with a `format`. */
  function revive(value) {
    if (Array.isArray(value)) return value.map(revive);
    if (value !== null && typeof value === "object") {
      const keys = Object.keys(value);
      if ("$timestamp" in value) {
        if (keys.length !== 1 || typeof value.$timestamp !== "string") {
          throw new KyberError(
            `Corrupt dump: a "$timestamp" tag must be the only key of its object ` +
              `and hold a string, got ${JSON.stringify(value)}.`,
          );
        }
        return Timestamp.fromDate(new Date(value.$timestamp));
      }
      const unknownTag = keys.find((key) => key.startsWith("$"));
      if (unknownTag !== undefined) {
        throw new KyberError(`Corrupt dump: unknown tag "${unknownTag}".`);
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
    }
    return value;
  }

  /**
   * The pre-`format` shape, where Timestamps were flattened to ISO strings.
   *
   * Guessing a Timestamp back from the string alone would be wrong the first
   * time somebody writes a note that looks like a date, so this needs BOTH
   * signals: the key ends in `At` and the value is a strict ISO-8601 instant.
   * A `"YYYY-MM-DD"` under a key ending in `At` is a calendar date and stays a
   * string. Only ever enabled by the consumer, per `selectReviver`.
   */
  function reviveLegacy(value, key = "") {
    if (typeof value === "string" && key.endsWith("At") && ISO_INSTANT.test(value)) {
      return Timestamp.fromDate(new Date(value));
    }
    if (Array.isArray(value)) return value.map((v) => reviveLegacy(v, key));
    if (value !== null && typeof value === "object") {
      if ("$timestamp" in value) {
        throw new KyberError(
          'Corrupt dump: it has no "format" but contains "$timestamp" tags. ' +
            "A legacy dump never has tags; a tagged dump always has a format.",
        );
      }
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, reviveLegacy(v, k)]),
      );
    }
    return value;
  }

  /**
   * Which reviver a dump needs, decided by its header AND the consumer.
   *
   * `format` present: tags only, the heuristic stays off.
   * `format` absent: the legacy heuristic, but only for a consumer that has
   * declared `restore.legacyIsoTimestamps: true` — the one with real dumps
   * from before the format existed. For anyone else that path does not exist,
   * so it cannot convert something by accident.
   */
  function selectReviver(dump, config) {
    if (dump.format === undefined) {
      if (config?.restore?.legacyIsoTimestamps === true) return reviveLegacy;
      throw new KyberError(
        'This dump has no "format" field, so it predates the tagged format.\n' +
          "  Reading it needs the legacy heuristic (ISO strings under keys ending\n" +
          '  in "At" become Timestamps), which this consumer has not enabled. If\n' +
          "  it genuinely has dumps from before the format, set\n" +
          '  "restore": { "legacyIsoTimestamps": true } in .kyber/config.json.',
      );
    }
    if (dump.format === DUMP_FORMAT) return revive;
    throw new KyberError(
      `This dump is format ${JSON.stringify(dump.format)}; this restore reads ` +
        `format ${DUMP_FORMAT}. Update kyber before restoring it.`,
    );
  }

  return { serialize, revive, reviveLegacy, selectReviver };
}

/** `<name>-<source>-<stamp>.json`, a name a directory listing can be read by. */
export function dumpFileName(name, source, when = new Date()) {
  const stamp = when.toISOString().replace(/[:.]/g, "-");
  return `${name}-${source}-${stamp}.json`;
}
