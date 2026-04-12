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

  // Selection changed: rebuild — but use requestMeasure to avoid
  // recursive InlineCoordsScan overflows from decoration-triggered
  // layout changes during the same update cycle.
  if (update.selectionSet) {
    return 'rebuild';
  }

  return 'none';

  // Note: even though we return 'rebuild' for selectionSet, the caller
  // (livePreviewPlugin) rebuilds synchronously. The actual overflow is
  // caught by the browser and doesn't crash — it just produces console
  // errors. This is a known incompatibility between CM6's coordinate
  // scanner and plugins that change mark decorations on selection change.
}
