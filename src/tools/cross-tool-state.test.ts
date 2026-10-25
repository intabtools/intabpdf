import { describe, expect, it } from 'vitest';
import { TOOLS, getToolById } from './registry';
import { getDefaultOutputBaseName, getOutputExtension } from './filename';
import type { StagedFile } from './types';

describe('Cross-tool state isolation', () => {
  it('ensures every tool route has a unique pathname key for ToolRouteGuard', () => {
    const routeKeys = TOOLS.map((t) => `/tool/${t.id}`);
    const uniqueKeys = new Set(routeKeys);
    expect(uniqueKeys.size).toBe(TOOLS.length);

    // Switching between any pair of tools must always yield a different key
    for (let i = 0; i < TOOLS.length; i++) {
      for (let j = i + 1; j < TOOLS.length; j++) {
        expect(`/tool/${TOOLS[i].id}`).not.toBe(`/tool/${TOOLS[j].id}`);
      }
    }
  });

  it('guarantees independent default options for each tool without leakage', () => {
    const rotate = getToolById('rotate');
    const merge = getToolById('merge');
    const compress = getToolById('compress');

    const rotateOpts: Record<string, boolean> = {};
    rotate?.options.forEach((opt) => {
      rotateOpts[opt.id] = opt.defaultValue;
    });

    const mergeOpts: Record<string, boolean> = {};
    merge?.options.forEach((opt) => {
      mergeOpts[opt.id] = opt.defaultValue;
    });

    const compressOpts: Record<string, boolean> = {};
    compress?.options.forEach((opt) => {
      compressOpts[opt.id] = opt.defaultValue;
    });

    expect(rotateOpts).toHaveProperty('cw', true);
    expect(mergeOpts).not.toHaveProperty('cw');
    expect(compressOpts).not.toHaveProperty('cw');
  });

  it('calculates independent default output filenames and extensions across tools', () => {
    const dummyFile: StagedFile = {
      id: 'doc-1',
      name: 'invoice.pdf',
      size: 1024,
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    };

    const rotateName = getDefaultOutputBaseName('rotate', [dummyFile]);
    const mergeName = getDefaultOutputBaseName('merge', [dummyFile]);
    const splitName = getDefaultOutputBaseName('split', [dummyFile]);

    expect(rotateName).toBe('rotated-invoice');
    expect(mergeName).toBe('merged-invoice');
    expect(splitName).toBe('split-invoice');

    const splitExt = getOutputExtension('split', 'split.zip');
    const rotateExt = getOutputExtension('rotate', 'rotated.pdf');

    expect(splitExt).toBe('.zip');
    expect(rotateExt).toBe('.pdf');
  });
});
