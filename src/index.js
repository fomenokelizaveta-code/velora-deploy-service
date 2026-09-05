const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

app.use(express.json());

// Health check endpoint
app.get('/v1/health', function (req, res) {
  res.json({
    ok: true,
    service: 'Velora Deploy Service'
  });
});

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
      site_admin_url: '',
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
 * Generate a static HTML website from site_build_brief
 */
async function generateStaticSite(outDir, brief, projectName) {
  const businessName = brief.business_name || 'Business';
  const businessDescription = brief.business_description || 'Welcome to our site';
  const heroImage = brief.hero_image_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22400%22%3E%3Crect fill=%22%23007bff%22 width=%22800%22 height=%22400%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2248%22 fill=%22white%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22%3EWelcome%3C/text%3E%3C/svg%3E';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(businessName)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
    }
    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 1rem;
      text-align: center;
    }
    header h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
    }
    .hero {
      background: linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%);
      padding: 4rem 1rem;
      text-align: center;
      min-height: 400px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
    }
    .hero h2 {
      font-size: 2rem;
      margin-bottom: 1rem;
      color: #333;
    }
    .hero p {
      font-size: 1.2rem;
      color: #666;
      max-width: 600px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 2rem;
      margin: 3rem 0;
    }
    .feature {
      padding: 1.5rem;
      background: #f8f9fa;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .feature h3 {
      margin-bottom: 0.5rem;
      color: #667eea;
    }
    footer {
      background: #333;
      color: white;
      text-align: center;
      padding: 2rem;
      margin-top: 3rem;
    }
    footer p {
      margin: 0.5rem 0;
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(businessName)}</h1>
  </header>

  <div class="hero">
    <h2>Welcome</h2>
    <p>${escapeHtml(businessDescription)}</p>
  </div>

  <div class="container">
    <h2 style="text-align: center; margin: 2rem 0;">Our Services</h2>
    <div class="features">
      <div class="feature">
        <h3>🚀 Fast</h3>
        <p>Lightning-fast performance optimized for your users.</p>
      </div>
      <div class="feature">
        <h3>🔒 Secure</h3>
        <p>Enterprise-grade security for your peace of mind.</p>
      </div>
      <div class="feature">
        <h3>📱 Responsive</h3>
        <p>Beautiful on all devices and screen sizes.</p>
      </div>
    </div>
  </div>

  <footer>
    <p>&copy; 2026 ${escapeHtml(businessName)}. All rights reserved.</p>
    <p>Deployed with Velora Deploy Service</p>
  </footer>
</body>
</html>`;

  fs.writeFileSync(path.join(outDir, 'index.html'), html);

  // Create a wrangler.toml for deployment
  const wranglerToml = `name = "${escapeToml(projectName)}"
main = "index.js"
compatibility_date = "2026-01-01"

[env.production]
`;

  fs.writeFileSync(path.join(outDir, 'wrangler.toml'), wranglerToml);
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
 * Deploy to Cloudflare Pages using direct upload
 */
async function deployToCloudflarePages(siteDir, projectName, accountId, apiToken) {
  try {
    // Read files to upload
    const files = fs.readdirSync(siteDir);
    const indexHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf-8');

    // Create FormData for upload
    const FormData = require('form-data');
    const form = new FormData();

    // Add files to form
    for (const file of files) {
      if (file === 'wrangler.toml') continue; // Skip wrangler.toml
      
      const filePath = path.join(siteDir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isFile()) {
        form.append('files', fs.createReadStream(filePath), file);
      }
    }

    // Upload via Cloudflare API
    const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`;

    const uploadResponse = await axios.post(uploadUrl, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${apiToken}`
      }
    });

    if (!uploadResponse.data.success) {
      throw new Error(`Upload failed: ${uploadResponse.data.errors?.[0]?.message || 'Unknown error'}`);
    }

    const deploymentId = uploadResponse.data.result?.id;
    const deploymentUrl = `https://${projectName}.pages.dev`;

    console.log(`Deployment successful: ${deploymentUrl}`);
    return deploymentUrl;
  } catch (error) {
    if (error.response?.data?.errors) {
      throw new Error(`Cloudflare deployment error: ${error.response.data.errors[0]?.message}`);
    }
    throw new Error(`Deployment failed: ${error.message}`);
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

/**
 * Escape for TOML
 */
function escapeToml(text) {
  return String(text).replace(/"/g, '\\"');
}

app.listen(PORT, '0.0.0.0', function () {
  console.log('Velora Deploy Service listening on port ' + PORT);
});

