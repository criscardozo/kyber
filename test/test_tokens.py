#!/usr/bin/env python3
"""Tests for design/tokens.py. Run: python3 -m unittest discover -s test -p 'test_*.py'"""

import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "design"))

from tokens import (  # noqa: E402
    AnchorError,
    main as tokens_main,
    Block,
    Destination,
    css_value,
    flat,
    rewrite_declarations,
    tokens_of,
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
    # Nested one level, the way both real files carry radii — and with the
    # metadata key a real group has. The first fixture had only the two-level
    # shape that colours use, so it reproduced the mechanism and not the
    # shape, and the walker read this group one level too deep.
    "radius": {
        "$description": "not a token",
        "card": {"$type": "dimension", "$value": "18px", "$extensions": {"uses": 11}},
        "field": {"$type": "dimension", "$value": "10px"},
    },
}


def css_decls(name, entry):
    return [
        f'  --{name}: {css_value(entry["$value"]["light"])};',
        f'  --{name}: {css_value(entry["$value"]["dark"])};',
    ]


def css_pattern(name, _entry):
    return re.compile(rf"^[ \t]*--{re.escape(name)}:[^;\n]+;", re.M)


def colour_decls(name, entry):
    """The CSS pair, declining anything that is not a light/dark colour."""
    value = entry["$value"]
    if not isinstance(value, dict) or "light" not in value:
        return []
    return css_decls(name, entry)


def colour_pattern(name, entry):
    value = entry["$value"]
    if not isinstance(value, dict) or "light" not in value:
        return None
    return css_pattern(name, entry)


def swift_decls(name, entry):
    """A second shape in the same file: one line, a bare dimension."""
    value = entry["$value"]
    if not isinstance(value, str):
        return []
    return [f"    static let {name}: CGFloat = {value.removesuffix('px')}"]


def swift_pattern(name, entry):
    if not isinstance(entry["$value"], str):
        return None
    return re.compile(rf"^[ \t]*static let {re.escape(name)}: CGFloat = .+$", re.M)


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

    def test_flat_reads_a_group_whose_tokens_sit_directly_under_it(self):
        # Colours nest by role, radii do not, and both are legitimate. Reading
        # this one as if it were nested returned each token's $extensions dict
        # — six of them for six radii, the wrong answer with the right count.
        self.assertEqual([n for n, _ in flat(DOC, "radius")], ["card", "field"])
        self.assertEqual(flat(DOC, "radius")[0][1]["$value"], "18px")

    def test_flat_skips_dollar_prefixed_metadata(self):
        self.assertNotIn("$description", [n for n, _ in flat(DOC, "radius")])

    def test_flat_reads_both_depths_from_one_document(self):
        self.assertEqual(len(flat(DOC, "color")), 3)
        self.assertEqual(len(flat(DOC, "radius")), 2)

    def test_tokens_of_spans_several_groups_in_document_order(self):
        # Colours and radii land in the same stylesheet, so a destination
        # wants both in one pass: one report, one exit code.
        self.assertEqual(
            [n for n, _ in tokens_of(DOC, ["color", "radius"])],
            ["ground", "veil", "ink", "card", "field"],
        )

    def test_tokens_of_takes_a_bare_group_name_too(self):
        self.assertEqual(tokens_of(DOC, "radius"), flat(DOC, "radius"))

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

    def test_a_subset_destination_reads_its_membership_from_the_file(self):
        # The point of the flag: which tokens a partial target carries comes
        # from the file, never from a list beside it. A consumer typed out
        # eight identifiers for its watch while the file declared nine, so the
        # ninth sat outside the generator and drifted on the next write —
        # with verify green, because it did not consider that token its own.
        sub = Destination(self.css, css_decls, css_pattern, label="watch", subset=True)
        # The file names one of the three tokens. That is its membership.
        self.css.write_text("  --ink: old;\n  --ink: old;\n", encoding="utf-8")
        self.assertEqual(write(DOC, [sub]), 0)
        out = self.css.read_text(encoding="utf-8")
        self.assertIn("  --ink: #111111;", out)
        self.assertNotIn("--ground", out)
        self.assertEqual(verify(DOC, [sub]), 0)

    def test_a_subset_adopts_a_token_the_file_starts_declaring(self):
        # The failure the flag exists for, in the direction that bit: the file
        # gains a token and the destination picks it up, where a typed list
        # would have gone on ignoring it.
        sub = Destination(self.css, css_decls, css_pattern, label="watch", subset=True)
        self.css.write_text("  --ink: a;\n  --ink: b;\n", encoding="utf-8")
        self.assertEqual(write(DOC, [sub]), 0)
        one = self.css.read_text(encoding="utf-8").count("#F4F4F4")
        self.css.write_text("  --ink: a;\n  --ink: b;\n  --ground: x;\n  --ground: y;\n",
                            encoding="utf-8")
        self.assertEqual(write(DOC, [sub]), 0)
        self.assertIn("  --ground: #F4F4F4;", self.css.read_text(encoding="utf-8"))
        self.assertEqual(one, 0)

    def test_without_the_flag_a_destination_owns_every_token(self):
        # Default unchanged: a full destination missing a token is a failure,
        # not a subset quietly declining it.
        full = Destination(self.css, css_decls, css_pattern, label="CSS")
        self.css.write_text("  --ink: #111111;\n  --ink: #EEEEEE;\n", encoding="utf-8")
        self.assertEqual(verify(DOC, [full]), 1)

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


    def test_two_destinations_on_the_same_file_compose_instead_of_clobbering(self):
        # Asked for by a consumer before wiring it: its theme file already
        # takes colours by line rewrite, and radii would land in the same
        # path. Nobody had ever pointed two destinations at one file, and the
        # failure it would have — each destination rebuilding from the text it
        # read at the start, so the last writer wins and the first one's
        # changes vanish — looks exactly like success: the run reports both,
        # and the file carries one.
        both = self.dir / "Theme.swift"
        both.write_text(
            "enum Palette {\n"
            "  --ground: #OLD;\n  --ground: #OLD;\n"
            "  --veil: a;\n  --veil: b;\n"
            "  --ink: a;\n  --ink: b;\n"
            "}\n"
            "enum Radius {\n"
            "    static let card: CGFloat = 99\n"
            "    static let field: CGFloat = 99\n"
            "}\n",
            encoding="utf-8",
        )
        colours = Destination(both, colour_decls, colour_pattern, label="colours")
        radii = Destination(both, swift_decls, swift_pattern, label="radii")
        groups = ["color", "radius"]
        self.assertEqual(write(DOC, [colours, radii], groups), 0)

        out = both.read_text(encoding="utf-8")
        self.assertIn("  --ground: #F4F4F4;", out)          # the first destination survived
        self.assertIn("    static let card: CGFloat = 18", out)  # and so did the second
        self.assertIn("    static let field: CGFloat = 10", out)
        self.assertNotIn("99", out)
        self.assertIn("enum Palette {", out)
        self.assertEqual(verify(DOC, [colours, radii], groups), 0)

    def test_a_shared_file_still_refuses_as_a_whole_when_one_half_is_short(self):
        # The all-or-nothing promise has to hold per FILE, not per destination:
        # writing the radii of a file whose colours came up short is exactly
        # the half-generated tree write() says it will never leave.
        both = self.dir / "Theme.swift"
        both.write_text(
            "  --ground: #OLD;\n"                      # one of the two it emits
            "  --veil: a;\n  --veil: b;\n"
            "  --ink: a;\n  --ink: b;\n"
            "    static let card: CGFloat = 99\n",
            encoding="utf-8",
        )
        before = both.read_text(encoding="utf-8")
        colours = Destination(both, colour_decls, colour_pattern, label="colours")
        radii = Destination(both, swift_decls, swift_pattern, label="radii")
        self.assertEqual(write(DOC, [colours, radii], ["color", "radius"]), 1)
        self.assertEqual(both.read_text(encoding="utf-8"), before)


BEGIN = "    // kyber:radius start"
END = "    // kyber:radius end"


def radius_lines(name, entry):
    value = entry["$value"]
    if not isinstance(value, str):
        return []
    return [f"    static let {name}: CGFloat = {value.removesuffix('px')}"]


class Blocks(unittest.TestCase):
    """The destination that creates what is not there.

    Every one of these was written before the consumers wired it, from the
    shape both of them described: an iOS theme with no radius constant
    anywhere, so there is nothing for a pattern to find.
    """

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.swift = self.dir / "Theme.swift"

    def block(self):
        return Block(self.swift, radius_lines, BEGIN, END, label="radios")

    def file(self, body="", tail="}\n"):
        self.swift.write_text(
            f"enum Theme {{\n{BEGIN}\n{body}{END}\n{tail}", encoding="utf-8"
        )

    def test_it_fills_a_region_that_starts_empty(self):
        self.file()
        self.assertEqual(write(DOC, [self.block()], "radius"), 0)
        out = self.swift.read_text(encoding="utf-8")
        self.assertIn("    static let card: CGFloat = 18\n", out)
        self.assertIn("    static let field: CGFloat = 10\n", out)
        self.assertIn("enum Theme {", out)          # nothing outside moved
        self.assertTrue(out.endswith("}\n"))
        self.assertEqual(verify(DOC, [self.block()], "radius"), 0)

    def test_writing_twice_produces_the_same_bytes(self):
        # Idempotence is the first thing the catalogue asks of a generator: a
        # diff that is not a value change trains everyone to ignore the ones
        # that are.
        self.file()
        write(DOC, [self.block()], "radius")
        once = self.swift.read_text(encoding="utf-8")
        write(DOC, [self.block()], "radius")
        self.assertEqual(self.swift.read_text(encoding="utf-8"), once)

    def test_a_stale_value_inside_the_block_fails_verify(self):
        self.file(body="    static let card: CGFloat = 99\n"
                       "    static let field: CGFloat = 10\n")
        self.assertEqual(verify(DOC, [self.block()], "radius"), 1)

    def test_a_line_added_by_hand_inside_the_block_fails_verify(self):
        # The question the pattern half CANNOT ask. It only checks that what
        # it emits is present, so an extra neighbour lives there for good.
        self.file(body="    static let card: CGFloat = 18\n"
                       "    static let field: CGFloat = 10\n"
                       "    static let smuggled: CGFloat = 4\n")
        self.assertEqual(verify(DOC, [self.block()], "radius"), 1)

    def test_the_same_lines_in_another_order_fail_verify(self):
        self.file(body="    static let field: CGFloat = 10\n"
                       "    static let card: CGFloat = 18\n")
        self.assertEqual(verify(DOC, [self.block()], "radius"), 1)

    def test_a_missing_anchor_refuses_and_writes_nothing(self):
        self.swift.write_text("enum Theme {\n}\n", encoding="utf-8")
        before = self.swift.read_text(encoding="utf-8")
        self.assertEqual(write(DOC, [self.block()], "radius"), 1)
        self.assertEqual(self.swift.read_text(encoding="utf-8"), before)
        self.assertEqual(verify(DOC, [self.block()], "radius"), 1)

    def test_a_doubled_anchor_refuses_instead_of_taking_the_first_pair(self):
        # Picking a pair here means generated code lands in whichever region
        # the search happened to bracket, which is not a place anyone chose.
        self.swift.write_text(
            f"enum A {{\n{BEGIN}\n{END}\n}}\nenum B {{\n{BEGIN}\n{END}\n}}\n",
            encoding="utf-8",
        )
        before = self.swift.read_text(encoding="utf-8")
        self.assertEqual(write(DOC, [self.block()], "radius"), 1)
        self.assertEqual(self.swift.read_text(encoding="utf-8"), before)

    def test_an_inverted_pair_refuses_instead_of_splicing_backwards(self):
        self.swift.write_text(f"{END}\nmiddle\n{BEGIN}\n", encoding="utf-8")
        before = self.swift.read_text(encoding="utf-8")
        self.assertEqual(write(DOC, [self.block()], "radius"), 1)
        self.assertEqual(self.swift.read_text(encoding="utf-8"), before)

    def test_the_anchors_themselves_are_never_replaced(self):
        self.file(body="    static let card: CGFloat = 99\n")
        write(DOC, [self.block()], "radius")
        out = self.swift.read_text(encoding="utf-8")
        self.assertEqual(out.count(BEGIN), 1)
        self.assertEqual(out.count(END), 1)

    def test_emitting_no_token_is_a_refusal_not_a_silent_wipe(self):
        # A block that renders nothing empties its region while the run
        # reports what the OTHER destination wrote. Alone it is already caught
        # by "nothing was rewritten", so the case has to be built with a
        # second destination that does write — found by deleting the refusal
        # and watching the first version of this test pass anyway.
        other = self.dir / "other.css"
        other.write_text("  --ground: #OLD;\n  --ground: #OLD;\n  --veil: a;\n"
                         "  --veil: b;\n  --ink: a;\n  --ink: b;\n", encoding="utf-8")
        self.file(body="    static let card: CGFloat = 18\n")
        before = self.swift.read_text(encoding="utf-8")
        colours = Destination(other, colour_decls, colour_pattern, label="other")
        empty = Block(self.swift, lambda n, e: [], BEGIN, END, label="vacío")
        self.assertEqual(write(DOC, [colours, empty], ["color", "radius"]), 1)
        self.assertEqual(self.swift.read_text(encoding="utf-8"), before)
        self.assertIn("--ground: #OLD;", other.read_text(encoding="utf-8"))

    def test_a_block_and_a_rewrite_destination_share_one_file(self):
        self.swift.write_text(
            "enum Theme {\n"
            "  --ground: #OLD;\n  --ground: #OLD;\n"
            "  --veil: a;\n  --veil: b;\n"
            "  --ink: a;\n  --ink: b;\n"
            f"{BEGIN}\n{END}\n}}\n",
            encoding="utf-8",
        )
        colours = Destination(self.swift, colour_decls, colour_pattern, label="colours")
        both = [colours, self.block()]
        self.assertEqual(write(DOC, both, ["color", "radius"]), 0)
        out = self.swift.read_text(encoding="utf-8")
        self.assertIn("  --ground: #F4F4F4;", out)
        self.assertIn("    static let card: CGFloat = 18", out)
        self.assertEqual(verify(DOC, both, ["color", "radius"]), 0)

    def test_a_rewrite_reaching_inside_the_block_stops_the_run(self):
        # The overlap that would otherwise be invisible: the block replaces
        # its region whole and goes last, so the pattern's edit disappears
        # while both halves report having written it.
        self.swift.write_text(
            f"enum Theme {{\n{BEGIN}\n"
            "    static let card: CGFloat = 99\n"
            "  --ground: #OLD;\n  --ground: #OLD;\n"
            "  --veil: a;\n  --veil: b;\n"
            "  --ink: a;\n  --ink: b;\n"
            f"{END}\n}}\n",
            encoding="utf-8",
        )
        before = self.swift.read_text(encoding="utf-8")
        colours = Destination(self.swift, colour_decls, colour_pattern, label="colours")
        self.assertEqual(write(DOC, [colours, self.block()], ["color", "radius"]), 1)
        self.assertEqual(self.swift.read_text(encoding="utf-8"), before)

    def test_a_broken_block_leaves_every_other_file_untouched(self):
        other = self.dir / "other.css"
        other.write_text("  --ground: #OLD;\n  --ground: #OLD;\n  --veil: a;\n"
                         "  --veil: b;\n  --ink: a;\n  --ink: b;\n", encoding="utf-8")
        self.swift.write_text("no anchors here\n", encoding="utf-8")
        before = other.read_text(encoding="utf-8")
        ok = Destination(other, colour_decls, colour_pattern, label="other")
        self.assertEqual(write(DOC, [ok, self.block()], ["color", "radius"]), 1)
        self.assertEqual(other.read_text(encoding="utf-8"), before)

    def test_the_anchor_error_names_which_anchor_and_which_destination(self):
        self.swift.write_text(f"{BEGIN}\n", encoding="utf-8")
        with self.assertRaises(AnchorError) as caught:
            self.block().body(self.swift.read_text(encoding="utf-8"))
        self.assertIn("radios", str(caught.exception))
        self.assertIn("cierre", str(caught.exception))


class Flags(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.css = self.dir / "globals.css"
        self.css.write_text(
            "\n".join(d for n, e in flat(DOC) for d in css_decls(n, e)) + "\n",
            encoding="utf-8",
        )
        self.dest = Destination(self.css, css_decls, css_pattern, label="CSS")

    def quiet(self, args):
        """Run main with both streams captured, and return (code, stdout).

        Captured rather than let through: the refusal path prints to stderr,
        which is where the pre-push hook reads the suite's verdict from. A
        test that writes there turns a clean run into one somebody has to read
        carefully, and the noise stays until it hides something.
        """
        import io
        from contextlib import redirect_stderr, redirect_stdout
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = tokens_main(DOC, [self.dest], args)
        return code, out.getvalue() + err.getvalue()

    def test_every_accepted_flag_is_named_in_the_usage_line(self):
        # The accepted set decides what gets REFUSED, so a flag missing from
        # the message cannot be discovered and one named but not accepted
        # sends whoever reads it to a command that errors. Two lists, nothing
        # coupling them: it named two of the four. Aliases are excluded by
        # asking for the long form of each pair, not by a list of exceptions.
        _, text = self.quiet(["--help"])
        for flag in ["--verify", "--write", "--help"]:
            self.assertIn(flag, text)

    def test_an_unknown_flag_is_refused_rather_than_ignored(self):
        self.assertEqual(self.quiet(["--wrote"])[0], 1)

    def test_help_does_not_run_anything(self):
        before = self.css.read_text(encoding="utf-8")
        self.assertEqual(self.quiet(["--help"])[0], 0)
        self.assertEqual(self.css.read_text(encoding="utf-8"), before)


if __name__ == "__main__":
    unittest.main()
