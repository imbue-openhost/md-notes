from pathlib import Path

import pytest

from server.core.files import PathTraversalError
from server.core.files import create_directory
from server.core.files import create_file
from server.core.files import delete_file
from server.core.files import list_files
from server.core.files import rename_file


def test_create_file_writes_content(tmp_path: Path) -> None:
    create_file(tmp_path, "dir/note.md", "# hi")
    assert (tmp_path / "dir/note.md").read_text() == "# hi"


def test_create_file_refuses_overwrite(tmp_path: Path) -> None:
    (tmp_path / "note.md").write_text("original")
    with pytest.raises(FileExistsError):
        create_file(tmp_path, "note.md", "")
    assert (tmp_path / "note.md").read_text() == "original"


def test_rename_moves_file(tmp_path: Path) -> None:
    create_file(tmp_path, "a.md", "x")
    create_directory(tmp_path, "sub")
    rename_file(tmp_path, "a.md", "sub/a.md")
    assert not (tmp_path / "a.md").exists()
    assert (tmp_path / "sub/a.md").read_text() == "x"


def test_rename_moves_directory_with_contents(tmp_path: Path) -> None:
    create_file(tmp_path, "src/inner/note.md", "x")
    rename_file(tmp_path, "src", "dst")
    assert (tmp_path / "dst/inner/note.md").read_text() == "x"


def test_rename_refuses_overwrite(tmp_path: Path) -> None:
    create_file(tmp_path, "a.md", "keep me")
    create_file(tmp_path, "b.md", "other")
    with pytest.raises(FileExistsError):
        rename_file(tmp_path, "b.md", "a.md")
    assert (tmp_path / "a.md").read_text() == "keep me"


def test_paths_cannot_escape_vault(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    with pytest.raises(PathTraversalError):
        create_file(vault, "../outside.md", "")
    with pytest.raises(PathTraversalError):
        rename_file(vault, "a.md", "../outside.md")


def test_list_files_skips_hidden_and_non_md(tmp_path: Path) -> None:
    create_file(tmp_path, "dir/note.md", "")
    (tmp_path / ".hidden.md").write_text("")
    (tmp_path / "image.png").write_text("")
    entries = list_files(tmp_path)
    assert [e.name for e in entries] == ["dir"]
    assert [c.name for c in entries[0].children or []] == ["note.md"]


def test_delete_file_and_empty_dir(tmp_path: Path) -> None:
    create_file(tmp_path, "dir/note.md", "")
    delete_file(tmp_path, "dir/note.md")
    assert not (tmp_path / "dir/note.md").exists()
    delete_file(tmp_path, "dir")
    assert not (tmp_path / "dir").exists()


def test_delete_dir_recursively(tmp_path: Path) -> None:
    create_file(tmp_path, "dir/nested/deep.md", "x")
    create_file(tmp_path, "dir/note.md", "y")
    delete_file(tmp_path, "dir")
    assert not (tmp_path / "dir").exists()
