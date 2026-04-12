/**
 * File tree sidebar — vanilla DOM.
 *
 * Renders a recursive file tree from the REST API response.
 * Click a file to open it; click a folder to expand/collapse.
 * Right-click for context menu with rename/delete.
 */

import type { FileEntry } from '../api/types';
import { listFiles, createFile, deleteFile, renameFile } from '../api/client';

export type OnFileSelect = (path: string) => void;
export type OnShare = (path: string) => void;

let currentPath: string | null = null;
let container: HTMLElement | null = null;
let onFileSelect: OnFileSelect | null = null;
let onShare: OnShare | null = null;

/** Create and mount the sidebar. */
export function createSidebar(
  parent: HTMLElement,
  onSelect: OnFileSelect,
  onShareCb?: OnShare,
): HTMLElement {
  onFileSelect = onSelect;
  onShare = onShareCb ?? null;

  container = document.createElement('div');
  container.id = 'sidebar';

  // Header
  const header = document.createElement('div');
  header.className = 'sidebar-header';

  const title = document.createElement('span');
  title.textContent = 'Files';
  header.appendChild(title);

  const buttons = document.createElement('div');
  buttons.className = 'sidebar-header-buttons';

  const newBtn = document.createElement('button');
  newBtn.className = 'sidebar-btn';
  newBtn.textContent = '+';
  newBtn.title = 'New file';
  newBtn.addEventListener('click', handleNewFile);
  buttons.appendChild(newBtn);

  if (onShareCb) {
    const shareBtn = document.createElement('button');
    shareBtn.className = 'sidebar-btn';
    shareBtn.textContent = '\u{1F517}'; // 🔗
    shareBtn.title = 'Share current file';
    shareBtn.addEventListener('click', () => {
      if (currentPath) onShare?.(currentPath);
      else alert('Open a file first.');
    });
    buttons.appendChild(shareBtn);
  }

  header.appendChild(buttons);

  container.appendChild(header);

  // Tree container
  const tree = document.createElement('div');
  tree.className = 'sidebar-tree';
  container.appendChild(tree);

  // Close context menu on click elsewhere
  document.addEventListener('click', () => {
    document.querySelector('.sidebar-context-menu')?.remove();
  });

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

      // Context menu for folders
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: 'New file here...', action: () => handleNewFileInDir(entry.path) },
          { label: 'Delete folder', action: () => handleDelete(entry.path, entry.name) },
        ]);
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

      // Context menu for files
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Rename...', action: () => handleRename(entry.path, entry.name) },
          { label: 'Delete', action: () => handleDelete(entry.path, entry.name) },
        ]);
      });

      li.appendChild(row);
    }

    ul.appendChild(li);
  }
  return ul;
}

// ── Context menu ──────────────────────────────────────────────────────────

interface MenuItem {
  label: string;
  action: () => void;
}

function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  // Remove any existing menu
  document.querySelector('.sidebar-context-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'sidebar-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  for (const item of items) {
    const btn = document.createElement('div');
    btn.className = 'sidebar-context-item';
    btn.textContent = item.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      item.action();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
}

// ── File operations ───────────────────────────────────────────────────────

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

async function handleNewFileInDir(dirPath: string): Promise<void> {
  const name = prompt('File name (e.g., note.md):');
  if (!name) return;
  const fileName = name.endsWith('.md') ? name : `${name}.md`;
  const fullPath = `${dirPath}/${fileName}`;
  try {
    await createFile(fullPath);
    await refreshSidebar();
    onFileSelect?.(fullPath);
  } catch (e) {
    alert(`Failed to create file: ${e}`);
  }
}

async function handleRename(path: string, name: string): Promise<void> {
  const newName = prompt('New name:', name);
  if (!newName || newName === name) return;

  // Build new path by replacing the last path component
  const parts = path.split('/');
  parts[parts.length - 1] = newName.endsWith('.md') ? newName : `${newName}.md`;
  const newPath = parts.join('/');

  try {
    await renameFile(path, newPath);
    await refreshSidebar();
    if (currentPath === path) {
      onFileSelect?.(newPath);
    }
  } catch (e) {
    alert(`Failed to rename: ${e}`);
  }
}

async function handleDelete(path: string, name: string): Promise<void> {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    await deleteFile(path);
    await refreshSidebar();
  } catch (e) {
    alert(`Failed to delete: ${e}`);
  }
}
