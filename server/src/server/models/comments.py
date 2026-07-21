import attr


@attr.s(auto_attribs=True, frozen=True)
class CreateCommentBody:
    userId: str
    userName: str
    text: str
    # Top-level comments anchor to a text span (base64 Yjs relative positions into the "content" text).
    anchorStart: str | None = None
    anchorEnd: str | None = None
    # Replies reference their top-level comment instead of carrying anchors.
    parentId: str | None = None


@attr.s(auto_attribs=True, frozen=True)
class UpdateCommentBody:
    userId: str
    text: str | None = None
    resolved: bool | None = None


@attr.s(auto_attribs=True, frozen=True)
class CreateCommentResponse:
    id: str
