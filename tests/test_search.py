import threading
from pathlib import Path

import pytest

from server.core.search import SNIPPET_WINDOW
from server.core.search import SearchCancelled
from server.core.search import normalize
from server.core.search import search_vault


def make_vault(tmp_path: Path, files: dict[str, str]) -> Path:
    for rel, content in files.items():
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    return tmp_path


# ── normalize ──────────────────────────────────────────────────────────────


def test_normalize_length_preserving() -> None:
    for s in ["hello world", "Foo-Bar", "café", "ß", "İstanbul", "a😀b", "—em–dash—", ""]:
        assert len(normalize(s)) == len(s)


def test_normalize_folds_variants_identically() -> None:
    assert normalize("Foo-Bar") == normalize("foo bar") == "foo bar"
    assert normalize("café") == "cafe"
    assert normalize("A—B") == "a b"


# ── ranking ────────────────────────────────────────────────────────────────


def test_exact_and_variants_outrank_weaker_matches(tmp_path: Path) -> None:
    vault = make_vault(
        tmp_path,
        {
            "exact.md": "the quick brown fox\n",
            "variant.md": "Quick-Brown fox jumps\n",
            "weak.md": "quik brwn fox\n",
            "miss.md": "totally unrelated text\n",
        },
    )
    hits = search_vault(vault, "quick brown")
    paths = [h.path for h in hits]
    assert set(paths[:2]) == {"exact.md", "variant.md"}
    assert all(h.score == 100.0 for h in hits[:2])
    assert "weak.md" in paths
    assert hits[paths.index("weak.md")].score < 100.0
    assert "miss.md" not in paths


def test_flat_results_same_file_repeats(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, {"multi.md": "alpha beta\nnothing here\nalpha beta again\n"})
    hits = search_vault(vault, "alpha beta")
    assert [(h.path, h.line_number) for h in hits] == [("multi.md", 1), ("multi.md", 3)]


def test_limit_respected(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, {"a.md": "match me\n" * 20})
    assert len(search_vault(vault, "match me", limit=5)) == 5


def test_exact_mode_distinguishes_case_and_punctuation(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, {"a.md": "the CRDT sync layer\ncrdt-sync is neat\n"})
    fuzzy = search_vault(vault, "crdt-sync")
    assert {h.line_number for h in fuzzy} == {1, 2}
    exact = search_vault(vault, "crdt-sync", do_normalize=False)
    assert [h.line_number for h in exact if h.score == 100.0] == [2]


def test_exact_header_match_ranks_first(tmp_path: Path) -> None:
    vault = make_vault(
        tmp_path,
        {
            "a.md": "sync protocol is described elsewhere\n",
            "b.md": "## Sync Protocol\nbody text\n",
        },
    )
    hits = search_vault(vault, "sync protocol")
    assert (hits[0].path, hits[0].line_number) == ("b.md", 1)
    assert "a.md" in [h.path for h in hits]


def test_header_boost_folds_case_punctuation_and_closing_hashes(tmp_path: Path) -> None:
    vault = make_vault(
        tmp_path,
        {
            "a.md": "sync-protocol mentioned in passing\n",
            "b.md": "### Sync—Protocol ##\n",
        },
    )
    hits = search_vault(vault, "sync protocol")
    assert (hits[0].path, hits[0].line_number) == ("b.md", 1)


def test_partial_header_match_not_boosted(tmp_path: Path) -> None:
    vault = make_vault(
        tmp_path,
        {
            "a.md": "alpha beta in a plain line\n",
            "b.md": "# alpha beta gamma\n",
        },
    )
    hits = search_vault(vault, "alpha beta")
    # header text != query, so plain score/path ordering applies
    assert hits[0].path == "a.md"


def test_header_boost_respects_exact_mode(tmp_path: Path) -> None:
    vault = make_vault(
        tmp_path,
        {
            "a.md": "notes on sync protocol and Sync Protocol usage\n",
            "b.md": "# Sync Protocol\n",
        },
    )
    # a.md scores 100 for both queries; b.md wins only when the case-sensitive header boost applies
    assert search_vault(vault, "sync protocol", do_normalize=False)[0].path == "a.md"
    assert search_vault(vault, "Sync Protocol", do_normalize=False)[0].path == "b.md"


# ── snippets ───────────────────────────────────────────────────────────────


def test_highlight_ranges_point_at_match(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, {"a.md": "prefix text Quick-Brown suffix\n"})
    (hit,) = search_vault(vault, "quick brown")
    assert len(hit.ranges) == 1
    r = hit.ranges[0]
    assert hit.text[r.start : r.end] == "Quick-Brown"


def test_long_line_windowed_around_match(tmp_path: Path) -> None:
    line = "x" * 500 + " needle in haystack " + "y" * 500
    vault = make_vault(tmp_path, {"a.md": line + "\n"})
    (hit,) = search_vault(vault, "needle in haystack")
    assert len(hit.text) == SNIPPET_WINDOW
    r = hit.ranges[0]
    assert 0 <= r.start < r.end <= len(hit.text)
    assert "needle in haystack" in hit.text
    assert hit.text[r.start : r.end] == "needle in haystack"


# ── scan hygiene ───────────────────────────────────────────────────────────


def test_skips_dotdirs_gitignored_and_non_md(tmp_path: Path) -> None:
    vault = make_vault(
        tmp_path,
        {
            "keep.md": "findme\n",
            ".git/blob.md": "findme\n",
            ".obsidian/config.md": "findme\n",
            "ignored.md": "findme\n",
            "sub/also-ignored.md": "findme\n",
            "note.txt": "findme\n",
            ".gitignore": "ignored.md\nsub/\n",
        },
    )
    assert [h.path for h in search_vault(vault, "findme")] == ["keep.md"]


def test_non_utf8_file_skipped(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, {"good.md": "findme\n"})
    (tmp_path / "bad.md").write_bytes(b"\xff\xfe findme \xff")
    assert [h.path for h in search_vault(vault, "findme")] == ["good.md"]


def test_cancel_event_aborts_scan(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, {"a.md": "findme\n"})
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(SearchCancelled):
        search_vault(vault, "findme", cancel=cancel)


def test_empty_query_and_empty_vault(tmp_path: Path) -> None:
    assert search_vault(tmp_path, "anything") == []
    make_vault(tmp_path, {"a.md": "content\n"})
    assert search_vault(tmp_path, "") == []
    assert search_vault(tmp_path, "   ") == []
    assert search_vault(tmp_path, "—…!!", do_normalize=True) == []
