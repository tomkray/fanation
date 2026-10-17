/** The brand splash painted by index.html, faded out once the city can draw. */

const BOOT_FADE_MS = 400;
/** Never trap anyone behind the splash if models or the API are slow. */
export const BOOT_MAX_MS = 15_000;

export function dismissBoot(): void {
  const boot = document.getElementById('boot');
  if (!boot || boot.classList.contains('boot--done')) {
    return;
  }
  boot.classList.add('boot--done');
  window.setTimeout(() => boot.remove(), BOOT_FADE_MS);
}
