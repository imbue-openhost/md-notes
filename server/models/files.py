from typing import Literal

import attr


@attr.s(auto_attribs=True, frozen=True)
class FileEntry:
    name: str
    path: str
    type: Literal["file", "dir"]
    children: list["FileEntry"] | None


@attr.s(auto_attribs=True, frozen=True)
class CreateFileBody:
    type: Literal["file", "dir"] = "file"
    content: str = ""


@attr.s(auto_attribs=True, frozen=True)
class RenameBody:
    newPath: str
