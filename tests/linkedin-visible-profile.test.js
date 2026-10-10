import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const script = readFileSync(
  new URL('../tools/linkedin_visible_profile.js', import.meta.url),
  'utf8',
);
function extract(html) {
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/in/test-candidate/',
    runScripts: 'outside-only',
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent;
    },
  });
  dom.window.HTMLElement.prototype.getClientRects = function () {
    return this.closest('[hidden]') ? [] : [{}];
  };
  try {
    return dom.window.eval(`(${script.trim().replace(/;$/, '')})()`);
  } finally {
    dom.window.close();
  }
}
const header =
  '<section><a componentkey="ProfileVerificationTriggerRef-test"><h2>Mira Testcandidate</h2></a><p>Developer</p><p>Example Labs</p><p>Example City</p><a>Contact info</a></section>';

test('contact-scoped heading works without verification keys or h1', () => {
  const result = extract(
    '<main><section><h2>Mira Testcandidate</h2><p>Developer</p><p>Example Labs</p><p>Example City</p><button>Contact info</button></section><section><h2>Experience</h2><ul><li>Engineer</li></ul></section></main>',
  );
  assert.equal(result.name, 'Mira Testcandidate');
  assert.equal(result.headline, 'Developer');
});
test('semantic level-one heading is accepted and unrelated headings are not names', () => {
  assert.equal(
    extract(
      '<main><section><div role="heading" aria-level="1">Mira</div><a>Contact info</a></section></main>',
    ).name,
    'Mira',
  );
  assert.equal(
    extract(
      '<main><section><h2>Experience</h2><a>Contact info</a></section><section><h2>Other person</h2></section></main>',
    ).name,
    null,
  );
});
test('contact link instead of paragraph preserves modern header fields', () => {
  const result = extract(`<main>${header}</main>`);
  assert.equal(result.headline, 'Developer');
  assert.equal(result.company, 'Example Labs');
  assert.equal(result.location, 'Example City');
});

test('connection degree cannot shift headline and company in a non-self profile', () => {
  const result = extract(
    '<main><section><h2>Fictional Candidate</h2><p>She/Her</p><p>· 3rd</p><p>Accounting Analyst</p><p>Example Company</p><p>Example City</p><p>·</p><a><p>Contact info</p></a><p>Example Company</p><p>228</p><p>connections</p></section></main>',
  );
  assert.equal(result.headline, 'Accounting Analyst');
  assert.equal(result.company, 'Example Company');
  assert.equal(result.location, 'Example City');
});

test('SDUI skill rows stay separate and dividers are excluded', () => {
  const result = extract(
    `<main>${header}<section><h2>Skills (22)</h2><div><div componentkey="com.linkedin.sdui.profile.skill(fake, 1)"><p>CRM</p>\n<p>Fictional job context</p></div><div componentkey="com.linkedin.sdui.profile.skill(fake, 1)-divider"><hr></div><div componentkey="com.linkedin.sdui.profile.skill(fake, 2)"><p>Final Accounts</p>\n<p>Fictional job context</p></div></div><a>Show all</a></section></main>`,
  );
  assert.equal(result.sections.skills.length, 2);
  assert.equal(result.sections.skills[0][0], 'CRM');
  assert.equal(result.sections.skills[1][0], 'Final Accounts');
});

test('company-specific intro control after contact preserves the two-field layout', () => {
  const result = extract(
    '<main><section><div><h2>Fictional Candidate</h2><p>· 3rd</p><p>Accounting Analyst</p><p>Example City</p><a><p>Contact info</p></a></div><div role="button"><figure><svg id="company-accent-4"></svg></figure><p>Example Company</p></div><p>228</p><p>connections</p><button>Follow</button></section><section><h2>Experience</h2><div role="button"><svg id="company-accent-other"></svg><p>Unrelated company</p></div></section></main>',
  );
  assert.equal(result.headline, 'Accounting Analyst');
  assert.equal(result.company, 'Example Company');
  assert.equal(result.location, 'Example City');
  assert.ok(!result.warnings.some((warning) => warning.startsWith('intro:')));
});
test('section headings need no component keys and support h3 and ARIA headings', () => {
  const result = extract(
    `<main>${header}<section><h3>Experience</h3><ul><li><h3>Developer</h3><p>Example Labs</p></li><li hidden>Hidden job</li></ul></section><section><div role="heading">Education</div><ul><li>Example University</li></ul></section><section><h2>Licenses and certifications</h2><ul><li>Example Certificate</li></ul></section></main><aside><h2>Skills</h2><li>Unrelated skill</li></aside>`,
  );
  assert.equal(result.sections.experience.length, 1);
  assert.ok(result.sections.experience[0][0].includes('Example Labs'));
  assert.equal(result.sections.education[0][0], 'Example University');
  assert.equal(result.sections.licenses_and_certifications[0][0], 'Example Certificate');
  assert.equal(result.sections.skills, undefined);
});
test('sections remain extractable after virtual rendering removes the intro', () => {
  const result = extract(
    '<main><section><h3>Skills</h3><ul><li>React</li><li>Node.js</li></ul></section></main>',
  );
  assert.equal(result.name, null);
  assert.equal(result.sections.skills.length, 2);
});
test('ambiguous headers keep fields blank and legacy explicit selectors remain usable', () => {
  const result = extract(
    '<main><section><h1>Mira</h1><div class="text-body-medium break-words">Engineer</div><span class="text-body-small inline t-black--light break-words">Example City</span><p>Unknown badge</p><a>Contact info</a></section></main>',
  );
  assert.equal(result.headline, 'Engineer');
  assert.equal(result.location, 'Example City');
  assert.equal(result.company, null);
  assert.ok(result.warnings.some((warning) => warning.startsWith('intro:')));
});
test('section boundary avoids mixing neighboring content and caps output', () => {
  const result = extract(
    `<main>${header}<section><h2>Skills</h2><ul>${Array.from({ length: 20 }, (_, i) => `<li>Skill ${i}</li>`).join('')}</ul><button>Show all skills</button></section><section><h2>About</h2><p>Professional summary</p></section></main>`,
  );
  assert.equal(result.sections.skills.length, 15);
  assert.equal(result.about, 'Professional summary');
  assert.ok(result.warnings.some((warning) => warning.includes('capped')));
  assert.ok(result.warnings.some((warning) => warning.includes('collapsed')));
});
