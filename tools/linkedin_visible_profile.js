// Read-only extraction for the observed 2026 profile layout. No network,
// browser storage, cookies, private application state, or activity posts.
() => {
  const visible = (el) =>
    Boolean(
      el &&
        el.getClientRects().length &&
        getComputedStyle(el).visibility !== 'hidden' &&
        getComputedStyle(el).display !== 'none',
    );
  const lines = (text) =>
    (text || '')
      .split(/\r?\n/)
      .map((x) => x.replace(/[ \t]+/g, ' ').trim())
      .filter((x, i, all) => x && x !== all[i - 1]);
  const trigger = document.querySelector('main a[componentkey^="ProfileVerificationTriggerRef-"]');
  const name = trigger?.querySelector('h2');
  if (!visible(name)) return null;
  let header = name.parentElement;
  for (let i = 0; header && i < 12; i++, header = header.parentElement) {
    if (header.querySelectorAll('h2').length !== 1) {
      header = null;
      break;
    }
    if (header.querySelectorAll('p').length >= 4) break;
  }
  const paragraphs = header
    ? Array.from(header.querySelectorAll('p'))
        .filter(visible)
        .map((x) => x.innerText.trim())
    : [];
  const contact = paragraphs.findIndex((x) => x === 'Contact info');
  const intro = (contact >= 0 ? paragraphs.slice(0, contact) : []).filter(
    (x) => x !== '·' && !/^(He\/Him|She\/Her|They\/Them)(\/\w+)?$/i.test(x),
  );
  // Require the observed three-field header shape; leave uncertain values blank.
  const data = {
    format: 'anthro-linkedin-profile',
    version: 1,
    url: window.location.href,
    name: name.innerText.trim(),
    headline: intro.length === 3 ? intro[0] : null,
    company: intro.length === 3 ? intro[1] : null,
    location: intro.length === 3 ? intro[2] : null,
    about: null,
    sections: {},
    warnings: [],
  };
  if (intro.length !== 3)
    data.warnings.push('intro: unfamiliar header shape; fill headline/company/location manually');
  const labels = {
    experience: /^Experience$/i,
    education: /^Education$/i,
    skills: /^Skills(?:\s*\(\d+\))?$/i,
    licenses_and_certifications: /^Licenses\s*&\s*certifications(?:\s*\(\d+\))?$/i,
  };
  for (const [key, label] of Object.entries(labels)) {
    const heading = Array.from(document.querySelectorAll('main h2')).find(
      (x) => visible(x) && label.test(x.innerText.trim()),
    );
    if (!heading) continue;
    let card = heading.parentElement;
    for (let i = 0; card && i < 10; i++, card = card.parentElement) {
      if (card.querySelectorAll('h2').length !== 1) {
        card = null;
        break;
      }
      if (Array.from(card.children).some((x) => !x.querySelector('h2') && x.querySelector('p')))
        break;
    }
    if (!card) continue;
    let entries = Array.from(
      card.querySelectorAll('[componentkey^="entity-collection-item"]'),
    ).filter(
      (el) => visible(el) && !el.parentElement.closest('[componentkey^="entity-collection-item"]'),
    );
    if (!entries.length && key === 'education') {
      const candidates = Array.from(card.querySelectorAll('div[componentkey]')).filter(
        (el) => visible(el) && el.querySelector('p'),
      );
      entries = candidates.filter(
        (el) => !candidates.some((other) => other !== el && other.contains(el)),
      );
    }
    if (!entries.length && key === 'licenses_and_certifications') {
      const links = Array.from(card.querySelectorAll('a')).filter(
        (el) => visible(el) && /^Show credential$/i.test(el.innerText.trim()),
      );
      entries = links
        .map((link) => {
          let row = link.parentElement;
          for (let i = 0; row && row !== card && i < 10; i++, row = row.parentElement) {
            const credentials = Array.from(row.querySelectorAll('a')).filter((x) =>
              /^Show credential$/i.test(x.innerText.trim()),
            );
            if (credentials.length !== 1) return null;
            if (row.querySelectorAll('p').length >= 3) return row;
          }
          return null;
        })
        .filter(Boolean);
    }
    if (!entries.length) {
      const content = Array.from(card.children).filter(
        (x) => !x.querySelector('h2') && x.querySelector('p'),
      );
      entries = content.flatMap((x) =>
        Array.from(x.children).filter((y) => visible(y) && y.querySelector('p')),
      );
    }
    const seen = new Set();
    const result = [];
    for (const el of entries) {
      const item = lines(el.innerText).filter(
        (x) => !/^Show credential$|^Show all\b|^Show more$|^Show less$/i.test(x),
      );
      const fingerprint = JSON.stringify(item);
      if (item.length && !seen.has(fingerprint)) {
        seen.add(fingerprint);
        result.push(item);
      }
    }
    data.sections[key] = result.slice(0, 15);
    if (result.length > 15) data.warnings.push(`${key}: output capped at 15 entries`);
    if (/Show all\b/i.test(card.innerText))
      data.warnings.push(`${key}: additional entries are collapsed; visible entries only`);
  }
  const aboutHeading = Array.from(document.querySelectorAll('main h2')).find(
    (x) => visible(x) && /^About$/i.test(x.innerText.trim()),
  );
  let aboutCard = aboutHeading?.parentElement;
  for (let i = 0; aboutCard && i < 10; i++, aboutCard = aboutCard.parentElement) {
    if (aboutCard.querySelectorAll('h2').length !== 1) break;
    const text = Array.from(aboutCard.querySelectorAll('p'))
      .filter(visible)
      .map((x) => x.innerText.trim())
      .filter(Boolean);
    if (text.length) {
      data.about = text.join('\n\n').slice(0, 10000);
      break;
    }
  }
  return data;
};
