// Android-only screen-awake bridge for foreground PDF processing operations.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getPlatformType } from './index';

interface ScreenAwakePlugin {
  setKeepScreenAwake(options: { active: boolean; token?: string }): Promise<void>;
}

const ScreenAwake = registerPlugin<ScreenAwakePlugin>('ScreenAwake');

function isAndroidNativeRuntime(): boolean {
  return getPlatformType() === 'android' && Capacitor.isNativePlatform();
}

export async function setKeepScreenAwake(active: boolean, token = 'web_processing'): Promise<void> {
  if (!isAndroidNativeRuntime()) {
    return;
  }
  try {
    await ScreenAwake.setKeepScreenAwake({ active, token });
  } catch {
    // Non-fatal: web builds or test mocks without plugin registration must stay resilient.
  }
}
