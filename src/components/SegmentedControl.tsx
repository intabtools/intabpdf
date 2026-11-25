import { useId, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { getNextSegmentIndex } from './segmentedControlUtils';
import type { SegmentedControlOption } from './segmentedControlUtils';

export type { SegmentedControlOption };

export interface SegmentedControlProps<T extends string | number = string> {
  /** Accessible label for the radio group */
  ariaLabel?: string;
  /** Element ID providing the accessible label */
  ariaLabelledBy?: string;
  /** Optional visible label rendered above the control */
  label?: ReactNode;
  /** Array of selectable radio options */
  options: SegmentedControlOption<T>[];
  /** Currently selected value */
  value: T;
  /** Callback fired when the selection changes */
  onChange: (value: T) => void;
  /** Whether the entire control is disabled */
  disabled?: boolean;
  /** Size variant: 'sm' (compact visual with expanded 44px hit area) or 'md' (default, 44px) */
  size?: 'sm' | 'md';
  /** Grid column count for 2D option layouts (e.g. 2 for 2x2 grid) */
  columns?: number;
  /** Whether the control spans 100% of its container width. Defaults to true. */
  fullWidth?: boolean;
  /** Optional container class name */
  className?: string;
  /** Optional inline styles on the container */
  style?: CSSProperties;
  /** Optional prefix for button IDs */
  idPrefix?: string;
}

export default function SegmentedControl<T extends string | number = string>({
  ariaLabel,
  ariaLabelledBy,
  label,
  options,
  value,
  onChange,
  disabled = false,
  size = 'md',
  columns,
  fullWidth = true,
  className = '',
  style,
  idPrefix,
}: SegmentedControlProps<T>): ReactNode {
  const generatedId = useId();
  const labelId = ariaLabelledBy || (label ? `segmented-label-${generatedId}` : undefined);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Determine the tab-reachable active focus index among enabled options
  const selectedEnabledIndex = options.findIndex(
    (opt) => opt.value === value && !opt.disabled && !disabled
  );
  const firstEnabledIndex = options.findIndex((opt) => !opt.disabled && !disabled);
  const activeFocusIndex =
    selectedEnabledIndex !== -1 ? selectedEnabledIndex : firstEnabledIndex;

  const selectOption = (index: number) => {
    const target = options[index];
    if (!target || target.disabled || disabled) return;
    buttonRefs.current[index]?.focus();
    if (target.value !== value) {
      onChange(target.value);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (disabled) return;

    let targetIndex = -1;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        targetIndex = getNextSegmentIndex(currentIndex, 'next', options, {
          disabled,
          columns,
        });
        break;

      case 'ArrowLeft':
        e.preventDefault();
        targetIndex = getNextSegmentIndex(currentIndex, 'prev', options, {
          disabled,
          columns,
        });
        break;

      case 'ArrowDown':
        e.preventDefault();
        targetIndex = getNextSegmentIndex(currentIndex, 'down', options, {
          disabled,
          columns,
        });
        break;

      case 'ArrowUp':
        e.preventDefault();
        targetIndex = getNextSegmentIndex(currentIndex, 'up', options, {
          disabled,
          columns,
        });
        break;

      case 'Home':
        e.preventDefault();
        targetIndex = options.findIndex((opt) => !opt.disabled && !disabled);
        break;

      case 'End':
        e.preventDefault();
        for (let i = options.length - 1; i >= 0; i--) {
          if (!options[i].disabled && !disabled) {
            targetIndex = i;
            break;
          }
        }
        break;

      case ' ':
      case 'Enter':
        e.preventDefault();
        selectOption(currentIndex);
        return;

      default:
        return;
    }

    if (targetIndex !== -1 && targetIndex !== currentIndex) {
      selectOption(targetIndex);
    }
  };

  const containerStyle: CSSProperties = {
    ...style,
    ...(columns && columns > 1
      ? {
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
        }
      : {}),
  };

  const containerClasses = [
    'segmented-control',
    size === 'sm' ? 'sm' : '',
    fullWidth ? 'full-width' : '',
    columns && columns > 1 ? 'grid' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: fullWidth ? '100%' : 'auto' }}>
      {label && (
        <span id={labelId} style={{ fontSize: '13px', fontWeight: 600 }}>
          {label}
        </span>
      )}

      <div
        role="radiogroup"
        aria-label={ariaLabel}
        aria-labelledby={labelId}
        aria-orientation={columns && columns > 1 ? undefined : 'horizontal'}
        className={containerClasses}
        style={containerStyle}
      >
        {options.map((option, index) => {
          const isSelected = option.value === value;
          const isOptionDisabled = disabled || Boolean(option.disabled);

          const tabIndex = isOptionDisabled || index !== activeFocusIndex ? -1 : 0;

          const buttonClasses = [
            'segmented-control-item',
            isSelected ? 'active' : '',
            isOptionDisabled ? 'disabled' : '',
          ]
            .filter(Boolean)
            .join(' ');

          const buttonId = idPrefix ? `${idPrefix}-${String(option.value)}` : undefined;

          return (
            <button
              key={String(option.value)}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              id={buttonId}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={option.ariaLabel}
              title={option.title}
              tabIndex={tabIndex}
              disabled={isOptionDisabled}
              className={buttonClasses}
              onClick={() => selectOption(index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
