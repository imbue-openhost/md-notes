import attr


@attr.s(auto_attribs=True, frozen=True)
class MatchRange:
    """Codepoint offsets into SearchHit.text; end-exclusive."""

    start: int
    end: int


@attr.s(auto_attribs=True, frozen=True)
class SearchHit:
    path: str
    line_number: int
    text: str
    ranges: list[MatchRange]
    score: float
