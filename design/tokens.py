#!/usr/bin/env python3
"""The machinery both consumers' token emitters were writing twice.

Each consumer keeps its own `tokens.json` — a palette is product identity and
never travels — and its own `design-system/emit.py`, which stays because what
a destination's declaration LOOKS like is that project's business: one wraps a
Swift line past a measured column, the other does not; one omits a dark CSS
line that would repeat the light one, the other writes both because every
token appears three times in its stylesheet. Those are not the same file with
different constants, so they are not extracted.

What is extracted is everything underneath: walking the token document,
spelling a value, rewriting a declaration WHERE IT ALREADY SITS, and the
verify/write pair with its reporting. Both had written all of it, separately,
down to the same reasoning in the comments.

The consumer describes its destinations and calls `main()`:

    from tokens import Destination, load, main

    DOC = load(ROOT / "tokens.json")

    def swift_decl(name, entry):
        ...  # this project's spelling, or None to skip the token

    main(DOC, [
        Destination(CSS, css_lines, css_pattern),
        Destination(SWIFT, swift_decl, swift_pattern),
    ])

Why `--write` matters more than it looks: before it, the token file MIRRORS
the code and a test checks they have not drifted. After it the code is written
FROM the token file, and the check becomes "regenerate and see that nothing
changed" — which is stronger than comparing text, because it proves the files
can be REBUILT rather than that they happen to match today. A file edited by
hand until it matched would pass the comparison and fail this the next time
anybody touched the source. See `docs/guardas.md`.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable


def load(path: Path) -> dict:
    """The token document, read as UTF-8 whatever the platform default is."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def flat(doc: dict, group: str = "color") -> list[tuple[str, dict]]:
    """Every token in a group as (name, entry), in the document's own order.

    The order is the file's, not sorted: a generated block that reorders its
    declarations produces a diff on every unrelated change, and a diff nobody
    can read is a diff nobody reads.
    """
    return [
        (name, entry)
        for subgroup in doc.get(group, {}).values()
        if isinstance(subgroup, dict)
        for name, entry in subgroup.items()
        if isinstance(entry, dict)
    ]


def css_value(value) -> str:
    """A token's CSS spelling: a hex, or `rgba()` when it carries opacity.

    The two shapes DTCG allows here are a plain string and `{base, alpha}`.
    Anything else raises rather than being coerced — a colour that silently
    becomes something printable is the failure mode this whole layer exists to
    remove, and a generator that guesses writes the guess into both platforms.
    """
    if isinstance(value, str):
        return value
    if not isinstance(value, dict) or "base" not in value or "alpha" not in value:
        raise ValueError(f"not a colour this knows how to spell: {value!r}")
    base = value["base"]
    r, g, b = (int(base[i : i + 2], 16) for i in (1, 3, 5))
    return f"rgba({r}, {g}, {b}, {value['alpha']})"


def rewrite_declarations(text: str, pattern: re.Pattern, values: Iterable[str]) -> tuple[str, int]:
    """Replace each match of `pattern` with the next value, in order.

    Line- and match-level rather than block-level, which both consumers had
    arrived at separately and for the same reason: the declarations sit
    interleaved with comments and with things the generator does not own — a
    category palette, a hue switch, shadow variables. Replacing a REGION would
    either drop those or force them into the generated file; replacing exactly
    the matched span leaves every other character where its author put it.

    `values` is consumed lazily, so a destination that declares a token once
    takes the first value and a stylesheet that declares it in a light block
    and a dark block takes both, with no list of which files carry which.
    Returns the new text and how many declarations were actually replaced —
    the count is the caller's evidence, never this function's assumption.
    """
    it = iter(values)
    replaced = 0

    def swap(match: re.Match) -> str:
        nonlocal replaced
        try:
            value = next(it)
        except StopIteration:
            return match.group(0)
        replaced += 1
        return value

    return pattern.sub(swap, text), replaced


@dataclass(frozen=True)
class Destination:
    """One file the tokens are written into.

    `declarations(name, entry)` returns the exact text this file should carry
    for that token — a list, because a stylesheet carries a light and a dark
    line for one token — or an empty list to skip it. Skipping is how a target
    that carries a SUBSET stays a subset without a list to maintain: a watch
    app or a widget names fewer tokens, and the destination simply declines the
    ones it does not name.

    `pattern(name, entry)` matches what is on disk for that token, in every
    layout it might be in. A destination whose file wraps a long declaration
    has to match both the wrapped and the unwrapped form, or `--write` rewrites
    one layout into the other and produces a diff that is not a value change.
    """

    path: Path
    declarations: Callable[[str, dict], list[str]]
    pattern: Callable[[str, dict], re.Pattern | None]
    label: str = ""

    def name(self) -> str:
        return self.label or Path(self.path).name


def verify(doc: dict, destinations: list[Destination], group: str = "color") -> int:
    """Every declaration this would emit must already be in the file, verbatim.

    Reports what is missing and how much was checked. The second number is not
    decoration: a run that checks nothing passes just as quietly as one that
    checks everything, and "0 mismatches" out of zero declarations is the most
    absorbable result there is (see `docs/guardas.md`).
    """
    texts = {d.path: Path(d.path).read_text(encoding="utf-8") for d in destinations}
    missing: list[str] = []
    checked = 0

    for name, entry in flat(doc, group):
        for dest in destinations:
            for decl in dest.declarations(name, entry):
                checked += 1
                if decl not in texts[dest.path]:
                    missing.append(f"{dest.name()}  {decl.strip()}")

    if checked == 0:
        print("  nada que verificar: ningún destino declara ningún token")
        return 1
    if missing:
        print(f"  {len(missing)} de {checked} declaraciones NO coinciden con el código:")
        for m in missing:
            print(f"    · {m}")
        return 1
    print(f"  las {checked} declaraciones coinciden con el código, carácter por carácter")
    return 0


def write(doc: dict, destinations: list[Destination], group: str = "color") -> int:
    """Rewrite every declaration in place, from the token document.

    Refuses to write anything if any destination would lose a declaration it
    currently has — a pattern that stops matching rewrites nothing and would
    otherwise report success over a file it never touched. All the files are
    written only after all of them have been rebuilt in memory, so a failure
    halfway through leaves the tree as it was rather than half-generated.
    """
    texts = {d.path: Path(d.path).read_text(encoding="utf-8") for d in destinations}
    updated = dict(texts)
    problems: list[str] = []
    rewritten = 0

    for name, entry in flat(doc, group):
        for dest in destinations:
            decls = dest.declarations(name, entry)
            if not decls:
                continue
            pattern = dest.pattern(name, entry)
            if pattern is None:
                continue
            new, count = rewrite_declarations(updated[dest.path], pattern, decls)
            # A token the file does not name is a no-op and legitimate: that is
            # how a subset stays a subset. A token it names in FEWER places
            # than this would write is not — it means the pattern matched some
            # of them, which leaves the file internally inconsistent.
            if 0 < count < len(decls):
                problems.append(
                    f"{dest.name()}: {name} coincide {count} vez(ces) y se emiten "
                    f"{len(decls)} declaraciones"
                )
            updated[dest.path] = new
            rewritten += count

    if problems:
        print(f"  {len(problems)} destino(s) quedarían a medias, no se escribió nada:")
        for p in problems:
            print(f"    · {p}")
        return 1
    if rewritten == 0:
        print("  no se reescribió ninguna declaración: ningún patrón coincidió")
        return 1

    for dest in destinations:
        if updated[dest.path] != texts[dest.path]:
            Path(dest.path).write_text(updated[dest.path], encoding="utf-8")
    names = "\n    ".join(str(d.path) for d in destinations)
    print(f"  {rewritten} declaraciones reescritas desde tokens.json:\n    {names}")
    return 0


def show(doc: dict, destinations: list[Destination], group: str = "color") -> int:
    """Print what each destination should say, without touching anything."""
    for dest in destinations:
        print(f"// {dest.name()}")
        for name, entry in flat(doc, group):
            for decl in dest.declarations(name, entry):
                print(decl)
        print()
    return 0


def main(doc: dict, destinations: list[Destination], argv: list[str] | None = None,
         group: str = "color") -> int:
    """`--write`, `--verify`, or print. An unknown flag is refused.

    Refused rather than ignored, for the reason an install script learned the
    hard way: the flag somebody types to ask what a command does should never
    be the one that makes it act.
    """
    args = sys.argv[1:] if argv is None else argv
    known = {"--write", "--verify", "--help", "-h"}
    unknown = [a for a in args if a not in known]
    usage = "uso: emit.py [--verify | --write]"
    if unknown:
        print(f"no entiendo {' '.join(unknown)}.\n{usage}", file=sys.stderr)
        return 1
    if "--help" in args or "-h" in args:
        print(usage)
        return 0
    if "--write" in args:
        return write(doc, destinations, group)
    if "--verify" in args:
        return verify(doc, destinations, group)
    return show(doc, destinations, group)
