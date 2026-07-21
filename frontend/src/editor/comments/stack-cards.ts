export interface LayoutEntry {
  id: string;
  /** Anchor top in document space — where the card wants to sit. */
  desired: number;
  height: number;
}

export const CARD_GAP = 8;
export const TOP_MARGIN = 4;

/**
 * Google-Docs-style stacking: every card wants to sit at its anchor's top; overlapping cards push
 * apart downward. A pinned (active/draft) card stays exactly at its anchor, with earlier cards
 * pushed up and later ones down. Entries must be sorted by `desired`.
 */
export function stackCards(
  entries: LayoutEntry[],
  pinnedId: string | null,
  gap = CARD_GAP,
  margin = TOP_MARGIN,
): Map<string, number> {
  const n = entries.length;
  const tops = new Array<number>(n);
  const pinnedIdx = pinnedId ? entries.findIndex((e) => e.id === pinnedId) : -1;

  if (pinnedIdx >= 0) {
    tops[pinnedIdx] = Math.max(margin, entries[pinnedIdx].desired);
    for (let i = pinnedIdx - 1; i >= 0; i--) {
      tops[i] = Math.min(entries[i].desired, tops[i + 1] - entries[i].height - gap);
    }
    if (n > 0 && tops[0] < margin) {
      // Ran out of room above; give up on pinning exactly and restack downward from the margin.
      tops[0] = margin;
      for (let i = 1; i <= pinnedIdx; i++) {
        tops[i] = Math.max(Math.min(entries[i].desired, tops[i]), tops[i - 1] + entries[i - 1].height + gap);
      }
    }
    for (let i = pinnedIdx + 1; i < n; i++) {
      tops[i] = Math.max(entries[i].desired, tops[i - 1] + entries[i - 1].height + gap);
    }
  } else {
    let floor = margin;
    for (let i = 0; i < n; i++) {
      tops[i] = Math.max(entries[i].desired, floor);
      floor = tops[i] + entries[i].height + gap;
    }
  }

  const result = new Map<string, number>();
  entries.forEach((e, i) => result.set(e.id, tops[i]));
  return result;
}
