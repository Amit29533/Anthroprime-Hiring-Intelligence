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
  let name =
    Array.from(document.querySelectorAll('main h1, main [role="heading"][aria-level="1"]')).find(
      visible,
    ) || trigger?.querySelector('h2');
  // Component keys are unstable. A visible contact control scopes the intro
  // card without selecting arbitrary headings from jobs or recommendations.
  if (!visible(name)) {
    const contacts = Array.from(document.querySelectorAll('main a, main button')).filter(
      (el) => visible(el) && /^Contact info$/i.test(el.innerText.trim()),
    );
    for (const contact of contacts.slice(0, 5)) {
      let card = contact.parentElement;
      for (
        let depth = 0;
        card && card.tagName !== 'MAIN' && depth < 8;
        depth++, card = card.parentElement
      ) {
        const candidates = Array.from(card.querySelectorAll('h1, h2, h3, [role="heading"]')).filter(
          (el) =>
            visible(el) &&
            Boolean(el.compareDocumentPosition(contact) & Node.DOCUMENT_POSITION_FOLLOWING) &&
            !/^(About|Experience|Education|Skills|Licenses.*certifications|Activity|Contact info|People also viewed)$/i.test(
              el.innerText.trim(),
            ),
        );
        if (candidates.length === 1) {
          name = candidates[0];
          break;
        }
        if (candidates.length > 1) break;
      }
      if (visible(name)) break;
    }
  }
  if (!document.querySelector('main')) return null;
  let header = visible(name) ? name.parentElement : null;
  for (let i = 0; header && i < 12; i++, header = header.parentElement) {
    if (header.querySelectorAll('h1, h2, h3, [role="heading"]').length !== 1) {
      header = null;
      break;
    }
    if (
      Array.from(header.querySelectorAll('a, button, p')).some(
        (el) => visible(el) && /^Contact info$/i.test(el.innerText.trim()),
      )
    )
      break;
  }
  // Contact and company can sit in sibling columns of the same intro card.
  // Expand only within the one-heading boundary, stopping before other sections.
  if (header && !header.querySelector('svg[id^="company-accent-"]')) {
    let parent = header.parentElement;
    for (
      let i = 0;
      parent && parent.tagName !== 'MAIN' && i < 8;
      i++, parent = parent.parentElement
    ) {
      if (parent.querySelectorAll('h1, h2, h3, [role="heading"]').length !== 1) break;
      if (parent.querySelector('svg[id^="company-accent-"]')) {
        header = parent;
        break;
      }
    }
  }
  const paragraphs = header
    ? Array.from(header.querySelectorAll('p'))
        .filter(visible)
        .map((x) => x.innerText.trim())
    : [];
  const contact = paragraphs.findIndex((x) => /^Contact info$/i.test(x));
  const intro = (contact >= 0 ? paragraphs.slice(0, contact) : paragraphs).filter(
    (x) =>
      x !== '·' &&
      x !== name?.innerText.trim() &&
      !/^(He\/Him|She\/Her|They\/Them)(\/\w+)?$|^[·\s]*(1st|2nd|3rd|\d+th)\+?$|^Contact info$|^\d[\d,+.]* (connections|followers)$/i.test(
        x,
      ),
  );
  // A non-self profile can put the company control after Contact info, leaving
  // headline/location before it. Use its company-specific icon, never action
  // button labels or unrelated sidebar companies, to recognize that layout.
  const companyControls = Array.from(
    header?.querySelectorAll('button, [role="button"]') || [],
  ).filter((el) => visible(el) && el.querySelector('svg[id^="company-accent-"]'));
  const companyLabel =
    companyControls.length === 1 && companyControls[0].querySelectorAll('p').length === 1
      ? companyControls[0].querySelector('p').innerText.trim()
      : null;
  const separatedCompany = intro.length === 2 && Boolean(companyLabel);
  // Require a recognized header shape; leave uncertain values blank.
  const data = {
    format: 'anthro-linkedin-profile',
    version: 1,
    url: window.location.href,
    name: visible(name) ? name.innerText.trim() : null,
    headline: intro.length === 3 || separatedCompany ? intro[0] : null,
    company: intro.length === 3 ? intro[1] : separatedCompany ? companyLabel : null,
    location: intro.length === 3 ? intro[2] : separatedCompany ? intro[1] : null,
    about: null,
    sections: {},
    warnings: [],
  };
  if (visible(name) && intro.length !== 3 && !separatedCompany)
    data.warnings.push('intro: unfamiliar header shape; fill headline/company/location manually');
  // Explicit legacy field selectors remain useful when the modern header varies.
  const field = (selector) =>
    Array.from((header || name?.parentElement)?.querySelectorAll(selector) || [])
      .find(visible)
      ?.innerText.trim() || null;
  data.headline ||= field('.text-body-medium.break-words');
  data.location ||= field('.text-body-small.inline.t-black--light.break-words');
  const labels = {
    experience: /^Experience$/i,
    education: /^Education$/i,
    skills: /^Skills(?:\s*\(\d+\))?$/i,
    licenses_and_certifications: /^Licenses\s*(?:&|and)\s*certifications(?:\s*\(\d+\))?$/i,
  };
  const headings = () =>
    Array.from(document.querySelectorAll('main h2, main h3, main [role="heading"]')).filter(
      visible,
    );
  const isSectionHeading = (el) =>
    /^About$/i.test(el.innerText.trim()) ||
    Object.values(labels).some((label) => label.test(el.innerText.trim()));
  const cardFor = (heading) => {
    let card = heading.parentElement;
    for (let i = 0; card && card.tagName !== 'MAIN' && i < 12; i++, card = card.parentElement) {
      if (
        Array.from(card.querySelectorAll('h2, h3, [role="heading"]')).filter(isSectionHeading)
          .length > 1
      )
        return null;
      if (
        card.tagName === 'SECTION' ||
        card.querySelector('li, [componentkey^="entity-collection-item"]')
      )
        return card;
      if (Array.from(card.children).some((el) => !el.contains(heading) && el.querySelector('p')))
        return card;
    }
    return null;
  };
  for (const [key, label] of Object.entries(labels)) {
    const heading = headings().find((x) => label.test(x.innerText.trim()));
    if (!heading) continue;
    const card = cardFor(heading);
    if (!card) continue;
    const skillRows = '[componentkey^="com.linkedin.sdui.profile.skill("]';
    let entries = Array.from(
      card.querySelectorAll(
        key === 'skills' && card.querySelector(skillRows)
          ? skillRows
          : '[componentkey^="entity-collection-item"]',
      ),
    ).filter(
      (el) =>
        visible(el) &&
        !el.parentElement.closest('[componentkey^="entity-collection-item"]') &&
        (key !== 'skills' || !el.getAttribute('componentkey')?.endsWith('-divider')),
    );
    if (!entries.length)
      entries = Array.from(card.querySelectorAll('li')).filter(
        (el) => visible(el) && !el.parentElement.closest('li'),
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
      const item = lines(el.innerText)
        .filter((x) => !/^Show credential$|^Show all\b|^Show more$|^Show less$/i.test(x))
        .slice(0, 40)
        .map((line) => line.slice(0, 2000));
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
  const aboutHeading = headings().find((x) => /^About$/i.test(x.innerText.trim()));
  const aboutCard = aboutHeading && cardFor(aboutHeading);
  if (aboutCard) {
    const text = Array.from(aboutCard.querySelectorAll('p, span[aria-hidden="true"]'))
      .filter(visible)
      .map((x) => x.innerText.trim())
      .filter((x) => x && !/^[…\.\s]*more$/i.test(x));
    if (text.length) {
      data.about = text.join('\n\n').slice(0, 10000);
      if (/[…\.]{1,3}\s*more\b/i.test(aboutCard.innerText))
        data.warnings.push('about: text may be collapsed; review the visible excerpt');
    }
  }
  return data;
};
