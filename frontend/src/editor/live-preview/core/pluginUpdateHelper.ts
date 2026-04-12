import { ViewUpdate } from '@codemirror/view';
import { mouseSelectingField } from './mouseSelecting';

/**
 * Update action for ViewPlugin
 * - 'rebuild': Decorations need to be rebuilt
 * - 'skip': Skip this update (e.g., during drag)
 * - 'none': No action needed
 */
export type UpdateAction = 'rebuild' | 'skip' | 'none';

/**
 * Determine what action a ViewPlugin should take on update
 *
 * This helper extracts the common update logic shared by livePreviewPlugin
 * and mathPlugin, handling:
 * 1. Document/viewport/config changes → rebuild
 * 2. Drag end → rebuild
 * 3. During drag → skip (avoid flickering)
 * 4. Selection change → rebuild
 *
 * @param update - The ViewUpdate from CodeMirror
 * @returns The action the plugin should take
 *
 * @example
 * ```typescript
 * update(update: ViewUpdate) {
 *   const action = checkUpdateAction(update);
 *   if (action === 'rebuild') {
 *     this.decorations = this.build(update.view);
 *   }
 * }
 * ```
 */
export function checkUpdateAction(update: ViewUpdate): UpdateAction {
  // Document/config changes: must rebuild.
  // Note: viewportChanged is intentionally NOT included here because
  // decoration changes can themselves trigger viewport changes, creating
  // an infinite rebuild loop (InlineCoordsScan stack overflow with vim j/k).
  if (
    update.docChanged ||
    update.transactions.some((t) => t.reconfigured)
  ) {
    return 'rebuild';
  }

  // Check drag state
  const isDragging = update.state.field(mouseSelectingField, false);
  const wasDragging = update.startState.field(mouseSelectingField, false);

  // Just finished dragging: rebuild
  if (wasDragging && !isDragging) {
    return 'rebuild';
  }

  // Currently dragging: skip to avoid flickering
  if (isDragging) {
    return 'skip';
  }

  // NOTE: selectionSet intentionally NOT triggering rebuild here.
  // Rebuilding mark decorations on selection change causes CM6's
  // InlineCoordsScan to recurse infinitely when vim navigates with j/k.
  // This means inline formatting marks (**, *, etc.) won't show/hide
  // based on cursor position — they'll only update on document edits.
  // The livePreviewPlugin has its own selection-aware update logic
  // with an active-lines guard to handle this safely.

  return 'none';
}
