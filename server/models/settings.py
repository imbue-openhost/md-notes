import attr


@attr.s(auto_attribs=True, frozen=True)
class VimrcResponse:
    vimrc: str | None


@attr.s(auto_attribs=True, frozen=True)
class VimrcBody:
    vimrc: str
