import { onMount, type Component } from 'solid-js';
import { Dialog } from '@kobalte/core';

interface Props {
  label: string;
  defaultValue?: string;
  onResult: (value: string | null) => void;
}

export const InputDialog: Component<Props> = (props) => {
  let inputRef!: HTMLInputElement;

  onMount(() => {
    inputRef.focus();
    inputRef.select();
  });

  function submit() { props.onResult(inputRef.value); }
  function cancel() { props.onResult(null); }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) cancel(); }}>
      <Dialog.Portal>
        <div class="settings-modal-overlay">
          <Dialog.Content class="settings-modal" onInteractOutside={cancel}>
            <Dialog.Title class="settings-modal-title">{props.label}</Dialog.Title>
            <input
              ref={inputRef}
              class="settings-input"
              type="text"
              value={props.defaultValue ?? ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') cancel();
              }}
            />
            <div class="settings-buttons">
              <button class="share-modal-btn" onClick={cancel}>Cancel</button>
              <button class="share-modal-btn share-modal-btn-primary" onClick={submit}>OK</button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
