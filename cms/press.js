const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('./database');
const seed = require('./press-seed.json');

const originalCovers = new Set(seed.map(({ cover_image }) => '/' + cover_image));

function articleUrl(value) {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url.href;
  } catch {
    return null;
  }
}

function registerPress(app, { asyncRoute, requireAuth, requireCsrf, cleanText, escapeHtml, uploadedImageExists, siteRoot, baseUrl }) {
  app.get('/api/admin/press', requireAuth, asyncRoute(async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM press_articles ORDER BY updated_at DESC, id ASC');
    res.json(rows);
  }));

  app.post('/api/admin/press', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
    const id = Number(req.body.id || 0);
    const title = cleanText(req.body.title, 180);
    const outlet = cleanText(req.body.outlet, 120);
    const excerpt = cleanText(req.body.excerpt, 500);
    const url = articleUrl(cleanText(req.body.url, 2000));
    const cover = cleanText(req.body.cover_image, 300);
    const status = req.body.status === 'published' ? 'published' : 'draft';
    if (!Number.isSafeInteger(id) || id < 0 || !title || !outlet || !excerpt || !url || url.length > 2000) {
      return res.status(400).json({ error: 'Preencha título, veículo, resumo e um link válido para a matéria.' });
    }
    if (!originalCovers.has(cover) && !await uploadedImageExists(cover)) {
      return res.status(400).json({ error: 'Envie uma imagem de capa pelo painel.' });
    }
    const now = new Date().toISOString();
    const fields = [title, outlet, excerpt, url, cover, status];
    let articleId = id;
    if (id) {
      const result = await pool.query(
        "UPDATE press_articles SET title=$1,outlet=$2,excerpt=$3,url=$4,cover_image=$5,status=$6,published_at=CASE WHEN $7::text='published' THEN COALESCE(published_at,$8) ELSE NULL END,updated_at=$9 WHERE id=$10",
        [...fields, status, now, now, id]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Matéria não encontrada.' });
    } else {
      const result = await pool.query(
        'INSERT INTO press_articles (title,outlet,excerpt,url,cover_image,status,published_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [...fields, status === 'published' ? now : null, now]
      );
      articleId = result.rows[0].id;
    }
    const { rows: [post] } = await pool.query('SELECT * FROM press_articles WHERE id=$1', [articleId]);
    if (!post) return res.status(404).json({ error: 'Matéria não encontrada.' });
    res.json({ post, url: `${baseUrl}/#blog` });
  }));

  app.delete('/api/admin/press/:id', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: 'Matéria não encontrada.' });
    const result = await pool.query('DELETE FROM press_articles WHERE id=$1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Matéria não encontrada.' });
    res.json({ ok: true });
  }));

  for (const cover of originalCovers) {
    app.get(cover, (_req, res) => res.sendFile(path.join(siteRoot, cover.slice(1))));
  }

  const home = fs.readFileSync(path.join(siteRoot, 'index.html'), 'utf8');
  app.get(['/', '/index.html'], asyncRoute(async (_req, res) => {
    const { rows: articles } = await pool.query(
      "SELECT title,outlet,excerpt,url,cover_image FROM press_articles WHERE status='published' ORDER BY published_at DESC, id ASC"
    );
    const cards = articles.map((article) => `<article class="blog-card">
      <div class="blog-card-media"><img src="${escapeHtml(article.cover_image)}" alt="${escapeHtml(article.outlet)}" loading="lazy"></div>
      <span class="blog-kicker">${escapeHtml(article.outlet)}</span>
      <h3>${escapeHtml(article.title)}</h3>
      <p>${escapeHtml(article.excerpt)}</p>
      <a class="blog-btn" href="${escapeHtml(article.url)}" target="_blank" rel="noopener">Ler matéria</a>
    </article>`).join('\n');
    const page = home.replace(/<!-- press-cards:start -->[\s\S]*?<!-- press-cards:end -->/, () => cards);
    res.set('Cache-Control', 'no-cache').type('html').send(page);
  }));
}

module.exports = { registerPress };
