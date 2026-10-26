// Configuration, presets, and metadata for PDF compression modes and targets.
import { Gauge, Sparkles, Zap } from 'lucide-react';
import type { CompressionPreset } from '../../../core';

export type CompressionMode = 'recommended' | 'smaller' | 'high-quality' | 'target';

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

export interface PresetCardInfo {
  id: CompressionMode;
  corePreset?: CompressionPreset;
  name: string;
  badge: string;
  icon: typeof Gauge;
  description: string;
  details: string;
  tradeoff: string;
  strategySummary: string;
}

export const PRESET_CARDS: PresetCardInfo[] = [
  {
    id: 'recommended',
    corePreset: 'recommended',
    name: 'Recommended',
    badge: 'Balanced',
    icon: Gauge,
    description: 'Optimal size-to-quality balance for everyday documents',
    details:
      'Re-encodes photos at 70% JPEG quality and downsamples oversized images above 1600px. Text, fonts, links, and vector graphics remain crisp.',
    tradeoff: 'Preserves text and vector sharpness. Minor photo compression.',
    strategySummary: '70% photo quality • Downsample > 1600px • Text & vectors crisp',
  },
  {
    id: 'smaller',
    corePreset: 'smaller',
    name: 'Smaller file',
    badge: 'Smallest',
    icon: Zap,
    description: 'Stronger compression for email and strict upload limits',
    details:
      'Aggressively compresses photos at 50% JPEG quality and downsizes images above 1024px. Maximizes space savings for portals with low file size limits.',
    tradeoff: 'Visible image compression trade-off for maximum size savings.',
    strategySummary: '50% photo quality • Downsample > 1024px • Maximum size savings',
  },
  {
    id: 'high-quality',
    corePreset: 'high-quality',
    name: 'High quality',
    badge: 'Fidelity',
    icon: Sparkles,
    description: 'Prioritizes readability and photographic fidelity',
    details:
      'Packs cross-reference tables and streams without downsampling photos. Preserves 100% of original photo resolution and details.',
    tradeoff: 'No image downsampling. Maximum visual fidelity.',
    strategySummary: '85% photo quality • 100% photo dimensions • Lossless stream packing',
  },
];

export const PRESET_CONFIG: Record<
  string,
  {
    name: string;
    badge: string;
    icon: typeof Zap;
    description: string;
    details: string;
    tradeoff: string;
    strategySummary: string;
  }
> = {
  recommended: PRESET_CARDS[0],
  balanced: PRESET_CARDS[0],
  smaller: PRESET_CARDS[1],
  strong: PRESET_CARDS[1],
  'high-quality': PRESET_CARDS[2],
  light: PRESET_CARDS[2],
};
