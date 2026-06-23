import { useState, useRef, useEffect, useId } from 'react';

/**
 * MultiSelectDropdown — checkbox list in a popover, styled with KPN design tokens.
 *
 * Props:
 *   options          — array of { id, label }
 *   selected         — array of selected ids (controlled)
 *   onChange         — (newSelectedIds: string[]) => void
 *   placeholder      — label when nothing is selected (default "All")
 *   includeAllOption — show an "All / none selected = include all" affordance (for filter use case)
 *   includeGlobal    — boolean (only relevant when includeAllOption=true)
 *   onIncludeGlobalChange — (bool) => void
 *   disabled         — bool
 *   style            — optional style overrides for the trigger button
 */
export default function MultiSelectDropdown({
  options = [],
  selected = [],
  onChange,
  placeholder = 'All',
  includeAllOption = false,
  includeGlobal = false,
  onIncludeGlobalChange,
  disabled = false,
  style,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const triggerId = useId();
  const panelId = useId();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // Focus first checkbox when panel opens
  useEffect(() => {
    if (open && panelRef.current) {
      const first = panelRef.current.querySelector('input[type="checkbox"]');
      if (first) first.focus();
    }
  }, [open]);

  function toggleOption(id) {
    const next = selected.includes(id)
      ? selected.filter((s) => s !== id)
      : [...selected, id];
    onChange(next);
  }

  function selectAll() {
    onChange(options.map((o) => o.id));
  }

  function clearAll() {
    onChange([]);
  }

  // Trigger label
  let triggerLabel;
  if (selected.length === 0) {
    triggerLabel = placeholder;
  } else if (selected.length === options.length) {
    triggerLabel = 'All BUs';
  } else {
    triggerLabel = `${selected.length} BU${selected.length === 1 ? '' : 's'} selected`;
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block', ...style }}>
      <button
        id={triggerId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '6px var(--space-3)',
          background: 'var(--color-bg-white)',
          border: '1px solid var(--color-border-medium)',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-primary)',
          fontSize: '0.875rem',
          fontWeight: 'var(--font-weight-normal)',
          color: selected.length > 0 ? 'var(--color-text-charcoal)' : 'var(--color-text-steel)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          whiteSpace: 'nowrap',
          minWidth: 140,
        }}
      >
        <span style={{ flex: 1, textAlign: 'left' }}>{triggerLabel}</span>
        <span aria-hidden="true" style={{ fontSize: '0.75rem', color: 'var(--color-text-steel)' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          ref={panelRef}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={triggerId}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 100,
            background: 'var(--color-bg-white)',
            border: '1px solid var(--color-border-light)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            minWidth: 220,
            maxHeight: 280,
            overflowY: 'auto',
            padding: 'var(--space-2) 0',
          }}
        >
          {/* Select all / Clear controls */}
          <div style={{
            display: 'flex',
            gap: 'var(--space-2)',
            padding: `var(--space-1) var(--space-3)`,
            borderBottom: '1px solid var(--color-border-light)',
            marginBottom: 'var(--space-1)',
          }}>
            <button
              type="button"
              onClick={selectAll}
              style={linkBtnStyle}
            >
              Select all
            </button>
            <span style={{ color: 'var(--color-border-medium)' }}>·</span>
            <button
              type="button"
              onClick={clearAll}
              style={linkBtnStyle}
            >
              Clear
            </button>
          </div>

          {/* Include Global option — for table filter */}
          {includeAllOption && (
            <label style={itemStyle}>
              <input
                type="checkbox"
                checked={includeGlobal}
                onChange={(e) => onIncludeGlobalChange?.(e.target.checked)}
                style={{ marginRight: 'var(--space-2)', accentColor: 'var(--color-primary)' }}
              />
              <span style={{ color: 'var(--color-text-steel)', fontStyle: 'italic' }}>Include Global apps</span>
            </label>
          )}

          {options.length === 0 && (
            <div style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-steel)', fontSize: '0.875rem' }}>
              No options available
            </div>
          )}

          {options.map((opt) => (
            <label
              key={opt.id}
              role="option"
              aria-selected={selected.includes(opt.id)}
              style={itemStyle}
            >
              <input
                type="checkbox"
                checked={selected.includes(opt.id)}
                onChange={() => toggleOption(opt.id)}
                style={{ marginRight: 'var(--space-2)', accentColor: 'var(--color-primary)' }}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const linkBtnStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontFamily: 'var(--font-primary)',
  fontSize: '0.75rem',
  color: 'var(--color-primary)',
  cursor: 'pointer',
  fontWeight: 'var(--font-weight-medium)',
};

const itemStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: `var(--space-1) var(--space-3)`,
  cursor: 'pointer',
  fontSize: '0.875rem',
  color: 'var(--color-text-charcoal)',
  fontFamily: 'var(--font-primary)',
  userSelect: 'none',
  lineHeight: '1.6',
};
