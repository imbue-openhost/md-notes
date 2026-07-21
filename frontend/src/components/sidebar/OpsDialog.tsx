import { Show, type Component } from 'solid-js';
import type { FileOps } from './file-ops';

/** Renders the confirm dialog a FileOps delete is waiting on, if any. */
export const OpsDialog: Component<{ ops: FileOps }> = (props) => (
  <Show when={props.ops.confirm()}>
    {(req) => (
      <div class="modal-backdrop" onClick={() => props.ops.closeConfirm(false)}>
        <div class="modal" onClick={(e) => e.stopPropagation()}>
          <p>{req().message}</p>
          <div class="modal-actions">
            <button onClick={() => props.ops.closeConfirm(false)}>Cancel</button>
            <button
              class="modal-btn-danger"
              ref={(el) => requestAnimationFrame(() => el.focus())}
              onKeyDown={(e) => { if (e.key === 'Escape') props.ops.closeConfirm(false); }}
              onClick={() => props.ops.closeConfirm(true)}
            >{req().confirmLabel}</button>
          </div>
        </div>
      </div>
    )}
  </Show>
);
