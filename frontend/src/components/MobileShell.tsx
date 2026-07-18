import { createSignal, onMount, onCleanup, For, Show, type Component, type JSX } from 'solid-js';
import { EditorView } from '@codemirror/view';
import type { EditorInstance } from '../editor/editor';
import type { EditorLayoutHandle } from './EditorLayout';
import { handleTab, handleShiftTab } from '../editor/tab';
import { toggleBold } from '../editor/lang-markdown/index';
import { toggleTaskAtSelection } from '../editor/tasks';
import { setHeadingLevel } from '../editor/heading';

type CreateEditorFn = (
  path: string,
  container: HTMLElement,
  onSyncFailed: (error: Error) => void,
) => EditorInstance;

interface Props {
  createEditor: CreateEditorFn;
  onActiveFileChange: (path: string | null) => void;
  onSyncFailed?: (path: string, error: Error) => void;
  vaultName: string;
  /** Rendered inside the slide-in drawer (the regular Sidebar). */
  drawerContent: JSX.Element;
  ref?: (handle: EditorLayoutHandle) => void;
}

function lastDocKey(vaultName: string): string {
  return `mdnotes-mobile-last-doc-${vaultName}`;
}

/**
 * Phone shell: one document at a time, a slide-in drawer for the file tree,
 * and a formatting toolbar that sits above the virtual keyboard.
 */
export const MobileShell: Component<Props> = (props) => {
  const [openPath, setOpenPath] = createSignal<string | null>(null);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [editorFocused, setEditorFocused] = createSignal(false);
  const [headingPickerOpen, setHeadingPickerOpen] = createSignal(false);

  let rootEl!: HTMLDivElement;
  let editorHost!: HTMLDivElement;
  let instance: EditorInstance | null = null;
  let pendingJump: number | null = null;

  function jumpToLine(view: EditorView, line: number) {
    // The search result came from disk, which can lag the live doc — clamp.
    const n = Math.max(1, Math.min(line, view.state.doc.lines));
    const pos = view.state.doc.line(n).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
  }

  function closeDoc() {
    instance?.destroy();
    instance = null;
    editorHost.innerHTML = '';
    setOpenPath(null);
    props.onActiveFileChange(null);
  }

  function openDoc(path: string, line?: number) {
    setDrawerOpen(false);
    if (path === openPath()) {
      if (line !== undefined && instance) {
        const inst = instance;
        inst.ready.then(() => { if (instance === inst) jumpToLine(inst.view, line); });
      }
      return;
    }
    instance?.destroy();
    editorHost.innerHTML = '';
    setOpenPath(path);
    props.onActiveFileChange(path);
    try { localStorage.setItem(lastDocKey(props.vaultName), path); } catch {}

    pendingJump = line ?? null;
    const inst = props.createEditor(path, editorHost, (err) => {
      if (instance === inst) closeDoc();
      props.onSyncFailed?.(path, err);
    });
    instance = inst;
    inst.ready.then(() => {
      if (instance !== inst) return;
      if (pendingJump !== null) {
        jumpToLine(inst.view, pendingJump);
        pendingJump = null;
      }
    });
  }

  props.ref?.({
    openFile: (path) => openDoc(path),
    openFileAt: (path, line) => openDoc(path, line),
    splitPane: () => {},
    toggleCollapseActivePane: () => {},
    focusGroupLeft: () => {},
    focusGroupRight: () => {},
    focusTabLeft: () => {},
    focusTabRight: () => {},
  });

  function runCommand(cmd: (view: EditorView) => boolean) {
    const view = instance?.view;
    if (!view) return;
    cmd(view);
    view.focus();
  }

  // Keeps a toolbar tap from moving focus out of the editor (which would
  // dismiss the keyboard before the command runs).
  const keepFocus = (e: PointerEvent | MouseEvent) => e.preventDefault();

  // Toolbar commands run on pointerdown, not click: on iOS the tap would
  // otherwise collapse the native text selection (which CM mirrors) before
  // click fires, so selection-based commands like bold saw an empty range.
  function toolBtn(label: string, title: string, action: () => void, cls = '') {
    return (
      <button
        class={cls ? `mobile-toolbar-btn ${cls}` : 'mobile-toolbar-btn'}
        title={title}
        onPointerDown={(e: PointerEvent) => {
          e.preventDefault();
          action();
        }}
      >{label}</button>
    );
  }

  onMount(() => {
    // Pin the shell to the visual viewport so the toolbar sits directly above
    // the virtual keyboard. iOS doesn't resize the layout viewport when the
    // keyboard opens — it pans it — so height and offset both need tracking.
    const vv = window.visualViewport;
    if (vv) {
      const update = () => {
        rootEl.style.height = `${Math.round(vv.height)}px`;
        rootEl.style.top = `${Math.round(vv.offsetTop)}px`;
        window.scrollTo(0, 0);
      };
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      update();
      onCleanup(() => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      });
    }

    // Track whether the editor owns focus (drives toolbar visibility).
    // focusout fires before focus lands elsewhere, so defer the check.
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const syncFocus = () => {
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        const focused = !!editorHost.contains(document.activeElement);
        setEditorFocused(focused);
        if (!focused) setHeadingPickerOpen(false);
      }, 50);
    };
    editorHost.addEventListener('focusin', syncFocus);
    editorHost.addEventListener('focusout', syncFocus);
    onCleanup(() => {
      clearTimeout(focusTimer);
      editorHost.removeEventListener('focusin', syncFocus);
      editorHost.removeEventListener('focusout', syncFocus);
    });

    // Reopen the doc from the previous session; fall back to the drawer.
    let last: string | null = null;
    try { last = localStorage.getItem(lastDocKey(props.vaultName)); } catch {}
    if (last) openDoc(last);
    else setDrawerOpen(true);
  });

  onCleanup(() => {
    instance?.destroy();
    instance = null;
  });

  return (
    <div class="mobile-shell" ref={rootEl}>
      <div class="mobile-editor" ref={editorHost} />

      {/* Obsidian-style floating control over the text instead of a top bar.
          Search lives in the drawer (file search and text search, separately). */}
      <div class="mobile-float-controls">
        <button class="mobile-float-btn" title="Files" onClick={() => setDrawerOpen(true)}>☰</button>
      </div>

      <Show when={!openPath()}>
        <div class="mobile-empty">
          <button class="mobile-empty-btn" onClick={() => setDrawerOpen(true)}>Open a note</button>
        </div>
      </Show>

      <Show when={openPath() && editorFocused()}>
        <div class="mobile-toolbar-wrap" onPointerDown={keepFocus} onMouseDown={keepFocus}>
          <Show when={headingPickerOpen()}>
            <div class="mobile-toolbar mobile-heading-picker">
              {toolBtn('None', 'Remove heading', () => {
                runCommand((v) => setHeadingLevel(v, 0));
                setHeadingPickerOpen(false);
              }, 'mobile-toolbar-none')}
              <For each={[1, 2, 3, 4, 5, 6]}>
                {(level) => toolBtn(`H${level}`, `Heading ${level}`, () => {
                  runCommand((v) => setHeadingLevel(v, level));
                  setHeadingPickerOpen(false);
                })}
              </For>
            </div>
          </Show>
          <div class="mobile-toolbar">
            <button
              class="mobile-toolbar-btn mobile-toolbar-bold"
              classList={{ active: headingPickerOpen() }}
              title="Heading"
              onPointerDown={(e: PointerEvent) => {
                e.preventDefault();
                setHeadingPickerOpen(!headingPickerOpen());
              }}
            >H</button>
            {toolBtn('B', 'Bold', () => runCommand(toggleBold), 'mobile-toolbar-bold')}
            {toolBtn('☑', 'Toggle checkbox', () => runCommand((v) => toggleTaskAtSelection(v)))}
            {toolBtn('⇥', 'Indent', () => runCommand(handleTab))}
            {toolBtn('⇤', 'Outdent', () => runCommand(handleShiftTab))}
          </div>
        </div>
      </Show>

      <Show when={drawerOpen()}>
        <div class="mobile-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
      </Show>
      <div class="mobile-drawer" classList={{ open: drawerOpen() }}>
        {props.drawerContent}
      </div>
    </div>
  );
};
