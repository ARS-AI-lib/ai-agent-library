import { isNoneValue } from '../lib/declaration';

// One declaration field (Task 10, 2026-11-27): required text, OR tick the field's "none" phrase.
// Checked → value = field.none and the input is hidden; unchecked → input shown (a none phrase is
// cleared). The checkbox is derived from the value, nothing extra is stored.
export default function DeclField({ field, value, onChange, error = false, disabled = false, readOnly = false, hint, placeholder }) {
  const none = isNoneValue(field.key, value);
  return (
    <div className="fg">
      <label>{field.label} <span className="req">*</span></label>
      {!readOnly && (
        <div style={{ marginBottom: 6 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 500, cursor: disabled ? 'default' : 'pointer' }}>
            <input
              type="checkbox"
              checked={none}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? field.none : '')}
            />
            {field.none}
          </label>
        </div>
      )}
      {(!none || readOnly) && (
        <input
          value={value ?? ''}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={error || undefined}
          style={error ? { borderColor: 'var(--late)' } : undefined}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? field.placeholder}
        />
      )}
      <div className="fhelp">{hint ?? field.hint}</div>
    </div>
  );
}
