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


def _is_token(node) -> bool:
    return isinstance(node, dict) and "$value" in node


def flat(doc: dict, group: str = "color") -> list[tuple[str, dict]]:
    """Every token in a group as (name, entry), in the document's own order.

    The order is the file's, not sorted: a generated block that reorders its
    declarations produces a diff on every unrelated change, and a diff nobody
    can read is a diff nobody reads.

    Groups nest to different depths and both are legitimate DTCG. Colours are
    grouped by role — `color.surface.ground` — while radii sit directly under
    theirs, `radius.card`. The first version assumed two levels everywhere,
    which read the radius group one level too deep and returned each token's
    `$extensions` dict as if it were a token.

    It returned SIX of them for a file with six radii, and five for a file with
    five: the wrong answer with the right count. A sanity check on the length
    would have passed. That is the whole reason this walks by looking for
    `$value` rather than by counting levels, and the reason the fixture for it
    now carries both shapes — the earlier one had only the nested one, so it
    reproduced the mechanism and not the shape.

    Keys beginning with `$` are DTCG metadata (`$description`), never tokens.
    """
    node = doc.get(group, {})
    if not isinstance(node, dict):
        return []
    out: list[tuple[str, dict]] = []
    for name, child in node.items():
        if name.startswith("$") or not isinstance(child, dict):
            continue
        if _is_token(child):
            out.append((name, child))
            continue
        for inner, entry in child.items():
            if not inner.startswith("$") and _is_token(entry):
                out.append((inner, entry))
    return out


def tokens_of(doc: dict, groups: str | list[str]) -> list[tuple[str, dict]]:
    """Every token across one group or several, in document order.

    Colours and radii land in the same stylesheet, so a destination usually
    wants both in one pass — one report, one exit code. Passing them
    separately would verify twice and leave the caller to combine two answers,
    which is how one of them ends up unread.
    """
    names = [groups] if isinstance(groups, str) else list(groups)
    return [pair for g in names for pair in flat(doc, g)]


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

    Returns the new text, how many were replaced, how many the pattern
    MATCHED, and how many replacements would change the line's indentation.

    The first two differ exactly when the file says a token more times than the
    caller emits for it. The last one catches a different mistake, and one
    easy to make: a pattern that swallows the leading whitespace, paired with
    declarations written at one fixed indentation. The same token often sits at
    two depths — a light block at the top level and a dark one nested inside a
    media query — and rewriting both from one string silently re-indents the
    nested one. Nothing about the values is wrong, so no diff of the values
    shows it, and the file still verifies. Found by running this against a real
    consumer's stylesheet and watching four-space declarations come back with
    two.
    """
    it = iter(values)
    replaced = 0
    matched = 0
    reindented = 0
    lead = re.compile(r"^[ \t]*")

    def swap(match: re.Match) -> str:
        nonlocal replaced, matched, reindented
        matched += 1
        try:
            value = next(it)
        except StopIteration:
            return match.group(0)
        replaced += 1
        found = match.group(0)
        if lead.match(found).group(0) != lead.match(value).group(0):
            reindented += 1
        return value

    return pattern.sub(swap, text), replaced, matched, reindented


def _stripped(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines()]


def count_block(haystack: list[str], needle: list[str]) -> int:
    """How many times `needle` appears as consecutive lines of `haystack`.

    Line-aligned and whitespace-normalised, which is the whole point. Asking
    `decl in text` instead looks right and is not: a declaration indented two
    spaces is a SUBSTRING of the same declaration indented four, so a
    stylesheet that carries a token at both depths — a nested media query and a
    flat override — verifies green while one of the two is corrupt, because the
    string being searched for is found hiding inside the other. Reported by a
    consumer whose file has exactly that shape.

    Counting rather than merely finding, for the other half of the same
    problem: present-somewhere says nothing about present-everywhere.
    """
    if not needle:
        return 0
    n = len(needle)
    return sum(1 for i in range(len(haystack) - n + 1) if haystack[i : i + n] == needle)


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


def verify(doc: dict, destinations: list[Destination],
           groups: str | list[str] = "color") -> int:
    """Every declaration this would emit must already be in the file, verbatim.

    Reports what is missing and how much was checked. The second number is not
    decoration: a run that checks nothing passes just as quietly as one that
    checks everything, and "0 mismatches" out of zero declarations is the most
    absorbable result there is (see `docs/guardas.md`).
    """
    texts = {d.path: Path(d.path).read_text(encoding="utf-8") for d in destinations}
    lines = {p: _stripped(t) for p, t in texts.items()}
    missing: list[str] = []
    checked = 0

    for name, entry in tokens_of(doc, groups):
        for dest in destinations:
            decls = dest.declarations(name, entry)
            checked += len(decls)
            # Grouped, so a token declared twice with the same text has to be
            # there twice. Finding it once and calling that done is how a
            # stale second copy survives the check that exists to catch it.
            wanted: dict[tuple[str, ...], int] = {}
            for decl in decls:
                key = tuple(_stripped(decl))
                wanted[key] = wanted.get(key, 0) + 1
            for key, times in wanted.items():
                found = count_block(lines[dest.path], list(key))
                if found < times:
                    where = " / ".join(key)
                    missing.append(
                        f"{dest.name()}  {where}"
                        + (f"  (aparece {found} de {times} veces)" if times > 1 else "")
                    )

            # And the same question `write` asks: does the file declare this
            # token somewhere these declarations do not cover? Asking it here
            # too is what puts it in CI rather than only in front of whoever
            # runs --write. A copy nobody emits keeps its old value through
            # both, and the check that exists to find exactly that would say
            # nothing — reported by a consumer whose stylesheet declares each
            # token three times against a callback returning two.
            if decls:
                pattern = dest.pattern(name, entry)
                if pattern is not None:
                    seen = len(pattern.findall(texts[dest.path]))
                    if seen > len(decls):
                        missing.append(
                            f"{dest.name()}  {name} aparece {seen} vez(ces) en el archivo "
                            f"y sólo se emiten {len(decls)} declaración(es): "
                            "las otras nunca se reescriben"
                        )

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


def write(doc: dict, destinations: list[Destination],
          groups: str | list[str] = "color") -> int:
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

    for name, entry in tokens_of(doc, groups):
        for dest in destinations:
            decls = dest.declarations(name, entry)
            if not decls:
                continue
            pattern = dest.pattern(name, entry)
            if pattern is None:
                continue
            new, count, matched, reindented = rewrite_declarations(
                updated[dest.path], pattern, decls
            )
            if reindented:
                problems.append(
                    f"{dest.name()}: {name} cambiaría la indentación de {reindented} "
                    "declaración(es) — el patrón se come el espacio inicial y las "
                    "declaraciones lo traen fijo"
                )
            # A token the file does not name at all is a no-op and legitimate:
            # that is how a subset stays a subset. Anything between zero and
            # agreement is not, and it is wrong in BOTH directions.
            #
            # Too FEW matches means only some of a token's declarations were
            # rewritten, leaving the file internally inconsistent.
            #
            # Too MANY means the file says this token somewhere this does not
            # write, and that one keeps its old value — through the write, and
            # then through verify as well, because verify only asks whether
            # what it emits is present. A consumer whose stylesheet declares
            # every token three times while its callback returns two would have
            # carried a stale third copy past both guards, silently and
            # for good. Found by reconciling two declaration counts that did
            # not agree.
            if matched and matched != len(decls):
                problems.append(
                    f"{dest.name()}: {name} aparece {matched} vez(ces) en el archivo "
                    f"y se emiten {len(decls)} declaraciones"
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


def show(doc: dict, destinations: list[Destination],
         groups: str | list[str] = "color") -> int:
    """Print what each destination should say, without touching anything."""
    for dest in destinations:
        print(f"// {dest.name()}")
        for name, entry in tokens_of(doc, groups):
            for decl in dest.declarations(name, entry):
                print(decl)
        print()
    return 0


def main(doc: dict, destinations: list[Destination], argv: list[str] | None = None,
         groups: str | list[str] = "color") -> int:
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
        return write(doc, destinations, groups)
    if "--verify" in args:
        return verify(doc, destinations, groups)
    return show(doc, destinations, groups)
