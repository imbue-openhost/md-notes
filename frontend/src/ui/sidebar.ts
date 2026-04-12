/**
 * File tree sidebar — vanilla DOM.
 *
 * Renders a recursive file tree from the REST API response.
 * Click a file to open it; click a folder to expand/collapse.
 */

import type { FileEntry } from '../api/types';
import { listFiles, createFile, deleteFile } from '../api/client';

export type OnFileSelect = (path: string) => void;

let currentPath: string | null = null;
let container: HTMLElement | null = null;
let onFileSelect: OnFileSelect | null = null;

/** Create and mount the sidebar. */
export function createSidebar(
  parent: HTMLElement,
  onSelect: OnFileSelect,
): HTMLElement {
  onFileSelect = onSelect;

  container = document.createElement('div');
  container.id = 'sidebar';

  // Header
  const header = document.createElement('div');
  header.className = 'sidebar-header';
  header.textContent = 'Files';

  const newBtn = document.createElement('button');
  newBtn.className = 'sidebar-btn';
  newBtn.textContent = '+';
  newBtn.title = 'New file';
  newBtn.addEventListener('click', handleNewFile);
  header.appendChild(newBtn);

  container.appendChild(header);

  // Tree container
  const tree = document.createElement('div');
  tree.className = 'sidebar-tree';
  container.appendChild(tree);

  parent.insertBefore(container, parent.firstChild);
  return container;
}

/** Refresh the file tree from the server. */
export async function refreshSidebar(): Promise<void> {
  if (!container) return;
  const tree = container.querySelector('.sidebar-tree');
  if (!tree) return;

  try {
    const files = await listFiles();
    tree.innerHTML = '';
    tree.appendChild(renderTree(files));
  } catch {
    tree.innerHTML = '<div class="sidebar-error">Could not load files</div>';
  }
}

/** Highlight the currently open file. */
export function setCurrentFile(path: string | null): void {
  currentPath = path;
  if (!container) return;
  container.querySelectorAll('.sidebar-item.active').forEach((el) => {
    el.classList.remove('active');
  });
  if (path) {
    const el = container.querySelector(`[data-path="${CSS.escape(path)}"]`);
    el?.classList.add('active');
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

function renderTree(entries: FileEntry[]): HTMLElement {
  const ul = document.createElement('ul');
  for (const entry of entries) {
    const li = document.createElement('li');

    const row = document.createElement('div');
    row.className = 'sidebar-item';
    row.dataset.path = entry.path;
    row.dataset.type = entry.type;

    if (entry.type === 'dir') {
      const arrow = document.createElement('span');
      arrow.className = 'sidebar-arrow';
      arrow.textContent = '\u25B6'; // ▶
      row.appendChild(arrow);

      const label = document.createElement('span');
      label.textContent = entry.name;
      row.appendChild(label);

      row.addEventListener('click', () => {
        const isOpen = li.classList.toggle('open');
        arrow.textContent = isOpen ? '\u25BC' : '\u25B6'; // ▼ or ▶
      });

      li.appendChild(row);

      if (entry.children && entry.children.length > 0) {
        const childUl = renderTree(entry.children);
        childUl.className = 'sidebar-children';
        li.appendChild(childUl);
      }
    } else {
      const icon = document.createElement('span');
      icon.className = 'sidebar-icon';
      icon.textContent = '\uD83D\uDCC4'; // 📄
      row.appendChild(icon);

      const label = document.createElement('span');
      label.textContent = entry.name.replace(/\.md$/, '');
      row.appendChild(label);

      if (entry.path === currentPath) {
        row.classList.add('active');
      }

      row.addEventListener('click', () => {
        onFileSelect?.(entry.path);
      });

      li.appendChild(row);
    }

    ul.appendChild(li);
  }
  return ul;
}

async function handleNewFile(): Promise<void> {
  const name = prompt('File name (e.g., note.md):');
  if (!name) return;
  const fileName = name.endsWith('.md') ? name : `${name}.md`;
  try {
    await createFile(fileName);
    await refreshSidebar();
    onFileSelect?.(fileName);
  } catch (e) {
    alert(`Failed to create file: ${e}`);
  }
}
