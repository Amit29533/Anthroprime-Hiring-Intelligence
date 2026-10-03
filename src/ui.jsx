import React, { useEffect, useRef, useId } from 'react';
import { X, Search, ArrowUpRight } from 'lucide-react';
import { initials } from './domain.js';
const dialogLocks = new WeakMap();

function lockDialogScroll(doc) {
  const existing = dialogLocks.get(doc);
  const lock = existing || { count: 0, previous: doc.body.style.overflow };
  lock.count++;
  dialogLocks.set(doc, lock);
  doc.body.style.overflow = 'hidden';
  return () => {
    lock.count--;
    if (lock.count === 0) {
      doc.body.style.overflow = lock.previous;
      dialogLocks.delete(doc);
    }
  };
}
export function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      <Icon size={18} />
    </button>
  );
}
export function Button({ children, icon: Icon, variant = '', className = '', ...props }) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {Icon && <Icon size={16} />} {children}
    </button>
  );
}
export function Badge({ children, tone = '' }) {
  return (
    <span
      className={`badge ${tone || { Ready: 'green', 'Near-ready': 'amber', Assessing: 'blue', Fresh: 'green', Aging: 'amber', Stale: 'red', High: 'amber', Open: 'green', Deployed: 'green', Rejected: 'red', Withdrawn: 'gray' }[children] || 'gray'}`}
    >
      {children}
    </span>
  );
}
export function Avatar({ name, size = '', index = 0 }) {
  return <span className={`avatar ${size} color-${index % 5}`}>{initials(name)}</span>;
}
export function Empty({
  title = 'No results found',
  text = 'Try adjusting your search or filters.',
  action,
}) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <span />
        <Search size={30} />
        <span />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function PageHeader({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function PanelHeading({ title, subtitle, action }) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function TextLink({ children, onClick }) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search candidates, skills, companies…',
  ...rest
}) {
  return (
    <div className="search-box">
      <Search size={18} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        {...rest}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange('')}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
export function Field({ label, children, hint, wide = false }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
  drawer = false,
  className = '',
}) {
  const ref = useRef(null),
    titleId = useId();
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    const unlock = lockDialogScroll(el.ownerDocument);
    return () => {
      el.close();
      unlock();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`${wide ? 'wide-modal' : ''} ${drawer ? 'drawer' : ''} ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = e.target.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <IconButton icon={X} label="Close dialog" onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}
export function PersonName({ person, onClick, index = 0 }) {
  return (
    <button className="person" onClick={onClick}>
      <Avatar name={person.name} index={index} />
      <span>
        <strong>{person.name}</strong>
        <small>{person.title}</small>
      </span>
    </button>
  );
}
export function Stat({ label, value, detail, icon: Icon, tone = 'teal' }) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${tone}`}>
          <Icon size={18} />
        </span>
      </div>
      <strong>{value}</strong>
      <span className="stat-detail">{detail}</span>
    </div>
  );
}
