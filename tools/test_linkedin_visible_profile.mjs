import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('./linkedin_visible_profile.js', import.meta.url), 'utf8');
function extract(html) {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://www.linkedin.com/in/test-candidate/',
  });
  dom.window.Element.prototype.getClientRects = function () {
    return this.closest('[hidden]') ? [] : [{ width: 100, height: 20 }];
  };
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent;
    },
  });
  try {
    return JSON.parse(JSON.stringify(dom.window.eval(`(${source.replace(/;\s*$/, '')}\n)()`)));
  } finally {
    dom.window.close();
  }
}
const header = `<main><div><a componentkey="ProfileVerificationTriggerRef-test"><h2>Mira Testcandidate</h2></a><p>She/Her</p><p>Developer</p><p>Example Labs</p><p>Example City</p><p>·</p><p>Contact info</p></div>`;
test('new layout reads professional intro and excludes pronouns and activity', () => {
  const result = extract(`${header}<div><h2>Activity</h2><p>Unrelated post</p></div></main>`);
  assert.equal(result.name, 'Mira Testcandidate');
  assert.equal(result.headline, 'Developer');
  assert.equal(result.company, 'Example Labs');
  assert.equal(result.location, 'Example City');
  assert.ok(!JSON.stringify(result).includes('Unrelated post'));
});
test('education and certifications without entity keys are grouped and collapsed content disclosed', () => {
  const result = extract(
    `${header}<div><div><h2>Education</h2></div><div><div componentkey="random-a"><p>Example University\nBTech\n2021–2025</p></div><div componentkey="random-b"><p>Example School\nHigher secondary</p></div><a><p>Show all 3 educations</p></a></div></div><div><div><h2>Licenses & certifications (6)</h2></div><div><div><p>Example Certification\nExample Vendor\nIssued 2026</p><a>Show credential</a></div><a><p>Show all 6 licenses</p></a></div></div></main>`,
  );
  assert.equal(result.sections.education.length, 2);
  assert.equal(result.sections.licenses_and_certifications.length, 1);
  assert.equal(result.warnings.filter((x) => x.includes('collapsed')).length, 2);
});
test('nested experience items do not become duplicate jobs', () => {
  const result = extract(
    `${header}<div><div><h2>Experience</h2></div><div><div componentkey="entity-collection-item-a"><p>Developer\nExample Labs</p><div componentkey="entity-collection-item-b"><p>Project role</p></div></div></div></div></main>`,
  );
  assert.equal(result.sections.experience.length, 1);
});
test('collection wrappers do not merge separate education or certification records', () => {
  const result = extract(
    `${header}<div componentkey="outer-profile-collection"><div><div><h2>Education</h2></div><div><div><div componentkey="random-a"><p>University A\nBTech</p></div><div componentkey="random-b"><p>School B\nSecondary</p></div></div></div></div><div><div><h2>Licenses & certifications (2)</h2></div><div><div><div><p>Certification A</p><p>Vendor A</p><p>Issued 2026</p><a>Show credential</a></div><div><p>Certification B</p><p>Vendor B</p><p>Issued 2025</p><a>Show credential</a></div></div></div></div></div></main>`,
  );
  assert.equal(result.sections.education.length, 2);
  assert.equal(result.sections.licenses_and_certifications.length, 2);
});
test('unrecognized intro stays blank and hidden profile heading cannot pass', () => {
  const result = extract(
    '<main><div><a componentkey="ProfileVerificationTriggerRef-test"><h2>Mira</h2></a><p>One</p><p>Two</p><p>Three</p><p>Four</p></div></main>',
  );
  assert.equal(result.headline, null);
  assert.equal(result.warnings.length, 1);
  assert.equal(
    extract(
      '<main><a hidden componentkey="ProfileVerificationTriggerRef-test"><h2>Mira</h2></a></main>',
    ),
    null,
  );
});
