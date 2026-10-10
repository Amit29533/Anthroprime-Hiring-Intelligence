import React, { useEffect, useId, useState, useRef } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import './disclosure.css';

// Mount on first use; closing a section preserves drafts and in-flight work.
export function DisclosureSection({
  title,
  description,
  icon: Icon = Layers,
  number,
  children,
  open: controlledOpen,
  onToggle,
  defaultOpen = false,
  className = '',
  ...props
}) {
  const id = useId();
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const [visited, setVisited] = useState(open);
  const trigger = useRef(null);
  const revealRequested = useRef(false);
  useEffect(() => {
    if (open) setVisited(true);
    if (open && revealRequested.current) {
      revealRequested.current = false;
      trigger.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [open]);
  return (
    <section className={`disclosure-section ${open ? 'is-open' : ''} ${className}`} {...props}>
      <button
        type="button"
        ref={trigger}
        className="disclosure-trigger"
        id={`${id}-trigger`}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => {
          revealRequested.current = !open;
          if (onToggle) onToggle(!open);
          else setLocalOpen(!open);
        }}
      >
        <span className="disclosure-icon" aria-hidden="true">
          {number ?? (Icon && <Icon size={21} />)}
        </span>
        <span className="disclosure-label">
          <strong>{title}</strong>
          {description && <span>{description}</span>}
        </span>
        <ChevronDown size={19} className="disclosure-chevron" aria-hidden="true" />
      </button>
      <div
        id={`${id}-body`}
        role="region"
        aria-labelledby={`${id}-trigger`}
        className="disclosure-body"
        hidden={!open}
      >
        {(open || visited) && children}
      </div>
    </section>
  );
}
