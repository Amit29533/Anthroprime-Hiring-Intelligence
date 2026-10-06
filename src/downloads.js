import Papa from 'papaparse';
import { anthroIdFor } from './anthroId.js';
import { getRole, canExportForRole } from './repository.js';

export function downloadFile(content, name, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export function canExportData(notify) {
  if (!canExportForRole(getRole())) {
    notify?.('Your viewer role cannot export workspace data.');
    return false;
  }
  return true;
}
export function exportSensitiveFile(content, name, type = 'application/octet-stream', notify) {
  if (!canExportData(notify)) return false;
  return downloadFile(content, name, type);
}
export function exportCandidates(rows, notify) {
  if (!canExportData(notify)) return false;
  return exportSensitiveFile(
    Papa.unparse(
      rows.map((c) => ({
        anthroId: anthroIdFor(c),
        name: c.name,
        email: c.email,
        phone: c.phone,
        title: c.title,
        company: c.company,
        location: c.location,
        experience: c.experience,
        relevantExperience: c.relevantExperience,
        notice: c.notice,
        expected: c.expected,
        current: c.current,
        skills: c.skills.join('; '),
        status: c.status,
        source: c.source,
        mode: c.mode,
        verified: c.verified,
        exportedAt: new Date().toISOString(),
        exportedBy: 'ECOD workspace export (audited)',
      })),
      { escapeFormulae: true },
    ),
    'ecod-candidates.csv',
    'text/csv;charset=utf-8',
    notify,
  );
}
