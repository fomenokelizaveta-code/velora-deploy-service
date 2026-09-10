#!/usr/bin/env node
// Read-only website QA. It never sends messages, books appointments or edits an admin panel.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const result = (status, details = {}) => ({ status, ...details });
const passed = value => value?.status === 'PASS';
const HOST = { platform: os.platform(), release: os.release(), arch: os.arch() };
const IDS = ['chromium-desktop', 'chromium-android', 'webkit-iphone', 'firefox-desktop'];
const DEFAULT_PLATFORMS = [
  { os: 'Android', mode: 'emulated', profiles: ['chromium-android'] },
  { os: 'iOS', mode: 'emulated', profiles: ['webkit-iphone'] },
  { os: 'Windows', mode: 'native', profiles: ['chromium-desktop', 'firefox-desktop'] }
];
const args = process.argv.slice(2);
const option = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const outputDir = path.resolve(option('--out') ?? 'readiness-artifacts');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const errorText = error => String(error?.message ?? error).slice(0, 1600);
const canonical = (url, base) => { try { return new URL(url, base).href; } catch { return null; } };

function validateManifest(m) {
  const errors = [];
  if (!/^https?:\/\//.test(m.url ?? '')) errors.push('url must be an absolute HTTP(S) public site URL');
  if (!/^[a-z0-9][a-z0-9-]{1,100}$/.test(m.slug ?? '')) errors.push('slug is required and must be a safe identifier');
  if (!/^\+[1-9]\d{7,14}$/.test(m.phone ?? '')) errors.push('phone must be E.164');
  if (!norm(m.expected_headline)) errors.push('expected_headline is required');
  if (!m.cta_selector) errors.push('cta_selector must select the actual prominent buttons');
  if (!m.services?.selector) errors.push('services.selector is required');
  if (!Number.isInteger(m.services?.expected_count) || m.services.expected_count < 1) errors.push('services.expected_count must be positive');
  if (!Array.isArray(m.services?.items) || m.services.items.length !== m.services.expected_count) errors.push('services.items must describe every expected card');
  for (const [i, item] of (m.services?.items ?? []).entries()) {
    if (!norm(item.title) || !norm(item.image_alt) || !Array.isArray(item.image_urls) || !item.image_urls.length) errors.push(`services.items[${i}] needs title, image_alt and allowed image_urls`);
    if (item.image_urls?.some(url => !canonical(url, m.url))) errors.push(`services.items[${i}] has an invalid image URL`);
  }
  if (m.booking_required !== false && !/^https?:\/\//.test(m.expected_booking_url ?? '')) errors.push('expected_booking_url is required; explicitly set booking_required:false when not applicable');
  if (m.booking_required === false && !norm(m.booking_not_applicable_reason)) errors.push('booking_not_applicable_reason is required');
  if (m.forbidden_strings !== undefined && (!Array.isArray(m.forbidden_strings) || m.forbidden_strings.some(s => typeof s !== 'string' || !s.trim()))) errors.push('forbidden_strings must be an array of nonempty literal strings');
  if (m.outbound_profile && !IDS.includes(m.outbound_profile)) errors.push('outbound_profile must name one of the four supported profiles');
  const platforms = m.required_platforms ?? DEFAULT_PLATFORMS;
  if (!Array.isArray(platforms) || !platforms.length) errors.push('required_platforms cannot be empty');
  else for (const entry of platforms) {
    if (!['Android', 'iOS', 'Windows'].includes(entry.os) || !['native', 'emulated'].includes(entry.mode) || !entry.profiles?.length || entry.profiles.some(id => !IDS.includes(id))) errors.push('required_platforms needs supported os, mode and profile IDs');
  }
  for (const target of ['Android', 'iOS', 'Windows']) if (!platforms?.some?.(entry => entry.os === target)) errors.push(`required_platforms must include ${target}`);
  return errors;
}

function profileDefinitions(pw) {
  return [
    { id: IDS[0], browser: 'chromium', target_os: HOST.platform, device_mode: 'native_browser', viewport: { width: 1440, height: 900 }, options: {} },
    { id: IDS[1], browser: 'chromium', target_os: 'Android', device_mode: 'emulated', preset: 'Pixel 5', viewport: { width: 390, height: 844 }, options: pw.devices?.['Pixel 5'] },
    { id: IDS[2], browser: 'webkit', target_os: 'iOS', device_mode: 'emulated', preset: 'iPhone 13', viewport: { width: 390, height: 844 }, options: pw.devices?.['iPhone 13'] },
    { id: IDS[3], browser: 'firefox', target_os: HOST.platform, device_mode: 'native_browser', viewport: { width: 1440, height: 900 }, options: {} }
  ];
}

async function walkForLazyImages(page, timeout) {
  return page.evaluate(async timeoutMs => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = Date.now() + timeoutMs;
    let y = 0;
    while (Date.now() < until) {
      window.scrollTo(0, y);
      await pause(100);
      const bottom = Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight);
      if (y + innerHeight >= bottom - 2) {
        await pause(250);
        if (y + innerHeight >= Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight) - 2) return { reached_bottom: true, height: bottom };
      }
      y += Math.max(200, Math.floor(innerHeight * 0.8));
    }
    return { reached_bottom: false, reason: 'Scroll deadline reached, lazy-image completeness is unknown' };
  }, timeout);
}

async function inspectDocument(page, m) {
  return page.evaluate(async manifest => {
    const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    const href = value => { try { return new URL(value, location.href).href; } catch { return null; } };
    const shown = el => { const box = el.getBoundingClientRect(), css = getComputedStyle(el); return box.width > 0 && box.height > 0 && css.display !== 'none' && css.visibility !== 'hidden' && Number(css.opacity) !== 0; };
    const deadline = promise => new Promise(resolve => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'Image decode timeout' }), 8000);
      Promise.resolve(promise).then(() => { clearTimeout(timer); resolve({ ok: true }); }, error => { clearTimeout(timer); resolve({ ok: false, error: String(error?.message ?? error) }); });
    });
    const images = await Promise.all([...document.images].map(async (img, index) => {
      const src = img.currentSrc || img.src;
      const decoded = src ? await deadline(img.decode()) : { ok: false, error: 'Empty src/currentSrc' };
      return { index, url: src, alt: img.alt, visible: shown(img), decoded: decoded.ok && img.naturalWidth > 0 && img.naturalHeight > 0, width: img.naturalWidth, height: img.naturalHeight, error: decoded.error ?? null };
    }));
    const backgrounds = new Set();
    for (const el of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const css = getComputedStyle(el, pseudo).backgroundImage;
        for (const match of css.matchAll(/url\(["']?(.*?)["']?\)/g)) if (match[1]) backgrounds.add(href(match[1]));
      }
    }
    const backgroundImages = await Promise.all([...backgrounds].map(async url => {
      const img = new Image(); img.src = url;
      const decoded = await deadline(img.decode());
      return { url, decoded: decoded.ok && img.naturalWidth > 0, width: img.naturalWidth, height: img.naturalHeight, error: decoded.error ?? null };
    }));
    const allCards = [...document.querySelectorAll(manifest.services.selector)];
    const cards = allCards.map((card, index) => ({ index, visible: shown(card), title: text(card.querySelector(manifest.services.title_selector ?? 'h3')?.textContent), images: [...card.querySelectorAll(manifest.services.image_selector ?? 'img')].map(img => ({ url: img.currentSrc || img.src, alt: img.alt, visible: shown(img), decoded: img.complete && img.naturalWidth > 0 })) }));
    const cardMatches = manifest.services.items.map(item => {
      const matches = cards.filter(card => card.title === text(item.title));
      const card = matches[0];
      const allowed = item.image_urls.map(href);
      return { title: item.title, matching_cards: matches.length, pass: matches.length === 1 && card.visible && card.images.some(img => img.visible && img.decoded && img.alt === item.image_alt && allowed.includes(href(img.url))) };
    });
    const anchors = [...document.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: text(a.innerText), visible: shown(a), enabled: a.getAttribute('aria-disabled') !== 'true' && getComputedStyle(a).pointerEvents !== 'none' }));
    const phones = anchors.filter(a => a.href.startsWith('tel:'));
    const booking = anchors.filter(a => href(a.href) === href(manifest.expected_booking_url));
    const visibleHeadlines = [...document.querySelectorAll(manifest.headline_selector ?? 'h1')].filter(shown).map(el => text(el.innerText));
    const forbidden = ['lorem ipsum', 'текст-заглушка', 'здесь будет', ...(manifest.forbidden_strings ?? [])];
    const body = text(document.body?.innerText).toLocaleLowerCase();
    return {
      location: location.href,
      navigator: { user_agent: navigator.userAgent, advertised_platform: navigator.platform },
      images, background_images: backgroundImages, cards, card_matches: cardMatches,
      phones, booking, headlines: visibleHeadlines,
      forbidden_matches: forbidden.filter(phrase => body.includes(text(phrase).toLocaleLowerCase())),
      viewport_meta: document.querySelector('meta[name="viewport"]')?.content ?? null,
      layout: { inner_width: innerWidth, viewport_width: document.documentElement.clientWidth, scroll_width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) }
    };
  }, m);
}

async function checkCtas(page, m) {
  const controls = page.locator(m.cta_selector);
  const count = await controls.count();
  const items = [];
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    if (!await control.isVisible()) { items.push({ index: i, status: 'HIDDEN', reason: 'Not evaluated as an actionable button in this profile' }); continue; }
    try {
      await control.scrollIntoViewIfNeeded({ timeout: 5000 });
      await control.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
      const item = await control.evaluate((el, minimum) => {
        const r = el.getBoundingClientRect();
        const points = [[.5, .5], [.2, .2], [.8, .2], [.2, .8], [.8, .8]];
        const occluded = points.filter(([x, y]) => {
          const top = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y);
          return !top || !(top === el || el.contains(top));
        }).length;
        const disabled = el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' || getComputedStyle(el).pointerEvents === 'none';
        const withinViewport = r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
        return { text: el.textContent?.trim() ?? '', href: el.href ?? null, width: r.width, height: r.height, occluded_points: occluded, disabled, within_viewport: withinViewport, pass: r.width >= minimum && r.height >= minimum && !occluded && !disabled && withinViewport };
      }, m.minimum_button_px ?? 44);
      items.push({ index: i, status: item.pass ? 'PASS' : 'FAIL', ...item });
    } catch (error) { items.push({ index: i, status: 'FAIL', error: errorText(error) }); }
  }
  const visible = items.filter(item => item.status !== 'HIDDEN');
  return result(visible.length && visible.every(passed) ? 'PASS' : 'FAIL', { minimum_size_px: m.minimum_button_px ?? 44, selected_count: count, visible_count: visible.length, items, interaction: 'Geometry, hit testing and enabled state only; no button was clicked' });
}

async function runProfile(pw, spec, m) {
  const report = { id: spec.id, browser: spec.browser, runner_os: HOST, target_os: spec.target_os, device_mode: spec.device_mode, emulated_preset: spec.preset ?? null, viewport: spec.viewport, physical_device_tested: false, status: 'UNKNOWN', sections: {} };
  if (!spec.options) return { ...report, status: 'BLOCKED', reason: `Playwright device preset ${spec.preset} is unavailable` };
  let browser;
  try {
    browser = await pw[spec.browser].launch({ headless: true });
    report.browser_version = browser.version();
    const context = await browser.newContext({ ...spec.options, viewport: spec.viewport, deviceScaleFactor: 1, locale: 'ru-RU', reducedMotion: 'reduce', serviceWorkers: 'block' });
    // Prevent form/API mutations initiated by page JavaScript. GET booking navigation is read-only.
    const blockedMutations = [];
    await context.route('**/*', async route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      blockedMutations.push({ method: route.request().method(), url: route.request().url() });
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const pageErrors = [], failedRequests = [];
    page.on('pageerror', error => pageErrors.push(errorText(error)));
    page.on('requestfailed', req => failedRequests.push({ url: req.url(), type: req.resourceType(), failure: req.failure()?.errorText }));
    const response = await page.goto(m.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = response?.status() ?? null;
    const finalUrl = page.url();
    report.html_sha256 = response ? sha(await response.body()) : null;
    const allowedUrls = [m.url, ...(m.allowed_redirect_urls ?? [])].map(url => canonical(url));
    report.sections.http = result(status >= 200 && status < 300 && allowedUrls.includes(canonical(finalUrl)) ? 'PASS' : 'FAIL', { status_code: status, final_url: finalUrl, expected_urls: allowedUrls, html_sha256: report.html_sha256 });
    const scroll = await walkForLazyImages(page, m.scroll_timeout_ms ?? 20000);
    report.sections.lazy_images = result(scroll.reached_bottom ? 'PASS' : 'UNKNOWN', scroll);
    await page.evaluate(() => Promise.race([document.fonts?.ready, new Promise(resolve => setTimeout(resolve, 5000))]));
    const doc = await inspectDocument(page, m);
    report.navigator = doc.navigator;
    report.sections.images = result(doc.images.length > 0 && [...doc.images, ...doc.background_images].every(img => img.decoded) ? 'PASS' : 'FAIL', { items: doc.images, backgrounds: doc.background_images });
    report.sections.service_cards = result(doc.cards.length === m.services.expected_count && doc.card_matches.every(item => item.pass) ? 'PASS' : 'FAIL', { expected_count: m.services.expected_count, actual_count: doc.cards.length, cards: doc.cards, requirements: doc.card_matches, visual_relevance: 'UNKNOWN — manager must inspect the actual pictures' });
    report.sections.headline = result(doc.headlines.length === 1 && doc.headlines[0] === norm(m.expected_headline) ? 'PASS' : 'FAIL', { actual: doc.headlines, expected: norm(m.expected_headline) });
    report.sections.copy = result(doc.forbidden_matches.length ? 'FAIL' : 'PASS', { forbidden_matches: doc.forbidden_matches, scope: 'Literal-string check only; factual truth still needs manager approval' });
    const normalizePhone = value => value.replace(/^tel:/, '').replace(/[^+\d]/g, '');
    report.sections.phone = result(doc.phones.some(a => a.visible && a.enabled && normalizePhone(a.href) === m.phone) && doc.phones.every(a => normalizePhone(a.href) === m.phone) ? 'PASS' : 'FAIL', { expected: m.phone, anchors: doc.phones, actual_call_placed: false });
    report.sections.booking_anchor = m.booking_required === false ? result('PASS', { applicable: false, reason: m.booking_not_applicable_reason }) : result(doc.booking.some(a => a.visible && a.enabled) ? 'PASS' : 'FAIL', { expected: m.expected_booking_url, anchors: doc.booking, actual_booking_created: false });
    const layoutOk = doc.layout.scroll_width <= doc.layout.viewport_width + 1 && Math.abs(doc.layout.inner_width - spec.viewport.width) <= 1;
    report.sections.layout = result(layoutOk && (spec.device_mode !== 'emulated' || /width\s*=\s*device-width/i.test(doc.viewport_meta ?? '')) ? 'PASS' : 'FAIL', { ...doc.layout, configured_width: spec.viewport.width, viewport_meta: doc.viewport_meta });
    report.sections.cta = await checkCtas(page, m);
    report.sections.javascript = result(pageErrors.length ? 'FAIL' : 'PASS', { page_errors: pageErrors, failed_requests: failedRequests, blocked_mutations: blockedMutations });
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); });
    await page.waitForFunction(() => Math.abs(window.scrollY) <= 1, undefined, { timeout: 5000 });
    const screenshotName = `${m.slug}-${spec.id}-first-screen.png`;
    const screenshot = await page.screenshot({ path: path.join(outputDir, screenshotName), fullPage: false, scale: 'css', animations: 'disabled', timeout: 15000 });
    const width = screenshot.readUInt32BE(16), height = screenshot.readUInt32BE(20);
    report.sections.screenshot = result(width === spec.viewport.width && height === spec.viewport.height ? 'PASS' : 'FAIL', { path: screenshotName, sha256: sha(screenshot), width, height, full_page: false, scroll_y: await page.evaluate(() => scrollY), first_screen: true });
    report.status = Object.values(report.sections).every(passed) ? 'PASS' : 'FAIL';
  } catch (error) {
    report.status = /Executable doesn't exist|browserType\.launch|Host system is missing dependencies/i.test(errorText(error)) ? 'BLOCKED' : 'FAIL';
    report.reason = errorText(error);
  } finally { if (browser) await browser.close().catch(() => {}); }
  return report;
}

async function bookingEndpoint(m) {
  if (m.booking_required === false) return result('PASS', { applicable: false, reason: m.booking_not_applicable_reason });
  try {
    const response = await fetch(m.expected_booking_url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000) });
    await response.body?.cancel();
    const allowed = new Set([new URL(m.expected_booking_url).hostname, ...(m.allowed_booking_redirect_hosts ?? [])]);
    return result(response.ok && allowed.has(new URL(response.url).hostname) ? 'PASS' : 'FAIL', { requested_url: m.expected_booking_url, final_url: response.url, status_code: response.status, scope: 'Public GET availability; no appointment, login or payment attempt' });
  } catch (error) { return result('UNKNOWN', { reason: errorText(error) }); }
}

function coverage(requirements, reports) {
  return requirements.map(requirement => {
    const profiles = requirement.profiles.map(id => {
      const match = reports.flatMap(report => (report.profiles ?? []).map(profile => ({ profile, report }))).find(({ profile }) => profile.id === id && profile.status === 'PASS' && (requirement.mode === 'native' ? profile.device_mode === 'native_browser' && ({ Windows: 'win32', Android: 'android', iOS: 'ios' })[requirement.os] === profile.runner_os.platform : profile.device_mode === 'emulated' && profile.target_os === requirement.os));
      return match ? { id, status: 'PASS', evidence_subject_sha256: match.report.subject_sha256, runner_os: match.profile.runner_os, device_mode: match.profile.device_mode } : { id, status: 'UNKNOWN', reason: `No passing ${requirement.mode} ${requirement.os} result` };
    });
    return { ...requirement, status: profiles.every(passed) ? 'PASS' : 'UNKNOWN', evidence: profiles };
  });
}

function verifyReportHash(report) {
  const { subject_sha256, ...body } = report;
  return subject_sha256 && sha(JSON.stringify(body)) === subject_sha256;
}

async function finalize(reportPath, evidencePath) {
  const report = await readJson(reportPath), evidence = await readJson(evidencePath);
  if (!verifyReportHash(report)) throw new Error('QA report integrity check failed');
  const blockers = [];
  if (evidence.subject_sha256 !== report.subject_sha256) blockers.push('Evidence belongs to a different tested snapshot');
  const otherReports = [];
  for (const filename of evidence.platform_reports ?? []) {
    const other = await readJson(path.resolve(path.dirname(evidencePath), filename));
    if (!verifyReportHash(other) || other.manifest_sha256 !== report.manifest_sha256 || other.url !== report.url || !other.technical_ready) {
      blockers.push(`Platform report rejected: ${filename}`); continue;
    }
    const sameHtml = other.profiles.every(profile => report.profiles.some(original => original.html_sha256 && original.html_sha256 === profile.html_sha256));
    if (!sameHtml) { blockers.push(`Platform report covers different HTML: ${filename}`); continue; }
    otherReports.push(other);
  }
  const platforms = coverage(report.required_platforms, [report, ...otherReports]);
  if (!platforms.every(passed)) blockers.push('Required platform coverage is incomplete');
  if (!report.technical_ready) blockers.push('Technical QA has failed, blocked or unknown checks');
  const admin = evidence.admin_save ?? {};
  const adminOk = admin.status === 'PASS' && admin.site_url === report.url && norm(admin.evidence_ref) && Number.isFinite(Date.parse(admin.tested_at)) && admin.loaded === true && admin.saved === true && admin.persisted_after_reload === true && admin.advanced_fields_preserved === true && admin.public_reload_verified === true && admin.restored === true && /^[a-f0-9]{64}$/.test(admin.before_sha256 ?? '') && /^[a-f0-9]{64}$/.test(admin.saved_sha256 ?? '') && admin.before_sha256 !== admin.saved_sha256 && admin.restored_sha256 === admin.before_sha256 && report.profiles.some(profile => profile.html_sha256 === admin.verified_public_html_sha256);
  if (!adminOk) blockers.push('Missing or incomplete real admin save/restore evidence for this public page');
  const manager = evidence.manager_approval ?? {};
  const screenshot = report.profiles.find(profile => profile.id === report.outbound_profile)?.sections.screenshot;
  const flags = ['content_verified', 'photos_visually_relevant', 'design_checked', 'contact_verified', 'admin_usable', 'ready_for_use'];
  const managerOk = manager.status === 'APPROVED' && norm(manager.reviewer) && norm(manager.evidence_ref) && Number.isFinite(Date.parse(manager.reviewed_at)) && manager.subject_sha256 === report.subject_sha256 && flags.every(flag => manager[flag] === true) && report.outreach_message_sha256 && manager.message_sha256 === report.outreach_message_sha256 && screenshot?.status === 'PASS' && manager.screenshot_sha256 === screenshot.sha256;
  if (!managerOk) blockers.push('Missing manager approval of this client, exact message and first-screen image');
  const final = { schema_version: 1, evaluated_at: new Date().toISOString(), slug: report.slug, url: report.url, subject_sha256: report.subject_sha256, ready: blockers.length === 0, technical_ready: report.technical_ready, platform_coverage: platforms, admin_save: result(adminOk ? 'PASS' : 'UNKNOWN', { independently_executed_by_this_harness: false, evidence: admin }), manager_approval: result(managerOk ? 'PASS' : 'UNKNOWN', { evidence: manager }), blockers, reminder: 'Approval covers this tested snapshot only; a changed site, image, message or recipient requires a new review.' };
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, `${report.slug}-final-readiness.json`), json(final));
  process.stdout.write(json({ ready: final.ready, blockers, report: path.join(outputDir, `${report.slug}-final-readiness.json`) }));
  process.exitCode = final.ready ? 0 : 2;
}

async function main() {
  if (option('--finalize')) {
    if (!option('--evidence')) throw new Error('--finalize requires --evidence');
    return finalize(path.resolve(option('--finalize')), path.resolve(option('--evidence')));
  }
  const manifestPath = args[0];
  if (!manifestPath || manifestPath.startsWith('--')) throw new Error('Usage: node verify-client-readiness.mjs manifest.json --out directory');
  const m = await readJson(manifestPath);
  const errors = validateManifest(m);
  if (errors.length) throw new Error(`Invalid manifest: ${errors.join('; ')}`);
  await mkdir(outputDir, { recursive: true });
  const report = { schema_version: 1, slug: m.slug, url: m.url, started_at: new Date().toISOString(), runner_os: HOST, manifest_sha256: sha(JSON.stringify(m)), required_platforms: m.required_platforms ?? DEFAULT_PLATFORMS, outbound_profile: m.outbound_profile ?? IDS[1], outreach_message_sha256: norm(m.outreach_message) ? sha(m.outreach_message) : null, profiles: [], booking_endpoint: result('UNKNOWN'), technical_ready: false, ready: false, admin_save: result('UNKNOWN', { reason: 'Separate actual save/restore evidence is mandatory' }), manager_approval: result('UNKNOWN', { reason: 'Independent approval of exact client/site/message/screenshot is mandatory' }) };
  let pw;
  try { pw = await import('playwright'); }
  catch (error) {
    report.profiles = IDS.map(id => ({ id, status: 'BLOCKED', runner_os: HOST, reason: `Playwright unavailable: ${errorText(error)}` }));
  }
  if (pw) {
    report.booking_endpoint = await bookingEndpoint(m);
    for (const spec of profileDefinitions(pw)) report.profiles.push(await runProfile(pw, spec, m));
  }
  report.technical_ready = report.profiles.length === IDS.length && report.profiles.every(passed) && passed(report.booking_endpoint);
  report.platform_coverage = coverage(report.required_platforms, [report]);
  report.finished_at = new Date().toISOString();
  report.subject_sha256 = sha(JSON.stringify(report));
  const filename = path.join(outputDir, `${m.slug}-readiness-report.json`);
  await writeFile(filename, json(report));
  await writeFile(path.join(outputDir, `${m.slug}-tested-manifest.json`), json(m));
  process.stdout.write(json({ ready: false, technical_ready: report.technical_ready, profiles: report.profiles.map(profile => ({ id: profile.id, status: profile.status })), platform_coverage: report.platform_coverage.map(item => ({ os: item.os, mode: item.mode, status: item.status })), report: filename, next: 'Manager and real admin evidence must be attached with --finalize before any send.' }));
  process.exitCode = report.technical_ready ? 0 : 2;
}

main().catch(error => { process.stderr.write(`${errorText(error)}\n`); process.exitCode = 1; });
