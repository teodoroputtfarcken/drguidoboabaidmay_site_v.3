(() => {
  const $ = (selector) => document.querySelector(selector);
  const loginView = $('#login-view');
  const adminView = $('#admin-view');
  const loginForm = $('#login-form');
  const postForm = $('#post-form');
  const editor = $('#content-editor');
  const postsList = $('#posts-list');
  let csrfToken = '';
  let posts = [];
  let activeId = null;
  let slugWasEdited = false;
  const isPress = new URLSearchParams(location.search).get('secao') === 'imprensa';
  const endpoint = isPress ? '/api/admin/press' : '/api/admin/posts';
  const newLabel = isPress ? 'Nova matéria' : 'Novo artigo';
  const editLabel = isPress ? 'Editar matéria' : 'Editar artigo';
  const publishedLabel = isPress ? 'Publicada' : 'Publicado';
  let editorRevision = 0;

  $('#blog-section-link').classList.toggle('primary', !isPress);
  $('#press-section-link').classList.toggle('primary', isPress);
  if (isPress) {
    $('#blog-section-link').removeAttribute('aria-current');
    $('#press-section-link').setAttribute('aria-current', 'page');
    $('#section-heading').textContent = 'Matérias de imprensa';
    $('#view-public').href = '/#blog';
    $('#view-public').textContent = '← Ver imprensa no site';
    $('#list-description').textContent = 'Rascunhos e matérias publicadas';
    $('#new-post-button').textContent = '+ Nova matéria';
    $('#excerpt-hint').textContent = 'Aparece no cartão da seção Imprensa.';
    $('#preview-cta').textContent = 'Ler matéria →';
    postForm.querySelector('[data-status="published"]').textContent = 'Publicar matéria';
    document.querySelectorAll('[data-blog-field]').forEach((field) => { field.hidden = true; });
    document.querySelectorAll('[data-press-field]').forEach((field) => {
      field.hidden = false;
      field.querySelector('input').disabled = false;
    });
    postForm.elements.slug.disabled = true;
  }
  $('#editor-heading-title').textContent = newLabel;

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (options.method && !['GET','HEAD'].includes(options.method.toUpperCase())) headers.set('X-CSRF-Token', csrfToken);
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.');
    return data;
  }
  function message(target, text, success = false) { target.textContent = text; target.classList.toggle('success', success); }
  function slugify(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,150); }
  function setSignedIn(signedIn, email = '') {
    loginView.hidden = signedIn;
    adminView.hidden = !signedIn;
    $('#account-email').textContent = email;
  }
  function readForm(status) {
    const data = Object.fromEntries(new FormData(postForm).entries());
    data.content_html = editor.innerHTML;
    data.status = status;
    return data;
  }
  function resetEditor() {
    editorRevision += 1;
    postForm.reset();
    postForm.elements.id.value = '';
    postForm.elements.author.value = 'Dr. Guido Boabaid May';
    postForm.elements.cover_image.value = '';
    editor.innerHTML = '';
    $('#cover-preview').hidden = true;
    $('#cover-preview').removeAttribute('src');
    $('#editor-heading-title').textContent = newLabel;
    $('#draft-indicator').textContent = 'Não salvo';
    $('#editor-notice').textContent = '';
    activeId = null;
    slugWasEdited = false;
    refreshPreview();
    drawPosts();
  }
  function loadPost(post) {
    editorRevision += 1;
    postForm.reset();
    activeId = post.id;
    postForm.elements.id.value = post.id;
    postForm.elements.title.value = post.title;
    postForm.elements.slug.value = post.slug || '';
    postForm.elements.outlet.value = post.outlet || '';
    postForm.elements.url.value = post.url || '';
    postForm.elements.author.value = post.author || '';
    postForm.elements.excerpt.value = post.excerpt;
    postForm.elements.category.value = post.category || '';
    postForm.elements.cover_image.value = post.cover_image;
    postForm.elements.seo_title.value = post.seo_title || '';
    postForm.elements.seo_description.value = post.seo_description || '';
    editor.innerHTML = post.content_html || '';
    $('#cover-preview').src = post.cover_image;
    $('#cover-preview').hidden = false;
    $('#editor-heading-title').textContent = editLabel;
    $('#editor-notice').textContent = '';
    slugWasEdited = true;
    refreshPreview();
    $('#draft-indicator').textContent = post.status === 'published' ? publishedLabel : 'Rascunho';
    drawPosts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function drawPosts() {
    postsList.replaceChildren();
    if (!posts.length) {
      const empty = document.createElement('div'); empty.className = 'empty-list'; empty.textContent = `Nenhuma publicação. Clique em “${newLabel}” para começar.`; postsList.append(empty); return;
    }
    for (const post of posts) {
      const row = document.createElement('div'); row.className = `post-row${activeId === post.id ? ' active' : ''}`;
      const main = document.createElement('div');
      const select = document.createElement('button'); select.type = 'button'; select.className = 'post-select'; select.textContent = post.title; select.addEventListener('click', () => loadPost(post));
      const meta = document.createElement('div'); meta.className = 'post-row-meta'; meta.textContent = post.display_date || (post.published_at ? new Date(post.published_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Rascunho');
      const status = document.createElement('span'); status.className = `status ${post.status}`; status.textContent = post.status === 'published' ? publishedLabel : 'Rascunho';
      main.append(select, meta, status);
      const actions = document.createElement('div'); actions.className = 'post-row-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'icon-button'; edit.textContent = 'Editar'; edit.setAttribute('aria-label', `Editar ${post.title}`); edit.addEventListener('click', () => loadPost(post));
      const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-button delete'; del.textContent = 'Excluir'; del.setAttribute('aria-label', `Excluir ${post.title}`); del.addEventListener('click', () => deletePost(post));
      actions.append(edit, del); row.append(main, actions); postsList.append(row);
    }
  }
  async function loadPosts() {
    posts = await api(endpoint);
    drawPosts();
  }
  async function deletePost(post) {
    if (!window.confirm(`Excluir “${post.title}”? Essa ação não pode ser desfeita.`)) return;
    try { await api(`${endpoint}/${post.id}`, { method: 'DELETE' }); if (activeId === post.id) resetEditor(); await loadPosts(); }
    catch (error) { message($('#editor-notice'), error.message); }
  }
  function refreshPreview() {
    const title = postForm.elements.title.value.trim();
    $('#preview-title').textContent = title || 'Título do artigo';
    $('#preview-excerpt').textContent = postForm.elements.excerpt.value.trim() || 'O resumo aparecerá aqui.';
    $('#preview-meta').textContent = isPress ? (postForm.elements.outlet.value.trim() || 'Veículo') : `📅 Prévia · ${postForm.elements.author.value.trim() || 'Dr. Guido'}`;
    const cover = postForm.elements.cover_image.value;
    $('#preview-image').src = cover || '';
    $('#preview-image').hidden = !cover;
    $('#preview-content').innerHTML = editor.innerHTML || '<p>O conteúdo formatado aparecerá aqui.</p>';
    $('#draft-indicator').textContent = activeId ? 'Alterações não salvas' : 'Não salvo';
  }
  async function boot() {
    const sessionInfo = await fetch('/api/admin/session', { credentials: 'same-origin' }).then((r) => r.json());
    csrfToken = sessionInfo.csrfToken;
    setSignedIn(sessionInfo.authenticated, sessionInfo.email || '');
    if (sessionInfo.authenticated) await loadPosts();
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault(); message($('#login-notice'), '');
    const body = Object.fromEntries(new FormData(loginForm).entries());
    try {
      const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify(body) });
      csrfToken = result.csrfToken; setSignedIn(true, body.email); loginForm.reset(); await loadPosts();
    } catch (error) { message($('#login-notice'), error.message); }
  });
  $('#logout-button').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST', body: JSON.stringify({}) }); csrfToken = ''; posts = []; resetEditor(); await boot(); }
    catch (error) { message($('#editor-notice'), error.message); }
  });
  $('#publish-site').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const notice = $('#site-publish-notice');
    button.disabled = true;
    message(notice, 'Solicitando publicação…');
    try {
      await api('/api/admin/publish-site', { method: 'POST' });
      message(notice, 'Publicação solicitada. O site será atualizado quando o deploy terminar.', true);
    } catch (error) {
      message(notice, error.message);
    } finally {
      button.disabled = false;
    }
  });
  $('#new-post-button').addEventListener('click', resetEditor);
  postForm.elements.title.addEventListener('input', () => { if (!slugWasEdited) postForm.elements.slug.value = slugify(postForm.elements.title.value); refreshPreview(); });
  postForm.elements.slug.addEventListener('input', () => { slugWasEdited = true; postForm.elements.slug.value = slugify(postForm.elements.slug.value); });
  postForm.elements.excerpt.addEventListener('input', refreshPreview);
  postForm.elements.outlet.addEventListener('input', refreshPreview);
  postForm.elements.author.addEventListener('input', refreshPreview);
  editor.addEventListener('input', refreshPreview);
  $('#cover-file').addEventListener('change', async (event) => {
    const file = event.target.files[0]; if (!file) return;
    const revision = editorRevision;
    message($('#editor-notice'), 'Enviando imagem...');
    const data = new FormData(); data.append('cover', file);
    try {
      const result = await api('/api/admin/upload', { method: 'POST', body: data });
      if (revision !== editorRevision) return;
      postForm.elements.cover_image.value = result.url; $('#cover-preview').src = result.url; $('#cover-preview').hidden = false;
      message($('#editor-notice'), 'Imagem enviada.', true); refreshPreview();
    } catch (error) { if (revision === editorRevision) { event.target.value = ''; message($('#editor-notice'), error.message); } }
  });
  document.querySelectorAll('.toolbar button').forEach((button) => button.addEventListener('click', async () => {
    editor.focus(); const command = button.dataset.command;
    if (command === 'createLink') {
      const href = window.prompt('Cole o endereço do link (https://...)');
      if (href && /^https?:\/\//i.test(href)) document.execCommand('createLink', false, href);
    } else if (command === 'formatBlock') document.execCommand(command, false, `<${button.dataset.value}>`);
    else document.execCommand(command, false, null);
    refreshPreview();
  }));
  editor.addEventListener('paste', (event) => {
    event.preventDefault(); const text = (event.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, text);
  });
  $('#preview-button').addEventListener('click', refreshPreview);
  postForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const revision = editorRevision;
    const data = readForm(event.submitter?.dataset.status || 'draft');
    const buttons = [...postForm.querySelectorAll('button[type="submit"]')];
    buttons.forEach((button) => { button.disabled = true; });
    message($('#editor-notice'), 'Salvando...');
    try {
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(data) });
      if (revision === editorRevision) {
        activeId = result.post.id;
        postForm.elements.id.value = activeId;
        message($('#editor-notice'), data.status === 'published' ? `${publishedLabel}. ${result.url}` : 'Rascunho salvo.', true);
        $('#editor-heading-title').textContent = editLabel;
        $('#draft-indicator').textContent = data.status === 'published' ? publishedLabel : 'Rascunho';
      }
      await loadPosts();
    } catch (error) {
      if (revision === editorRevision) message($('#editor-notice'), error.message);
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  });

  boot().catch((error) => { setSignedIn(false); message($('#login-notice'), error.message); });
})();
