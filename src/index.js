const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/v1/health', function (req, res) {
  res.json({
    ok: true,
    service: 'Velora Deploy Service'
  });
});

app.post('/v1/deploy', async function (req, res) {
  const body = req.body || {};

  const client_id = body.client_id;
  const site_slug = body.site_slug || '';
  const template = body.template || 'vard-baseline';
  const mode = body.mode || 'create_or_update';
  const site_build_brief = body.site_build_brief;

 if (!client_id  !site_build_brief  !site_build_brief.business_name) {
    return res.status(200).json({
      status: 'ERROR',
      site_result_url: '',
      site_admin_url: '',
      error: 'VALIDATION: client_id and business_name are required',
      site_slug: site_slug
    });
  }

  return res.status(200).json({
    status: 'ERROR',
    site_result_url: '',
    site_admin_url: '',
    error: 'NOT_CONFIGURED: Cloudflare deployment is not connected yet',
    site_slug: site_slug,
    template: template,
    mode: mode
  });
});

app.listen(PORT, '0.0.0.0', function () {
  console.log('Velora Deploy Service listening on port ' + PORT);
});
// redeploy
