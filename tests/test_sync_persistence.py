"""Smoke test: verify CRDT sidecar prevents content doubling on cold reconnect.

Exercises the SyncManager flow:
  1. Open a room, edit, save → sidecar written.
  2. Drop the room (simulate grace-period cleanup).
  3. Re-open the room — should load sidecar, preserving Y.Doc clientID.
  4. Apply a "stale client" update (a separate Y.Doc that diverged from the same starting point).
     If the server lost CRDT state, this would double the content; with sidecar, it's a no-op.

Run with:  uv run python tests/test_sync_persistence.py
"""

import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server" / "src"))

from pycrdt import Doc
from pycrdt import Text

from server.core import crdt_store
from server.core.sync import SyncManager


async def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp) / "vault"
        vault.mkdir()
        doc_path = "test.md"
        (vault / doc_path).write_text("hello world\n", encoding="utf-8")

        # First session: edit, save.
        manager1 = SyncManager(vault)
        await manager1.start()
        room1 = await manager1._ws_server.get_room(doc_path)  # type: ignore[union-attr]
        manager1._init_room(room1, doc_path)
        text1 = room1.ydoc.get("content", type=Text)
        assert text1 is not None
        text1 += " edited"
        await manager1._save_room(doc_path, room1)
        first_size = len(str(text1))
        assert first_size == len("hello world\n edited"), first_size

        # Capture a "stale client" — a fork of the same doc, same clientIDs.
        stale = Doc()
        stale.apply_update(room1.ydoc.get_update())
        stale_text = stale.get("content", type=Text)
        assert stale_text is not None

        # Verify sidecar exists.
        sidecar = crdt_store.read_state(vault, doc_path)
        assert sidecar is not None and len(sidecar) > 0

        # Simulate full server restart: new SyncManager.
        manager1._initialised_rooms.discard(doc_path)
        manager1._last_saved_size.pop(doc_path, None)
        manager2 = SyncManager(vault)
        await manager2.start()
        room2 = await manager2._ws_server.get_room(doc_path)  # type: ignore[union-attr]
        manager2._init_room(room2, doc_path)
        text2 = room2.ydoc.get("content", type=Text)
        assert text2 is not None
        assert str(text2) == "hello world\n edited", str(text2)

        # Stale client reconnects: send its full update. Because both docs share clientID/clock
        # from the sidecar, this is a no-op merge — NOT a doubling.
        room2.ydoc.apply_update(stale.get_update())
        post_merge = str(text2)
        assert post_merge == "hello world\n edited", f"DOUBLED: {post_merge!r}"

        # Stale client makes a real edit, then merges. Should add cleanly.
        stale_text += " from-stale"
        room2.ydoc.apply_update(stale.get_update(state=room2.ydoc.get_state()))
        assert str(text2) == "hello world\n edited from-stale", str(text2)

        # Refuse non-existent doc.
        room3 = await manager2._ws_server.get_room("nope.md")  # type: ignore[union-attr]
        try:
            manager2._init_room(room3, "nope.md")
        except FileNotFoundError:
            pass
        else:
            raise AssertionError("expected FileNotFoundError for missing .md")
        print("OK: sidecar prevents doubling on cold reconnect")


if __name__ == "__main__":
    asyncio.run(main())
