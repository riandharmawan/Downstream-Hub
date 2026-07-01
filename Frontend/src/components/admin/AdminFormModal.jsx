import AdminModal from './AdminModal';

/**
 * AdminFormModal — form CRUD wrapper around AdminModal.
 *
 * Props:
 *   open, title, size, onClose, onSubmit, saving, disableClose
 *   saveLabel, cancelLabel, savingLabel
 *   children — form fields only
 */
export default function AdminFormModal({
  open,
  title,
  size = 'sm',
  onClose,
  onSubmit,
  saving = false,
  disableClose,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  savingLabel,
  children,
}) {
  if (!open) return null;

  const submitLabel = saving ? (savingLabel || `${saveLabel}…`) : saveLabel;

  return (
    <AdminModal
      title={title}
      size={size}
      onClose={onClose}
      disableClose={disableClose ?? saving}
      footer={
        <div style={footerActionsStyle}>
          <button type="submit" form="admin-form-modal-form" className="btn-secondary" disabled={saving}>
            {submitLabel}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            {cancelLabel}
          </button>
        </div>
      }
    >
      <form id="admin-form-modal-form" onSubmit={onSubmit}>
        {children}
      </form>
    </AdminModal>
  );
}

const footerActionsStyle = {
  display: 'flex',
  gap: 'var(--space-2)',
};
