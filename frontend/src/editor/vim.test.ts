import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Vim, type CodeMirrorV, type MotionArgs, type Pos, type vimState } from '@replit/codemirror-vim';
import { parseVimrc, applyMappings, moveByDisplayLines, type VimMapping } from './vim';

describe('parseVimrc: easyclip-style d/m remapping', () => {
  // Normal-mode m/mm are handled via Vim.mapCommand in vimMode(), not vimrc
  const EASYCLIP_VIMRC = [
    'nnoremap d "_d',
    'xnoremap d "_d',
    'nnoremap dd "_dd',
    'nnoremap D "_D',
    'xnoremap D "_D',
    'nnoremap x "_x',
    'xnoremap x "_x',
    'xnoremap m d',
  ].join('\n');

  it('parses d → black-hole delete mappings', () => {
    const result = parseVimrc(EASYCLIP_VIMRC);
    const dNormal = result.mappings.find((m) => m.lhs === 'd' && m.context === 'normal');
    expect(dNormal).toBeDefined();
    expect(dNormal!.rhs).toBe('"_d');
    expect(dNormal!.noremap).toBe(true);
  });

  it('parses dd → black-hole delete-line mapping', () => {
    const result = parseVimrc(EASYCLIP_VIMRC);
    const dd = result.mappings.find((m) => m.lhs === 'dd' && m.context === 'normal');
    expect(dd).toBeDefined();
    expect(dd!.rhs).toBe('"_dd');
    expect(dd!.noremap).toBe(true);
  });

  it('does not include normal-mode m/mm (handled via mapCommand)', () => {
    const result = parseVimrc(EASYCLIP_VIMRC);
    const mNormal = result.mappings.find((m) => m.lhs === 'm' && m.context === 'normal');
    const mmNormal = result.mappings.find((m) => m.lhs === 'mm' && m.context === 'normal');
    expect(mNormal).toBeUndefined();
    expect(mmNormal).toBeUndefined();
  });

  it('parses visual-mode d and m mappings', () => {
    const result = parseVimrc(EASYCLIP_VIMRC);
    const dVisual = result.mappings.find((m) => m.lhs === 'd' && m.context === 'visual');
    const mVisual = result.mappings.find((m) => m.lhs === 'm' && m.context === 'visual');
    expect(dVisual).toBeDefined();
    expect(dVisual!.rhs).toBe('"_d');
    expect(mVisual).toBeDefined();
    expect(mVisual!.rhs).toBe('d');
  });

  it('produces no parse errors', () => {
    const result = parseVimrc(EASYCLIP_VIMRC);
    expect(result.errors).toEqual([]);
  });
});

describe('applyMappings: built-in key unmapping', () => {
  let unmapSpy: ReturnType<typeof vi.fn>;
  let noremapSpy: ReturnType<typeof vi.fn>;
  let mapSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    unmapSpy = vi.fn();
    noremapSpy = vi.fn();
    mapSpy = vi.fn();
    vi.spyOn(Vim, 'unmap' as any).mockImplementation(unmapSpy);
    vi.spyOn(Vim, 'noremap').mockImplementation(noremapSpy as any);
    vi.spyOn(Vim, 'map').mockImplementation(mapSpy as any);
  });

  function mapping(lhs: string, rhs: string, ctx = 'normal', noremap = true): VimMapping {
    return { lhs, rhs, context: ctx, noremap };
  }

  it('unmaps m when m and mm are both mapped', () => {
    applyMappings([mapping('m', 'd'), mapping('mm', 'dd')]);
    expect(unmapSpy).toHaveBeenCalledWith('m');
  });

  it('does NOT unmap operator keys like d even when dd is also mapped', () => {
    applyMappings([mapping('d', '"_d'), mapping('dd', '"_dd')]);
    const unmappedKeys = unmapSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(unmappedKeys).not.toContain('d');
  });

  it('does NOT unmap c, y, or other native operators used as prefixes', () => {
    applyMappings([
      mapping('c', '"_c'),
      mapping('cc', '"_cc'),
      mapping('y', '"_y'),
      mapping('yy', '"_yy'),
    ]);
    const unmappedKeys = unmapSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(unmappedKeys).not.toContain('c');
    expect(unmappedKeys).not.toContain('y');
  });

  it('unmaps the leader key when it prefixes a multi-char mapping', () => {
    applyMappings([mapping(',x', ':toggletask<CR>')], ',');
    expect(unmapSpy).toHaveBeenCalledWith(',');
  });

  it('does NOT unmap a single-char key that has no multi-char extension', () => {
    applyMappings([mapping('m', 'd')]);
    const unmappedKeys = unmapSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(unmappedKeys).not.toContain('m');
  });

  it('calls noremap for noremap mappings and map for non-noremap', () => {
    applyMappings([
      mapping('m', 'd', 'normal', true),
      { lhs: 'za', rhs: ':togglefold<CR>', context: 'normal', noremap: false },
    ]);
    expect(noremapSpy).toHaveBeenCalledWith('m', 'd', 'normal');
    expect(mapSpy).toHaveBeenCalledWith('za', ':togglefold<CR>', 'normal');
  });

  it('handles the full easyclip vimrc without unmapping d or x', () => {
    // Normal-mode m/mm are handled via mapCommand, not vimrc
    const mappings = [
      mapping('d', '"_d', 'normal'),
      mapping('d', '"_d', 'visual'),
      mapping('dd', '"_dd', 'normal'),
      mapping('D', '"_D', 'normal'),
      mapping('D', '"_D', 'visual'),
      mapping('x', '"_x', 'normal'),
      mapping('x', '"_x', 'visual'),
      mapping('m', 'd', 'visual'),
    ];
    applyMappings(mappings, ',');

    const unmappedKeys = unmapSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(unmappedKeys).not.toContain('d');
    expect(unmappedKeys).not.toContain('x');
    expect(unmappedKeys).not.toContain('D');
    expect(unmappedKeys).not.toContain('m');
  });

  it('does NOT unmap j when j (normal) and jk (insert) are in different contexts', () => {
    applyMappings([
      mapping('j', 'gj', 'normal'),
      mapping('k', 'gk', 'normal'),
      mapping('jk', '<Esc>', 'insert'),
    ]);
    const unmappedKeys = unmapSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(unmappedKeys).not.toContain('j');
    expect(unmappedKeys).not.toContain('k');
  });
});

describe('moveByDisplayLines: gj/gk without the hitSide coords fallback', () => {
  function makeVimState(overrides: Partial<vimState> = {}): vimState {
    return { lastMotion: null, lastHSPos: 0, lastHPos: 0, ...overrides } as vimState;
  }

  function makeCm(findPosVResult: Pos & { hitSide?: boolean }, charLeft = 42) {
    return {
      charCoords: vi.fn().mockReturnValue({ left: charLeft, top: 100, bottom: 116 }),
      findPosV: vi.fn().mockReturnValue(findPosVResult),
      coordsChar: vi.fn(),
    } as unknown as CodeMirrorV;
  }

  const args = (forward: boolean, repeat = 1) => ({ forward, repeat }) as MotionArgs;

  it('gj at the end of the document stays put instead of jumping to the top', () => {
    // findPosV clips to the doc edge and reports hitSide; the buggy built-in
    // then re-derived the position via coordsChar, landing at offset 0.
    const head: Pos = { line: 9, ch: 5 };
    const cm = makeCm({ line: 9, ch: 5, hitSide: true });
    const res = moveByDisplayLines(cm, head, args(true), makeVimState());
    expect(res).toMatchObject({ line: 9, ch: 5 });
    expect((cm as any).coordsChar).not.toHaveBeenCalled();
  });

  it('gk at the start of the document returns the clamped position', () => {
    const cm = makeCm({ line: 0, ch: 0, hitSide: true });
    const res = moveByDisplayLines(cm, { line: 0, ch: 3 }, args(false), makeVimState());
    expect(res).toMatchObject({ line: 0, ch: 0 });
    expect((cm as any).coordsChar).not.toHaveBeenCalled();
  });

  it('returns findPosV result for a normal downward move and records lastHPos', () => {
    const cm = makeCm({ line: 3, ch: 7 });
    const vimState = makeVimState();
    const res = moveByDisplayLines(cm, { line: 2, ch: 7 }, args(true), vimState);
    expect(res).toMatchObject({ line: 3, ch: 7 });
    expect(vimState.lastHPos).toBe(7);
  });

  it('resets lastHSPos from the cursor when the previous motion was not vertical', () => {
    const cm = makeCm({ line: 1, ch: 0 }, 55);
    const vimState = makeVimState({ lastHSPos: 999 });
    moveByDisplayLines(cm, { line: 0, ch: 0 }, args(true), vimState);
    expect(vimState.lastHSPos).toBe(55);
    expect((cm as any).findPosV).toHaveBeenCalledWith({ line: 0, ch: 0 }, 1, 'line', 55);
  });

  it('preserves lastHSPos across consecutive vertical motions', () => {
    const motions: Record<string, unknown> = {};
    const vimState = makeVimState({ lastHSPos: 123 });
    vimState.lastMotion = moveByDisplayLines as never;
    motions.moveByDisplayLines = vimState.lastMotion;
    const cm = makeCm({ line: 2, ch: 0 }, 55);
    moveByDisplayLines.call(motions, cm, { line: 1, ch: 0 }, args(true), vimState);
    expect(vimState.lastHSPos).toBe(123);
    expect((cm as any).charCoords).not.toHaveBeenCalled();
  });

  it('is registered as the moveByDisplayLines motion by vimMode()', async () => {
    const defineMotionSpy = vi.spyOn(Vim, 'defineMotion');
    const { vimMode } = await import('./vim');
    vimMode();
    expect(defineMotionSpy).toHaveBeenCalledWith('moveByDisplayLines', moveByDisplayLines);
  });
});
