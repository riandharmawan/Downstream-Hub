import { useState, useRef, useEffect } from 'react';
import { applicationInitials } from '../../utils/applicationInitials';
import { resolveIconSrc } from '../../utils/resolveIconSrc';

const FILE_ACCEPT = '.svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp';

/**
 * Preview-first icon picker: upload a file or enter a URL (one method at a time).
 */
export default function ApplicationIconField({
  iconUrl = '',
  appName = '',
  onIconUrlChange,
  onFileSelect,
  uploading = false,
  disabled = false,
}) {
  const [inputMode, setInputMode] = useState(null);
  const fileInputRef = useRef(null);
  const resolvedSrc = resolveIconSrc(iconUrl);
  const hasIcon = !!iconUrl;
  const showInvalid = hasIcon && !resolvedSrc;

  useEffect(() => {
    if (!iconUrl) {
      setInputMode(null);
    } else if (!resolveIconSrc(iconUrl)) {
      setInputMode('url');
    }
  }, [iconUrl]);

  function handleUploadClick() {
    setInputMode(null);
    fileInputRef.current?.click();
  }

  function handleUseUrlClick() {
    setInputMode('url');
  }

  function handleRemove() {
    onIconUrlChange('');
    setInputMode(null);
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.previewArea}>
          {resolvedSrc ? (
            <img src={resolvedSrc} alt="" style={styles.previewImg} />
          ) : (
            <span style={styles.previewInitials} title={appName || 'Application'}>
              {applicationInitials(appName)}
            </span>
          )}
        </div>
        <div style={styles.cardBody}>
          <p style={styles.cardTitle}>
            {showInvalid
              ? 'Invalid icon URL'
              : hasIcon
                ? (appName.trim() || 'Icon set')
                : 'No icon set'}
          </p>
          <div style={styles.actions}>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleUploadClick}
              disabled={disabled || uploading}
            >
              {hasIcon ? 'Replace image' : 'Upload image'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleUseUrlClick}
              disabled={disabled || uploading}
            >
              Use URL
            </button>
            {hasIcon && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRemove}
                disabled={disabled || uploading}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_ACCEPT}
          onChange={onFileSelect}
          disabled={disabled || uploading}
          style={styles.hiddenFileInput}
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      {uploading && <p style={styles.helpText}>Uploading…</p>}

      {inputMode === 'url' && (
        <div style={styles.urlSection}>
          <input
            type="url"
            inputMode="url"
            placeholder="https://example.com/icon.png"
            value={iconUrl}
            onChange={(e) => onIconUrlChange(e.target.value)}
            disabled={disabled || uploading}
            style={styles.urlInput}
            autoComplete="off"
          />
          <button
            type="button"
            style={styles.switchLink}
            onClick={() => setInputMode(null)}
            disabled={disabled || uploading}
          >
            Upload a file instead
          </button>
        </div>
      )}

      <p style={styles.helpText}>PNG, JPEG, WebP, or SVG — max 100 KB</p>
    </div>
  );
}

const styles = {
  wrapper: { marginBottom: 'var(--space-3)' },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
    padding: 'var(--space-4)',
    background: 'var(--color-bg-light, #f8f9fa)',
    border: '1px solid var(--color-border-light)',
    borderRadius: 'var(--radius-md)',
    flexWrap: 'wrap',
  },
  previewArea: { flexShrink: 0 },
  previewImg: {
    width: 48,
    height: 48,
    borderRadius: 8,
    objectFit: 'cover',
    border: '1px solid var(--color-border-light)',
    display: 'block',
  },
  previewInitials: {
    display: 'inline-flex',
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    background: '#A84335',
    color: '#fff',
    fontWeight: 700,
    fontSize: 13,
    fontFamily: 'var(--font-heading, system-ui, sans-serif)',
  },
  cardBody: { flex: 1, minWidth: 200 },
  cardTitle: {
    margin: '0 0 var(--space-2)',
    fontSize: 'var(--text-small)',
    fontWeight: 'var(--font-weight-medium)',
    color: 'var(--color-text-charcoal)',
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' },
  hiddenFileInput: { display: 'none' },
  urlSection: { marginBottom: 'var(--space-2)' },
  urlInput: {
    display: 'block',
    width: '100%',
    padding: 'var(--space-2) var(--space-3)',
    marginBottom: 'var(--space-2)',
    border: '1px solid var(--color-border-medium)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-base)',
  },
  switchLink: {
    padding: 0,
    background: 'none',
    border: 'none',
    color: 'var(--color-primary)',
    fontSize: 'var(--text-xs)',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  helpText: {
    margin: 'var(--space-2) 0 0',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-steel)',
  },
};
