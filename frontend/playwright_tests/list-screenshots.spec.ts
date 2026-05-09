// Visual screenshots of list/task/code-block rendering at various cursor
// positions. Uses the standalone screenshots.html harness so it doesn't
// need the full e2e stack — just a vite dev server.
//
// Run:  PLAYWRIGHT_BASE_URL=http://localhost:5173 \
//         npx playwright test playwright_tests/list-screenshots.spec.ts

import { test, expect } from '@playwright/test';

const HARNESS = '/screenshots.html';

declare global {
  interface Window {
    mountEditor: (content: string, label?: string) => Promise<void>;
    moveCursor: (pos: number) => Promise<void>;
  }
}

interface Case {
  name: string;
  doc: string;
  // Cursor positions to snapshot at (in addition to position 0). Each
  // produces a separate screenshot.
  cursorPositions?: number[];
}

const cases: Case[] = [
  {
    name: '01-flat-bullets',
    doc: '- one\n- two\n- three\n',
  },
  {
    name: '02-nested-bullets',
    doc: '- L1 a\n  - L2 a\n    - L3 a\n  - L2 b\n- L1 b\n',
  },
  {
    name: '03-deep-nest',
    doc: '- 1\n  - 2\n    - 3\n      - 4\n        - 5\n',
  },
  {
    name: '04-cursor-on-bullet',
    doc: '- one\n  - two nested\n',
    cursorPositions: [0, 6, 8],
  },
  {
    name: '05-cursor-in-indent',
    doc: '- one\n  - two\n    - three\n',
    cursorPositions: [7, 14, 15, 16],
  },
  {
    name: '06-ordered-list',
    doc: '1. first\n2. second\n   1. nested\n   2. nested two\n',
  },
  {
    name: '07-task-list',
    doc: '- [ ] todo a\n- [x] done b\n  - [ ] sub todo\n  - [x] sub done\n',
  },
  {
    name: '08-task-cursor-on-marker',
    doc: '- [ ] todo a\n- [x] done b\n',
    cursorPositions: [0, 1, 4],
  },
  {
    name: '09-mixed-list-with-paragraphs',
    doc:
      '- intro line\n  has wrapped continuation that should align under the bullet text\n' +
      '- next item\n  - nested item\n    with its own wrapped continuation that aligns\n',
  },
  {
    name: '10-code-block-top-level',
    doc: '```python\ndef foo():\n    return 1\n```\n',
  },
  {
    name: '11-code-block-in-list',
    doc: '- here is a code block\n  ```python\n  def foo():\n      return 1\n  ```\n- after\n',
  },
  {
    name: '12-code-block-deep-nest',
    doc:
      '- outer\n  - inner\n    ```python\n    def foo():\n        return 1\n    ```\n  - sibling\n',
  },
  {
    name: '13-mixed-tasks-bullets',
    doc:
      '- regular bullet\n  - [ ] nested task\n    - deeper bullet\n      - [x] deep done\n',
  },
  {
    name: '14-empty-list-items',
    doc: '- \n  - \n    - third has text\n',
  },
  {
    name: '15-long-wrap',
    doc:
      '- this is a single bullet whose text is intentionally long enough to wrap onto a second visual line so that we can verify the hanging-indent CSS keeps the wrapped continuation aligned under the bullet text rather than under the bullet itself or the line edge\n',
  },
  {
    name: '16-long-task-wrap',
    doc:
      '- [ ] this is a single task whose text is intentionally long enough to wrap onto a second visual line so we can verify the wrapped continuation aligns under the task text rather than under the checkbox\n',
    // Cursor 50: deep inside the task text so the checkbox widget is
    // rendered (not the revealed `- [ ]` source).
    cursorPositions: [50],
  },
  {
    name: '17-continuation-paragraphs',
    doc:
      '- first item with a long line\n  and an explicit continuation paragraph that should align under the first letter of "first"\n- next item\n  - nested\n    with its own continuation that should align under the first letter of "nested"\n',
  },
];

test.describe('list rendering screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS);
    await page.waitForFunction(() => typeof window.mountEditor === 'function');
  });

  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await page.evaluate(
        ({ doc, label }) => window.mountEditor(doc, label),
        { doc: c.doc, label: c.name },
      );
      const editor = page.locator('.cm-editor');
      await expect(editor).toBeVisible();
      // Default screenshot: no specific cursor position.
      await page.screenshot({
        path: `test-results/screenshots/${c.name}.png`,
        clip: await page.locator('body').boundingBox().then((b) => b!),
      });

      for (const pos of c.cursorPositions ?? []) {
        await page.evaluate((p) => window.moveCursor(p), pos);
        await page.screenshot({
          path: `test-results/screenshots/${c.name}_cursor-${pos}.png`,
          clip: await page.locator('body').boundingBox().then((b) => b!),
        });
      }
    });
  }
});
