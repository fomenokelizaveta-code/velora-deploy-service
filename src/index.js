const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { chromium } = require('playwright-core');

const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3000;

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const GENERATOR_VERSION = 'business-site-v5-russia-safe-proxy';
const VELORA_ADMIN_SECRET = process.env.VELORA_ADMIN_SECRET || '';
const VELORA_API_KEY = process.env.VELORA_API_KEY || '';
const VELORA_MAKE_API_KEY = process.env.VELORA_MAKE_API_KEY || '';

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

app.get('/vard', async function (req, res) {
  return proxyCloudflarePagesRequest(req, res, 'vard-flowers-sevastopol', '', '/vard/');
});

app.get('/vard/*', async function (req, res) {
  return proxyCloudflarePagesRequest(req, res, 'vard-flowers-sevastopol', req.params[0] || '', '/vard/');
});

app.get('/vard-api', function (req, res) {
  return res.redirect(302, '/vard-api/');
});

app.get('/vard-api/*', async function (req, res) {
  const rel = String(req.params[0] || '').replace(/^\/+/, '');
  const upstream = 'https://blue-cvard-flowers-cms-apiloud-58a4.lolikingor18.workers.dev/' + rel;
  try {
    const response = await axios.get(upstream, {
      timeout: 20000,
      maxRedirects: 5,
      responseType: 'arraybuffer',
      validateStatus: function () { return true; },
      headers: {
        'User-Agent': 'Velora-Railway-Gateway/1.0',
        'Accept': req.get('accept') || '*/*'
      }
    });
    let data = Buffer.from(response.data || []);
    const contentType = String(response.headers['content-type'] || 'application/octet-stream');
    if (/json|text|javascript/i.test(contentType)) {
      let text = data.toString('utf8');
      const origin = publicRequestOrigin(req);
      text = text
        .replace(/https:\/\/vard-flowers-velora(?:-1qm)?\.pages\.dev\//g, origin + '/vard/')
        .replace(/https:\/\/vard-flowers-sevastopol\.pages\.dev\//g, origin + '/vard/')
        .replace(/(["'])\/assets\//g, '$1/vard/assets/')
        .replace(/(["'])\/fonts\//g, '$1/vard/fonts/');
      data = Buffer.from(text, 'utf8');
    }
    res.status(response.status);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-store');
    return res.send(data);
  } catch (error) {
    console.error('VARD CMS gateway error:', error.message);
    return res.status(502).send('VARD CMS gateway unavailable');
  }
});

app.get('/site/:subdomain', async function (req, res) {
  const subdomain = sanitizePagesSubdomain(req.params.subdomain);
  if (!subdomain) return res.status(400).send('Invalid site');
  return proxyCloudflarePagesRequest(req, res, subdomain, '', '/site/' + encodeURIComponent(subdomain) + '/');
});

app.get('/site/:subdomain/*', async function (req, res) {
  const subdomain = sanitizePagesSubdomain(req.params.subdomain);
  if (!subdomain) return res.status(400).send('Invalid site');
  return proxyCloudflarePagesRequest(req, res, subdomain, req.params[0] || '', '/site/' + encodeURIComponent(subdomain) + '/');
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
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
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
      site_result_url:publicSiteUrl(req, deploymentUrl),
      site_admin_url:publicAdminUrl(req, site_slug),
      site_slug
    });
  } catch (error) {
    console.error('Admin update error:', error.message);
    return res.status(200).json({status:'ERROR', error:error.message, site_slug});
  }
});


function publicRequestOrigin(req) {
  const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = req.get('host');
  return protocol + '://' + host;
}

function sanitizePagesSubdomain(value) {
  const text = String(value || '').toLowerCase().trim();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text) ? text : '';
}

function publicSiteUrl(req, deploymentUrl) {
  try {
    const parsed = new URL(String(deploymentUrl || ''));
    if (!parsed.hostname.endsWith('.pages.dev')) return deploymentUrl;
    const subdomain = sanitizePagesSubdomain(parsed.hostname.slice(0, -'.pages.dev'.length));
    if (!subdomain) return deploymentUrl;
    return publicRequestOrigin(req) + '/site/' + encodeURIComponent(subdomain) + '/';
  } catch (error) {
    return deploymentUrl;
  }
}

function rewriteProxiedText(text, req, subdomain, publicBasePath) {
  const origin = publicRequestOrigin(req);
  const base = publicBasePath || ('/site/' + encodeURIComponent(subdomain) + '/');
  let out = String(text || '');

  // Keep all local VARD assets on Railway instead of sending the client back to Cloudflare.
  out = out
    .replace(/(["'(=])\/assets\//g, '$1' + base + 'assets/')
    .replace(/(["'(=])\/fonts\//g, '$1' + base + 'fonts/')
    .replace(/(["'(=])\/content\.js/g, '$1' + base + 'content.js');

  if (subdomain.indexOf('vard-flowers') === 0) {
    out = out
      .replace(/https:\/\/blue-cvard-flowers-cms-apiloud-58a4\.lolikingor18\.workers\.dev/g, origin + '/vard-api')
      .replace(/https:\/\/vard-flowers-velora(?:-1qm)?\.pages\.dev\//g, origin + base)
      .replace(/https:\/\/vard-flowers-sevastopol\.pages\.dev\//g, origin + base);
  }

  return out;
}

async function proxyCloudflarePagesRequest(req, res, subdomain, relativePath, publicBasePath) {
  const safeSubdomain = sanitizePagesSubdomain(subdomain);
  if (!safeSubdomain) return res.status(400).send('Invalid site');

  const rel = String(relativePath || '').replace(/^\/+/, '');
  const upstream = 'https://' + safeSubdomain + '.pages.dev/' + rel;

  try {
    const response = await axios.get(upstream, {
      timeout: 25000,
      maxRedirects: 5,
      responseType: 'arraybuffer',
      validateStatus: function () { return true; },
      headers: {
        'User-Agent': req.get('user-agent') || 'Velora-Railway-Gateway/1.0',
        'Accept': req.get('accept') || '*/*'
      }
    });

    let data = Buffer.from(response.data || []);
    const contentType = String(response.headers['content-type'] || 'application/octet-stream');

    if (/text\/html|text\/css|javascript|application\/json|text\/plain/i.test(contentType)) {
      data = Buffer.from(
        rewriteProxiedText(data.toString('utf8'), req, safeSubdomain, publicBasePath),
        'utf8'
      );
    }

    res.status(response.status);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', /text\/html/i.test(contentType) ? 'no-cache' : 'public, max-age=300');
    res.set('X-Velora-Gateway', 'railway');
    return res.send(data);
  } catch (error) {
    console.error('Pages gateway error for ' + safeSubdomain + ':', error.message);
    return res.status(502).send('Site gateway unavailable');
  }
}

function isDeployAuthorized(req) {
  const supplied = String(req.get('x-velora-api-key') || '');
  const keys = [VELORA_API_KEY, VELORA_MAKE_API_KEY].filter(Boolean);
  for (const key of keys) {
    if (supplied.length !== key.length) continue;
    try {
      if (crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(key))) return true;
    } catch {}
  }
  return false;
}

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
  if (!isDeployAuthorized(req)) {
    return res.status(401).json({status:'ERROR', error:'UNAUTHORIZED'});
  }

  const body = req.body || {};
  const client_id = body.client_id;
  const site_slug = body.site_slug || '';
  const template = body.template || 'vard-baseline';
  const mode = body.mode || 'create_or_update';
  const site_build_brief = body.site_build_brief;

  if (!client_id || !site_build_brief || !site_build_brief.business_name) {
    return res.status(200).json({
      status: 'ERROR',
      client_id: client_id || '',
      site_result_url: '',
      site_admin_url: '',
      error: 'VALIDATION: client_id and business_name are required',
      site_slug: site_slug,
      template: template,
      mode: mode
    });
  }

  const result = await performSiteDeployment(req, {
    client_id,
    site_slug,
    template,
    mode,
    site_build_brief
  });

  return res.status(200).json(result);
});

// n8n / VELORA MANAGER bridge.
// This endpoint returns the exact state fields the manager can upsert into VELORA Clients.
app.post('/v1/manager/site-build', async function (req, res) {
  if (!isDeployAuthorized(req)) {
    return res.status(401).json({status:'ERROR', error_text:'UNAUTHORIZED'});
  }

  const body = req.body || {};
  const client_id = cleanText(body.client_id, '');
  const business_name = cleanText(
    body.business_name || body.site_build_brief?.business_name,
    ''
  );
  const contact = cleanText(body.contact, '');
  const requestedStatus = cleanText(body.status, '');

  if (!client_id || !business_name) {
    return res.status(200).json({
      client_id,
      business_name,
      contact,
      status: 'ERROR',
      site_url: '',
      admin_url: '',
      screenshots_status: 'PENDING',
      video_status: 'PENDING',
      send_status: 'PENDING',
      manager_comment: 'Site build validation failed',
      error_text: 'VALIDATION: client_id and business_name are required'
    });
  }

  if (requestedStatus && requestedStatus !== 'SITE_BUILDING') {
    return res.status(200).json({
      client_id,
      business_name,
      contact,
      status: requestedStatus,
      site_url: cleanText(body.site_url, ''),
      admin_url: cleanText(body.admin_url, ''),
      screenshots_status: cleanText(body.screenshots_status, 'PENDING'),
      video_status: cleanText(body.video_status, 'PENDING'),
      send_status: cleanText(body.send_status, 'PENDING'),
      manager_comment: 'No site build started because status is not SITE_BUILDING',
      error_text: ''
    });
  }

  const site_build_brief = {
    ...(body.site_build_brief || {}),
    business_name
  };

  const result = await performSiteDeployment(req, {
    client_id,
    site_slug: cleanText(body.site_slug, ''),
    template: cleanText(body.template, 'vard-baseline'),
    mode: cleanText(body.mode, 'create_or_update'),
    site_build_brief
  });

  if (result.status === 'OK') {
    return res.status(200).json({
      client_id,
      business_name,
      contact,
      status: 'SITE_READY',
      site_url: result.site_result_url,
      admin_url: result.site_admin_url,
      site_slug: result.site_slug,
      screenshots_status: 'PENDING',
      video_status: 'PENDING',
      send_status: 'PENDING',
      client_reply: cleanText(body.client_reply, ''),
      manager_comment: 'Site deployed successfully. Next required state: QA.',
      error_text: ''
    });
  }

  return res.status(200).json({
    client_id,
    business_name,
    contact,
    status: 'ERROR',
    site_url: '',
    admin_url: '',
    site_slug: result.site_slug || '',
    screenshots_status: 'PENDING',
    video_status: 'PENDING',
    send_status: 'PENDING',
    client_reply: cleanText(body.client_reply, ''),
    manager_comment: 'Site build failed. Preserve error_text and stop automatic progression.',
    error_text: result.error || 'UNKNOWN_DEPLOYMENT_ERROR'
  });
});


app.post('/v1/manager/qa', async function (req, res) {
  if (!isDeployAuthorized(req)) {
    return res.status(401).json({status:'ERROR', error_text:'UNAUTHORIZED'});
  }

  const body=req.body||{};
  const client_id=cleanText(body.client_id,'');
  const business_name=cleanText(body.business_name,'');
  const site_url=cleanText(body.site_url,'');
  const current_status=cleanText(body.status,'');

  if (!client_id || !site_url) {
    return res.status(200).json({
      client_id,
      status:'ERROR',
      qa_status:'FAILED',
      qa_report:'VALIDATION: client_id and site_url are required',
      manager_comment:'QA could not start.',
      error_text:'VALIDATION: client_id and site_url are required'
    });
  }

  if (current_status && current_status !== 'QA') {
    return res.status(200).json({
      client_id,
      status:current_status,
      qa_status:cleanText(body.qa_status,'PENDING'),
      qa_report:cleanText(body.qa_report,''),
      manager_comment:'QA skipped because status is not QA.',
      error_text:''
    });
  }

  try {
    const result=await runSiteQa({
      site_url,
      business_name,
      expected_phone:cleanText(body.phone,''),
      expected_contact:cleanText(body.contact,'')
    });

    return res.status(200).json({
      client_id,
      business_name,
      status:'QA',
      site_url,
      admin_url:cleanText(body.admin_url,''),
      site_slug:cleanText(body.site_slug,''),
      qa_status:result.passed ? 'PASSED' : 'FAILED',
      qa_report:JSON.stringify(result),
      screenshots_status:cleanText(body.screenshots_status,'PENDING'),
      video_status:cleanText(body.video_status,'PENDING'),
      send_status:cleanText(body.send_status,'PENDING'),
      manager_comment:result.passed
        ? 'QA passed. Keep status QA until screenshots and video are ready.'
        : 'QA failed. Fix the site before materials generation.',
      error_text:result.passed ? '' : 'QA_FAILED'
    });
  } catch (error) {
    return res.status(200).json({
      client_id,
      status:'ERROR',
      qa_status:'FAILED',
      qa_report:JSON.stringify({passed:false,error:error.message}),
      manager_comment:'QA request failed.',
      error_text:'QA_ERROR: '+error.message
    });
  }
});

async function runSiteQa({site_url,business_name,expected_phone,expected_contact}) {
  const report={
    passed:false,
    checked_at:new Date().toISOString(),
    site_url,
    checks:[],
    warnings:[]
  };

  const add=(name,pass,detail='')=>{
    report.checks.push({name,pass,detail});
    return pass;
  };

  const response=await axios.get(site_url,{
    timeout:20000,
    maxRedirects:5,
    validateStatus:()=>true,
    headers:{'User-Agent':'Velora-QA/1.0'}
  });

  add('http_status',response.status>=200&&response.status<400,String(response.status));

  const deviceProfiles=[
    {
      name:'windows',
      ua:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    },
    {
      name:'android',
      ua:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    },
    {
      name:'iphone',
      ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
    }
  ];
  for(const profile of deviceProfiles){
    try{
      const deviceResp=await axios.get(site_url,{
        timeout:15000,
        maxRedirects:5,
        validateStatus:()=>true,
        headers:{'User-Agent':profile.ua,'Accept':'text/html,application/xhtml+xml'}
      });
      add('device_http_'+profile.name,deviceResp.status>=200&&deviceResp.status<400,String(deviceResp.status));
    }catch(e){
      add('device_http_'+profile.name,false,e.message);
    }
  }

  const html=typeof response.data==='string' ? response.data : String(response.data||'');

  add('html_present',html.length>300,'bytes='+html.length);
  add('viewport_meta',/<meta[^>]+name=["']viewport["'][^>]*>/i.test(html));
  add('title_present',/<title>[^<]{2,}<\/title>/i.test(html));
  add('h1_present',/<h1[^>]*>[^<]{2,}<\/h1>/i.test(html));

  if (business_name) {
    add('business_name_present',html.toLowerCase().includes(business_name.toLowerCase()),business_name);
  }

  const badPlaceholders=['lorem ipsum','example.com','your business','business name','todo','undefined','null'];
  const foundBad=badPlaceholders.filter(x=>html.toLowerCase().includes(x));
  add('no_placeholder_text',foundBad.length===0,foundBad.join(', '));

  const briefUrl=site_url.replace(/\/$/,'')+'/velora-brief.json';
  let brief={};
  try {
    const briefResp=await axios.get(briefUrl,{timeout:15000,validateStatus:()=>true});
    if(briefResp.status>=200&&briefResp.status<400&&briefResp.data&&typeof briefResp.data==='object'){
      brief=briefResp.data;
      add('brief_available',true);
    } else {
      add('brief_available',false,'status='+briefResp.status);
    }
  } catch(e) {
    add('brief_available',false,e.message);
  }

  const expectedPhone=cleanText(expected_phone || brief.phone,'');
  if(expectedPhone){
    const normalized=expectedPhone.replace(/[^+\d]/g,'');
    const telMatch=(html.match(/href=["']tel:([^"']+)["']/i)||[])[1]||'';
    add('phone_link_present',telMatch.replace(/[^+\d]/g,'')===normalized,expectedPhone);
  }

  const tg=normalizeTelegramUrl(brief.telegram_url||brief.telegram);
  if(tg){
    add('telegram_link_present',html.includes(tg),tg);
  }

  const hrefs=[...html.matchAll(/href=["'](https?:\/\/[^"'#]+)["']/gi)].map(m=>m[1]);
  const images=[...html.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi)].map(m=>m[1]);

  const uniqueLinks=[...new Set(hrefs)].slice(0,8);
  for(const url of uniqueLinks){
    try{
      const r=await axios.get(url,{timeout:10000,maxRedirects:3,validateStatus:()=>true,headers:{'User-Agent':'Velora-QA/1.0'}});
      const ok=r.status>=200&&r.status<400;
      report.checks.push({name:'external_link',pass:ok,detail:url+' -> '+r.status});
    }catch(e){
      report.checks.push({name:'external_link',pass:false,detail:url+' -> '+e.message});
    }
  }

  const uniqueImages=[...new Set(images)].slice(0,8);
  for(const url of uniqueImages){
    try{
      const r=await axios.get(url,{timeout:10000,maxRedirects:3,validateStatus:()=>true,responseType:'arraybuffer',headers:{'User-Agent':'Velora-QA/1.0'}});
      const ok=r.status>=200&&r.status<400;
      report.checks.push({name:'image_asset',pass:ok,detail:url+' -> '+r.status});
    }catch(e){
      report.checks.push({name:'image_asset',pass:false,detail:url+' -> '+e.message});
    }
  }

  const criticalNames=new Set([
    'http_status','device_http_windows','device_http_android','device_http_iphone',
    'html_present','viewport_meta','title_present','h1_present',
    'business_name_present','no_placeholder_text','brief_available',
    'phone_link_present','telegram_link_present'
  ]);
  const critical=report.checks.filter(x=>criticalNames.has(x.name));
  const assetFailures=report.checks.filter(x=>(x.name==='image_asset'||x.name==='external_link')&&!x.pass);

  report.passed=critical.every(x=>x.pass) && assetFailures.length===0;
  report.summary={
    total_checks:report.checks.length,
    failed_checks:report.checks.filter(x=>!x.pass).length,
    asset_failures:assetFailures.length
  };

  return report;
}


app.post('/v1/manager/materials', async function (req, res) {
  if (!isDeployAuthorized(req)) {
    return res.status(401).json({status:'ERROR', error_text:'UNAUTHORIZED'});
  }

  const body=req.body||{};
  const client_id=cleanText(body.client_id,'');
  const business_name=cleanText(body.business_name,'');
  const site_url=cleanText(body.site_url,'');
  const site_slug=sanitizeProjectName(body.site_slug || business_name || 'site');
  const current_status=cleanText(body.status,'');
  const qa_status=cleanText(body.qa_status,'').toUpperCase();

  if (!client_id || !site_url) {
    return res.status(200).json({
      client_id,
      status:'ERROR',
      screenshots_status:'ERROR',
      video_status:'ERROR',
      manager_comment:'Materials generation could not start.',
      error_text:'VALIDATION: client_id and site_url are required'
    });
  }

  if (current_status !== 'QA' || qa_status !== 'PASSED') {
    return res.status(200).json({
      client_id,
      business_name,
      status:current_status || 'QA',
      qa_status,
      screenshots_status:cleanText(body.screenshots_status,'PENDING'),
      video_status:cleanText(body.video_status,'PENDING'),
      send_status:cleanText(body.send_status,'PENDING'),
      manager_comment:'Materials generation skipped: QA must be PASSED while status is QA.',
      error_text:''
    });
  }

  let tempDir='';
  let browser=null;

  try {
    tempDir=path.join('/tmp', `velora-materials-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
    fs.mkdirSync(tempDir,{recursive:true});

    browser=await chromium.launch({
      headless:true,
      executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
    });

    const context=await browser.newContext({
      viewport:{width:390,height:693},
      deviceScaleFactor:1,
      isMobile:true,
      hasTouch:true,
      userAgent:'Velora Materials Bot/1.0'
    });
    const page=await context.newPage();

    await page.goto(site_url,{waitUntil:'networkidle',timeout:45000});
    await page.evaluate(async()=>{
      if(document.fonts&&document.fonts.ready){try{await document.fonts.ready;}catch(e){}}
      await new Promise(r=>setTimeout(r,800));
    });

    const screenshotFiles=await captureDistinctScreenshots(page,tempDir);
    const videoFile=await captureScrollVideo(page,tempDir);

    await context.close();
    await browser.close();
    browser=null;

    const materialsProject=materialsProjectName(site_slug);
    await ensureCloudflareProject(materialsProject);
    const materialsRoot=await deployToCloudflarePages(
      tempDir,
      materialsProject,
      CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN
    );

    const screenshotUrls=screenshotFiles.map(name=>materialsRoot+'/'+encodeURIComponent(name));
    const videoUrl=materialsRoot+'/'+encodeURIComponent(videoFile);

    return res.status(200).json({
      client_id,
      business_name,
      status:'QA',
      qa_status:'PASSED',
      site_url,
      site_slug,
      screenshots_status:'READY',
      video_status:'READY',
      send_status:cleanText(body.send_status,'PENDING'),
      screenshots_urls:screenshotUrls,
      video_url:videoUrl,
      materials_url:materialsRoot,
      manager_comment:'Screenshots and MP4 video are ready. Client may advance to MATERIALS_READY.',
      error_text:''
    });
  } catch(error) {
    console.error('Materials generation error:',error.message);
    return res.status(200).json({
      client_id,
      business_name,
      status:'QA',
      qa_status:'PASSED',
      site_url,
      site_slug,
      screenshots_status:'ERROR',
      video_status:'ERROR',
      send_status:cleanText(body.send_status,'PENDING'),
      manager_comment:'Materials generation failed. Keep client in QA.',
      error_text:'MATERIALS_ERROR: '+error.message
    });
  } finally {
    if(browser){try{await browser.close();}catch(e){}}
    if(tempDir){fs.rmSync(tempDir,{recursive:true,force:true});}
  }
});

async function captureDistinctScreenshots(page,outDir) {
  const filenames=[];
  const hashes=new Set();
  const sectionOffsets=await page.evaluate(()=>{
    const els=[...document.querySelectorAll('main section')];
    const offsets=els.map(el=>Math.max(0,Math.floor(el.getBoundingClientRect().top+window.scrollY)));
    const max=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
    if(!offsets.length){
      return [0,Math.floor(max*.25),Math.floor(max*.5),Math.floor(max*.75),max];
    }
    const unique=[...new Set([0,...offsets,max])];
    return unique.slice(0,8);
  });

  for(const y of sectionOffsets){
    if(filenames.length>=5) break;
    await page.evaluate(v=>window.scrollTo({top:v,behavior:'instant'}),y);
    await page.waitForTimeout(350);
    const buf=await page.screenshot({type:'png',fullPage:false});
    const hash=crypto.createHash('sha1').update(buf).digest('hex');
    if(hashes.has(hash)) continue;
    hashes.add(hash);
    const name=`screenshot-${filenames.length+1}.png`;
    fs.writeFileSync(path.join(outDir,name),buf);
    filenames.push(name);
  }

  if(filenames.length<3){
    const max=await page.evaluate(()=>Math.max(0,document.documentElement.scrollHeight-window.innerHeight));
    for(const frac of [0,.25,.5,.75,1]){
      if(filenames.length>=5) break;
      await page.evaluate(v=>window.scrollTo({top:v,behavior:'instant'}),Math.floor(max*frac));
      await page.waitForTimeout(300);
      const buf=await page.screenshot({type:'png',fullPage:false});
      const hash=crypto.createHash('sha1').update(buf).digest('hex');
      if(hashes.has(hash)) continue;
      hashes.add(hash);
      const name=`screenshot-${filenames.length+1}.png`;
      fs.writeFileSync(path.join(outDir,name),buf);
      filenames.push(name);
    }
  }

  if(!filenames.length) throw new Error('No screenshots captured');
  return filenames;
}

async function captureScrollVideo(page,outDir) {
  const framesDir=path.join(outDir,'frames');
  fs.mkdirSync(framesDir,{recursive:true});

  const fps=8;
  const seconds=24;
  const totalFrames=fps*seconds;
  const maxScroll=await page.evaluate(()=>Math.max(0,document.documentElement.scrollHeight-window.innerHeight));
  const faqExists=await page.locator('details summary').count();

  for(let i=0;i<totalFrames;i++){
    const t=i/(totalFrames-1);
    const eased=t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;
    const y=Math.floor(maxScroll*eased);
    await page.evaluate(v=>window.scrollTo({top:v,behavior:'instant'}),y);

    if(faqExists && i===Math.floor(totalFrames*.62)){
      try{
        const first=page.locator('details summary').first();
        await first.scrollIntoViewIfNeeded();
        await first.click({timeout:2000});
      }catch(e){}
    }

    await page.waitForTimeout(90);
    const frameName=String(i+1).padStart(4,'0')+'.jpg';
    await page.screenshot({
      path:path.join(framesDir,frameName),
      type:'jpeg',
      quality:82,
      fullPage:false
    });
  }

  const videoName='site-walkthrough.mp4';
  const videoPath=path.join(outDir,videoName);
  await execFileAsync('ffmpeg',[
    '-y',
    '-framerate',String(fps),
    '-i',path.join(framesDir,'%04d.jpg'),
    '-c:v','libx264',
    '-preset','veryfast',
    '-crf','27',
    '-pix_fmt','yuv420p',
    '-movflags','+faststart',
    videoPath
  ],{timeout:180000,maxBuffer:10*1024*1024});

  fs.rmSync(framesDir,{recursive:true,force:true});

  const stat=fs.statSync(videoPath);
  if(!stat.size) throw new Error('Video file is empty');
  if(stat.size>22*1024*1024) throw new Error('Video file is too large for Pages direct upload');
  return videoName;
}

function materialsProjectName(siteSlug){
  const hash=crypto.createHash('sha1').update(String(siteSlug)).digest('hex').slice(0,8);
  const base=sanitizeProjectName(siteSlug).slice(0,44);
  return sanitizeProjectName(`materials-${base}-${hash}`);
}

app.get('/v1/manager/schema', function (req, res) {
  res.json({
    ok: true,
    endpoint: '/v1/manager/site-build',
    method: 'POST',
    auth_header: 'x-velora-api-key',
    expected_input: {
      client_id: 'string, required',
      business_name: 'string, required unless site_build_brief.business_name exists',
      contact: 'string, optional',
      status: 'SITE_BUILDING',
      site_slug: 'string, optional',
      template: 'string, optional',
      mode: 'create_or_update',
      site_build_brief: 'object, required for real content; business_name is enforced'
    },
    success_output_status: 'SITE_READY',
    failure_output_status: 'ERROR',
    next_manager_state: 'QA',
    qa_endpoint: '/v1/manager/qa',
    qa_success: 'qa_status=PASSED while status stays QA until materials are ready',
    materials_endpoint: '/v1/manager/materials',
    materials_success: 'screenshots_status=READY and video_status=READY while status stays QA'
  });
});

async function performSiteDeployment(req, payload) {
  const {
    client_id,
    site_slug,
    template,
    mode,
    site_build_brief
  } = payload;

  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
    return {
      status: 'ERROR',
      client_id,
      site_result_url: '',
      site_admin_url: '',
      error: 'CONFIGURATION: Cloudflare credentials missing',
      site_slug: site_slug || '',
      template,
      mode
    };
  }

  let tempDir = '';

  try {
    const sanitizedSlug = sanitizeProjectName(site_slug || site_build_brief.business_name);
    tempDir = path.join('/tmp', `velora-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tempDir, { recursive: true });

    await generateStaticSite(tempDir, site_build_brief, sanitizedSlug);
    const projectName = await ensureCloudflareProject(sanitizedSlug);
    const deploymentUrl = await deployToCloudflarePages(
      tempDir,
      projectName,
      CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN
    );

    return {
      status: 'OK',
      client_id,
      site_result_url: publicSiteUrl(req, deploymentUrl),
      site_admin_url: publicAdminUrl(req, sanitizedSlug),
      site_slug: sanitizedSlug,
      template,
      mode
    };
  } catch (error) {
    console.error('Deployment error:', error.message);
    return {
      status: 'ERROR',
      client_id,
      site_result_url: '',
      site_admin_url: '',
      error: error.message,
      site_slug: site_slug || '',
      template,
      mode
    };
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

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
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
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
      --line: rgba(23, 23, 23, .12);
      --shadow: 0 22px 60px rgba(24, 20, 17, .10);
      --radius: 28px;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      width: 100%;
      min-width: 0;
      overflow-x: hidden;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      text-size-adjust: 100%;
      -webkit-text-size-adjust: 100%;
    }
    a { color: inherit; text-decoration: none; }
    img { display: block; width: 100%; max-width: 100%; }
    button, a { -webkit-tap-highlight-color: transparent; }
    .shell { width: calc(100% - 40px); max-width: 1180px; margin: 0 auto; }
    .shell-narrow { width: calc(100% - 40px); max-width: 860px; margin: 0 auto; }

    .site-header {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
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
      align-items: flex-end;
      overflow: hidden;
      background:
        radial-gradient(circle at 78% 18%, rgba(181,138,98,.34), transparent 34%),
        linear-gradient(145deg, #111 0%, #28221d 100%);
      color: white;
    }
    .hero-media {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: saturate(.92) contrast(1.02);
    }
    .hero-overlay {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
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
      max-width: 720px;
      font-family: Georgia, "Times New Roman", serif;
      font-weight: 500;
      font-size: clamp(42px, 6vw, 76px);
      line-height: .98;
      letter-spacing: -.035em;
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
      line-height: 1.2;
      text-align: center;
      white-space: normal;
      transition: transform .2s ease, opacity .2s ease;
    }
    .button:hover { transform: translateY(-2px); }
    .button-primary { background: var(--accent); color: white; }
    .button-light { background: white; color: #161310; }
    .button-ghost { border: 1px solid var(--line); background: transparent; }
    .hero .button-ghost { border-color: rgba(255,255,255,.34); color: white; }

    .section { padding: 104px 0; }
    .section-soft { background: rgba(181,138,98,.08); }
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
      bottom: 12px;
      bottom: max(12px, env(safe-area-inset-bottom));
      gap: 8px;
      padding: 8px;
      border-radius: 999px;
      background: rgba(20,18,16,.88);
      backdrop-filter: blur(16px);
      box-shadow: 0 12px 40px rgba(0,0,0,.24);
    }
    .mobile-actions a { flex: 1; min-width: 0; min-height: 46px; padding-left: 12px; padding-right: 12px; overflow-wrap: anywhere; }
    .brand span, .hero h1, .hero-lead, .contact-list strong { overflow-wrap: anywhere; }

    @media (max-width: 900px) {
      .nav { display: none; }
      .hero { min-height: 610px; }
      .hero-content { padding: 138px 0 48px; max-width: 92%; }
      .hero h1 { font-size: clamp(38px, 12vw, 58px); line-height: 1; }
      .hero-lead { font-size: 17px; margin-top: 18px; }
      .hero-actions { margin-top: 24px; }
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
      .shell, .shell-narrow { width: calc(100% - 28px); }
      .site-header { padding-top: 14px; }
      .brand-logo, .brand-mark { width: 38px; height: 38px; }
      .brand span { max-width: 210px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 15px; }
      .hero { min-height: 540px; }
      .hero-content { padding: 112px 0 38px; max-width: 100%; }
      .hero h1 { font-size: clamp(34px, 10vw, 46px); line-height: 1.02; letter-spacing: -.025em; }
      .hero-lead { font-size: 16px; line-height: 1.45; margin-top: 14px; }
      .eyebrow { font-size: 10px; letter-spacing: .16em; margin-bottom: 12px; }
      .hero-actions { gap: 8px; margin-top: 20px; }
      .hero-actions .button { width: 100%; min-height: 48px; padding: 0 18px; }
      .section { padding: 50px 0; }
      .section-head { margin-bottom: 26px; }
      .section-head h2 { font-size: 32px; line-height: 1.05; }
      .section-head.split { gap: 14px; }
      .section-copy { font-size: 15px; }
      .card-grid,
      .benefit-grid,
      .review-grid,
      .gallery-grid { grid-template-columns: 1fr; }
      .gallery-grid { grid-auto-rows: 230px; gap: 10px; }
      .business-card { min-height: 0; border-radius: 20px; }
      .card-media { height: 190px; }
      .card-body { padding: 20px; }
      .card-body h3 { font-size: 20px; }
      .benefit-card { min-height: 180px; padding: 22px; }
      .benefit-card h3 { margin-top: 34px; font-size: 21px; }
      .review-card { min-height: 220px; padding: 22px; }
      .review-text { margin: 26px 0 20px; font-size: 20px; }
      .contact-card { padding: 24px; border-radius: 24px; }
      .contact-card h2 { font-size: 34px; }
      .footer-row { flex-direction: column; }
      .mobile-actions { display: flex; }
      footer { padding-bottom: 106px; }
    }

    @media (max-width: 380px) {
      .shell, .shell-narrow { width: calc(100% - 20px); }
      .hero h1 { font-size: 32px; }
      .hero-lead { font-size: 15px; }
      .contact-card { padding: 20px; }
      .mobile-actions { left: 8px; right: 8px; padding: 6px; }
      .mobile-actions a { font-size: 12px; padding-left: 8px; padding-right: 8px; }
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

    let deploymentUrl = `https://${projectName}.pages.dev`;
    try {
      const projectInfoUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`;
      const projectInfo = await axios.get(projectInfoUrl, {
        timeout: 15000,
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });
      const actualSubdomain = projectInfo.data?.result?.subdomain;
      if (actualSubdomain) {
        deploymentUrl = `https://${actualSubdomain}`;
      }
    } catch (lookupError) {
      console.warn('Could not resolve actual Pages subdomain:', lookupError.message);
    }
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


const SALES_DEMOS = {
  'amate-sevastopol': {
    business_name: 'АМАТЭ Севастополь',
    eyebrow: 'Студия эстетики тела · Севастополь',
    headline: 'Аматэ',
    business_description: 'Оздоровительные, спортивные, лимфодренажные и антицеллюлитные массажи, косметология, фотоэпиляция и программы коррекции фигуры.',
    subheadline: 'Массаж, косметология и работа с телом в одном пространстве на Античном проспекте.',
    phone: '+7 978 888-60-90',
    telegram: '@amate_sevastopol',
    address: 'Севастополь, проспект Античный, 26к4',
    hero_image: 'https://sun9-17.userapi.com/s/v1/ig2/TVxuDhnUe9RAY-nVnDUha3Tle2_yFsXRE5dYGgl63eBSQCmQlVYwJ-WkNzlVV2X8Ug96uMBYVvJsrzc3-CPwvEDR.jpg?as=32x43%2C48x64%2C72x96%2C108x144%2C160x213%2C240x320%2C360x480%2C480x640%2C540x720%2C640x853%2C720x960%2C1080x1440%2C1280x1707%2C1440x1920%2C1920x2560&cs=200x267&from=bu&quality=95',
    logo_url: 'https://sun9-51.userapi.com/s/v1/ig2/wbcvBVuaktvccHbfoWYY1nJp11HKGMtceACo1LrLTFiMJzL1gtIPxPpQeSmdu2HPK3Zjd0LNtl9UiacbkVjF7IfL.jpg?as=32x32%2C48x48%2C72x72%2C108x108%2C160x160%2C240x240%2C360x360%2C480x480%2C540x540%2C640x640%2C720x720%2C1080x1080%2C1280x1280%2C1440x1440&ava=1&crop=100%2C131%2C1769%2C1769&cs=200x200&quality=95',
    primary_action_url: 'https://dikidi.net/1659449',
    primary_action_label: 'Записаться онлайн',
    secondary_action_url: 'https://t.me/amate_sevastopol',
    secondary_action_label: 'Telegram',
    services_title: 'Услуги Аматэ',
    services_subtitle: 'Подобрали ключевые направления из актуальных публикаций студии — от массажа до косметологии и коррекции фигуры.',
    services: [
      { title: 'Оздоровительный массаж', description: 'Для расслабления, восстановления и снятия мышечного напряжения.', price: 'по записи', image_url: 'https://sun9-17.userapi.com/s/v1/ig2/TVxuDhnUe9RAY-nVnDUha3Tle2_yFsXRE5dYGgl63eBSQCmQlVYwJ-WkNzlVV2X8Ug96uMBYVvJsrzc3-CPwvEDR.jpg?as=32x43%2C48x64%2C72x96%2C108x144%2C160x213%2C240x320%2C360x480%2C480x640%2C540x720%2C640x853%2C720x960%2C1080x1440%2C1280x1707%2C1440x1920%2C1920x2560&cs=200x267&from=bu&quality=95' },
      { title: 'Лимфодренажный массаж', description: 'Работа с отёчностью, ощущением тяжести и тонусом тела.', price: 'по записи', image_url: 'https://sun9-78.userapi.com/s/v1/ig2/50oxGPFLOgd8OEaobpp0CPnVNAMx3--x-XPe91CdZJrWn_uFE297SNns4kOUrNQXJE1-qFGlb7M_uJhjE1lRx2mX.jpg?as=32x32%2C48x48%2C72x72%2C108x108%2C160x160%2C240x240%2C360x360%2C480x480%2C540x540%2C640x640%2C720x720%2C1080x1080%2C1280x1280%2C1440x1440%2C2560x2560&cs=200x200&from=bu&quality=95' },
      { title: 'Антицеллюлитные программы', description: 'Комплексные программы коррекции фигуры и ухода за телом.', price: 'по записи', image_url: 'https://sun9-4.userapi.com/s/v1/ig2/SELerdOEZfH1fFBHUUdIAbOxTh23LKvvOPued1v-1XYjNovC6ZpJatypRuv6XzuuruXyeEJhutdRZ7vf9mwpTGFG.jpg?as=32x57%2C48x85%2C72x128%2C108x192%2C160x284%2C240x426%2C360x639%2C474x842&cs=200x355&from=bu&quality=95' },
      { title: 'Косметология', description: 'Уходовые процедуры, пилинги и персонально подобранные программы для кожи.', price: 'консультация', image_url: 'https://sun9-71.userapi.com/s/v1/ig2/l1KJudahzQbENe3I-NQOhBy0A-jpQoLaa83xemg-wBuX_qk8yD-Lps_C5WnPE_UeLMLUIKrzSDUmMyH34HqC2OuP.jpg?as=32x57%2C48x85%2C72x128%2C108x192%2C160x284%2C240x426%2C360x639%2C474x842&cs=200x355&from=bu&quality=95' },
      { title: 'Фотоэпиляция', description: 'Процедуры для гладкой кожи и уменьшения роста волос.', price: 'от 5 799 ₽ за всё тело', image_url: 'https://sun9-4.userapi.com/s/v1/ig2/igW2I3Qw0G5eTwEuMbvk6y0z5wyBOVy2HNmnB8xb3BQ4GuCEdXxNvZFk356c7Vz9xFzHsFxrQLJxAdvzL74qptdw.jpg?as=32x57%2C48x85%2C72x128%2C108x192%2C160x284%2C240x426%2C360x639%2C474x842&cs=200x355&from=bu&quality=95' },
      { title: 'Аппаратные методики', description: 'RF, HIFEM и другие программы для качества кожи и контуров тела.', price: 'по записи', image_url: 'https://sun9-78.userapi.com/s/v1/ig2/50oxGPFLOgd8OEaobpp0CPnVNAMx3--x-XPe91CdZJrWn_uFE297SNns4kOUrNQXJE1-qFGlb7M_uJhjE1lRx2mX.jpg?as=32x32%2C48x48%2C72x72%2C108x108%2C160x160%2C240x240%2C360x360%2C480x480%2C540x540%2C640x640%2C720x720%2C1080x1080%2C1280x1280%2C1440x1440%2C2560x2560&cs=200x200&from=bu&quality=95' }
    ],
    gallery_title: 'Атмосфера и процедуры',
    gallery_subtitle: 'Использованы фотографии из публичной страницы студии.',
    gallery_images: [
      { url: 'https://sun9-17.userapi.com/s/v1/ig2/TVxuDhnUe9RAY-nVnDUha3Tle2_yFsXRE5dYGgl63eBSQCmQlVYwJ-WkNzlVV2X8Ug96uMBYVvJsrzc3-CPwvEDR.jpg?as=32x43%2C48x64%2C72x96%2C108x144%2C160x213%2C240x320%2C360x480%2C480x640%2C540x720%2C640x853%2C720x960%2C1080x1440%2C1280x1707%2C1440x1920%2C1920x2560&cs=200x267&from=bu&quality=95', alt: 'АМАТЭ Севастополь' },
      { url: 'https://sun9-78.userapi.com/s/v1/ig2/50oxGPFLOgd8OEaobpp0CPnVNAMx3--x-XPe91CdZJrWn_uFE297SNns4kOUrNQXJE1-qFGlb7M_uJhjE1lRx2mX.jpg?as=32x32%2C48x48%2C72x72%2C108x108%2C160x160%2C240x240%2C360x360%2C480x480%2C540x540%2C640x640%2C720x720%2C1080x1080%2C1280x1280%2C1440x1440%2C2560x2560&cs=200x200&from=bu&quality=95', alt: 'АМАТЭ — процедуры' },
      { url: 'https://sun9-4.userapi.com/s/v1/ig2/SELerdOEZfH1fFBHUUdIAbOxTh23LKvvOPued1v-1XYjNovC6ZpJatypRuv6XzuuruXyeEJhutdRZ7vf9mwpTGFG.jpg?as=32x57%2C48x85%2C72x128%2C108x192%2C160x284%2C240x426%2C360x639%2C474x842&cs=200x355&from=bu&quality=95', alt: 'АМАТЭ — эстетика тела' },
      { url: 'https://sun9-71.userapi.com/s/v1/ig2/l1KJudahzQbENe3I-NQOhBy0A-jpQoLaa83xemg-wBuX_qk8yD-Lps_C5WnPE_UeLMLUIKrzSDUmMyH34HqC2OuP.jpg?as=32x57%2C48x85%2C72x128%2C108x192%2C160x284%2C240x426%2C360x639%2C474x842&cs=200x355&from=bu&quality=95', alt: 'АМАТЭ — косметология' },
      { url: 'https://sun9-4.userapi.com/s/v1/ig2/igW2I3Qw0G5eTwEuMbvk6y0z5wyBOVy2HNmnB8xb3BQ4GuCEdXxNvZFk356c7Vz9xFzHsFxrQLJxAdvzL74qptdw.jpg?as=32x57%2C48x85%2C72x128%2C108x192%2C160x284%2C240x426%2C360x639%2C474x842&cs=200x355&from=bu&quality=95', alt: 'АМАТЭ — уходовые процедуры' }
    ],
    benefits_title: 'Забота без суеты',
    benefits: [
      { title: 'Несколько направлений', description: 'Массаж, косметология, аппаратные процедуры и коррекция фигуры в одном месте.' },
      { title: 'Персональный подход', description: 'Программы подбираются под конкретный запрос и комфорт клиента.' },
      { title: 'Онлайн-запись', description: 'Клиент может сразу выбрать удобное время через Dikidi или написать в Telegram.' }
    ],
    faq: [
      { question: 'Где находится студия?', answer: 'Севастополь, проспект Античный, 26к4.' },
      { question: 'Как записаться?', answer: 'Через онлайн-запись Dikidi, Telegram @amate_sevastopol или по телефону +7 978 888-60-90.' },
      { question: 'Какие направления есть?', answer: 'Массажи, косметология, фотоэпиляция, аппаратные методики и программы коррекции фигуры.' }
    ],
    theme: { accent:'#B7A488', accent2:'#7E6B54', background:'#F5F1EB', surface:'#FFFFFF', text:'#211D18', muted:'#746C62' },
    contact_title: 'Запишитесь в Аматэ',
    contact_text: 'Проспект Античный, 26к4 · онлайн-запись и Telegram',
    footer_note: 'Демо-концепт сайта от VELORA AI'
  },
  'studio17-sevastopol': {
    business_name: 'Студия 17',
    eyebrow: 'Барбершоп · Севастополь',
    headline: 'Студия 17',
    business_description: 'Мужские стрижки, бритьё и уход за бородой. Барберы с опытом, премиальный сервис и уютная атмосфера.',
    subheadline: 'Стрижки, борода, бритьё и уход — в одном месте на проспекте Победы.',
    phone: '+7 978 682-72-92',
    telegram: '@studiO_17_sev',
    address: 'Севастополь, проспект Победы, 1А',
    working_hours: 'Ежедневно 10:00–21:00',
    hero_image: 'https://avatars.mds.yandex.net/get-maps-adv-crm/3927175/2a0000017f930c126f5646ca14762b7228e7/landing_background',
    logo_url: 'https://avatars.mds.yandex.net/get-maps-adv-crm/11387709/2a00000194004536be58f49e19cc5f1dd7cc/landing_logo',
    primary_action_url: 'https://studija17.clients.site/',
    primary_action_label: 'Записаться онлайн',
    secondary_action_url: 'https://t.me/studiO_17_sev',
    secondary_action_label: 'Telegram',
    services_title: 'Услуги барбершопа',
    services_subtitle: 'То, за чем сюда возвращаются: чистая форма, аккуратные линии и нормальный мужской сервис.',
    services: [
      { title: 'Мужская стрижка', description: 'Подбор формы под тип волос, привычный стиль и образ жизни.', price: 'от 1 200 ₽', image_url: 'https://avatars.mds.yandex.net/get-maps-adv-crm/3927175/2a0000017f930c126f5646ca14762b7228e7/landing_background' },
      { title: 'Оформление бороды', description: 'Форма, контур, длина и финальная укладка.', price: 'по записи', image_url: 'https://avatars.mds.yandex.net/get-maps-adv-crm/3927175/2a0000017f930c126f5646ca14762b7228e7/landing_background' },
      { title: 'Стрижка + борода', description: 'Комплексный образ за один визит — волосы и борода в одном стиле.', price: 'комплекс', image_url: 'https://avatars.mds.yandex.net/get-maps-adv-crm/3927175/2a0000017f930c126f5646ca14762b7228e7/landing_background' },
      { title: 'Бритьё опасной бритвой', description: 'Классический ритуал с распариванием кожи и уходом.', price: 'по записи', image_url: 'https://avatars.mds.yandex.net/get-maps-adv-crm/3927175/2a0000017f930c126f5646ca14762b7228e7/landing_background' },
      { title: 'Уход за бородой', description: 'Подбор стайлинга, уходовых средств и рекомендации мастера.', price: 'по записи', image_url: 'https://avatars.mds.yandex.net/get-maps-adv-crm/3927175/2a0000017f930c126f5646ca14762b7228e7/landing_background' },
      { title: 'Детская стрижка', description: 'Аккуратная современная форма для детей и подростков.', price: 'по записи', image_url: 'https://avatars.mds.yandex.net/get-maps-adv-crm/3927175/2a0000017f930c126f5646ca14762b7228e7/landing_background' }
    ],
    gallery_title: 'Студия и работы',
    gallery_subtitle: 'Реальная фотография бизнеса из их публичной карточки. Для финальной версии подключим полный фотосет из их галереи.',
    gallery_images: [
      { url: 'https://avatars.mds.yandex.net/get-maps-adv-crm/3927175/2a0000017f930c126f5646ca14762b7228e7/landing_background', alt: 'Студия 17 — барбершоп в Севастополе' },
      { url: 'https://avatars.mds.yandex.net/get-maps-adv-crm/3927175/2a0000017f930c126f5646ca14762b7228e7/landing_background', alt: 'Интерьер Студии 17' },
      { url: 'https://avatars.mds.yandex.net/get-maps-adv-crm/3927175/2a0000017f930c126f5646ca14762b7228e7/landing_background', alt: 'Работа барбершопа Студия 17' },
      { url: 'https://avatars.mds.yandex.net/get-maps-adv-crm/3927175/2a0000017f930c126f5646ca14762b7228e7/landing_background', alt: 'Студия 17, Севастополь' }
    ],
    benefits_title: 'Не просто стрижка',
    benefits: [
      { title: 'Опытные барберы', description: 'Мастера вникают в запрос, предлагают форму и доводят результат до деталей.' },
      { title: 'Премиальный уход', description: 'Профессиональная косметика, уход за бородой и дополнительные процедуры.' },
      { title: 'Уют и сервис', description: 'Кофе, чай, спокойная атмосфера и запись без лишних звонков.' }
    ],
    reviews_title: '245 отзывов · рейтинг 5.0',
    reviews: [
      { name: 'Юлия', rating: 5, text: 'Очень приятная обстановка. Вежливый коллектив. Сын подросток ходил на стрижку — всё понравилось.' },
      { name: 'Артём Волобуев', rating: 5, text: 'Мастер Элина профессионал своего дела, стрижет и бреет так, как никто. Давно искал мастера такого уровня.' },
      { name: 'Роман Олегович', rating: 5, text: 'Был тут не один раз, всё понравилось. Персонал отличный, приду сюда ещё раз.' }
    ],
    faq: [
      { question: 'Где находится Студия 17?', answer: 'Севастополь, проспект Победы, 1А, рядом с ТЦ «Фреш», второй этаж.' },
      { question: 'Как записаться?', answer: 'Через онлайн-запись, Telegram или по телефону +7 978 682-72-92.' },
      { question: 'Как работает барбершоп?', answer: 'Ежедневно с 10:00 до 21:00.' }
    ],
    theme: { accent:'#CDAE6A', accent2:'#9D7B3D', background:'#F5F1EA', surface:'#FFFFFF', text:'#17130F', muted:'#756C62' },
    contact_title: 'Запишитесь на удобное время',
    contact_text: 'Проспект Победы, 1А · ежедневно 10:00–21:00',
    footer_note: 'Демо-концепт сайта от VELORA AI'
  },
  'selfie-sevastopol': {
    business_name: 'Selfie',
    eyebrow: 'Салон красоты · Севастополь',
    headline: 'Красота в деталях',
    business_description: 'Салон красоты, парикмахерские услуги и ногтевой сервис в центре Севастополя.',
    subheadline: 'Уход, стиль и мастера, которым можно доверить свой образ.',
    phone: '+7 978 082-58-22',
    address: 'Севастополь, Большая Морская улица, 5',
    primary_action_label: 'Позвонить и записаться',
    services: [
      { title: 'Парикмахерские услуги', description: 'Стрижки, окрашивание и уход за волосами.' },
      { title: 'Маникюр', description: 'Аккуратный уход и современный дизайн.' },
      { title: 'Педикюр', description: 'Эстетика и комфорт в каждой детали.' },
      { title: 'Мужской сервис', description: 'Уход и ногтевой сервис для мужчин.' }
    ],
    benefits: [
      { title: 'Сильные мастера', description: 'Профессиональный подход и внимание к пожеланиям.' },
      { title: 'Широкий выбор услуг', description: 'Несколько направлений красоты в одном салоне.' },
      { title: 'Удобное расположение', description: 'Центр Севастополя, Большая Морская.' }
    ],
    theme: { accent:'#B58F9B', accent2:'#866671', background:'#FAF5F7', surface:'#FFFFFF', text:'#241F21', muted:'#7B7175' },
    footer_note: 'Демо-концепт сайта от VELORA AI'
  }
};



SALES_DEMOS['bazhanova-clinic-sevastopol'] = {
  business_name: 'Косметологическая клиника Юлии Бажановой',
  eyebrow: 'Врачебная косметология · Севастополь',
  headline: 'Красота с медицинским подходом',
  business_description: 'Клиника косметологии в Севастополе с практикой с 2008 года: инъекционные и эстетические процедуры, работа с качеством кожи и индивидуальные программы ухода.',
  subheadline: 'Профессиональная косметология без лишнего навязывания — с акцентом на безопасность, естественный результат и персональный план.',
  phone: '+7 978 590-39-82',
  address: 'Севастополь, улица Руднева, 26Б, корп. 1',
  working_hours: 'Ежедневно 10:00–20:00',
  primary_action_label: 'Позвонить и записаться',
  services_title: 'Основные направления',
  services_subtitle: 'Ключевые процедуры клиники собраны в понятном каталоге, чтобы клиент сразу видел возможности и мог быстро связаться.',
  services: [
    { title: 'Ботулинотерапия', description: 'Коррекция мимических морщин и работа с мышечным гипертонусом.' },
    { title: 'Контурная пластика', description: 'Коррекция пропорций и контуров лица с индивидуальным подбором процедуры.' },
    { title: 'Биоревитализация', description: 'Программы для увлажнения, восстановления и улучшения качества кожи.' },
    { title: 'Лазерная эпиляция', description: 'Курс процедур для долговременного уменьшения нежелательных волос.' },
    { title: 'Пилинги и чистки', description: 'Комплексное очищение, обновление и уход с учётом состояния кожи.' },
    { title: 'Комплексное омоложение', description: 'Сочетание методик для гармоничной работы с качеством кожи и контурами лица.' }
  ],
  benefits_title: 'Почему клинике доверяют',
  benefits: [
    { title: '17+ лет практики', description: 'Клиника работает с 2008 года и делает ставку на накопленный врачебный опыт.' },
    { title: 'Медицинский подход', description: 'Процедуры подбираются с учётом состояния кожи, показаний и желаемого результата.' },
    { title: 'Индивидуальный план', description: 'Без универсальных схем: рекомендации формируются под конкретный запрос клиента.' }
  ],
  faq: [
    { question: 'Где находится клиника?', answer: 'Севастополь, улица Руднева, 26Б, корпус 1.' },
    { question: 'Как записаться?', answer: 'По телефону +7 978 590-39-82.' },
    { question: 'Какие направления представлены?', answer: 'Инъекционная и эстетическая косметология, биоревитализация, контурная пластика, ботулинотерапия, эпиляция, пилинги и чистки.' }
  ],
  theme: { accent:'#B9988D', accent2:'#7F6158', background:'#F7F1EE', surface:'#FFFFFF', text:'#251E1B', muted:'#786C67' },
  contact_title: 'Запишитесь на консультацию',
  contact_text: 'Руднева, 26Б, корп. 1 · ежедневно 10:00–20:00',
  footer_note: 'Демо-концепт сайта от VELORA AI'
};

SALES_DEMOS['barbershop-777-sevastopol'] = {
  business_name: 'Барбершоп 777',
  eyebrow: 'Барбершоп · Севастополь',
  headline: 'Точный стиль без лишнего',
  business_description: 'Мужские стрижки, оформление бороды и бритьё в барбершопе на улице Гоголя.',
  subheadline: 'Современный мужской сервис, аккуратная форма и уверенный образ.',
  phone: '+7 978 777-18-30',
  address: 'Севастополь, улица Гоголя, 51',
  working_hours: 'Ежедневно 10:00–20:00',
  primary_action_label: 'Позвонить и записаться',
  services: [
    { title: 'Мужская стрижка', description: 'Форма с учётом структуры волос и привычного образа.' },
    { title: 'Оформление бороды', description: 'Контур, длина и аккуратная финальная укладка.' },
    { title: 'Королевское бритьё', description: 'Классический ритуал бритья и ухода.' },
    { title: 'Укладка', description: 'Финишный стиль и рекомендации по домашнему уходу.' }
  ],
  benefits: [
    { title: 'Сильный мужской сервис', description: 'Без лишнего пафоса — только результат и комфорт.' },
    { title: 'Удобное расположение', description: 'Улица Гоголя, центр Севастополя.' },
    { title: 'Запись в один клик', description: 'Контакт с барбершопом прямо с сайта.' }
  ],
  theme: { accent:'#B8955A', accent2:'#7B623D', background:'#101010', surface:'#191919', text:'#F4EFE7', muted:'#AAA39A' },
  footer_note: 'Демо-концепт сайта от VELORA AI'
};

SALES_DEMOS['imperiya-stilya-sevastopol'] = {
  business_name: 'Империя Стиля',
  eyebrow: 'Салон красоты · Севастополь',
  headline: 'Образ, который подчёркивает вас',
  business_description: 'Стрижки, окрашивание, брови, макияж, причёски, маникюр и педикюр в одном салоне.',
  subheadline: 'Современный салон красоты с широким выбором услуг и вниманием к деталям.',
  phone: '+7 978 772-18-85',
  address: 'Севастополь, проспект Победы, 44Г',
  primary_action_label: 'Позвонить и записаться',
  services: [
    { title: 'Стрижки и окрашивание', description: 'Женские и мужские стрижки, окрашивание разной сложности.' },
    { title: 'Брови и макияж', description: 'Коррекция, окрашивание и образ для особого случая.' },
    { title: 'Причёски', description: 'Свадебные и вечерние укладки.' },
    { title: 'Маникюр и педикюр', description: 'Уход и аккуратный современный результат.' }
  ],
  benefits: [
    { title: 'Много услуг в одном месте', description: 'Волосы, брови, макияж и ногтевой сервис.' },
    { title: 'Профессиональный подход', description: 'Мастера помогают подобрать решение под ваш образ.' },
    { title: 'Удобная связь', description: 'Все контакты и основные услуги собраны в одном месте.' }
  ],
  theme: { accent:'#B88C9C', accent2:'#865F70', background:'#FBF5F7', surface:'#FFFFFF', text:'#261E21', muted:'#786B70' },
  footer_note: 'Демо-концепт сайта от VELORA AI'
};


SALES_DEMOS['le-di-clinic-sevastopol'] = {
  business_name: 'LE Di Clinic Севастополь',
  eyebrow: 'Клиника эстетической косметологии · Севастополь',
  headline: 'LE Di Clinic',
  business_description: 'Инъекционная и аппаратная косметология, ботулинотерапия, контурная пластика, SMAS- и RF-лифтинг, пилинги, чистки и уходовые процедуры.',
  subheadline: 'Современные процедуры для лица и тела с записью напрямую к специалисту.',
  phone: '+7 978 161-53-68',
  telegram: '@EkaterinaValeri',
  address: 'Севастополь, улица Адмирала Перелешина, 1',
  hero_image: 'https://telegra.ph/file/e90369865d0f7a45c7c4b.jpg',
  logo_url: 'https://cdn4.telesco.pe/file/qOG63aAU0eihALLkMQ1n3IwuHGhcEYF4woPrsr61622H6aV5pJhluhEZ_BaWasJHacWxP0am3MSgh5svpiKXgxVeBEnlRlEzwn_iTaqC2DTfU4h2EskV0o8gcyOC_f7YwMVy2Zd_P_B5mw6IasnB9tG7vpj-96_qWvx9CZfJkKkM5SPlZzMfvQq_oiRRuXITCXp0aaNNd-Jd27kdTMqSTRWeKMRhLtVhzK4ePVWE6AmtwoSou8qYpETpQU7i0U_7SOWl5rba6dILmvglntCa3-K79rqMcoLpkJG09cwAnxK2WlosmkGzEgph-HjM1p7ohcEqESRMu2LASxxj2vvKlA.jpg',
  primary_action_url: 'https://t.me/EkaterinaValeri',
  primary_action_label: 'Записаться',
  secondary_action_url: 'https://t.me/ledi_sevastopol',
  secondary_action_label: 'Telegram клиники',
  services_title: 'Популярные процедуры',
  services_subtitle: 'Собрали направления и актуальные предложения из публичного Telegram клиники.',
  services: [
    { title: 'Ботулинотерапия', description: 'Коррекция мимических морщин и работа с гипертонусом мышц лица.', price: '3 зоны — 6 000 ₽', image_url: 'https://telegra.ph/file/b104988c64c9f3ce75d05.jpg' },
    { title: 'Контурная пластика губ', description: 'Коррекция формы и объёма губ филлерами на основе гиалуроновой кислоты.', price: 'от 6 400 ₽', image_url: 'https://telegra.ph/file/e90369865d0f7a45c7c4b.jpg' },
    { title: 'SMAS-лифтинг', description: 'Безоперационная подтяжка тканей и работа с овалом лица.', price: 'от 5 000 ₽', image_url: 'https://telegra.ph/file/c668c90d58d4866ddbe44.jpg' },
    { title: 'Микроигольчатый RF-лифтинг', description: 'Работа с качеством кожи, постакне, рубцами и тонусом.', price: 'по записи', image_url: 'https://telegra.ph/file/c668c90d58d4866ddbe44.jpg' },
    { title: 'Биоревитализация', description: 'Увлажнение, поддержка качества кожи и работа с возрастными изменениями.', price: 'лицо — от 3 500 ₽', image_url: 'https://telegra.ph/file/b104988c64c9f3ce75d05.jpg' },
    { title: 'Чистка + энзимный пилинг', description: 'Комбинированная процедура для очищения и обновления кожи.', price: 'от 999 ₽', image_url: 'https://telegra.ph/file/e90369865d0f7a45c7c4b.jpg' }
  ],
  gallery_title: 'Процедуры и эстетика',
  gallery_subtitle: 'Использованы изображения из публичных публикаций LE Di Clinic.',
  gallery_images: [
    { url: 'https://telegra.ph/file/e90369865d0f7a45c7c4b.jpg', alt: 'LE Di Clinic — контурная пластика' },
    { url: 'https://telegra.ph/file/b104988c64c9f3ce75d05.jpg', alt: 'LE Di Clinic — ботулинотерапия' },
    { url: 'https://telegra.ph/file/c668c90d58d4866ddbe44.jpg', alt: 'LE Di Clinic — SMAS и RF процедуры' },
    { url: 'https://telegra.ph/file/e90369865d0f7a45c7c4b.jpg', alt: 'LE Di Clinic Севастополь' }
  ],
  benefits_title: 'Всё для записи в одном месте',
  benefits: [
    { title: 'Понятный каталог', description: 'Клиент сразу видит основные процедуры и ориентиры по стоимости.' },
    { title: 'Прямая запись', description: 'Запись к специалисту через Telegram без лишних переходов.' },
    { title: 'Актуальная подача', description: 'Акции, новые процедуры и цены можно менять через админ-панель.' }
  ],
  faq: [
    { question: 'Где находится LE Di Clinic в Севастополе?', answer: 'Севастополь, улица Адмирала Перелешина, 1.' },
    { question: 'Как записаться?', answer: 'Через Telegram @EkaterinaValeri или по телефону +7 978 161-53-68.' },
    { question: 'Какие процедуры есть?', answer: 'Инъекционная и аппаратная косметология, ботулинотерапия, контурная пластика, SMAS- и RF-лифтинг, пилинги и чистки.' }
  ],
  theme: { accent:'#C9A0A8', accent2:'#8C6570', background:'#F8F3F5', surface:'#FFFFFF', text:'#261D20', muted:'#74676C' },
  contact_title: 'Запишитесь в LE Di Clinic',
  contact_text: 'Адмирала Перелешина, 1 · запись через Telegram',
  footer_note: 'Демо-концепт сайта от VELORA AI'
};

SALES_DEMOS['zrit-rukami-crimea'] = {
  business_name: 'Зрить руками',
  eyebrow: 'Массажное пространство · Крым',
  headline: 'Возвращение к лёгкости через прикосновение',
  business_description: 'Профессиональный массаж для взрослых и детей, восстановление, расслабление и индивидуальная работа с телом.',
  subheadline: 'Спокойное пространство без суеты — только внимание к вашему состоянию и профессиональная работа руками.',
  phone: '+7 978 500-92-74',
  telegram: '@zrit_rukami',
  primary_action_label: 'Записаться на массаж',
  services: [
    { title: 'Массаж для взрослых', description: 'Работа с напряжением, усталостью и восстановлением общего самочувствия.' },
    { title: 'Детский массаж', description: 'Деликатный подход, безопасность и комфорт ребёнка на каждом этапе.' },
    { title: 'Восстановительные программы', description: 'Индивидуальная работа с телом под конкретные задачи и состояние.' },
    { title: 'Релакс-массаж', description: 'Мягкое снижение напряжения и возможность действительно отдохнуть.' }
  ],
  benefits: [
    { title: 'Индивидуальный подход', description: 'Каждый сеанс подстраивается под состояние и запрос клиента.' },
    { title: 'Спокойная атмосфера', description: 'Без потока и суеты — только внимание к человеку.' },
    { title: 'Удобная связь', description: 'Запись и вопросы через Telegram или телефон.' }
  ],
  theme: { accent:'#9E8B73', accent2:'#6F6150', background:'#F7F4EF', surface:'#FFFFFF', text:'#26231F', muted:'#756F67' },
  footer_note: 'Демо-концепт сайта от VELORA AI'
};


SALES_DEMOS['bonbuket-sevastopol'] = {
  business_name: 'BonBuket Севастополь',
  eyebrow: 'Мастерская авторских букетов · Севастополь',
  headline: 'Цветы, которые говорят за вас',
  business_description: 'Авторские букеты, свежие розы, фруктовые наборы и гелиевые шары с доставкой по Севастополю и Крыму.',
  subheadline: 'Обсудите с мастерской повод, пожелания к букету и удобное время получения по телефону.',
  phone: '+7 978 332-43-44',
  primary_action_label: 'Позвонить',
  services: [
    { title: 'Авторские букеты', description: 'Сборные композиции под повод, стиль и бюджет.' },
    { title: 'Розы', description: 'Классические и необычные сорта в актуальном оформлении.' },
    { title: 'Подарочные наборы', description: 'Фрукты, сладости и композиции для яркого подарка.' },
    { title: 'Шары и доставка', description: 'Гелиевые шары и доставка по Севастополю и Крыму.' }
  ],
  benefits: [
    { title: 'Выбор букета', description: 'Уточните доступные цветы и состав композиции у мастерской.' },
    { title: 'Связь с мастерской', description: 'Позвоните, чтобы обсудить пожелания и стоимость букета.' },
    { title: 'Получение букета', description: 'Время, адрес и условия доставки согласуйте по телефону.' }
  ],
  theme: { accent:'#E6C75C', accent2:'#A88A2C', background:'#111111', surface:'#191919', text:'#F8F4E9', muted:'#B9B19D' },
  footer_note: 'Демо-концепт сайта от VELORA AI'
};

SALES_DEMOS['kurort-sevastopol'] = {
  business_name: 'Турфирма КУРОРТ',
  eyebrow: 'Туристическая компания · Севастополь',
  headline: 'Путешествия начинаются с правильного выбора',
  business_description: 'Туры, авиа- и железнодорожные билеты, бронирование отелей и организация путешествий по России и миру.',
  subheadline: 'Более 17 лет в туризме — подбор маршрута, консультация и бронирование в одном месте.',
  phone: '+7 978 947-58-88',
  telegram: '@kurort_best',
  address: 'Севастополь, проспект Нахимова, 15, офис 9',
  primary_action_label: 'Подобрать тур',
  services: [
    { title: 'Туры по миру', description: 'Пляжный отдых, экскурсионные программы и авторские поездки.' },
    { title: 'Авиа и ж/д билеты', description: 'Помощь с маршрутом и подбором удобных вариантов.' },
    { title: 'Отели по Крыму', description: 'Бронирование проживания и локальных туров.' },
    { title: 'Персональный подбор', description: 'Маршрут под бюджет, даты и формат отдыха.' }
  ],
  benefits: [
    { title: '17+ лет опыта', description: 'Практический опыт в туризме и работа с разными направлениями.' },
    { title: 'Всё в одном месте', description: 'Тур, билеты и размещение без десятка разных сервисов.' },
    { title: 'Быстрая связь', description: 'Заявка на подбор тура через телефон или Telegram.' }
  ],
  theme: { accent:'#2F7EA8', accent2:'#1E5877', background:'#F4F8FA', surface:'#FFFFFF', text:'#162229', muted:'#66767E' },
  footer_note: 'Демо-концепт сайта от VELORA AI'
};

SALES_DEMOS['bem-massage-sevastopol'] = {
  business_name: 'БЭМ: Прикосновение к Жизни',
  eyebrow: 'Биоэнергетический массаж · Севастополь',
  headline: 'Через тело — к ощущению лёгкости',
  business_description: 'Биоэнергетический массаж лица и тела с индивидуальным подходом, направленный на расслабление и восстановление ощущения комфорта.',
  subheadline: 'Понятная презентация метода, ответы на частые вопросы и запись на консультацию в одном месте.',
  telegram: '@ViktoriaWWW',
  primary_action_label: 'Записаться на консультацию',
  services: [
    { title: 'БЭМ-массаж тела', description: 'Мягкая работа с телом и мышечным напряжением.' },
    { title: 'БЭМ-массаж лица', description: 'Уходовая процедура с акцентом на расслабление и тонус.' },
    { title: 'Пробный сеанс', description: 'Знакомство с методом и подбор комфортного формата.' },
    { title: 'Персональный курс', description: 'Индивидуальная программа под запрос клиента.' }
  ],
  benefits: [
    { title: 'Метод объяснён просто', description: 'На сайте клиент сразу понимает, что это за процедура и как она проходит.' },
    { title: 'Снимает страх перед записью', description: 'Отдельный блок с ответами на частые вопросы и противопоказания.' },
    { title: 'Запись в Telegram', description: 'Переход к консультации напрямую из сайта.' }
  ],
  theme: { accent:'#B88474', accent2:'#805B50', background:'#F7F1EC', surface:'#FFFFFF', text:'#2A211E', muted:'#756963' },
  footer_note: 'Демо-концепт сайта от VELORA AI'
};

const SALES_MATERIAL_CACHE = new Map();

app.get('/demo/:slug/materials.json', async function (req, res) {
  const slug = String(req.params.slug || '').toLowerCase();
  const brief = SALES_DEMOS[slug];
  if (!brief) return res.status(404).json({status:'ERROR', error:'Demo not found'});

  const cached = SALES_MATERIAL_CACHE.get(slug);
  if (cached) return res.json(cached);

  let tempDir='';
  let browser=null;
  try {
    tempDir=path.join('/tmp', `velora-sales-materials-${slug}-${Date.now()}`);
    fs.mkdirSync(tempDir,{recursive:true});

    browser=await chromium.launch({
      headless:true,
      executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
    });

    const context=await browser.newContext({
      viewport:{width:390,height:693},
      deviceScaleFactor:1,
      isMobile:true,
      hasTouch:true,
      userAgent:'Velora Sales Materials Bot/1.0'
    });
    const page=await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/demo/${encodeURIComponent(slug)}`,{
      waitUntil:'networkidle',
      timeout:45000
    });
    await page.evaluate(async()=>{
      if(document.fonts&&document.fonts.ready){try{await document.fonts.ready;}catch(e){}}
      await new Promise(r=>setTimeout(r,700));
    });

    const screenshotFiles=await captureDistinctScreenshots(page,tempDir);
    await context.close();
    await browser.close();
    browser=null;

    const project=materialsProjectName(slug+'-sales');
    await ensureCloudflareProject(project);
    const root=await deployToCloudflarePages(
      tempDir,
      project,
      CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN
    );
    const payload={
      status:'READY',
      business_name:cleanText(brief.business_name,slug),
      site_url:`https://velora-deploy-service-production.up.railway.app/demo/${slug}`,
      screenshots_urls:screenshotFiles.map(name=>root+'/'+encodeURIComponent(name)),
      materials_url:root
    };
    SALES_MATERIAL_CACHE.set(slug,payload);
    return res.json(payload);
  } catch(error) {
    console.error('Sales materials error:',error.message);
    return res.status(500).json({status:'ERROR',error:error.message});
  } finally {
    if(browser){try{await browser.close();}catch(e){}}
    if(tempDir){fs.rmSync(tempDir,{recursive:true,force:true});}
  }
});

app.get('/demo/:slug', function (req, res) {
  const slug = String(req.params.slug || '').toLowerCase();
  const brief = SALES_DEMOS[slug];
  if (!brief) return res.status(404).send('Demo not found');

  const outDir = path.join('/tmp', 'velora-sales-demo-' + slug);
  fs.mkdirSync(outDir, { recursive: true });
  generateStaticSite(outDir, brief, slug);
  res.sendFile(path.join(outDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', function () {
  console.log('Velora Deploy Service listening on port ' + PORT);
});

