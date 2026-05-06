// Toast notification — small bottom-right popup.

function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderColor = isError ? 'var(--red)' : 'var(--green)';
  t.style.borderLeftColor = isError ? 'var(--red)' : 'var(--green)';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}


window.toast = toast;
