import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import SegmentedControl from './SegmentedControl';
import { getNextSegmentIndex } from './segmentedControlUtils';

describe('SegmentedControl Component Unit & Accessibility Tests', () => {
  const sampleOptions = [
    { value: 'png', label: 'PNG' },
    { value: 'jpeg', label: 'JPEG' },
    { value: 'webp', label: 'WebP' },
  ];

  it('renders with initial selected value, role="radiogroup", and aria-checked attributes', () => {
    const html = renderToString(
      <SegmentedControl
        ariaLabel="Image format"
        options={sampleOptions}
        value="png"
        onChange={() => {}}
      />
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Image format"');
    expect(html).toContain('aria-orientation="horizontal"');

    // PNG is selected
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('class="segmented-control-item active"');

    // Others are unselected
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('class="segmented-control-item"');
  });

  it('renders visible label and links aria-labelledby attribute', () => {
    const html = renderToString(
      <SegmentedControl
        label="Page Orientation"
        options={[
          { value: 'portrait', label: 'Portrait' },
          { value: 'landscape', label: 'Landscape' },
        ]}
        value="portrait"
        onChange={() => {}}
      />
    );

    expect(html).toContain('Page Orientation');
    expect(html).toContain('aria-labelledby="segmented-label-');
    expect(html).toContain('id="segmented-label-');
  });

  it('supports size="sm" compact variant', () => {
    const html = renderToString(
      <SegmentedControl
        ariaLabel="Compact options"
        size="sm"
        options={sampleOptions}
        value="webp"
        onChange={() => {}}
      />
    );

    expect(html).toContain('class="segmented-control sm full-width"');
  });

  it('supports 2D grid layout with columns prop', () => {
    const gridOptions = [
      { value: 'br', label: 'Bottom Right' },
      { value: 'bl', label: 'Bottom Left' },
      { value: 'bc', label: 'Bottom Center' },
      { value: 'tr', label: 'Top Right' },
    ];

    const html = renderToString(
      <SegmentedControl
        ariaLabel="Position grid"
        columns={2}
        options={gridOptions}
        value="br"
        onChange={() => {}}
      />
    );

    expect(html).toContain('class="segmented-control full-width grid"');
    expect(html).toContain('grid-template-columns:repeat(2, 1fr)');
    expect(html).not.toContain('aria-orientation="horizontal"');
  });

  it('disables individual options and falls back tabIndex="0" if current value is disabled', () => {
    const optionsWithDisabled = [
      { value: 'opt1', label: 'Option 1', disabled: true },
      { value: 'opt2', label: 'Option 2' },
      { value: 'opt3', label: 'Option 3' },
    ];

    const html = renderToString(
      <SegmentedControl
        ariaLabel="Disabled option fallback test"
        options={optionsWithDisabled}
        value="opt1"
        onChange={() => {}}
      />
    );

    expect(html).toContain('class="segmented-control-item active disabled"');
    expect(html).toContain('disabled=""');
    // Option 2 (first enabled option) must receive tabIndex="0" so group stays keyboard reachable
    expect(html).toContain('tabindex="0"');
  });

  it('disables all buttons when entire control is disabled', () => {
    const html = renderToString(
      <SegmentedControl
        disabled
        ariaLabel="All disabled test"
        options={sampleOptions}
        value="png"
        onChange={() => {}}
      />
    );

    const disabledMatches = html.match(/disabled=""/g);
    expect(disabledMatches).toHaveLength(3);

    const tabindexMatches = html.match(/tabindex="-1"/g);
    expect(tabindexMatches).toHaveLength(3);
  });

  it('supports multiple independent instances on the same page', () => {
    const html = renderToString(
      <div>
        <SegmentedControl
          ariaLabel="Format group"
          options={sampleOptions}
          value="png"
          onChange={() => {}}
        />
        <SegmentedControl
          ariaLabel="Orientation group"
          options={[
            { value: 'p', label: 'Portrait' },
            { value: 'l', label: 'Landscape' },
          ]}
          value="l"
          onChange={() => {}}
        />
      </div>
    );

    expect(html).toContain('aria-label="Format group"');
    expect(html).toContain('aria-label="Orientation group"');
    expect(html).toContain('PNG');
    expect(html).toContain('Landscape');
  });

  describe('Keyboard navigation index calculation (getNextSegmentIndex)', () => {
    it('steps forward with wrap-around from last to first', () => {
      expect(getNextSegmentIndex(0, 'next', sampleOptions)).toBe(1);
      expect(getNextSegmentIndex(1, 'next', sampleOptions)).toBe(2);
      expect(getNextSegmentIndex(2, 'next', sampleOptions)).toBe(0);
    });

    it('steps backward with wrap-around from first to last', () => {
      expect(getNextSegmentIndex(0, 'prev', sampleOptions)).toBe(2);
      expect(getNextSegmentIndex(2, 'prev', sampleOptions)).toBe(1);
      expect(getNextSegmentIndex(1, 'prev', sampleOptions)).toBe(0);
    });

    it('skips disabled options when stepping forward or backward in 1D', () => {
      const optionsWithDisabled = [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', disabled: true },
        { value: 'c', label: 'C' },
      ];

      expect(getNextSegmentIndex(0, 'next', optionsWithDisabled)).toBe(2);
      expect(getNextSegmentIndex(2, 'prev', optionsWithDisabled)).toBe(0);
    });

    it('steps vertically by columns in 2D grid layouts', () => {
      const gridOptions = [
        { value: '0', label: '0' },
        { value: '1', label: '1' },
        { value: '2', label: '2' },
        { value: '3', label: '3' },
      ];

      expect(getNextSegmentIndex(0, 'down', gridOptions, { columns: 2 })).toBe(2);
      expect(getNextSegmentIndex(1, 'down', gridOptions, { columns: 2 })).toBe(3);
      expect(getNextSegmentIndex(2, 'up', gridOptions, { columns: 2 })).toBe(0);
      expect(getNextSegmentIndex(3, 'up', gridOptions, { columns: 2 })).toBe(1);
    });

    it('navigates 2D grid properly when target column cell is disabled', () => {
      // [0] [1]
      // [2:disabled] [3]
      const gridWithDisabled = [
        { value: '0', label: '0' },
        { value: '1', label: '1' },
        { value: '2', label: '2', disabled: true },
        { value: '3', label: '3' },
      ];

      // Pressing down from 0 skips disabled 2 and lands on enabled 3 in row 1
      expect(getNextSegmentIndex(0, 'down', gridWithDisabled, { columns: 2 })).toBe(3);
      // Pressing up from 2? What if from 3 -> up lands on 1 (same col)
      expect(getNextSegmentIndex(3, 'up', gridWithDisabled, { columns: 2 })).toBe(1);

      // Diagonal disabled: [0] [1:disabled] / [2:disabled] [3]
      const diagonalDisabled = [
        { value: '0', label: '0' },
        { value: '1', label: '1', disabled: true },
        { value: '2', label: '2', disabled: true },
        { value: '3', label: '3' },
      ];
      expect(getNextSegmentIndex(0, 'down', diagonalDisabled, { columns: 2 })).toBe(3);
      expect(getNextSegmentIndex(3, 'up', diagonalDisabled, { columns: 2 })).toBe(0);
    });

    it('prefers same-column enabled cell in multi-row 2D grids with disabled intermediate cell', () => {
      // [0] [1]
      // [2:disabled] [3]
      // [4] [5]
      const sixOptions = [
        { value: '0', label: '0' },
        { value: '1', label: '1' },
        { value: '2', label: '2', disabled: true },
        { value: '3', label: '3' },
        { value: '4', label: '4' },
        { value: '5', label: '5' },
      ];
      expect(getNextSegmentIndex(0, 'down', sixOptions, { columns: 2 })).toBe(4);
      expect(getNextSegmentIndex(4, 'up', sixOptions, { columns: 2 })).toBe(0);
    });

    it('handles ragged 2D grid with missing bottom-right cell', () => {
      // [0] [1]
      // [2]
      const raggedGrid = [
        { value: '0', label: '0' },
        { value: '1', label: '1' },
        { value: '2', label: '2' },
      ];
      expect(getNextSegmentIndex(1, 'down', raggedGrid, { columns: 2 })).toBe(2);
      expect(getNextSegmentIndex(2, 'down', raggedGrid, { columns: 2 })).toBe(0);
    });

    it('returns currentIndex if all options are disabled or control is disabled', () => {
      const allDisabled = [
        { value: '1', label: '1', disabled: true },
        { value: '2', label: '2', disabled: true },
      ];

      expect(getNextSegmentIndex(0, 'next', allDisabled)).toBe(0);
      expect(getNextSegmentIndex(0, 'next', sampleOptions, { disabled: true })).toBe(0);
    });
  });
});
