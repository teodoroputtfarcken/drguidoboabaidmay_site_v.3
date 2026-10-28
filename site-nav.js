(() => {
  const nav = document.getElementById('main-nav');
  const hamburger = document.getElementById('hamburger');
  const group = nav?.querySelector('.nav-dropdown');
  const toggle = group?.querySelector('.dropdown-toggle');
  if (!nav || !hamburger || !toggle) return;
  const mobile = () => window.matchMedia('(max-width: 1100px)').matches;
  const positionNav = () => {
    const header = nav.closest('header');
    if (header) nav.style.setProperty('--nav-top', `${Math.ceil(header.getBoundingClientRect().bottom)}px`);
  };
  const close = () => {
    nav.classList.remove('open'); hamburger.classList.remove('open');
    group.classList.remove('expanded'); document.body.classList.remove('menu-open');
    hamburger.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-expanded', 'false');
  };
  window.closeMenu = close;
  window.toggleMenu = () => {
    positionNav();
    const open = !nav.classList.contains('open');
    if (!open) { close(); return; }
    nav.classList.add('open'); hamburger.classList.add('open');
    document.body.classList.add('menu-open'); hamburger.setAttribute('aria-expanded', 'true');
  };
  toggle.addEventListener('click', () => {
    const expanded = group.classList.toggle('expanded');
    toggle.setAttribute('aria-expanded', String(expanded));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', () => { positionNav(); if (!mobile()) close(); });
  positionNav();
  nav.addEventListener('click', e => { if (e.target.closest('a')) close(); });
})();
