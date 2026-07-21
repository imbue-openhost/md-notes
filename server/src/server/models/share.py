from typing import Literal

import attr

SharePermission = Literal["read", "comment", "write"]


@attr.s(auto_attribs=True, frozen=True)
class ShareLink:
    uuid: str
    doc_path: str
    permission: SharePermission
    created_at: str


@attr.s(auto_attribs=True, frozen=True)
class CreateShareBody:
    docPath: str
    permission: SharePermission = "read"


@attr.s(auto_attribs=True, frozen=True)
class CreateShareResponse:
    uuid: str
