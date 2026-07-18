import { Show, type Component } from 'solid-js';
import { InputDialog } from '../InputDialog';
import type { FileOps } from './file-ops';

/** Renders the input dialog a FileOps prompt is waiting on, if any. */
export const OpsDialog: Component<{ ops: FileOps }> = (props) => (
  <Show when={props.ops.dialog()}>
    {(d) => (
      <InputDialog
        label={d().label}
        defaultValue={d().defaultValue}
        onResult={(v) => props.ops.closeDialog(v)}
      />
    )}
  </Show>
);
