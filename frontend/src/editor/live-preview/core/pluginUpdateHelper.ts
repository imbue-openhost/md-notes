import { syntaxTree } from '@codemirror/language';
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
 * Determine what action a decoration-building ViewPlugin should take:
 * 1. Document/config changes → rebuild
 * 2. Drag end → rebuild
 * 3. During drag → skip (decorations stay frozen so layout doesn't shift under the mouse)
 * 4. Selection/viewport/syntax-tree changes → rebuild
 *
 * @example
 * ```typescript
 * update(update: ViewUpdate) {
 *   if (checkUpdateAction(update) === 'rebuild') {
 *     this.decorations = this.build(update.view);
 *   }
 * }
 * ```
 */
export function checkUpdateAction(update: ViewUpdate): UpdateAction {
  if (update.docChanged || update.transactions.some((t) => t.reconfigured)) {
    return 'rebuild';
  }

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

  // Selection moves show/hide marks; viewport and syntax-tree changes bring
  // newly visible or newly parsed regions that need decorating. Rebuilding
  // on these is safe with replace decorations (taskListPlugin does the
  // same) — the old stack overflow came from CSS font-size mark hiding.
  if (
    update.selectionSet ||
    update.viewportChanged ||
    syntaxTree(update.startState) !== syntaxTree(update.state)
  ) {
    return 'rebuild';
  }

  return 'none';
}
