// Offer letter generation (e-sign precursor, G1): a complete, printable letter built
// from the offer record's terms. Actual e-signature execution needs a server-side
// provider and remains out of scope; this produces the letter humans sign today.
import {money} from './domain.js';

const longDate = iso => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '[start date]';

export function offerLetterText(offer, candidate, demand, workspaceName = 'AnthroPrime') {
  const o = offer, c = candidate || {};
  const role = o.role || (demand ? demand.title : '[role]');
  const client = demand ? demand.client : '';
  const location = o.location || (demand ? demand.location : '[location]');
  const lines = [];
  lines.push(`${workspaceName}`);
  lines.push(`Date: ${longDate(new Date().toISOString().slice(0, 10))}`);
  lines.push('');
  lines.push(`${c.name || '[candidate name]'}`);
  lines.push('');
  lines.push(`Dear ${c.name ? c.name.split(' ')[0] : '[candidate]'},`);
  lines.push('');
  lines.push(`Subject: Offer of employment — ${role}${client ? ` (${client})` : ''}`);
  lines.push('');
  lines.push(`Following your interviews and assessments, we are pleased to offer you the position of ${role}${client ? ` with ${client}` : ''}.`);
  lines.push('');
  lines.push('Terms of this offer:');
  lines.push(` • Role: ${role}`);
  lines.push(` • Work location: ${location || 'As discussed'}`);
  lines.push(` • Annual compensation: ${o.ctc != null ? `₹${money(o.ctc)} lakh per annum (CTC)` : '[as per the attached compensation schedule]'}`);
  lines.push(` • Proposed joining date: ${longDate(o.joining)}`);
  lines.push('');
  lines.push('This offer is contingent on satisfactory completion of background verification and the production of educational and identity documents. Your detailed appointment letter, covering notice periods, confidentiality and working conditions, will be issued on joining.');
  lines.push('');
  lines.push(`To accept, please reply to this letter confirming your acceptance${o.joining ? ` on or before ${longDate(o.joining)}` : ''}. If you have any questions, your recruiter will be glad to walk through the details with you.`);
  lines.push('');
  lines.push('We look forward to welcoming you.');
  lines.push('');
  lines.push('Yours sincerely,');
  lines.push('');
  lines.push('[Authorised signatory]');
  lines.push(workspaceName);
  if (o.notes) { lines.push(''); lines.push(`Notes discussed with you: ${o.notes}`); }
  return lines.join('\n');
}
