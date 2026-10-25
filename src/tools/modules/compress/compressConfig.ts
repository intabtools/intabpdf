// Configuration, presets, and metadata for PDF compression modes and targets.
import { Gauge, Sparkles, Zap } from 'lucide-react';
import type { CompressionPreset } from '../../../core';

export interface TargetPreset {
  label: string;
  value: string;
  unit: 'KB' | 'MB';
  bytes: number;
}

export const TARGET_PRESETS: TargetPreset[] = [
  { label: '100 KB', value: '100', unit: 'KB', bytes: 100 * 1024 },
  { label: '200 KB', value: '200', unit: 'KB', bytes: 200 * 1024 },
  { label: '500 KB', value: '500', unit: 'KB', bytes: 500 * 1024 },
  { label: '1 MB', value: '1', unit: 'MB', bytes: 1024 * 1024 },
  { label: '2 MB', value: '2', unit: 'MB', bytes: 2 * 1024 * 1024 },
];

export const PRESET_CONFIG: Record<
  CompressionPreset,
  {
    name: string;
    badge: string;
    icon: typeof Zap;
    description: string;
    details: string;
  }
> = {
  light: {
    name: 'Light',
    badge: 'Lossless',
    icon: Sparkles,
    description: 'Compresses PDF structure & streams',
    details: 'Packs cross-reference tables and streams. 100% original photo resolution preserved.',
  },
  balanced: {
    name: 'Balanced',
    badge: 'Recommended',
    icon: Gauge,
    description: 'Optimal size-to-quality balance',
    details: 'Re-encodes photos at 70% quality, downsamples above 1600px. Text and vectors remain crisp.',
  },
  strong: {
    name: 'Strong',
    badge: 'Smallest',
    icon: Zap,
    description: 'Maximum file size reduction',
    details: 'Aggressively compresses photos at 50% quality, downsamples above 1024px. Ideal for email limits.',
  },
};
