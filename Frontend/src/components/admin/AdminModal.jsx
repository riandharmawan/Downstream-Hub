import { useEffect, useRef } from 'react';

/**
 * AdminModal — accessible overlay wrapper.
 * Provides: role="dialog", aria-modal, focus trap (first focusable child), Escape to close.
 *
 * Props:
 *   onClose  — () => void — called on Escape or backdrop click
 *   wide     — bool — wider modal (700px) for tables/history
 *   children — modal content
 */
export default function AdminModal({ onClose, wide = false, children }) {
  const contentRef = useRef(null);

  // Focus first focusable element on mount
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) focusable[0].focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      style={overlayStyle}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={{ ...contentStyle, maxWidth: wide ? 700 : 480 }}
      >
        {children}
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
  padding: 'var(--space-3)',
};

const contentStyle = {
  background: 'var(--color-bg-white)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-4)',
  width: '100%',
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
};
