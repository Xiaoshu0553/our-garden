const hit = document.getElementById('pet-hit');
const petImage = document.getElementById('pet-image');
let pointer;
let dragged = false;
let cancelled = false;
let singleClickTimer;
function clearSingleClick() { clearTimeout(singleClickTimer); singleClickTimer = undefined; }
function cancelInteraction() {
  clearSingleClick();
  // A screenshot overlay can steal capture and the eventual pointerup/click.
  // Suppress that gesture until a fresh press, instead of moving on hover.
  cancelled = true;
  const previous = pointer; pointer = null;
  if (previous && hit.hasPointerCapture(previous.id)) hit.releasePointerCapture(previous.id);
  window.gardenDesktop?.petHit(false);
}
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
  clearSingleClick(); dragged = false; cancelled = false;
  pointer = { id: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
  try { hit.setPointerCapture(event.pointerId); }
  catch { cancelInteraction(); return; }
  window.gardenDesktop?.petHit(true);
});
hit.addEventListener('pointermove', event => {
  if (!pointer) return;
  if (event.pointerId !== pointer.id || !(event.buttons & 1)) { cancelInteraction(); return; }
  const dx = event.screenX - pointer.x, dy = event.screenY - pointer.y;
  if (Math.abs(dx) + Math.abs(dy) > 4 || pointer.moved) {
    pointer.moved = true;
    window.gardenDesktop?.movePet(dx, dy);
    pointer.x = event.screenX; pointer.y = event.screenY;
  }
});
hit.addEventListener('pointerup', event => {
  if (!pointer) return;
  if (event.pointerId !== pointer.id) { cancelInteraction(); return; }
  dragged = pointer.moved; pointer = null;
});
for (const type of ['pointercancel', 'lostpointercapture']) hit.addEventListener(type, event => {
  // Normal pointerup also releases capture, after clearing pointer above.
  if (pointer && event.pointerId === pointer.id) cancelInteraction();
});
window.addEventListener('blur', cancelInteraction);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelInteraction(); });
hit.addEventListener('click', event => {
  if (cancelled) return;
  if (dragged) { dragged = false; return; }
  clearSingleClick();
  if (event.detail < 2) singleClickTimer = setTimeout(() => { singleClickTimer = undefined; window.gardenDesktop?.togglePanel(); }, 350);
});
hit.addEventListener('dblclick', event => { event.preventDefault(); clearSingleClick(); if (!cancelled) window.gardenDesktop?.openMain(); });
hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); clearSingleClick(); window.gardenDesktop?.togglePanel(); } });
hit.addEventListener('contextmenu', event => { event.preventDefault(); clearSingleClick(); window.gardenDesktop?.petMenu(); });
