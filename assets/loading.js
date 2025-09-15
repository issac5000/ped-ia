(function(){
  const overlay = document.getElementById('loading-overlay');
  if(!overlay) return;
  const refreshBtn = overlay.querySelector('#refresh-btn');
  let done = false;
  function hide(){
    if(done) return;
    done = true;
    overlay.style.display = 'none';
  }
  // Hide as early as possible to avoid blocking scroll on heavy pages
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    hide();
  } else {
    window.addEventListener('DOMContentLoaded', hide, { once: true });
  }
  // Keep the original load hook as a fallback (no-op if already hidden)
  window.addEventListener('load', hide, { once: true });
  // Absolute safety: if something still delays, stop capturing pointer events quickly
  setTimeout(() => {
    if (!done) {
      overlay.style.pointerEvents = 'none';
    }
  }, 800);
  // Offer a manual refresh if assets take too long
  setTimeout(() => {
    if(!done){
      if(refreshBtn){
        refreshBtn.hidden = false;
        refreshBtn.addEventListener('click', () => location.reload());
      }
    }
  }, 5000);
})();
