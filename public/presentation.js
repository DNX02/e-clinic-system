(function() {
  const slides = document.querySelectorAll('.slide');
  const progressBar = document.getElementById('progressBar');
  const currentSlideNum = document.getElementById('currentSlideNum');
  const totalSlidesNum = document.getElementById('totalSlidesNum');
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const btnToggleNotes = document.getElementById('btnToggleNotes');
  const btnCloseNotes = document.getElementById('btnCloseNotes');
  const notesModal = document.getElementById('speakerNotesModal');
  const notesContent = document.getElementById('speakerNotesContent');

  let currentIdx = 0;
  const total = slides.length;
  totalSlidesNum.textContent = total;

  function updateSlide(idx) {
    if (idx < 0) idx = 0;
    if (idx >= total) idx = total - 1;
    currentIdx = idx;

    slides.forEach((s, i) => {
      s.classList.toggle('active', i === currentIdx);
    });

    currentSlideNum.textContent = currentIdx + 1;
    progressBar.style.width = (((currentIdx + 1) / total) * 100) + '%';
    btnPrev.disabled = currentIdx === 0;
    btnNext.disabled = currentIdx === total - 1;

    // Update speaker notes
    const currentSlide = slides[currentIdx];
    const notes = currentSlide.getAttribute('data-notes') || 'Нет заметок для этого слайда.';
    notesContent.innerHTML = `<p>${notes.replace(/\n/g, '<br>')}</p>`;
  }

  function nextSlide() {
    if (currentIdx < total - 1) updateSlide(currentIdx + 1);
  }
  function prevSlide() {
    if (currentIdx > 0) updateSlide(currentIdx - 1);
  }

  btnNext.addEventListener('click', nextSlide);
  btnPrev.addEventListener('click', prevSlide);

  btnToggleNotes.addEventListener('click', () => {
    notesModal.classList.toggle('open');
  });
  btnCloseNotes.addEventListener('click', () => {
    notesModal.classList.remove('open');
  });

  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      nextSlide();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      prevSlide();
    } else if (e.key === 'Home') {
      e.preventDefault();
      updateSlide(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      updateSlide(total - 1);
    } else if (e.key.toLowerCase() === 'n' || e.key.toLowerCase() === 'т') {
      notesModal.classList.toggle('open');
    } else if (e.key === 'Escape') {
      notesModal.classList.remove('open');
    }
  });

  // Swipe support for tablets / touch screens
  let touchStartX = 0;
  let touchEndX = 0;
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    if (touchStartX - touchEndX > 50) nextSlide();
    if (touchEndX - touchStartX > 50) prevSlide();
  }, { passive: true });

  // Init first slide
  updateSlide(0);
})();
