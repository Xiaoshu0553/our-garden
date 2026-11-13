const hit = document.getElementById('pet-hit');
const petImage = document.getElementById('pet-image');
let pointer;
let dragged = false;
let singleClickTimer;
function update(info) {
  petImage.src = info.customImage && info.pet === 'custom' ? info.customImage : `${info.pet === 'cat' ? 'cat' : 'dog'}.svg`;
  const count = Math.max(0, info.unreadCount || 0);
  document.getElementById('pet-unread').hidden = !count;
  document.getElementById('pet-count').textContent = count > 9 ? '9+' : count;
  document.getElementById('pet-bubble').hidden = !count;
}
window.gardenDesktop?.onEvent(event => { if (event.type === 'pet-state') update(event.data); });
window.gardenDesktop?.petReady().then(update);
document.addEventListener('mousemove', event => {
  if (!pointer) window.gardenDesktop?.petHit(Boolean(event.target.closest('#pet-hit')));
});
hit.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointer = { x: event.screenX, y: event.screenY, moved: false };
  hit.setPointerCapture(event.pointerId);
  window.gardenDesktop?.petHit(true);
});
hit.addEventListener('pointermove', event => {
  if (!pointer) return;
  const dx = event.screenX - pointer.x, dy = event.screenY - pointer.y;
  if (Math.abs(dx) + Math.abs(dy) > 4 || pointer.moved) {
    pointer.moved = true;
    window.gardenDesktop?.movePet(dx, dy);
    pointer.x = event.screenX; pointer.y = event.screenY;
  }
});
hit.addEventListener('pointerup', () => { dragged = Boolean(pointer?.moved); pointer = null; });
hit.addEventListener('pointercancel', () => { pointer = null; });
hit.addEventListener('click', event => {
  if (dragged) { dragged = false; return; }
  clearTimeout(singleClickTimer);
  if (event.detail < 2) singleClickTimer = setTimeout(() => window.gardenDesktop?.togglePanel(), 350);
});
hit.addEventListener('dblclick', event => { event.preventDefault(); clearTimeout(singleClickTimer); window.gardenDesktop?.openMain(); });
hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.gardenDesktop?.togglePanel(); } });
hit.addEventListener('contextmenu', event => { event.preventDefault(); clearTimeout(singleClickTimer); window.gardenDesktop?.petMenu(); });
