// The argument gate. Written after `--help` on the backup script ran a full
// dump against production, reported by a consumer who typed it to find out
// how to invoke the thing — and after noticing the same bug had been fixed
// once before, in one file, by writing the check into that file.

import { strict as assert } from "node:assert";
import test from "node:test";

import { gate } from "../scripts/lib/errors.mjs";

const USAGE = "Usage: script [--production] <file>";

test("--help answers and does not run", () => {
  assert.equal(gate(["--help"], { usage: USAGE }).action, "help");
  assert.equal(gate(["-h"], { usage: USAGE }).action, "help");
});

test("--help wins over everything else on the line", () => {
  // Someone adding `--help` to a command they already typed is asking what it
  // does, not asking for it to run with one more flag.
  const { action } = gate(["--production", "dump.json", "--help"], {
    usage: USAGE,
    flags: ["--production"],
    operands: 1,
  });
  assert.equal(action, "help");
});

test("an undeclared flag is refused, not ignored", () => {
  // The case that matters is the near miss: --prod for --production reads as
  // "restore to production" and silently means the opposite.
  const { action, message } = gate(["--prod", "dump.json"], {
    usage: USAGE,
    flags: ["--production"],
    operands: 1,
  });
  assert.equal(action, "refuse");
  assert.match(message, /--prod/);
  assert.match(message, /Usage/);
});

test("a declared flag and its operand run", () => {
  assert.equal(
    gate(["--production", "dump.json"], { usage: USAGE, flags: ["--production"], operands: 1 })
      .action,
    "run",
  );
});

test("a flag's value is not counted as an operand", () => {
  assert.equal(
    gate(["--device", "iPhone"], { usage: USAGE, flags: ["--device"] }).action,
    "run",
  );
});

test("a stray operand is refused when the script takes none", () => {
  // Six of the eight scripts take no arguments at all, so `backup production`
  // must not read as `backup`.
  const { action, message } = gate(["production"], { usage: USAGE });
  assert.equal(action, "refuse");
  assert.match(message, /production/);
});

test("one operand too many is refused", () => {
  assert.equal(gate(["a.json", "b.json"], { usage: USAGE, operands: 1 }).action, "refuse");
  assert.match(gate(["a.json", "b.json"], { usage: USAGE, operands: 1 }).message, /b\.json/);
});

test("no arguments at all runs", () => {
  assert.equal(gate([], { usage: USAGE }).action, "run");
});

test("every refusal names what it refused AND how to call it", () => {
  // A refusal that only says "no" sends the reader back to the source.
  for (const argv of [["--nope"], ["extra"], ["--nope", "extra"]]) {
    const { message } = gate(argv, { usage: USAGE });
    for (const arg of argv) assert.match(message, new RegExp(arg.replace("--", "--")));
    assert.match(message, /Usage/);
  }
});
