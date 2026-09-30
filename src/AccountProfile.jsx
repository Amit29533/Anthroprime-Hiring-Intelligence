import React, { useState } from 'react';
import { LogOut, ShieldCheck } from 'lucide-react';
import { Avatar, Button, Modal } from './ui.jsx';

export default function AccountProfile({ name, email, role, workspace, demo, onClose, onSignOut }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function signOut() {
    setPending(true);
    setError('');
    try {
      await onSignOut();
    } catch (failure) {
      setError(failure.message || 'Unable to sign out. Please try again.');
      setPending(false);
    }
  }
  return (
    <Modal
      className="account-modal"
      title="Your account"
      subtitle="Profile and workspace access"
      onClose={() => !pending && onClose()}
    >
      <div className="modal-body account-details">
        <div className="account-identity">
          <Avatar name={name} />
          <div>
            <h3>{name}</h3>
            <p>{email || (demo ? 'Local demo profile' : 'Email unavailable')}</p>
          </div>
        </div>
        <dl className="account-facts">
          <div>
            <dt>Workspace</dt>
            <dd>{workspace}</dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>
              <ShieldCheck size={15} aria-hidden="true" />
              {role === 'admin' ? 'Administrator' : role === 'recruiter' ? 'Recruiter' : 'Viewer'}
            </dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{demo ? 'Demo workspace' : 'Signed in'}</dd>
          </div>
        </dl>
        {demo && (
          <p className="account-note">
            This is a local demo profile. Signing out leaves your saved demo data intact.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-actions">
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          Close
        </Button>
        <Button icon={LogOut} disabled={pending} onClick={signOut}>
          {pending ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </Modal>
  );
}
