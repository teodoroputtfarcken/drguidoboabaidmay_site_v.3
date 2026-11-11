const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'pages-dist');
const backend = new URL(process.env.PAGES_BACKEND_URL);
const site = new URL(process.env.PAGES_SITE_URL);
const prefix = site.pathname.replace(/\/$/, '');
const staticExtension = /\.(?:html|css|js|json|png|jpe?g|webp|avif|gif|svg|ico|mp4|mp3|webm|pdf|woff2?|txt)$/i;
const uploadPath = /\/blog-uploads\/[a-f0-9]{36}\.(?:jpg|png|webp)/g;

async function get(route) {
  const response = await fetch(new URL(route, backend), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(route + ' returned HTTP ' + response.status);
  return response;
}

function sitePaths(html) {
  return html.replace(/\b(href|src|action)=(["'])(\/(?!\/)[^"']*)\2/g,
    (_full, attribute, quote, url) => attribute + '=' + quote + prefix + url + quote);
}

async function build() {
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const backendFiles = new Set(['package.json', 'package-lock.json', 'vercel.json', 'server.js']);
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.') || !staticExtension.test(entry.name) || backendFiles.has(entry.name)) continue;
    if (entry.name === 'blog-post.html') continue;
    await fs.copyFile(path.join(root, entry.name), path.join(output, entry.name));
  }

  const posts = await (await get('/api/posts')).json();
  if (!Array.isArray(posts) || posts.some((post) => !/^[a-z0-9][a-z0-9-]{0,149}$/.test(post.slug))) {
    throw new Error('Invalid list of published articles');
  }
  const pages = [
    ['/', 'index.html'],
    ['/blog.html', 'blog.html'],
    ...posts.map(({ slug }) => ['/blog/' + slug, 'blog/' + slug + '/index.html'])
  ];
  const images = new Set();
  for (const [route, filename] of pages) {
    const html = await (await get(route)).text();
    for (const image of html.matchAll(uploadPath)) images.add(image[0]);
    const destination = path.join(output, filename);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, sitePaths(html));
  }

  await fs.mkdir(path.join(output, 'blog-uploads'), { recursive: true });
  for (const image of images) {
    const bytes = Buffer.from(await (await get(image)).arrayBuffer());
    await fs.writeFile(path.join(output, image.slice(1)), bytes);
  }

  const sitemap = await (await get('/sitemap.xml')).text();
  const siteUrl = site.origin + prefix;
  const publishedSitemap = sitemap.replace(/<loc>https:\/\/drguidoboabaid\.com\.br(?=\/|<)/g, () => '<loc>' + siteUrl);
  await fs.writeFile(path.join(output, 'sitemap.xml'), publishedSitemap);
  const robots = await fs.readFile(path.join(root, 'robots.txt'), 'utf8');
  await fs.writeFile(path.join(output, 'robots.txt'), robots.replace(/^Sitemap:.*$/mi, () => 'Sitemap: ' + siteUrl + '/sitemap.xml'));
  await fs.writeFile(path.join(output, 'blog-search-index.json'), JSON.stringify(posts));
  console.log('Páginas públicas geradas: ' + pages.length);
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
