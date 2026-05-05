import attr


@attr.s(auto_attribs=True, frozen=True)
class Vault:
    name: str


@attr.s(auto_attribs=True, frozen=True)
class VaultBody:
    name: str
