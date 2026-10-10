import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import './progressive-ui.css';

// A disclosure, rather than an ARIA menu: content may include forms and file inputs.
export function MoreOptions({ label = 'More options', icon: Icon = MoreHorizontal, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const doc = ref.current.ownerDocument;
    const closeOutside = (e) => {
      if (!ref.current.contains(e.target)) setOpen(false);
    };
    const escape = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        ref.current.querySelector('button').focus();
      }
    };
    doc.addEventListener('pointerdown', closeOutside);
    ref.current.addEventListener('keydown', escape);
    const el = ref.current;
    return () => {
      doc.removeEventListener('pointerdown', closeOutside);
      el.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className="more-options" ref={ref}>
      <button
        type="button"
        className="button secondary"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <Icon size={17} aria-hidden="true" />
        {label}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        id={id}
        className="options-popover"
        hidden={!open}
        role="region"
        aria-label={label}
        onClick={(event) => {
          const button = event.target.closest('button');
          if (button && !button.disabled) {
            setOpen(false);
            ref.current.querySelector('button').focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Keep form fields mounted so defaults, validation and drafts survive a collapse.
// Native invalid events reveal every collapsed ancestor before the browser focuses it.
export function FormSection({
  title,
  description,
  icon: Icon = SlidersHorizontal,
  children,
  defaultOpen = false,
}) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const reveal = (event) => {
      let parent = event.target.parentElement;
      while (parent) {
        if (parent.tagName === 'DETAILS') parent.open = true;
        parent = parent.parentElement;
      }
    };
    el.addEventListener('invalid', reveal, true);
    return () => el.removeEventListener('invalid', reveal, true);
  }, []);
  return (
    <details className="form-section wide" ref={ref} open={defaultOpen || undefined}>
      <summary>
        <Icon size={19} aria-hidden="true" />
        <span>
          <strong>{title}</strong>
          {description && <small>{description}</small>}
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className="form-section-content form-grid">{children}</div>
    </details>
  );
}

export function SectionTabs({
  items,
  value,
  onChange,
  primary = items.slice(0, 4),
  label = 'Profile sections',
}) {
  const tabs = useRef(null);
  const requested = useRef(false);
  useEffect(() => {
    if (!requested.current) return;
    requested.current = false;
    [...tabs.current.querySelectorAll(':scope > button')]
      .find((button) => button.textContent === value)
      ?.focus();
  }, [value]);
  const select = (item) => {
    requested.current = true;
    onChange(item);
  };
  const visible = items.filter((item) => primary.includes(item) || item === value);
  const more = items.filter((item) => !visible.includes(item));
  return (
    <div className="section-tabs" ref={tabs} role="group" aria-label={label}>
      {visible.map((item) => (
        <button
          type="button"
          key={item}
          className={value === item ? 'active' : ''}
          aria-pressed={value === item}
          onClick={() => select(item)}
        >
          {item}
        </button>
      ))}
      {more.length > 0 && (
        <MoreOptions label="More sections">
          {more.map((item) => (
            <button type="button" className="button ghost" key={item} onClick={() => select(item)}>
              {item}
            </button>
          ))}
        </MoreOptions>
      )}
    </div>
  );
}
