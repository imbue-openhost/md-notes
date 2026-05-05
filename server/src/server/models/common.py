import attr


@attr.s(auto_attribs=True, frozen=True)
class OkResponse:
    ok: bool = True
