const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();

  try {
    tg.setHeaderColor('#0b0b0f');
    tg.setBackgroundColor('#0b0b0f');
  } catch (e) {}

  if (typeof tg.disableVerticalSwipes === 'function') {
    tg.disableVerticalSwipes();
  }
}

let currentUser = null;
let currentQuizQuestion = null;
let currentWordleLevel = 1;
let currentWordleAttempts = 0;
let currentWordleWordLength = 5;
let wordleFinished = false;
let wordleRows = [];

document.addEventListener('DOMContentLoaded', async () => {
  const balanceValue = document.getElementById('balanceValue');
  const doubleBalanceValue = document.getElementById('doubleBalanceValue');
  const quizBalanceValue = document.getElementById('quizBalanceValue');
  const wordleBalanceValue = document.getElementById('wordleBalanceValue');
  const welcomeTitle = document.getElementById('welcomeTitle');

  const dailyBonusBtn = document.getElementById('dailyBonusBtn');
  const rouletteBtn = document.getElementById('rouletteBtn');
  const quizBtn = document.getElementById('quizBtn');
  const doubleBtn = document.getElementById('doubleBtn');

  const homeScreen = document.getElementById('homeScreen');
  const doubleScreen = document.getElementById('doubleScreen');
  const quizScreen = document.getElementById('quizScreen');
  const wordleScreen = document.getElementById('wordleScreen');

  const backFromDoubleBtn = document.getElementById('backFromDoubleBtn');
  const backFromQuizBtn = document.getElementById('backFromQuizBtn');
  const backFromWordleBtn = document.getElementById('backFromWordleBtn');

  const coin = document.getElementById('coin');
  const doubleStatus = document.getElementById('doubleStatus');
  const playAgainBtn = document.getElementById('playAgainBtn');
  const choiceButtons = document.querySelectorAll('.choice-btn');

  const quizQuestionTitle = document.getElementById('quizQuestionTitle');
  const quizOptions = document.getElementById('quizOptions');
  const quizStatus = document.getElementById('quizStatus');
  const nextQuizBtn = document.getElementById('nextQuizBtn');

  const wordleLevelTitle = document.getElementById('wordleLevelTitle');
  const wordleBoard = document.getElementById('wordleBoard');
  const wordleInput = document.getElementById('wordleInput');
  const wordleSubmitBtn = document.getElementById('wordleSubmitBtn');
  const wordleStatus = document.getElementById('wordleStatus');
  const nextWordleBtn = document.getElementById('nextWordleBtn');

  const telegramUser = tg?.initDataUnsafe?.user;
  const API_BASE = '';

  if (telegramUser?.first_name) {
    welcomeTitle.textContent = `Bienvenido, ${telegramUser.first_name}`;
  } else {
    welcomeTitle.textContent = 'Bienvenido al Arcade';
  }

  const earnGamesGrid = document.getElementById('earnGamesGrid');
  if (earnGamesGrid && !document.getElementById('wordleOpenBtn')) {
    const wordleCard = document.createElement('article');
    wordleCard.className = 'game-card earn';
    wordleCard.innerHTML = `
      <div class="game-top">
        <span class="game-tag quiz">NIVELES</span>
        <span class="game-icon">🔤</span>
      </div>
      <h3>Wordle</h3>
      <p>Adivina palabras en castellano. Cada 10 niveles ganas 1 moneda.</p>
      <button id="wordleOpenBtn" class="game-btn secondary">Jugar Wordle</button>
    `;
    earnGamesGrid.appendChild(wordleCard);
  }

  const wordleOpenBtn = document.getElementById('wordleOpenBtn');

  async function registerOrLoadUser() {
    try {
      if (!telegramUser?.id) return;

      const res = await fetch(`${API_BASE}/api/auth/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: telegramUser.id,
          username: telegramUser.username || null,
          first_name: telegramUser.first_name || null
        })
      });

      const data = await res.json();

      if (data.ok) {
        currentUser = data.user;
        updateBalance(data.user.coins || 0);
      }
    } catch (error) {
      console.error('Error cargando usuario:', error);
    }
  }

  async function refreshBalance() {
    try {
      if (!telegramUser?.id) return;

      const res = await fetch(`${API_BASE}/api/balance/${telegramUser.id}`);
      const data = await res.json();

      if (data.ok) {
        updateBalance(data.balance);
      }
    } catch (error) {
      console.error('Error actualizando saldo:', error);
    }
  }

  function updateBalance(balance) {
    balanceValue.textContent = balance ?? 0;
    doubleBalanceValue.textContent = balance ?? 0;
    quizBalanceValue.textContent = balance ?? 0;
    wordleBalanceValue.textContent = balance ?? 0;
  }

  function showScreen(screenName) {
    homeScreen.classList.remove('active');
    doubleScreen.classList.remove('active');
    quizScreen.classList.remove('active');
    wordleScreen.classList.remove('active');

    if (screenName === 'double') {
      doubleScreen.classList.add('active');
    } else if (screenName === 'quiz') {
      quizScreen.classList.add('active');
    } else if (screenName === 'wordle') {
      wordleScreen.classList.add('active');
    } else {
      homeScreen.classList.add('active');
    }
  }

  function resetDoubleGameUI() {
    doubleStatus.textContent = 'Elige cara o cruz para empezar.';
    playAgainBtn.classList.add('hidden');
    coin.classList.remove('spinning');
    coin.style.transform = 'rotateY(0deg)';

    choiceButtons.forEach(btn => {
      btn.disabled = false;
    });
  }

  async function loadQuizQuestion() {
    try {
      quizStatus.textContent = 'Cargando pregunta...';
      quizOptions.innerHTML = '';
      nextQuizBtn.classList.add('hidden');

      const res = await fetch(`${API_BASE}/api/quiz-question`);
      const data = await res.json();

      if (!data.ok) {
        quizStatus.textContent = 'No se pudo cargar la pregunta.';
        return;
      }

      currentQuizQuestion = data.question;
      quizQuestionTitle.textContent = currentQuizQuestion.question;
      quizStatus.textContent = 'Elige una respuesta.';

      currentQuizQuestion.options.forEach((option, index) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-option-btn';
        btn.textContent = option;

        btn.addEventListener('click', async () => {
          await answerQuiz(index);
        });

        quizOptions.appendChild(btn);
      });
    } catch (error) {
      console.error('Error cargando pregunta del quiz:', error);
      quizStatus.textContent = 'Error cargando pregunta.';
    }
  }

  async function answerQuiz(answerIndex) {
    try {
      if (!telegramUser?.id || !currentQuizQuestion) return;

      const buttons = document.querySelectorAll('.quiz-option-btn');
      buttons.forEach(btn => btn.disabled = true);

      const res = await fetch(`${API_BASE}/api/quiz-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: telegramUser.id,
          question_id: currentQuizQuestion.id,
          answer_index: answerIndex
        })
      });

      const data = await res.json();

      if (!data.ok) {
        quizStatus.textContent = `❌ ${data.error}`;
        nextQuizBtn.classList.remove('hidden');
        return;
      }

      updateBalance(data.balance);

      if (data.correct) {
        quizStatus.innerHTML = `✅ ¡Correcto! Has ganado ${data.reward} moneda.<br>💰 Saldo actual: ${data.balance}`;
      } else {
        const correctText = currentQuizQuestion.options[data.correctIndex];
        quizStatus.innerHTML = `❌ Incorrecto.<br>Respuesta correcta: <strong>${correctText}</strong><br>💰 Saldo actual: ${data.balance}`;
      }

      nextQuizBtn.classList.remove('hidden');
    } catch (error) {
      console.error('Error respondiendo quiz:', error);
      quizStatus.textContent = '❌ Error respondiendo la pregunta.';
      nextQuizBtn.classList.remove('hidden');
    }
  }

  async function loadWordleState() {
    try {
      if (!telegramUser?.id) return;

      const res = await fetch(`${API_BASE}/api/wordle-state/${telegramUser.id}`);
      const data = await res.json();

      if (!data.ok) {
        wordleStatus.textContent = 'No se pudo cargar Wordle.';
        return;
      }

      currentWordleLevel = data.level;
      currentWordleWordLength = data.wordLength;
      currentWordleAttempts = 0;
      wordleFinished = false;
      wordleRows = [];

      wordleLevelTitle.textContent = `Nivel ${currentWordleLevel}`;
      wordleStatus.textContent = `Adivina la palabra de ${currentWordleWordLength} letras. Tienes 6 intentos.`;
      wordleInput.value = '';
      wordleInput.maxLength = currentWordleWordLength;
      nextWordleBtn.classList.add('hidden');
      wordleSubmitBtn.disabled = false;
      wordleInput.disabled = false;

      renderWordleBoard([]);
    } catch (error) {
      console.error('Error cargando Wordle:', error);
      wordleStatus.textContent = 'Error cargando Wordle.';
    }
  }

  function renderWordleBoard(rows) {
    wordleBoard.innerHTML = '';

    for (let i = 0; i < 6; i++) {
      const row = document.createElement('div');
      row.className = 'wordle-row';

      const rowData = rows[i] || [];

      for (let j = 0; j < currentWordleWordLength; j++) {
        const cell = document.createElement('div');
        cell.className = 'wordle-cell';

        if (rowData[j]) {
          cell.textContent = rowData[j].letter;
          cell.classList.add(rowData[j].state);
        }

        row.appendChild(cell);
      }

      wordleBoard.appendChild(row);
    }
  }

  async function submitWordleGuess() {
    try {
      if (!telegramUser?.id || wordleFinished) return;

      const guess = wordleInput.value.trim().toLowerCase();

      if (guess.length !== currentWordleWordLength) {
        wordleStatus.textContent = `La palabra debe tener ${currentWordleWordLength} letras.`;
        return;
      }

      const res = await fetch(`${API_BASE}/api/wordle-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: telegramUser.id,
          guess
        })
      });

      const data = await res.json();

      if (!data.ok) {
        wordleStatus.textContent = `❌ ${data.error}`;
        return;
      }

      const row = guess.split('').map((letter, i) => ({
        letter,
        state: data.result[i]
      }));

      wordleRows.push(row);
      renderWordleBoard(wordleRows);

      currentWordleAttempts++;
      updateBalance(data.balance);

      if (data.win) {
        wordleFinished = true;
        wordleStatus.innerHTML = data.reward > 0
          ? `🎉 Nivel superado.<br>Ganaste ${data.reward} moneda.<br>💰 Saldo actual: ${data.balance}`
          : `✅ Nivel superado.<br>💰 Saldo actual: ${data.balance}`;

        wordleSubmitBtn.disabled = true;
        wordleInput.disabled = true;
        nextWordleBtn.classList.remove('hidden');
        return;
      }

      if (currentWordleAttempts >= 6) {
        wordleFinished = true;
        wordleStatus.innerHTML = `💥 Has agotado tus intentos.<br>Vuelve a intentarlo en este nivel.`;
        nextWordleBtn.classList.remove('hidden');
        wordleSubmitBtn.disabled = true;
        wordleInput.disabled = true;
        return;
      }

      wordleStatus.textContent = `Intento ${currentWordleAttempts}/6. Sigue probando.`;
      wordleInput.value = '';
    } catch (error) {
      console.error('Error enviando palabra Wordle:', error);
      wordleStatus.textContent = '❌ Error jugando Wordle.';
    }
  }

  dailyBonusBtn.addEventListener('click', async () => {
    try {
      if (!telegramUser?.id) {
        alert('No se pudo obtener tu usuario de Telegram');
        return;
      }

      dailyBonusBtn.disabled = true;
      dailyBonusBtn.textContent = 'Reclamando...';

      const res = await fetch(`${API_BASE}/api/daily-bonus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: telegramUser.id
        })
      });

      const data = await res.json();

      if (data.ok) {
        updateBalance(data.balance);
        alert(`🎁 ${data.message || `Has ganado ${data.reward} monedas`}\n💰 Saldo actual: ${data.balance}`);
      } else {
        alert(`❌ ${data.error}`);
      }
    } catch (error) {
      console.error('Error reclamando bonus diario:', error);
      alert('❌ Error reclamando bonus diario');
    } finally {
      dailyBonusBtn.disabled = false;
      dailyBonusBtn.textContent = 'Reclamar bonus';
    }
  });

  doubleBtn.addEventListener('click', () => {
    resetDoubleGameUI();
    showScreen('double');
  });

  quizBtn.addEventListener('click', async () => {
    showScreen('quiz');
    await loadQuizQuestion();
  });

  if (wordleOpenBtn) {
    wordleOpenBtn.addEventListener('click', async () => {
      showScreen('wordle');
      await loadWordleState();
    });
  }

  backFromDoubleBtn.addEventListener('click', () => {
    showScreen('home');
  });

  backFromQuizBtn.addEventListener('click', () => {
    showScreen('home');
  });

  backFromWordleBtn.addEventListener('click', () => {
    showScreen('home');
  });

  playAgainBtn.addEventListener('click', () => {
    resetDoubleGameUI();
  });

  nextQuizBtn.addEventListener('click', async () => {
    await loadQuizQuestion();
  });

  nextWordleBtn.addEventListener('click', async () => {
    await loadWordleState();
  });

  wordleSubmitBtn.addEventListener('click', async () => {
    await submitWordleGuess();
  });

  wordleInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      await submitWordleGuess();
    }
  });

  choiceButtons.forEach(button => {
    button.addEventListener('click', async () => {
      try {
        if (!telegramUser?.id) {
          doubleStatus.textContent = 'No se pudo obtener tu usuario de Telegram.';
          return;
        }

        const userChoice = button.dataset.choice;

        choiceButtons.forEach(btn => {
          btn.disabled = true;
        });

        doubleStatus.textContent = `Has elegido ${userChoice}. Lanzando moneda...`;
        playAgainBtn.classList.add('hidden');

        coin.classList.remove('spinning');
        void coin.offsetWidth;
        coin.classList.add('spinning');

        const res = await fetch(`${API_BASE}/api/double-or-nothing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telegram_id: telegramUser.id
          })
        });

        const data = await res.json();

        setTimeout(() => {
          if (data.ok) {
            const resultSide = data.win
              ? userChoice
              : (userChoice === 'cara' ? 'cruz' : 'cara');

            if (resultSide === 'cara') {
              coin.style.transform = 'rotateY(0deg)';
            } else {
              coin.style.transform = 'rotateY(180deg)';
            }

            updateBalance(data.balance);

            doubleStatus.innerHTML = data.win
              ? `🎉 <strong>¡Ganaste!</strong><br>Salió <strong>${resultSide}</strong>.<br>💰 Saldo actual: ${data.balance}`
              : `💥 <strong>Perdiste</strong><br>Salió <strong>${resultSide}</strong>.<br>💰 Saldo actual: ${data.balance}`;
          } else {
            doubleStatus.innerHTML = `❌ ${data.error}`;
          }

          playAgainBtn.classList.remove('hidden');
        }, 1600);
      } catch (error) {
        console.error('Error jugando doble o nada:', error);
        doubleStatus.textContent = '❌ Error al jugar';
        playAgainBtn.classList.remove('hidden');
      }
    });
  });

  rouletteBtn.addEventListener('click', () => {
    alert('🎡 Próximamente: ruleta diaria');
  });

  await registerOrLoadUser();
  await refreshBalance();
});
