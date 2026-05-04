from typing import Literal

import attr


@attr.s(auto_attribs=True, frozen=True)
class ShareLink:
    uuid: str
    doc_path: str
    permission: Literal["read", "write"]
    created_at: str


@attr.s(auto_attribs=True, frozen=True)
class CreateShareBody:
    docPath: str
    permission: Literal["read", "write"] = "read"


@attr.s(auto_attribs=True, frozen=True)
class CreateShareResponse:
    uuid: str
