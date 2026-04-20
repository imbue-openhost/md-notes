import { onMount, onCleanup, type Component } from 'solid-js';
import {
  DockviewSolid,
  themeLight,
  type DockviewApi,
  type IDockviewPanelProps,
  type DockviewReadyEvent,
} from '@arminmajerie/dockview-solid';
import '@arminmajerie/dockview-solid/dist/styles/dockview.css';
import type { EditorInstance } from '../editor/editor';

export interface EditorLayoutHandle {
  openFile: (path: string) => void;
  splitPane: () => void;
}

type CreateEditorFn = (path: string, container: HTMLElement) => EditorInstance;

interface Props {
  createEditor: CreateEditorFn;
  onActiveFileChange: (path: string | null) => void;
  ref?: (handle: EditorLayoutHandle) => void;
}

let panelCounter = 0;

const editorInstances = new Map<string, EditorInstance>();

export const EditorLayout: Component<Props> = (props) => {
  let api: DockviewApi | undefined;

  const handle: EditorLayoutHandle = {
    openFile(path: string) {
      if (!api) return;
      for (const panel of api.panels) {
        if ((panel.params as any)?.filePath === path) {
          panel.api.setActive();
          return;
        }
      }
      const panelId = `file-${++panelCounter}`;
      const name = path.replace(/\.md$/, '').split('/').pop() || path;
      api.addPanel({
        id: panelId,
        component: 'editor',
        title: name,
        params: { filePath: path },
      });
    },
    splitPane() {
      if (!api) return;
      const active = api.activePanel;
      if (!active) return;
      const filePath = (active.params as any)?.filePath;
      if (!filePath) return;
      const panelId = `file-${++panelCounter}`;
      const name = filePath.replace(/\.md$/, '').split('/').pop() || filePath;
      api.addPanel({
        id: panelId,
        component: 'editor',
        title: name,
        params: { filePath },
        position: { referencePanel: active, direction: 'right' },
      });
    },
  };

  props.ref?.(handle);

  function EditorPanel(panelProps: IDockviewPanelProps<{ filePath: string }>) {
    let container!: HTMLDivElement;

    onMount(() => {
      const instance = props.createEditor(panelProps.params.filePath, container);
      editorInstances.set(panelProps.api.id, instance);
    });

    onCleanup(() => {
      const instance = editorInstances.get(panelProps.api.id);
      if (instance) {
        instance.destroy();
        editorInstances.delete(panelProps.api.id);
      }
    });

    return <div ref={container} style={{ width: '100%', height: '100%' }} />;
  }

  function handleReady(event: DockviewReadyEvent) {
    api = event.api;

    api.onDidActivePanelChange((panel) => {
      props.onActiveFileChange((panel?.params as any)?.filePath ?? null);
    });

    api.onDidRemovePanel((panel) => {
      const instance = editorInstances.get(panel.id);
      if (instance) {
        instance.destroy();
        editorInstances.delete(panel.id);
      }
    });
  }

  onCleanup(() => {
    for (const instance of editorInstances.values()) {
      instance.destroy();
    }
    editorInstances.clear();
    api?.dispose();
  });

  return (
    <div id="editor-container">
      <DockviewSolid
        theme={themeLight}
        components={{ editor: EditorPanel }}
        onReady={handleReady}
      />
    </div>
  );
};
