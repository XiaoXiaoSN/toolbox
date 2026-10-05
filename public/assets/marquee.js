const message = document.getElementById('message');
const input = document.getElementById('message-input');
const speed = document.getElementById('speed');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let animation;
let paused = reducedMotion.matches;
function update() {
  const velocity = Number(speed.value);
  if (!Number.isFinite(velocity) || velocity < 1 || velocity > 5000) return;
  message.textContent = input.value || ' ';
  animation?.cancel();
  const width = message.getBoundingClientRect().width;
  const viewport = document.documentElement.clientWidth;
  animation = message.animate([
    { transform: `translateX(${viewport}px)` },
    { transform: `translateX(${-width}px)` },
  ], { duration: (viewport + width) * 1000 / velocity, iterations: Infinity, easing: 'linear' });
  if (paused) {
    animation.pause();
    // Keep paused content visible rather than outside the viewport.
    animation.currentTime = viewport * 1000 / velocity;
  }
}
document.getElementById('controls').addEventListener('submit', (event) => { event.preventDefault(); update(); });
document.getElementById('pause').addEventListener('click', () => {
  paused = !paused;
  if (paused) animation?.pause(); else animation?.play();
});
document.getElementById('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* Fullscreen is optional, including on iOS. */ }
});
window.addEventListener('resize', update);
update();
