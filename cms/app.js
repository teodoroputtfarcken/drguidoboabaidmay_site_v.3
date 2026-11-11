require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const { pool, initializeDatabase, SessionStore } = require('./database');
const { registerPress } = require('./press');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const { rateLimit } = require('express-rate-limit');
const ejs = require('ejs');

const app = express();
const PORT = Number(process.env.PORT || 3100);
const SITE_ROOT = path.resolve(__dirname, process.env.SITE_ROOT || '..');
const VIEW_DIR = path.join(__dirname, 'views');
const ADMIN_FILE = path.join(__dirname, 'public', 'admin.html');
const BASE_URL = (process.env.BASE_URL || 'https://drguidoboabaid.com.br').replace(/\/$/, '');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH || '');
const SESSION_SECRET = String(process.env.SESSION_SECRET || '');

if (!ADMIN_EMAIL || !/^\$2[aby]\$/.test(ADMIN_PASSWORD_HASH)) {
  throw new Error('Configure ADMIN_EMAIL e ADMIN_PASSWORD_HASH no arquivo .env antes de iniciar.');
}
if (SESSION_SECRET.length < 48 || SESSION_SECRET.includes('troque-')) {
  throw new Error('Configure SESSION_SECRET com pelo menos 48 caracteres aleatórios.');
}
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  store: new SessionStore(),
  name: 'guido_blog_admin',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function cleanText(value, max) { return String(value || '').trim().slice(0, max); }
function makeSlug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);
}
function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
}
function asPublicPost(row) { return { ...row, display_date: formatDate(row.published_at) }; }
function asAdminPost(row) { return { ...row, display_date: formatDate(row.published_at) }; }
function safeArticleHtml(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: ['p','h2','h3','h4','ul','ol','li','strong','b','em','i','a','blockquote','hr','br'],
    allowedAttributes: { a: ['href','target','rel'] },
    allowedSchemes: ['http','https','mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) }
  });
}
function requireAuth(req, res, next) {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Entre no painel para continuar.' });
  next();
}
function requireCsrf(req, res, next) {
  const received = req.get('x-csrf-token');
  if (!received || !req.session.csrfToken || received !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Sessão expirada. Atualize a página e tente novamente.' });
  }
  next();
}
function renderView(file, data) {
  return ejs.renderFile(path.join(VIEW_DIR, file), data, { async: true });
}
function postUrl(post) { return `${BASE_URL}/blog/${encodeURIComponent(post.slug)}`; }

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' } });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Limite de envios atingido. Tente novamente mais tarde.' } });
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg','image/png','image/webp'].includes(file.mimetype))
});

app.get('/admin', (_req, res) => { res.set('Cache-Control','no-store'); res.sendFile(ADMIN_FILE); });
app.get('/admin/', (_req, res) => res.redirect(302, '/admin'));
app.use('/admin-assets', express.static(path.join(__dirname, 'public'), { fallthrough: false, maxAge: '1h' }));
app.get('/blog-uploads/:filename', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT mime_type, content FROM cms_images WHERE filename = ?', [req.params.filename]);
    const image = rows[0];
    if (!image) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=604800, immutable').type(image.mime_type).send(image.content);
  } catch (error) { next(error); }
});

app.get('/api/admin/session', (req, res) => {
  res.set('Cache-Control','no-store');
  req.session.csrfToken ||= crypto.randomBytes(32).toString('hex');
  res.json({ authenticated: Boolean(req.session.authenticated), csrfToken: req.session.csrfToken, email: req.session.authenticated ? req.session.email : null });
});
app.post('/api/admin/login', loginLimiter, requireCsrf, async (req, res, next) => {
  try {
    const email = cleanText(req.body.email, 200).toLowerCase();
    const password = String(req.body.password || '');
    const valid = email === ADMIN_EMAIL && await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!valid) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    const csrfToken = crypto.randomBytes(32).toString('hex');
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.authenticated = true;
      req.session.email = email;
      req.session.csrfToken = csrfToken;
      res.json({ ok: true, csrfToken });
    });
  } catch (error) { next(error); }
});
app.post('/api/admin/logout', requireAuth, requireCsrf, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('guido_blog_admin');
    res.json({ ok: true });
  });
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
}

app.get('/api/admin/posts', requireAuth, asyncRoute(async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM posts ORDER BY updated_at DESC');
  res.json(rows.map(asAdminPost));
}));
app.post('/api/admin/upload', requireAuth, requireCsrf, uploadLimiter, (req, res, next) => {
  imageUpload.single('cover')(req, res, async (error) => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'A imagem deve ter até 8 MB.' : 'Envie uma imagem JPG, PNG ou WEBP.' });
    if (!req.file) return res.status(400).json({ error: 'Selecione uma imagem JPG, PNG ou WEBP.' });
    const bytes = req.file.buffer;
    const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes.length > 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const isWebp = bytes.length > 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) return res.status(400).json({ error: 'O arquivo não parece ser uma imagem válida.' });
    const ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
    const mime = isJpeg ? 'image/jpeg' : `image/${ext}`;
    const filename = `${crypto.randomBytes(18).toString('hex')}.${ext}`;
    try {
      await pool.execute('INSERT INTO cms_images (filename, mime_type, content) VALUES (?, ?, ?)', [filename, mime, bytes]);
      res.json({ url: `/blog-uploads/${filename}` });
    } catch (error) { next(error); }
  });
});

async function uploadedImageExists(cover) {
  const match = /^\/blog-uploads\/([a-f0-9]{36}\.(?:jpg|png|webp))$/.exec(cover);
  if (!match) return false;
  const [rows] = await pool.execute('SELECT 1 FROM cms_images WHERE filename = ?', [match[1]]);
  return rows.length > 0;
}

app.post('/api/admin/posts', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const id = Number(req.body.id || 0);
  const title = cleanText(req.body.title, 180);
  const excerpt = cleanText(req.body.excerpt, 500);
  const content = safeArticleHtml(req.body.content_html);
  const cover = cleanText(req.body.cover_image, 300);
  const author = cleanText(req.body.author, 120) || 'Dr. Guido Boabaid May';
  const category = cleanText(req.body.category, 80);
  const seoTitle = cleanText(req.body.seo_title, 180);
  const seoDescription = cleanText(req.body.seo_description, 300);
  const status = req.body.status === 'published' ? 'published' : 'draft';
  const slug = makeSlug(req.body.slug || title);
  if (!title || !excerpt || !content || !cover || !slug) return res.status(400).json({ error: 'Preencha título, endereço, resumo, conteúdo e imagem de capa.' });
  if (!await uploadedImageExists(cover)) return res.status(400).json({ error: 'A imagem de capa precisa ser enviada pelo painel.' });
  if (!Number.isSafeInteger(id) || id < 0) return res.status(400).json({ error: 'Artigo inválido.' });
  const now = new Date().toISOString();
  const fields = [slug, title, excerpt, content, cover, author, category, seoTitle, seoDescription, status];
  try {
    let postId = id;
    if (id) {
      const [result] = await pool.execute(`UPDATE posts SET slug=?,title=?,excerpt=?,content_html=?,cover_image=?,author=?,category=?,seo_title=?,seo_description=?,status=?,published_at=IF(?='published',COALESCE(published_at,?),NULL),updated_at=? WHERE id=?`,
        [...fields, status, now, now, id]);
      if (!result.affectedRows) return res.status(404).json({ error: 'Artigo não encontrado.' });
    } else {
      const [result] = await pool.execute(`INSERT INTO posts (slug,title,excerpt,content_html,cover_image,author,category,seo_title,seo_description,status,published_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [...fields, status === 'published' ? now : null, now, now]);
      postId = result.insertId;
    }
    const [rows] = await pool.execute('SELECT * FROM posts WHERE id=?', [postId]);
    if (!rows.length) return res.status(404).json({ error: 'Artigo não encontrado.' });
    res.json({ post: asAdminPost(rows[0]), url: postUrl(rows[0]) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Esse endereço já está sendo usado por outro artigo.' });
    throw error;
  }
}));
app.delete('/api/admin/posts/:id', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: 'Artigo não encontrado.' });
  const [result] = await pool.execute('DELETE FROM posts WHERE id=?', [id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Artigo não encontrado.' });
  res.json({ ok: true });
}));

app.get('/api/posts', asyncRoute(async (req, res) => {
  const query = cleanText(req.query.q, 120);
  const term = `%${query.replace(/[!%_]/g, (char) => `!${char}`)}%`;
  const fields = "SELECT id,slug,title,excerpt,author,published_at FROM posts WHERE status='published'";
  const [rows] = query
    ? await pool.execute(`${fields} AND (title LIKE ? ESCAPE '!' OR excerpt LIKE ? ESCAPE '!' OR content_html LIKE ? ESCAPE '!') ORDER BY published_at DESC`, [term, term, term])
    : await pool.query(`${fields} ORDER BY published_at DESC`);
  res.json(rows.map((post) => ({ id:post.id,slug:post.slug,title:post.title,excerpt:post.excerpt,author:post.author,date:formatDate(post.published_at) })));
}));

registerPress(app, { asyncRoute, requireAuth, requireCsrf, cleanText, escapeHtml, uploadedImageExists, siteRoot: SITE_ROOT });

app.get('/blog.html', async (_req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC");
    const posts = rows.map(asPublicPost);
    const html = await renderView('blog-list.ejs', { posts });
    res.type('html').send(html);
  } catch (error) { next(error); }
});
app.get('/blog/:slug', async (req, res, next) => {
  try {
    const [[row]] = await pool.execute("SELECT * FROM posts WHERE slug=? AND status='published'", [req.params.slug]);
    if (!row) return res.status(404).send('Artigo não encontrado.');
    const post = asPublicPost(row);
    const html = await renderView('blog-post.ejs', { post, canonicalUrl: postUrl(post), baseUrl: BASE_URL });
    res.type('html').send(html);
  } catch (error) { next(error); }
});
app.get('/blog-post.html', (_req, res) => res.redirect(301, '/blog.html'));
app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const [posts] = await pool.query("SELECT slug,updated_at FROM posts WHERE status='published' ORDER BY published_at DESC");
    const sitemapPath = path.join(SITE_ROOT, 'sitemap.xml');
    const current = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, 'utf8') : '';
    const baseEntries = [...current.matchAll(/<url>[\s\S]*?<\/url>/g)].map((match) => match[0]);
    const known = new Set(baseEntries.map((entry) => (entry.match(/<loc>(.*?)<\/loc>/) || [])[1]));
    const dynamicEntries = posts.filter((post) => !known.has(`${BASE_URL}/blog/${encodeURIComponent(post.slug)}`)).map((post) => `<url><loc>${escapeHtml(`${BASE_URL}/blog/${encodeURIComponent(post.slug)}`)}</loc><lastmod>${new Date(post.updated_at).toISOString().slice(0,10)}</lastmod></url>`);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${baseEntries.join('')}${dynamicEntries.join('')}</urlset>`);
  } catch (error) { next(error); }
});

// Keep CMS implementation files, credentials and database outside the public file namespace.
app.use(['/cms', '/node_modules', '/package.json', '/package-lock.json', '/README.md'], (_req, res) => res.sendStatus(404));
app.use(express.static(SITE_ROOT, { index: 'index.html', dotfiles: 'deny', setHeaders: (res) => res.setHeader('X-Content-Type-Options','nosniff') }));
app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Ocorreu um erro no sistema. Tente novamente.' });
});

const HOST = process.env.HOST || '0.0.0.0';
initializeDatabase()
  .then(() => app.listen(PORT, HOST, () => console.log(`CMS listening on ${HOST}:${PORT}`)))
  .catch(async (error) => {
    console.error('Não foi possível iniciar o CMS.', error.code || error.message);
    await pool.end();
    process.exitCode = 1;
  });
