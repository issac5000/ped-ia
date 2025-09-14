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
  window.addEventListener('load', hide);
  setTimeout(() => {
    if(!done){
      if(refreshBtn){
        refreshBtn.hidden = false;
        refreshBtn.addEventListener('click', () => location.reload());
      }
    }
  }, 5000);
})();
