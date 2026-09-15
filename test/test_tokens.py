#!/usr/bin/env python3
"""Tests for design/tokens.py. Run: python3 -m unittest discover -s test -p 'test_*.py'"""

import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "design"))

from tokens import (  # noqa: E402
    Destination,
    css_value,
    flat,
    rewrite_declarations,
    verify,
    write,
)

DOC = {
    "color": {
        "surface": {
            "ground": {"$value": {"light": "#F4F4F4", "dark": "#161616"}},
            "veil": {
                "$value": {
                    "light": {"base": "#101010", "alpha": 0.08},
                    "dark": {"base": "#FFFFFF", "alpha": 0.12},
                }
            },
        },
        "text": {"ink": {"$value": {"light": "#111111", "dark": "#EEEEEE"}}},
    },
    "radius": {"shape": {"card": {"$value": "18px"}}},
}


def css_decls(name, entry):
    return [
        f'  --{name}: {css_value(entry["$value"]["light"])};',
        f'  --{name}: {css_value(entry["$value"]["dark"])};',
    ]


def css_pattern(name, _entry):
    return re.compile(rf"^[ \t]*--{re.escape(name)}:[^;\n]+;", re.M)


class Values(unittest.TestCase):
    def test_a_plain_hex_passes_through(self):
        self.assertEqual(css_value("#F4F4F4"), "#F4F4F4")

    def test_base_and_alpha_become_rgba(self):
        self.assertEqual(css_value({"base": "#101010", "alpha": 0.08}), "rgba(16, 16, 16, 0.08)")

    def test_a_shape_it_does_not_know_raises_instead_of_guessing(self):
        # A colour that silently becomes something printable is the failure
        # this layer exists to remove, and a guess gets written into both
        # platforms at once.
        for bad in [{"base": "#101010"}, {"alpha": 0.5}, 42, None, ["#fff"]]:
            with self.assertRaises(ValueError):
                css_value(bad)


class Walk(unittest.TestCase):
    def test_flat_keeps_the_documents_own_order(self):
        # Not sorted: a generated block that reorders produces a diff on every
        # unrelated change.
        self.assertEqual([n for n, _ in flat(DOC)], ["ground", "veil", "ink"])

    def test_flat_reads_the_group_it_is_asked_for(self):
        self.assertEqual([n for n, _ in flat(DOC, "radius")], ["card"])

    def test_an_absent_group_is_empty_not_an_error(self):
        self.assertEqual(flat(DOC, "spacing"), [])


class Rewrite(unittest.TestCase):
    def test_each_match_takes_the_next_value_in_order(self):
        text = "  --ink: #000;\n  /* dark */\n    --ink: #fff;\n"
        out, n, matched, reindented = rewrite_declarations(
            text, css_pattern("ink", {}), ["  --ink: #111111;", "    --ink: #EEEEEE;"]
        )
        self.assertEqual((n, matched, reindented), (2, 2, 0))
        self.assertIn("  --ink: #111111;", out)
        self.assertIn("    --ink: #EEEEEE;", out)

    def test_nothing_around_the_declaration_moves(self):
        # The reason both consumers rewrote line by line: the declarations sit
        # among comments and among tokens the generator does not own.
        text = "/* keep */\n  --ink: #000; /* trailing */\n  --other: red;\n"
        out, _, _, _ = rewrite_declarations(text, css_pattern("ink", {}), ["  --ink: #111111;"])
        self.assertIn("/* keep */", out)
        self.assertIn("--other: red;", out)
        self.assertIn("/* trailing */", out)

    def test_a_pattern_that_matches_nothing_changes_nothing_and_says_so(self):
        text = "  --ink: #000;\n"
        out, n, matched, _ = rewrite_declarations(text, css_pattern("absent", {}), ["  --absent: #fff;"])
        self.assertEqual((out, n, matched), (text, 0, 0))

    def test_more_matches_than_values_is_reported_not_hidden(self):
        # This function leaves the extras alone, which is correct at this
        # level — but it has to SAY there were extras, because the caller
        # cannot otherwise tell a clean run from a file left half-rewritten.
        text = "  --ink: #000;\n  --ink: #111;\n  --ink: #222;\n"
        out, n, matched, _ = rewrite_declarations(text, css_pattern("ink", {}), ["  --ink: #A;"])
        self.assertEqual((n, matched), (1, 3))
        self.assertIn("  --ink: #111;", out)


    def test_a_replacement_that_would_re_indent_is_counted(self):
        # The same token often sits at two depths — flat in :root, nested in a
        # media query — and rewriting both from one fixed string silently
        # re-indents the nested one. No value is wrong, so no diff of the
        # values shows it.
        text = "  --ink: #000;\n    --ink: #fff;\n"
        _, _, _, reindented = rewrite_declarations(
            text, css_pattern("ink", {}), ["  --ink: #A;", "  --ink: #B;"]
        )
        self.assertEqual(reindented, 1)


class VerifyAndWrite(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.css = self.dir / "globals.css"

    def dest(self):
        return Destination(self.css, css_decls, css_pattern, label="CSS")

    def test_a_file_that_already_says_it_verifies(self):
        self.css.write_text(
            "\n".join(d for n, e in flat(DOC) for d in css_decls(n, e)) + "\n", encoding="utf-8"
        )
        self.assertEqual(verify(DOC, [self.dest()]), 0)

    def test_a_drifted_value_fails(self):
        self.css.write_text("  --ground: #WRONG0;\n  --ground: #161616;\n", encoding="utf-8")
        self.assertEqual(verify(DOC, [self.dest()]), 1)

    def test_checking_nothing_is_a_failure_not_a_pass(self):
        # "0 mismatches" out of zero declarations is the most absorbable
        # result there is: it reads as success and means the sweep found
        # nothing to look at.
        self.css.write_text("", encoding="utf-8")
        empty = Destination(self.css, lambda n, e: [], css_pattern)
        self.assertEqual(verify(DOC, [empty]), 1)

    def test_write_rewrites_in_place_and_leaves_the_rest(self):
        self.css.write_text(
            "/* header */\n  --ground: #OLD;\n  --ground: #OLD;\n"
            "  --veil: old;\n  --veil: old;\n"
            "  --ink: old;\n  --ink: old;\n  --unowned: keep;\n",
            encoding="utf-8",
        )
        self.assertEqual(write(DOC, [self.dest()]), 0)
        out = self.css.read_text(encoding="utf-8")
        self.assertIn("/* header */", out)
        self.assertIn("--unowned: keep;", out)
        self.assertIn("  --ground: #F4F4F4;", out)
        self.assertIn("  --veil: rgba(16, 16, 16, 0.08);", out)
        # And it round-trips: what it just wrote is what verify demands.
        self.assertEqual(verify(DOC, [self.dest()]), 0)

    def test_write_refuses_when_a_token_matches_fewer_places_than_it_emits(self):
        # Half a token rewritten leaves the file internally inconsistent, and
        # the run would otherwise report success over it.
        self.css.write_text("  --ground: #OLD;\n  --veil: a;\n  --veil: b;\n"
                            "  --ink: a;\n  --ink: b;\n", encoding="utf-8")
        before = self.css.read_text(encoding="utf-8")
        self.assertEqual(write(DOC, [self.dest()]), 1)
        self.assertEqual(self.css.read_text(encoding="utf-8"), before)

    def test_write_refuses_when_the_file_says_a_token_more_times_than_it_emits(self):
        # The direction this guard was missing, found by reconciling two
        # declaration counts that disagreed. A stylesheet declaring every
        # token three times against a callback returning two left the third
        # copy stale — and it survived BOTH guards, because verify only asks
        # whether what it emits is present, and what it emits was.
        self.css.write_text(
            "  --ground: a;\n  --ground: b;\n  --ground: STALE;\n"
            "  --veil: a;\n  --veil: b;\n  --ink: a;\n  --ink: b;\n",
            encoding="utf-8",
        )
        before = self.css.read_text(encoding="utf-8")
        self.assertEqual(write(DOC, [self.dest()]), 1)
        self.assertEqual(self.css.read_text(encoding="utf-8"), before)

    def test_write_refuses_a_rewrite_that_would_change_indentation(self):
        self.css.write_text(
            "  --ground: a;\n    --ground: b;\n  --veil: a;\n  --veil: b;\n"
            "  --ink: a;\n  --ink: b;\n",
            encoding="utf-8",
        )
        before = self.css.read_text(encoding="utf-8")
        self.assertEqual(write(DOC, [self.dest()]), 1)
        self.assertEqual(self.css.read_text(encoding="utf-8"), before)

    def test_verify_does_not_accept_a_declaration_hiding_inside_a_deeper_one(self):
        # Reported by a consumer: a declaration indented two spaces is a
        # SUBSTRING of the same one indented four, so corrupting only the flat
        # copy left the check green — it found the string it wanted inside the
        # nested line that was still correct.
        deep = Destination(
            self.css,
            lambda n, e: [f'  --{n}: {css_value(e["$value"]["light"])};',
                          f'    --{n}: {css_value(e["$value"]["dark"])};'],
            css_pattern,
            label="CSS",
        )
        good = ("  --ground: #F4F4F4;\n    --ground: #161616;\n"
                "  --veil: rgba(16, 16, 16, 0.08);\n    --veil: rgba(255, 255, 255, 0.12);\n"
                "  --ink: #111111;\n    --ink: #EEEEEE;\n")
        self.css.write_text(good, encoding="utf-8")
        self.assertEqual(verify(DOC, [deep]), 0)
        # Corrupt ONLY the flat one. Its correct text still occurs, inside the
        # nested line.
        self.css.write_text(good.replace("  --ground: #F4F4F4;", "  --ground: #DEAD00;"),
                            encoding="utf-8")
        self.assertEqual(verify(DOC, [deep]), 1)

    def test_verify_counts_repeats_rather_than_finding_one_and_stopping(self):
        # A token declared twice with identical text has to BE there twice.
        twice = Destination(
            self.css,
            lambda n, e: [f'  --{n}: {css_value(e["$value"]["dark"])};'] * 2,
            css_pattern,
            label="CSS",
        )
        self.css.write_text("  --ground: #161616;\n  --veil: rgba(255, 255, 255, 0.12);\n"
                            "  --veil: rgba(255, 255, 255, 0.12);\n"
                            "  --ink: #EEEEEE;\n  --ink: #EEEEEE;\n", encoding="utf-8")
        self.assertEqual(verify(DOC, [twice]), 1)

    def test_write_refuses_when_no_pattern_matches_at_all(self):
        self.css.write_text("nothing here\n", encoding="utf-8")
        self.assertEqual(write(DOC, [self.dest()]), 1)

    def test_a_destination_that_declines_a_token_is_a_legitimate_subset(self):
        # How a watch app or a widget carries fewer names without a list that
        # has to be kept in step.
        subset = Destination(
            self.css,
            lambda n, e: css_decls(n, e) if n == "ink" else [],
            css_pattern,
            label="subset",
        )
        self.css.write_text("  --ink: a;\n  --ink: b;\n", encoding="utf-8")
        self.assertEqual(write(DOC, [subset]), 0)
        self.assertEqual(verify(DOC, [subset]), 0)

    def test_one_destination_failing_leaves_every_file_untouched(self):
        other = self.dir / "other.css"
        other.write_text("  --ground: #OLD;\n  --ground: #OLD;\n  --veil: a;\n  --veil: b;\n"
                         "  --ink: a;\n  --ink: b;\n", encoding="utf-8")
        self.css.write_text("  --ground: #OLD;\n", encoding="utf-8")  # only one of two
        ok = Destination(other, css_decls, css_pattern, label="other")
        before = other.read_text(encoding="utf-8")
        self.assertEqual(write(DOC, [ok, self.dest()]), 1)
        self.assertEqual(other.read_text(encoding="utf-8"), before)


if __name__ == "__main__":
    unittest.main()
