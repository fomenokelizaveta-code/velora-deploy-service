const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3000;

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const GENERATOR_VERSION = 'business-site-v2';
const VELORA_ADMIN_SECRET = process.env.VELORA_ADMIN_SECRET || '';

app.use(express.json());

// Health check endpoint
app.get('/v1/health', function (req, res) {
  res.json({
    ok: true,
    service: 'Velora Deploy Service'
  });
});

app.get('/v1/build', function (req, res) {
  res.json({
    ok: true,
    generator: GENERATOR_VERSION
  });
});

// Protected lightweight admin editor for updating a generated site's brief.
app.get('/v1/admin', function (req, res) {
  const slug = sanitizeProjectName(req.query.slug || '');
  const token = String(req.query.token || '');
  if (!slug) return res.status(400).send('Missing slug');
  if (!isSiteAuthorized(slug, token)) return res.status(401).send('Unauthorized');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Velora Admin</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f3ef;color:#171717;margin:0}
    .wrap{max-width:860px;margin:0 auto;padding:28px 18px 70px}
    h1{font-family:Georgia,serif;font-size:42px;margin:0 0 8px}
    p{color:#6f6a64}
    label{display:block;font-weight:700;margin:18px 0 8px}
    input,textarea{width:100%;box-sizing:border-box;border:1px solid #d8d2ca;border-radius:14px;padding:14px;font:inherit;background:#fff}
    textarea{min-height:120px;resize:vertical}
    button{margin-top:20px;border:0;border-radius:999px;padding:14px 22px;background:#171717;color:#fff;font-weight:700;font-size:16px}
    .status{margin-top:14px;font-weight:700}
    code{background:#eee8df;padding:3px 7px;border-radius:7px}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Velora Admin</h1>
    <p>Редактирование сайта <code>${escapeHtml(slug)}</code></p>
    <label>Название бизнеса</label>
    <input id="business_name" placeholder="Название">
    <label>Описание</label>
    <textarea id="business_description" placeholder="Описание бизнеса"></textarea>
    <label>Телефон</label>
    <input id="phone" placeholder="+7 ...">
    <label>Telegram</label>
    <input id="telegram" placeholder="@username или https://t.me/...">
    <label>Адрес</label>
    <input id="address" placeholder="Адрес">
    <label>Режим работы</label>
    <input id="working_hours" placeholder="Ежедневно, 09:00–20:00">
    <label>Заголовок на первом экране</label>
    <input id="headline" placeholder="Заголовок">
    <label>Подзаголовок</label>
    <textarea id="subheadline" placeholder="Подзаголовок"></textarea>
    <label>Ссылка на главное фото</label>
    <input id="hero_image" placeholder="https://...">
    <label>Услуги / товары (JSON-массив)</label>
    <textarea id="services" placeholder='[{"title":"Услуга","description":"Описание","price":"от 1000 ₽"}]'></textarea>
    <label>Отзывы (JSON-массив)</label>
    <textarea id="reviews" placeholder='[{"name":"Анна","text":"Отлично","rating":5}]'></textarea>
    <button id="save">Сохранить и опубликовать</button>
    <div class="status" id="status"></div>
  </div>
  <script>
    const slug = ${JSON.stringify(slug)};
    const token = ${JSON.stringify(token)};
    const $ = id => document.getElementById(id);

    async function load() {
      const r = await fetch('/v1/site-brief?slug=' + encodeURIComponent(slug), {
        headers: {'x-velora-site-token': token}
      });
      if (!r.ok) return;
      const data = await r.json();
      const b = data.brief || {};
      ['business_name','business_description','phone','telegram','address','working_hours','headline','subheadline','hero_image'].forEach(k => {
        if ($(k)) $(k).value = b[k] || '';
      });
      $('services').value = JSON.stringify(b.services || b.products || [], null, 2);
      $('reviews').value = JSON.stringify(b.reviews || [], null, 2);
    }

    $('save').onclick = async () => {
      let services=[], reviews=[];
      try { services = $('services').value.trim() ? JSON.parse($('services').value) : []; } catch(e) { $('status').textContent='Ошибка JSON в услугах'; return; }
      try { reviews = $('reviews').value.trim() ? JSON.parse($('reviews').value) : []; } catch(e) { $('status').textContent='Ошибка JSON в отзывах'; return; }

      const brief = {
        business_name:$('business_name').value,
        business_description:$('business_description').value,
        phone:$('phone').value,
        telegram:$('telegram').value,
        address:$('address').value,
        working_hours:$('working_hours').value,
        headline:$('headline').value,
        subheadline:$('subheadline').value,
        hero_image:$('hero_image').value,
        services,
        reviews
      };

      $('status').textContent='Публикую...';
      const r = await fetch('/v1/admin/update', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-velora-site-token':token},
        body:JSON.stringify({site_slug:slug, site_build_brief:brief})
      });
      const data = await r.json();
      $('status').textContent = data.status === 'OK'
        ? 'Готово: ' + data.site_result_url
        : 'Ошибка: ' + (data.error || 'unknown');
    };

    load();
  </script>
</body>
</html>`;
  res.type('html').send(html);
});

app.get('/v1/site-brief', async function (req, res) {
  const slug = sanitizeProjectName(req.query.slug || '');
  if (!slug) return res.status(400).json({status:'ERROR', error:'Missing slug'});
  const token = String(req.get('x-velora-site-token') || req.query.token || '');
  if (!isSiteAuthorized(slug, token)) return res.status(401).json({status:'ERROR', error:'UNAUTHORIZED'});
  try {
    const url = `https://${slug}.pages.dev/velora-brief.json`;
    const response = await axios.get(url, { timeout: 15000 });
    return res.json({status:'OK', site_slug:slug, brief:response.data || {}});
  } catch (e) {
    return res.status(404).json({status:'ERROR', error:'BRIEF_NOT_FOUND'});
  }
});

app.post('/v1/admin/update', async function (req, res) {
  const body=req.body||{};
  const site_build_brief=body.site_build_brief||{};
  const site_slug=sanitizeProjectName(body.site_slug || site_build_brief.business_name || '');
  if (!site_slug || !site_build_brief.business_name) {
    return res.status(400).json({status:'ERROR', error:'VALIDATION'});
  }
  const token = String(req.get('x-velora-site-token') || body.token || '');
  if (!isSiteAuthorized(site_slug, token)) return res.status(401).json({status:'ERROR', error:'UNAUTHORIZED'});

  try {
    const tempDir=path.join('/tmp', `velora-admin-${Date.now()}`);
    fs.mkdirSync(tempDir,{recursive:true});
    await generateStaticSite(tempDir, site_build_brief, site_slug);
    const projectName=await ensureCloudflareProject(site_slug);
    const deploymentUrl=await deployToCloudflarePages(tempDir, projectName, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN);
    fs.rmSync(tempDir,{recursive:true,force:true});
    return res.json({
      status:'OK',
      site_result_url:deploymentUrl,
      site_admin_url:publicAdminUrl(req, site_slug),
      site_slug
    });
  } catch (error) {
    console.error('Admin update error:', error.message);
    return res.status(200).json({status:'ERROR', error:error.message, site_slug});
  }
});

function siteAdminToken(slug) {
  if (!VELORA_ADMIN_SECRET) return '';
  return crypto
    .createHmac('sha256', VELORA_ADMIN_SECRET)
    .update(String(slug))
    .digest('hex')
    .slice(0, 40);
}

function publicAdminUrl(req, slug) {
  const protocol=(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  const host=req.get('host');
  const token=siteAdminToken(slug);
  return `${protocol}://${host}/v1/admin?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`;
}

function isSiteAuthorized(slug, supplied) {
  const expected = siteAdminToken(slug);
  if (!expected || !supplied || supplied.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Deployment endpoint
app.post('/v1/deploy', async function (req, res) {
  const body = req.body || {};

  const client_id = body.client_id;
  const site_slug = body.site_slug || '';
  const template = body.template || 'vard-baseline';
  const mode = body.mode || 'create_or_update';
  const site_build_brief = body.site_build_brief;

  // Validation
  if (!client_id || !site_build_brief || !site_build_brief.business_name) {
    return res.status(200).json({
      status: 'ERROR',
      site_result_url: '',
      site_admin_url: '',
      error: 'VALIDATION: client_id and business_name are required',
      site_slug: site_slug
    });
  }

  // Validate environment
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
    return res.status(200).json({
      status: 'ERROR',
      site_result_url: '',
      site_admin_url: '',
      error: 'CONFIGURATION: Cloudflare credentials missing',
      site_slug: site_slug,
      template: template,
      mode: mode
    });
  }

  try {
    // Sanitize site_slug for Cloudflare Pages (alphanumeric, hyphens, 1-63 chars)
    const sanitizedSlug = sanitizeProjectName(site_slug || site_build_brief.business_name);
    
    // Create temp directory for the generated site
    const tempDir = path.join('/tmp', `velora-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Generate static website from site_build_brief
    await generateStaticSite(tempDir, site_build_brief, sanitizedSlug);

    // Ensure Cloudflare Pages project exists
    const projectName = await ensureCloudflareProject(sanitizedSlug);

    // Deploy to Cloudflare Pages
    const deploymentUrl = await deployToCloudflarePages(
      tempDir,
      projectName,
      CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN
    );

    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    return res.status(200).json({
      status: 'OK',
      client_id: client_id,
      site_result_url: deploymentUrl,
      site_admin_url: publicAdminUrl(req, sanitizedSlug),
      site_slug: sanitizedSlug,
      template: template,
      mode: mode
    });
  } catch (error) {
    console.error('Deployment error:', error.message);
    return res.status(200).json({
      status: 'ERROR',
      site_result_url: '',
      site_admin_url: '',
      error: error.message,
      site_slug: body.site_slug,
      template: template,
      mode: mode
    });
  }
});

/**
 * Sanitize project name for Cloudflare Pages
 * Alphanumeric and hyphens only, 1-63 characters
 */
function sanitizeProjectName(name) {
  let sanitized = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (sanitized.length === 0) {
    sanitized = 'project';
  }

  return sanitized.substring(0, 63);
}

/**
 * Generate a polished one-page business website from site_build_brief.
 * Sections are data-driven: we never invent services, prices, reviews, or contacts.
 */
async function generateStaticSite(outDir, brief, projectName) {
  const businessName = cleanText(brief.business_name, 'Business');
  const businessDescription = cleanText(brief.business_description, '');
  const eyebrow = cleanText(brief.eyebrow || brief.category || brief.city, '');
  const headline = cleanText(brief.headline, businessName);
  const subheadline = cleanText(
    brief.subheadline,
    businessDescription || 'Информация, услуги и контакты в одном месте.'
  );

  const phone = cleanText(brief.phone, '');
  const phoneHref = phone ? 'tel:' + phone.replace(/[^+\d]/g, '') : '';
  const telegramUrl = normalizeTelegramUrl(brief.telegram_url || brief.telegram);
  const whatsappUrl = safeUrl(brief.whatsapp_url || brief.whatsapp);
  const address = cleanText(brief.address, '');
  const workingHours = cleanText(brief.working_hours || brief.hours, '');
  const heroImage = normalizeImageUrl(brief.hero_image || brief.hero_image_url);
  const logoUrl = normalizeImageUrl(brief.logo_url);
  const gallery = normalizeImages(brief.gallery_images || brief.gallery || []);
  const services = normalizeCards(brief.services || []);
  const products = normalizeCards(brief.products || []);
  const benefits = normalizeCards(brief.benefits || []);
  const reviews = normalizeReviews(brief.reviews || []);
  const faq = normalizeFaq(brief.faq || []);

  const primaryActionUrl = safeUrl(brief.primary_action_url) || phoneHref || telegramUrl || whatsappUrl;
  const primaryActionLabel = cleanText(
    brief.primary_action_label,
    phone ? 'Позвонить' : telegramUrl ? 'Написать в Telegram' : 'Связаться'
  );
  const secondaryActionUrl = safeUrl(brief.secondary_action_url) || telegramUrl || whatsappUrl;
  const secondaryActionLabel = cleanText(
    brief.secondary_action_label,
    telegramUrl ? 'Telegram' : whatsappUrl ? 'WhatsApp' : ''
  );

  const theme = {
    accent: safeColor(brief.theme?.accent, '#B58A62'),
    accent2: safeColor(brief.theme?.accent2, '#7C5C45'),
    background: safeColor(brief.theme?.background, '#F7F4EF'),
    surface: safeColor(brief.theme?.surface, '#FFFFFF'),
    text: safeColor(brief.theme?.text, '#171717'),
    muted: safeColor(brief.theme?.muted, '#706B66')
  };

  const seoTitle = cleanText(brief.seo?.title, businessName);
  const seoDescription = cleanText(
    brief.seo?.description,
    businessDescription || subheadline
  ).slice(0, 180);

  const servicesSection = renderCardSection(
    'services',
    cleanText(brief.services_title, 'Услуги'),
    cleanText(brief.services_subtitle, ''),
    services,
    'service'
  );

  const productsSection = renderCardSection(
    'products',
    cleanText(brief.products_title, 'Предложения'),
    cleanText(brief.products_subtitle, ''),
    products,
    'product'
  );

  const benefitsSection = benefits.length
    ? `<section class="section section-soft" id="benefits">
        <div class="shell">
          <div class="section-head">
            <p class="kicker">${escapeHtml(cleanText(brief.benefits_kicker, 'Почему выбирают нас'))}</p>
            <h2>${escapeHtml(cleanText(brief.benefits_title, 'Главное — в деталях'))}</h2>
          </div>
          <div class="benefit-grid">
            ${benefits.map((item, index) => `
              <article class="benefit-card">
                <span class="benefit-number">${String(index + 1).padStart(2, '0')}</span>
                <h3>${escapeHtml(item.title)}</h3>
                ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
              </article>
            `).join('')}
          </div>
        </div>
      </section>`
    : '';

  const gallerySection = gallery.length
    ? `<section class="section" id="gallery">
        <div class="shell">
          <div class="section-head split">
            <div>
              <p class="kicker">${escapeHtml(cleanText(brief.gallery_kicker, 'Галерея'))}</p>
              <h2>${escapeHtml(cleanText(brief.gallery_title, 'Посмотрите ближе'))}</h2>
            </div>
            ${cleanText(brief.gallery_subtitle, '') ? `<p class="section-copy">${escapeHtml(cleanText(brief.gallery_subtitle, ''))}</p>` : ''}
          </div>
          <div class="gallery-grid">
            ${gallery.map((image, index) => `
              <figure class="gallery-item gallery-item-${(index % 5) + 1}">
                <img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.alt || businessName)}" loading="lazy">
              </figure>
            `).join('')}
          </div>
        </div>
      </section>`
    : '';

  const reviewsSection = reviews.length
    ? `<section class="section section-dark" id="reviews">
        <div class="shell">
          <div class="section-head light">
            <p class="kicker">Отзывы</p>
            <h2>${escapeHtml(cleanText(brief.reviews_title, 'Что говорят клиенты'))}</h2>
          </div>
          <div class="review-grid">
            ${reviews.map(review => `
              <article class="review-card">
                <div class="stars" aria-label="${review.rating} из 5">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
                <p class="review-text">“${escapeHtml(review.text)}”</p>
                <p class="review-author">${escapeHtml(review.name)}</p>
              </article>
            `).join('')}
          </div>
        </div>
      </section>`
    : '';

  const faqSection = faq.length
    ? `<section class="section" id="faq">
        <div class="shell shell-narrow">
          <div class="section-head">
            <p class="kicker">FAQ</p>
            <h2>${escapeHtml(cleanText(brief.faq_title, 'Частые вопросы'))}</h2>
          </div>
          <div class="faq-list">
            ${faq.map(item => `
              <details class="faq-item">
                <summary>${escapeHtml(item.question)}</summary>
                <p>${escapeHtml(item.answer)}</p>
              </details>
            `).join('')}
          </div>
        </div>
      </section>`
    : '';

  const contactRows = [
    phone ? `<a href="${escapeAttr(phoneHref)}"><span>Телефон</span><strong>${escapeHtml(phone)}</strong></a>` : '',
    address ? `<div><span>Адрес</span><strong>${escapeHtml(address)}</strong></div>` : '',
    workingHours ? `<div><span>Режим работы</span><strong>${escapeHtml(workingHours)}</strong></div>` : ''
  ].filter(Boolean).join('');

  const contactSection = (contactRows || primaryActionUrl || secondaryActionUrl)
    ? `<section class="section contact-section" id="contacts">
        <div class="shell">
          <div class="contact-card">
            <div class="contact-copy">
              <p class="kicker">Контакты</p>
              <h2>${escapeHtml(cleanText(brief.contact_title, 'Будем на связи'))}</h2>
              ${cleanText(brief.contact_text, '') ? `<p>${escapeHtml(cleanText(brief.contact_text, ''))}</p>` : ''}
              <div class="contact-actions">
                ${primaryActionUrl ? `<a class="button button-primary" href="${escapeAttr(primaryActionUrl)}">${escapeHtml(primaryActionLabel)}</a>` : ''}
                ${secondaryActionUrl && secondaryActionLabel && secondaryActionUrl !== primaryActionUrl
                  ? `<a class="button button-ghost" href="${escapeAttr(secondaryActionUrl)}">${escapeHtml(secondaryActionLabel)}</a>`
                  : ''}
              </div>
            </div>
            ${contactRows ? `<div class="contact-list">${contactRows}</div>` : ''}
          </div>
        </div>
      </section>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="${escapeAttr(cleanText(brief.language, 'ru'))}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(seoTitle)}</title>
  <meta name="description" content="${escapeAttr(seoDescription)}">
  <meta name="theme-color" content="${escapeAttr(theme.background)}">
  <meta property="og:title" content="${escapeAttr(seoTitle)}">
  <meta property="og:description" content="${escapeAttr(seoDescription)}">
  <meta property="og:type" content="website">
  ${heroImage ? `<meta property="og:image" content="${escapeAttr(heroImage)}">` : ''}
  <style>
    :root {
      --accent: ${theme.accent};
      --accent-2: ${theme.accent2};
      --bg: ${theme.background};
      --surface: ${theme.surface};
      --text: ${theme.text};
      --muted: ${theme.muted};
      --line: color-mix(in srgb, var(--text) 12%, transparent);
      --shadow: 0 22px 60px rgba(24, 20, 17, .10);
      --radius: 28px;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; text-decoration: none; }
    img { display: block; width: 100%; }
    button, a { -webkit-tap-highlight-color: transparent; }
    .shell { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
    .shell-narrow { width: min(860px, calc(100% - 40px)); margin: 0 auto; }

    .site-header {
      position: absolute;
      inset: 0 0 auto;
      z-index: 20;
      padding: 22px 0;
      color: white;
    }
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; letter-spacing: .01em; }
    .brand-logo {
      width: 44px; height: 44px; border-radius: 50%;
      object-fit: cover; background: rgba(255,255,255,.14);
      border: 1px solid rgba(255,255,255,.28);
    }
    .brand-mark {
      width: 44px; height: 44px; border-radius: 50%;
      display: grid; place-items: center;
      background: rgba(255,255,255,.14);
      border: 1px solid rgba(255,255,255,.28);
      font-weight: 800;
    }
    .nav { display: flex; gap: 24px; font-size: 14px; }
    .nav a { opacity: .82; }
    .nav a:hover { opacity: 1; }

    .hero {
      position: relative;
      min-height: 760px;
      display: flex;
      align-items: end;
      overflow: hidden;
      background:
        radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--accent) 45%, transparent), transparent 34%),
        linear-gradient(145deg, #111 0%, #28221d 100%);
      color: white;
    }
    .hero-media {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: saturate(.92) contrast(1.02);
    }
    .hero-overlay {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(10,9,8,.76) 0%, rgba(10,9,8,.44) 48%, rgba(10,9,8,.10) 100%),
        linear-gradient(0deg, rgba(10,9,8,.70) 0%, transparent 46%);
    }
    .hero-content {
      position: relative;
      z-index: 2;
      padding: 180px 0 84px;
      max-width: 760px;
    }
    .eyebrow, .kicker {
      margin: 0 0 18px;
      text-transform: uppercase;
      letter-spacing: .20em;
      font-size: 12px;
      font-weight: 700;
    }
    .eyebrow { color: rgba(255,255,255,.72); }
    .kicker { color: var(--accent-2); }
    .hero h1 {
      margin: 0;
      max-width: 820px;
      font-family: Georgia, "Times New Roman", serif;
      font-weight: 500;
      font-size: clamp(54px, 8vw, 108px);
      line-height: .92;
      letter-spacing: -.045em;
    }
    .hero-lead {
      margin: 28px 0 0;
      max-width: 620px;
      color: rgba(255,255,255,.82);
      font-size: clamp(18px, 2vw, 23px);
    }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 34px; }
    .button {
      min-height: 52px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 0 22px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 14px;
      transition: transform .2s ease, opacity .2s ease;
    }
    .button:hover { transform: translateY(-2px); }
    .button-primary { background: var(--accent); color: white; }
    .button-light { background: white; color: #161310; }
    .button-ghost { border: 1px solid var(--line); background: transparent; }
    .hero .button-ghost { border-color: rgba(255,255,255,.34); color: white; }

    .section { padding: 104px 0; }
    .section-soft { background: color-mix(in srgb, var(--accent) 8%, var(--bg)); }
    .section-dark { background: #171512; color: white; }
    .section-head { max-width: 760px; margin-bottom: 48px; }
    .section-head.split {
      max-width: none;
      display: grid;
      grid-template-columns: 1fr minmax(260px, 440px);
      gap: 40px;
      align-items: end;
    }
    .section-head h2 {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(40px, 5vw, 68px);
      font-weight: 500;
      line-height: 1;
      letter-spacing: -.035em;
    }
    .section-head.light .kicker { color: #d8b28b; }
    .section-copy { margin: 0; color: var(--muted); font-size: 17px; }

    .intro {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr);
      gap: 70px;
      align-items: start;
    }
    .intro-copy {
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(30px, 4vw, 54px);
      line-height: 1.1;
      letter-spacing: -.025em;
      margin: 0;
    }
    .intro-meta {
      padding-top: 10px;
      color: var(--muted);
      font-size: 16px;
    }

    .card-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 18px;
    }
    .business-card {
      min-height: 360px;
      overflow: hidden;
      position: relative;
      display: flex;
      flex-direction: column;
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .card-media { height: 220px; object-fit: cover; }
    .card-body { padding: 26px; display: flex; flex: 1; flex-direction: column; }
    .card-body h3 { margin: 0; font-size: 23px; letter-spacing: -.02em; }
    .card-body p { margin: 12px 0 0; color: var(--muted); }
    .price { margin-top: auto !important; padding-top: 20px; color: var(--text) !important; font-weight: 800; }

    .benefit-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
    .benefit-card {
      padding: 30px;
      min-height: 230px;
      border-radius: var(--radius);
      background: rgba(255,255,255,.72);
      border: 1px solid rgba(0,0,0,.05);
    }
    .benefit-number { font-size: 12px; color: var(--muted); letter-spacing: .16em; }
    .benefit-card h3 { margin: 52px 0 10px; font-size: 24px; }
    .benefit-card p { margin: 0; color: var(--muted); }

    .gallery-grid {
      display: grid;
      grid-template-columns: 1.25fr .75fr .75fr;
      grid-auto-rows: 260px;
      gap: 14px;
    }
    .gallery-item { margin: 0; overflow: hidden; border-radius: 24px; background: #ddd; }
    .gallery-item img { width: 100%; height: 100%; object-fit: cover; transition: transform .5s ease; }
    .gallery-item:hover img { transform: scale(1.025); }
    .gallery-item-1 { grid-row: span 2; }
    .gallery-item-4 { grid-column: span 2; }

    .review-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .review-card {
      padding: 30px;
      min-height: 280px;
      border-radius: var(--radius);
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.12);
    }
    .stars { color: #d8b28b; letter-spacing: .12em; }
    .review-text { margin: 42px 0 28px; font-family: Georgia, serif; font-size: 24px; line-height: 1.3; }
    .review-author { margin: 0; color: rgba(255,255,255,.64); }

    .faq-list { border-top: 1px solid var(--line); }
    .faq-item { border-bottom: 1px solid var(--line); padding: 22px 0; }
    .faq-item summary { cursor: pointer; font-size: 20px; font-weight: 700; list-style: none; }
    .faq-item summary::-webkit-details-marker { display: none; }
    .faq-item p { color: var(--muted); max-width: 720px; }

    .contact-card {
      display: grid;
      grid-template-columns: 1.2fr .8fr;
      gap: 40px;
      padding: 52px;
      border-radius: 34px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .contact-card h2 {
      margin: 0;
      font-family: Georgia, serif;
      font-size: clamp(42px, 5vw, 66px);
      line-height: 1;
      font-weight: 500;
      letter-spacing: -.035em;
    }
    .contact-copy > p:not(.kicker) { color: var(--muted); max-width: 560px; }
    .contact-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
    .contact-list { display: grid; align-content: start; border-top: 1px solid var(--line); }
    .contact-list > * {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 18px 0;
      border-bottom: 1px solid var(--line);
    }
    .contact-list span { color: var(--muted); font-size: 13px; }
    .contact-list strong { font-size: 17px; }

    footer { padding: 34px 0 96px; color: var(--muted); font-size: 13px; }
    .footer-row { display: flex; justify-content: space-between; gap: 24px; }

    .mobile-actions {
      display: none;
      position: fixed;
      z-index: 40;
      left: 12px;
      right: 12px;
      bottom: max(12px, env(safe-area-inset-bottom));
      gap: 8px;
      padding: 8px;
      border-radius: 999px;
      background: rgba(20,18,16,.88);
      backdrop-filter: blur(16px);
      box-shadow: 0 12px 40px rgba(0,0,0,.24);
    }
    .mobile-actions a { flex: 1; min-height: 46px; }

    @media (max-width: 900px) {
      .nav { display: none; }
      .hero { min-height: 690px; }
      .hero-content { padding-bottom: 58px; }
      .section { padding: 78px 0; }
      .intro,
      .section-head.split,
      .contact-card { grid-template-columns: 1fr; gap: 30px; }
      .card-grid,
      .benefit-grid,
      .review-grid { grid-template-columns: 1fr 1fr; }
      .gallery-grid { grid-template-columns: 1fr 1fr; grid-auto-rows: 220px; }
      .gallery-item-1 { grid-row: span 1; }
      .gallery-item-4 { grid-column: span 1; }
      .contact-card { padding: 34px; }
    }

    @media (max-width: 620px) {
      .shell, .shell-narrow { width: min(100% - 28px, 1180px); }
      .site-header { padding-top: 16px; }
      .brand span { max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .hero { min-height: 650px; }
      .hero-content { padding: 150px 0 46px; }
      .hero h1 { font-size: clamp(48px, 17vw, 76px); }
      .hero-lead { font-size: 18px; }
      .hero-actions .button { width: 100%; }
      .section { padding: 66px 0; }
      .section-head { margin-bottom: 34px; }
      .card-grid,
      .benefit-grid,
      .review-grid,
      .gallery-grid { grid-template-columns: 1fr; }
      .gallery-grid { grid-auto-rows: 300px; }
      .business-card { min-height: 0; }
      .card-media { height: 260px; }
      .contact-card { padding: 26px; border-radius: 26px; }
      .footer-row { flex-direction: column; }
      .mobile-actions { display: flex; }
      footer { padding-bottom: 106px; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="shell header-row">
      <a class="brand" href="#top" aria-label="${escapeAttr(businessName)}">
        ${logoUrl
          ? `<img class="brand-logo" src="${escapeAttr(logoUrl)}" alt="${escapeAttr(businessName)}">`
          : `<span class="brand-mark">${escapeHtml(businessName.slice(0, 1).toUpperCase())}</span>`}
        <span>${escapeHtml(businessName)}</span>
      </a>
      <nav class="nav">
        ${businessDescription ? '<a href="#about">О нас</a>' : ''}
        ${services.length ? '<a href="#services">Услуги</a>' : ''}
        ${products.length ? '<a href="#products">Предложения</a>' : ''}
        ${gallery.length ? '<a href="#gallery">Галерея</a>' : ''}
        ${reviews.length ? '<a href="#reviews">Отзывы</a>' : ''}
        ${contactSection ? '<a href="#contacts">Контакты</a>' : ''}
      </nav>
    </div>
  </header>

  <main id="top">
    <section class="hero">
      ${heroImage ? `<img class="hero-media" src="${escapeAttr(heroImage)}" alt="${escapeAttr(businessName)}">` : ''}
      <div class="hero-overlay"></div>
      <div class="shell hero-content">
        ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
        <h1>${escapeHtml(headline)}</h1>
        <p class="hero-lead">${escapeHtml(subheadline)}</p>
        <div class="hero-actions">
          ${primaryActionUrl ? `<a class="button button-primary" href="${escapeAttr(primaryActionUrl)}">${escapeHtml(primaryActionLabel)}</a>` : ''}
          ${secondaryActionUrl && secondaryActionLabel && secondaryActionUrl !== primaryActionUrl
            ? `<a class="button button-ghost" href="${escapeAttr(secondaryActionUrl)}">${escapeHtml(secondaryActionLabel)}</a>`
            : ''}
        </div>
      </div>
    </section>

    ${businessDescription ? `
      <section class="section" id="about">
        <div class="shell intro">
          <p class="intro-copy">${escapeHtml(businessDescription)}</p>
          <div class="intro-meta">
            ${address ? `<p><strong>Адрес</strong><br>${escapeHtml(address)}</p>` : ''}
            ${workingHours ? `<p><strong>Режим работы</strong><br>${escapeHtml(workingHours)}</p>` : ''}
          </div>
        </div>
      </section>
    ` : ''}

    ${servicesSection}
    ${productsSection}
    ${benefitsSection}
    ${gallerySection}
    ${reviewsSection}
    ${faqSection}
    ${contactSection}
  </main>

  <footer>
    <div class="shell footer-row">
      <span>© ${new Date().getFullYear()} ${escapeHtml(businessName)}</span>
      <span>${escapeHtml(cleanText(brief.footer_note, 'Сайт создан Velora'))}</span>
    </div>
  </footer>

  ${(primaryActionUrl || secondaryActionUrl) ? `
    <div class="mobile-actions" aria-label="Быстрые действия">
      ${primaryActionUrl ? `<a class="button button-primary" href="${escapeAttr(primaryActionUrl)}">${escapeHtml(primaryActionLabel)}</a>` : ''}
      ${secondaryActionUrl && secondaryActionLabel && secondaryActionUrl !== primaryActionUrl
        ? `<a class="button button-light" href="${escapeAttr(secondaryActionUrl)}">${escapeHtml(secondaryActionLabel)}</a>`
        : ''}
    </div>
  ` : ''}
</body>
</html>`;

  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  fs.writeFileSync(path.join(outDir, 'velora-brief.json'), JSON.stringify(brief, null, 2));
  fs.writeFileSync(
    path.join(outDir, 'robots.txt'),
    'User-agent: *\nAllow: /\nSitemap: https://' + projectName + '.pages.dev/sitemap.xml\n'
  );
  fs.writeFileSync(
    path.join(outDir, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      '<url><loc>https://' + escapeXml(projectName) + '.pages.dev/</loc></url>' +
      '</urlset>'
  );
}

function cleanText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function safeColor(value, fallback) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(text) ? text : fallback;
}

function safeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^(https?:\/\/|tel:|mailto:|tg:\/\/|whatsapp:\/\/)/i.test(text)) {
    return text;
  }
  return '';
}

function normalizeTelegramUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('@')) {
    return 'https://t.me/' + text.slice(1).replace(/[^a-zA-Z0-9_]/g, '');
  }
  return safeUrl(text);
}

function normalizeImageUrl(value) {
  const url = safeUrl(value);
  return /^https?:\/\//i.test(url) ? url : '';
}

function normalizeImages(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => {
      if (typeof item === 'string') {
        return { url: normalizeImageUrl(item), alt: '' };
      }
      return {
        url: normalizeImageUrl(item?.url || item?.image_url || item?.src),
        alt: cleanText(item?.alt || item?.title, '')
      };
    })
    .filter(item => item.url)
    .slice(0, 12);
}

function normalizeCards(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => {
      if (typeof item === 'string') {
        return { title: cleanText(item), description: '', price: '', image_url: '' };
      }
      return {
        title: cleanText(item?.title || item?.name, ''),
        description: cleanText(item?.description || item?.text, ''),
        price: cleanText(item?.price, ''),
        image_url: normalizeImageUrl(item?.image_url || item?.image || item?.photo)
      };
    })
    .filter(item => item.title)
    .slice(0, 12);
}

function normalizeReviews(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => ({
      name: cleanText(item?.name || item?.author, 'Клиент'),
      text: cleanText(item?.text || item?.review, ''),
      rating: Math.max(1, Math.min(5, Number(item?.rating) || 5))
    }))
    .filter(item => item.text)
    .slice(0, 9);
}

function normalizeFaq(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => ({
      question: cleanText(item?.question || item?.title, ''),
      answer: cleanText(item?.answer || item?.text, '')
    }))
    .filter(item => item.question && item.answer)
    .slice(0, 12);
}

function renderCardSection(id, title, subtitle, items, kind) {
  if (!items.length) return '';

  return `<section class="section" id="${escapeAttr(id)}">
    <div class="shell">
      <div class="section-head split">
        <div>
          <p class="kicker">${kind === 'service' ? 'Услуги' : 'Каталог'}</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        ${subtitle ? `<p class="section-copy">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      <div class="card-grid">
        ${items.map(item => `
          <article class="business-card">
            ${item.image_url ? `<img class="card-media" src="${escapeAttr(item.image_url)}" alt="${escapeAttr(item.title)}" loading="lazy">` : ''}
            <div class="card-body">
              <h3>${escapeHtml(item.title)}</h3>
              ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
              ${item.price ? `<p class="price">${escapeHtml(item.price)}</p>` : ''}
            </div>
          </article>
        `).join('')}
      </div>
    </div>
  </section>`;
}

function escapeAttr(text) {
  return escapeHtml(String(text || ''));
}

function escapeXml(text) {
  return String(text || '').replace(/[<>&'"]/g, ch => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;'
  }[ch]));
}

/**
 * Ensure Cloudflare Pages project exists
 */
async function ensureCloudflareProject(projectName) {
  try {
    // Check if project exists
    const getUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}`;
    
    const getResponse = await axios.get(getUrl, {
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (getResponse.data.success) {
      console.log(`Project ${projectName} already exists`);
      return projectName;
    }
  } catch (error) {
    if (error.response?.status !== 404) {
      console.error('Unexpected error checking project:', error.message);
      throw error;
    }
  }

  // Project doesn't exist, create it
  try {
    const createUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects`;
    
    const createResponse = await axios.post(
      createUrl,
      {
        name: projectName,
        production_branch: 'main'
      },
      {
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (createResponse.data.success) {
      console.log(`Created new project: ${projectName}`);
      return projectName;
    } else {
      throw new Error(`Failed to create project: ${createResponse.data.errors?.[0]?.message || 'Unknown error'}`);
    }
  } catch (error) {
    if (error.response?.data?.errors) {
      throw new Error(`Cloudflare API error: ${error.response.data.errors[0]?.message}`);
    }
    throw error;
  }
}

/**
 * Deploy to Cloudflare Pages using Wrangler Direct Upload.
 * Wrangler handles asset hashing, upload tokens, missing-asset checks,
 * MIME types, manifests, and the final Pages deployment.
 */
async function deployToCloudflarePages(siteDir, projectName, accountId, apiToken) {
  const wranglerBin = path.join(process.cwd(), 'node_modules', '.bin', 'wrangler');

  try {
    await execFileAsync(
      wranglerBin,
      [
        'pages',
        'deploy',
        siteDir,
        '--project-name',
        projectName,
        '--branch',
        'main'
      ],
      {
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: accountId,
          CLOUDFLARE_API_TOKEN: apiToken,
          CI: 'true'
        },
        timeout: 180000,
        maxBuffer: 10 * 1024 * 1024
      }
    );

    const deploymentUrl = `https://${projectName}.pages.dev`;
    console.log(`Deployment successful: ${deploymentUrl}`);
    return deploymentUrl;
  } catch (error) {
    const detail = [
      error.stderr,
      error.stdout,
      error.message
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);

    throw new Error(`Cloudflare Wrangler deployment failed: ${detail}`);
  }
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

app.listen(PORT, '0.0.0.0', function () {
  console.log('Velora Deploy Service listening on port ' + PORT);
});

