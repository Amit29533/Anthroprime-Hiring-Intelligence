// Self-hosted LinkedIn session worker. Runs a headless browser signed in with a
// dedicated TEST account's li_at cookie and returns a minimal profile payload.
//
// Why a separate service: Netlify Functions cannot run Chromium, and the session
// cookie must never reach the browser, Supabase or Netlify. The cookie lives only
// in this process's environment (LI_AT).
//
// Automated access violates LinkedIn's User Agreement; the test account may be
// restricted or banned. This worker is deliberately single-flight, rate limited,
// and stops (it never works around) login walls, checkpoints or CAPTCHAs.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const PROFILE_RE = /^https:\/\/www\.linkedin\.com\/in\/[a-z0-9][a-z0-9._-]{2,99}$/;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function workerConfig(env = process.env) {
  return {
    token: env.LINKEDIN_WORKER_TOKEN || '',
    liAt: env.LI_AT || '',
    port: Number(env.PORT) || 8081,
    minIntervalMs: Number(env.LINKEDIN_MIN_INTERVAL_MS) || 30000,
    dailyLimit: Number(env.LINKEDIN_DAILY_LIMIT) || 20,
    budgetMs: Number(env.LINKEDIN_SCRAPE_BUDGET_MS) || 20000,
  };
}
const clean = (text, limit = 400) => {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
};
const dedupeLines = (raw) => {
  const out = [];
  for (const line of String(raw || '')
    .split('\n')
    .map((l) => clean(l))
    .filter(Boolean))
    if (out[out.length - 1] !== line) out.push(line);
  return out;
};
async function firstText(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) && (await locator.isVisible())) {
        const text = clean(await locator.innerText({ timeout: 1500 }));
        if (text) return text;
      }
    } catch {
      /* try next selector */
    }
  }
  return '';
}
async function sectionItems(page, anchor, max = 8) {
  try {
    const section = page.locator(`section:has(div#${anchor})`).first();
    if (!(await section.count())) return [];
    const items = section.locator('li.artdeco-list__item, ul > li');
    const seen = new Set();
    const out = [];
    const total = Math.min(await items.count(), max * 3);
    for (let i = 0; i < total && out.length < max; i++) {
      const lines = dedupeLines(await items.nth(i).innerText({ timeout: 1500 })).slice(0, 4);
      const key = lines.join('|');
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(lines);
      }
    }
    return out;
  } catch {
    return [];
  }
}
export class WorkerError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function scrapeProfile(
  profile,
  config,
  launch = async () => (await import('playwright')).chromium.launch(),
) {
  if (!PROFILE_RE.test(profile))
    throw new WorkerError(400, 'bad-profile', 'Use a normalized LinkedIn member profile URL.');
  const deadline = Date.now() + config.budgetMs;
  const browser = await launch();
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 900 },
      locale: 'en-US',
    });
    await context.addCookies([
      {
        name: 'li_at',
        value: config.liAt,
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true,
      },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(Math.max(3000, config.budgetMs - 4000));
    await page.goto(profile, { waitUntil: 'domcontentloaded' });
    if (/authwall|\/login|\/checkpoint|\/uas\/|captcha/i.test(page.url()))
      throw new WorkerError(
        409,
        'session-blocked',
        'LinkedIn asked for sign-in or verification. Refresh the test-account cookie manually.',
      );
    await page.waitForSelector('h1', { timeout: 10000 });
    // Short scroll pass so lazy sections render, bounded by the overall budget.
    for (let i = 0; i < 3 && Date.now() < deadline - 3000; i++) {
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(600 + Math.floor(Math.random() * 500));
    }
    const finalUrl = new URL(page.url());
    const finalProfile =
      `https://www.linkedin.com${finalUrl.pathname.replace(/\/+$/, '')}`.toLowerCase();
    const about = await sectionItems(page, 'about', 1);
    return {
      profile: finalProfile,
      name: await firstText(page, ['main h1', 'h1']),
      headline: await firstText(page, [
        'div.text-body-medium.break-words',
        'main section div.text-body-medium',
      ]),
      location: await firstText(page, [
        'span.text-body-small.inline.t-black--light.break-words',
        'main section span.text-body-small',
      ]),
      about: about[0] ? about[0].join(' ').slice(0, 1500) : '',
      experience: await sectionItems(page, 'experience'),
      education: await sectionItems(page, 'education', 4),
      skills: (await sectionItems(page, 'skills', 20)).map((lines) => lines[0]).filter(Boolean),
    };
  } catch (err) {
    if (err instanceof WorkerError) throw err;
    throw new WorkerError(502, 'scrape-failed', 'The profile could not be read.');
  } finally {
    await browser.close().catch(() => {});
  }
}
const sameToken = (given, expected) => {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
export function createServer(config = workerConfig(), scrape = scrapeProfile) {
  let busy = false,
    lastAt = 0,
    day = '',
    used = 0;
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health')
        return reply(res, 200, { ok: true, configured: Boolean(config.liAt) });
      if (req.method !== 'POST' || req.url !== '/profile')
        return reply(res, 404, { error: 'Not found.' });
      if (!sameToken(req.headers.authorization?.replace(/^Bearer /, ''), config.token))
        return reply(res, 401, { error: 'Unauthorized.' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024) return reply(res, 413, { error: 'Request is too large.' });
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(res, 400, { error: 'Request body must be valid JSON.' });
      }
      const today = new Date().toISOString().slice(0, 10);
      if (day !== today) {
        day = today;
        used = 0;
      }
      if (busy) return reply(res, 429, { error: 'Worker is busy. Try again shortly.' });
      if (used >= config.dailyLimit)
        return reply(res, 429, { error: 'Worker daily limit reached.' });
      const wait = lastAt + config.minIntervalMs - Date.now();
      if (wait > 0)
        return reply(res, 429, {
          error: `Worker is rate limited. Retry in ${Math.ceil(wait / 1000)} seconds.`,
        });
      busy = true;
      used++;
      lastAt = Date.now();
      try {
        return reply(res, 200, await scrape(String(body.profile || ''), config));
      } finally {
        busy = false;
        lastAt = Date.now();
      }
    } catch (err) {
      if (err instanceof WorkerError)
        return reply(res, err.status, { error: err.message, code: err.code });
      return reply(res, 500, { error: 'Worker failed.' });
    }
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = workerConfig();
  if (config.token.length < 32)
    throw new Error('LINKEDIN_WORKER_TOKEN must be at least 32 characters.');
  if (!config.liAt) throw new Error('LI_AT (test-account session cookie) is required.');
  createServer(config).listen(config.port, '0.0.0.0', () =>
    console.log(`linkedin-session-worker listening on ${config.port}`),
  );
}
