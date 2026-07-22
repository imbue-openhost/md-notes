import { describe, expect, it } from 'vitest';
import { awarenessUser } from './sync';

describe('awarenessUser', () => {
  it('carries the name and derives deterministic colors', () => {
    const a = awarenessUser('zack');
    expect(a.name).toBe('zack');
    expect(a).toEqual(awarenessUser('zack'));
    expect(a.color).toMatch(/^hsl\(\d+, 65%, 45%\)$/);
    expect(a.colorLight).toMatch(/^hsla\(\d+, 65%, 45%, 0\.3\)$/);
  });

  it('gives different names different hues (usually)', () => {
    expect(awarenessUser('alice').color).not.toBe(awarenessUser('bob').color);
  });
});
