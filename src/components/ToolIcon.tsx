import {
  Code2,
  Eye,
  FileText,
  Image,
  Info,
  Layers,
  LayoutGrid,
  Lock,
  Minimize2,
  PenTool,
  RotateCw,
  Scissors,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface ToolIconProps {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export default function ToolIcon({
  name,
  size = 20,
  strokeWidth = 1.8,
  className,
}: ToolIconProps): ReactNode {
  switch (name) {
    case 'image':
      return <Image size={size} strokeWidth={strokeWidth} className={className} />;
    case 'type':
      return <FileText size={size} strokeWidth={strokeWidth} className={className} />;
    case 'layers':
      return <Layers size={size} strokeWidth={strokeWidth} className={className} />;
    case 'scissors':
      return <Scissors size={size} strokeWidth={strokeWidth} className={className} />;
    case 'grid':
      return <LayoutGrid size={size} strokeWidth={strokeWidth} className={className} />;
    case 'rotate':
      return <RotateCw size={size} strokeWidth={strokeWidth} className={className} />;
    case 'x':
      return <Trash2 size={size} strokeWidth={strokeWidth} className={className} />;
    case 'shrink':
      return <Minimize2 size={size} strokeWidth={strokeWidth} className={className} />;
    case 'lock':
      return <Lock size={size} strokeWidth={strokeWidth} className={className} />;
    case 'unlock':
      return <Unlock size={size} strokeWidth={strokeWidth} className={className} />;
    case 'pen':
      return <PenTool size={size} strokeWidth={strokeWidth} className={className} />;
    case 'text':
      return <FileText size={size} strokeWidth={strokeWidth} className={className} />;
    case 'eye':
      return <Eye size={size} strokeWidth={strokeWidth} className={className} />;
    case 'info':
      return <Info size={size} strokeWidth={strokeWidth} className={className} />;
    case 'code':
      return <Code2 size={size} strokeWidth={strokeWidth} className={className} />;
    default:
      return <FileText size={size} strokeWidth={strokeWidth} className={className} />;
  }
}
