import { describe, expect, it } from 'vitest';
import { calculateDropIndex, reorderItems } from './reorder';

describe('reorderItems', () => {
  const sample = ['A', 'B', 'C', 'D'];

  it('moves an item forward in the array', () => {
    // Move A (0) to position 2
    expect(reorderItems(sample, 0, 2)).toEqual(['B', 'C', 'A', 'D']);
    // Move A (0) to end (3)
    expect(reorderItems(sample, 0, 3)).toEqual(['B', 'C', 'D', 'A']);
  });

  it('moves an item backward in the array', () => {
    // Move D (3) to position 1
    expect(reorderItems(sample, 3, 1)).toEqual(['A', 'D', 'B', 'C']);
    // Move D (3) to start (0)
    expect(reorderItems(sample, 3, 0)).toEqual(['D', 'A', 'B', 'C']);
  });

  it('returns original array when fromIndex === toIndex', () => {
    expect(reorderItems(sample, 1, 1)).toEqual(sample);
  });

  it('returns original array on invalid or out-of-bound indices', () => {
    expect(reorderItems(sample, -1, 2)).toEqual(sample);
    expect(reorderItems(sample, 0, 10)).toEqual(sample);
    expect(reorderItems(sample, 10, 0)).toEqual(sample);
  });

  it('does not mutate the input array', () => {
    const original = ['X', 'Y', 'Z'];
    const result = reorderItems(original, 0, 2);
    expect(original).toEqual(['X', 'Y', 'Z']);
    expect(result).toEqual(['Y', 'Z', 'X']);
  });
});

describe('calculateDropIndex', () => {
  it('handles dropping forward (fromIndex < targetIndex)', () => {
    // A (0) dropped before B (1) -> should stay at 0
    expect(calculateDropIndex(0, 1, 'before')).toBe(0);
    // A (0) dropped after B (1) -> should become index 1
    expect(calculateDropIndex(0, 1, 'after')).toBe(1);
    // A (0) dropped before C (2) -> should become index 1
    expect(calculateDropIndex(0, 2, 'before')).toBe(1);
    // A (0) dropped after C (2) -> should become index 2
    expect(calculateDropIndex(0, 2, 'after')).toBe(2);
  });

  it('handles dropping backward (fromIndex > targetIndex)', () => {
    // D (3) dropped before B (1) -> should become index 1
    expect(calculateDropIndex(3, 1, 'before')).toBe(1);
    // D (3) dropped after B (1) -> should become index 2
    expect(calculateDropIndex(3, 1, 'after')).toBe(2);
    // D (3) dropped before C (2) -> should become index 2
    expect(calculateDropIndex(3, 2, 'before')).toBe(2);
    // D (3) dropped after C (2) -> should stay at 3
    expect(calculateDropIndex(3, 2, 'after')).toBe(3);
  });

  it('handles dropping onto itself', () => {
    expect(calculateDropIndex(2, 2, 'before')).toBe(2);
    expect(calculateDropIndex(2, 2, 'after')).toBe(2);
  });
});
