import { describe, expect, it, vi, beforeEach } from 'vitest';

const setKeepScreenAwakePluginMock = vi.fn().mockResolvedValue(undefined);
let platformMock: 'android' | 'web' | 'electron' = 'web';
let isNativeMock = false;

vi.mock('./index', () => ({
  getPlatformType: () => platformMock,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativeMock,
  },
  registerPlugin: () => ({
    setKeepScreenAwake: setKeepScreenAwakePluginMock,
  }),
}));

describe('screenAwake platform bridge', () => {
  beforeEach(() => {
    setKeepScreenAwakePluginMock.mockClear();
  });

  it('is a no-op on Web and Electron platforms', async () => {
    const { setKeepScreenAwake } = await import('./screenAwake');

    platformMock = 'web';
    isNativeMock = false;
    await setKeepScreenAwake(true);

    platformMock = 'electron';
    isNativeMock = false;
    await setKeepScreenAwake(true);

    expect(setKeepScreenAwakePluginMock).not.toHaveBeenCalled();
  });

  it('invokes Android ScreenAwake plugin only on native Android runtime', async () => {
    const { setKeepScreenAwake } = await import('./screenAwake');

    platformMock = 'android';
    isNativeMock = true;

    await setKeepScreenAwake(true);
    await setKeepScreenAwake(false);

    expect(setKeepScreenAwakePluginMock).toHaveBeenNthCalledWith(1, {
      active: true,
      token: 'web_processing',
    });
    expect(setKeepScreenAwakePluginMock).toHaveBeenNthCalledWith(2, {
      active: false,
      token: 'web_processing',
    });
  });
});
