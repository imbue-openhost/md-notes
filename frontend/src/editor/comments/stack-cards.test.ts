import { describe, expect, it } from 'vitest';
import { stackCards } from './stack-cards';

const e = (id: string, desired: number, height: number) => ({ id, desired, height });

describe('stackCards', () => {
  it('leaves spread-out cards at their anchors', () => {
    const tops = stackCards([e('a', 100, 50), e('b', 400, 50), e('c', 900, 50)], null);
    expect([...tops.values()]).toEqual([100, 400, 900]);
  });

  it('pushes overlapping cards downward with a gap', () => {
    const tops = stackCards([e('a', 100, 80), e('b', 110, 80), e('c', 120, 80)], null, 8, 4);
    expect(tops.get('a')).toBe(100);
    expect(tops.get('b')).toBe(188); // 100 + 80 + 8
    expect(tops.get('c')).toBe(276);
  });

  it('clamps the first card to the top margin', () => {
    const tops = stackCards([e('a', -20, 50)], null, 8, 4);
    expect(tops.get('a')).toBe(4);
  });

  it('pins the active card and pushes earlier cards up', () => {
    const tops = stackCards([e('a', 190, 80), e('b', 200, 80)], 'b', 8, 4);
    expect(tops.get('b')).toBe(200); // pinned exactly at its anchor
    expect(tops.get('a')).toBe(112); // 200 - 80 - 8
  });

  it('restacks downward when pinning would push cards past the top', () => {
    const tops = stackCards([e('a', 10, 80), e('b', 20, 80)], 'b', 8, 4);
    expect(tops.get('a')).toBe(4);
    expect(tops.get('b')).toBe(92); // couldn't hold 20; pushed below a
  });

  it('cards after the pinned one stack below it', () => {
    const tops = stackCards([e('a', 100, 80), e('b', 150, 80), e('c', 160, 80)], 'a', 8, 4);
    expect(tops.get('a')).toBe(100);
    expect(tops.get('b')).toBe(188);
    expect(tops.get('c')).toBe(276);
  });
});
