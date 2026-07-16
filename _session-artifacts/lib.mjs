import { chromium } from 'playwright-core';

export const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const BASE = 'http://127.0.0.1:5285';
export const DC = 'http://127.0.0.1:4085';
export const AC = 'http://127.0.0.1:4185';

export const ROLES = {
  admin: { username: 'admin', password: 'demo1234' },
  planner: { username: 'planner', password: 'demo1234' },
  base_manager: { username: 'base_manager', password: 'demo1234' },
};

export async function launch() {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
  return browser;
}

// attach console + network error capture to a page
export function watch(page, sink) {
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') sink.console.push({ t, text: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) => sink.pageerrors.push(String(e).slice(0, 300)));
  page.on('requestfailed', (r) => sink.netfail.push({ url: r.url(), err: r.failure()?.errorText }));
  page.on('response', (r) => {
    const s = r.status();
    const u = r.url();
    if (s >= 400 && (u.includes(':4085') || u.includes(':4185') || u.includes('/a/v1') || u.includes('/api/v1') || u.includes('/b/v1'))) {
      sink.http.push({ status: s, url: u.replace(/^https?:\/\/127\.0\.0\.1:\d+/, '') });
    }
  });
}

export function newSink() {
  return { console: [], pageerrors: [], netfail: [], http: [] };
}

export async function login(page, role) {
  const r = ROLES[role];
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', r.username);
  await page.fill('#login-password', r.password);
  await page.click('button[type=submit]');
  // wait for navigation away from /login
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

export async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
}

// summarize visible content of main region
export async function snapshot(page) {
  return await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    const text = (main.innerText || '').replace(/\s+/g, ' ').trim();
    const empties = Array.from(document.querySelectorAll('.empty-state')).map((e) => e.textContent?.trim()).filter(Boolean);
    const errors = Array.from(document.querySelectorAll('.badge.red, [data-testid*=error], .error')).map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 8);
    const buttons = Array.from(main.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 40);
    const tables = document.querySelectorAll('table').length;
    const rows = document.querySelectorAll('tbody tr').length;
    const canvas = document.querySelectorAll('canvas, svg').length;
    return { len: text.length, text: text.slice(0, 1200), empties, errors, buttons, tables, rows, canvas };
  });
}
