const toggle = document.querySelector('#menu-toggle');
const menu = document.querySelector('#mobileMenu');
const desktop = matchMedia('(min-width: 901px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const video = document.querySelector('#film');

function setMenu(open, restoreFocus = false) {
  menu.inert = !open;
  menu.setAttribute('aria-hidden', String(!open));
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  document.body.classList.toggle('menu-open', open);
  if (open) menu.querySelector('a').focus();
  if (restoreFocus && !desktop.matches) toggle.focus();
}

toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
menu.addEventListener('click', event => {
  if (event.target === menu) setMenu(false, true);
});
desktop.addEventListener('change', event => { if (event.matches) setMenu(false); });
document.addEventListener('keydown', event => {
  if (menu.inert) return;
  if (event.key === 'Escape') setMenu(false, true);
  if (event.key !== 'Tab') return;
  const ends = [...menu.querySelectorAll('a'), toggle];
  const index = ends.indexOf(document.activeElement);
  event.preventDefault();
  const step = event.shiftKey ? -1 : 1;
  ends[(index + step + ends.length) % ends.length].focus();
});

function updateVideo() {
  if (reduced.matches) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    return;
  }
  video.src = video.dataset.src;
  video.play().catch(() => {});
}
reduced.addEventListener('change', updateVideo);
updateVideo();
document.querySelector('#landing-host').textContent = location.host;
