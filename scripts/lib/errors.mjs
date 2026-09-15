// One error type for "the consumer got something wrong", so scripts can print
// the message on its own and exit 1, instead of a stack trace pointing into
// kyber for a problem that lives in `.kyber/config.json` or the environment.

export class KyberError extends Error {
  constructor(message) {
    super(message);
    this.name = "KyberError";
  }
}

/**
 * What the arguments mean, decided without touching the process.
 *
 * Separate from `run` so it can be tested: the half that decides is pure, and
 * the half that exits is three lines with nothing to get wrong.
 *
 * Any argument starting with `-` must be declared. Unknown ones are REFUSED
 * rather than ignored, which is not pedantry: a typo'd `--prod` silently
 * ignored means a restore quietly aims at the wrong target, and the run looks
 * exactly like the one that was asked for.
 *
 * Operands are refused too unless the script says how many it takes, and that
 * default is the strict one on purpose — six of the eight scripts here take
 * none, so `backup.mjs production` should not read as `backup.mjs`. The one
 * script that had this check written by hand refused stray operands as well,
 * and moving it to the shared gate had to keep that rather than quietly
 * loosen it. Values that follow a flag are not operands and are not counted.
 */
export function gate(argv, { usage, flags = [], operands = 0 } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { action: "help", message: usage };
  }
  const known = new Set([...flags, "--help", "-h"]);
  const unknown = [];
  const loose = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("-")) {
      if (known.has(arg)) {
        // A declared flag consumes the next argument only when one follows
        // that is not itself a flag, which is how `--device <udid>` works
        // without a table of which flags take values.
        if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) i += 1;
      } else {
        unknown.push(arg);
      }
    } else {
      loose.push(arg);
    }
  }
  const refused = [...unknown, ...loose.slice(operands)];
  if (refused.length > 0) {
    return { action: "refuse", message: `Unrecognised: ${refused.join(" ")}\n${usage}` };
  }
  return { action: "run" };
}

/**
 * Run a script's `main`, translating failures into exit codes.
 *
 * A KyberError is a message for the person at the keyboard; anything else is a
 * bug or a network failure and keeps its stack.
 *
 * The argument gate lives HERE, in the one call every script already makes,
 * rather than in a helper each script has to remember to call. It is here
 * because it was forgotten: `--help` on the backup script ran a full dump
 * against production, reported by a consumer who typed it to find out how to
 * invoke the thing. The same bug had already been fixed once, in the install
 * script, by writing the check into that file — which fixed that file and
 * nothing else. A rule you have to remember at the right moment is the rule
 * that gets skipped; a gate in the shared entry point cannot be.
 */
export function run(main, options = {}) {
  const { action, message } = gate(process.argv.slice(2), {
    usage: options.usage ?? `Usage: node ${process.argv[1] ?? "script"}`,
    flags: options.flags,
    operands: options.operands,
  });
  if (action === "help") {
    console.log(message);
    return;
  }
  if (action === "refuse") {
    console.error(message);
    process.exit(1);
    return;
  }
  main().catch((error) => {
    if (error instanceof KyberError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}
