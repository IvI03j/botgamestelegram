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

document.addEventListener('DOMContentLoaded', async () => {
  const balanceValue = document.getElementById('balanceValue');
  const doubleBalanceValue = document.getElementById('doubleBalanceValue');
  const welcomeTitle = document.getElementById('welcomeTitle');

  const dailyBonusBtn = document.getElementById('dailyBonusBtn');
  const rouletteBtn = document.getElementById('rouletteBtn');
  const quizBtn = document.getElementById('quizBtn');
  const doubleBtn = document.getElementById('doubleBtn');

  const homeScreen = document.getElementById('homeScreen');
  const doubleScreen = document.getElementById('doubleScreen');
  const backFromDoubleBtn = document.getElementById('backFromDoubleBtn');

  const coin = document.getElementById('coin');
  const doubleStatus = document.getElementById('doubleStatus');
  const playAgainBtn = document.getElementById('playAgainBtn');
  const choiceButtons = document.querySelectorAll('.choice-btn');

  const telegramUser = tg?.initDataUnsafe?.user;
  const API_BASE = '';

  if (telegramUser?.first_name) {
    welcomeTitle.textContent = `Bienvenido, ${telegramUser.first_name}`;
  } else {
    welcomeTitle.textContent = 'Bienvenido al Arcade';
  }

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
  }

  function showScreen(screenName) {
    homeScreen.classList.remove('active');
    doubleScreen.classList.remove('active');

    if (screenName === 'double') {
      doubleScreen.classList.add('active');
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

  backFromDoubleBtn.addEventListener('click', () => {
    showScreen('home');
  });

  playAgainBtn.addEventListener('click', () => {
    resetDoubleGameUI();
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
            const resultSide = data.win ? userChoice : (userChoice === 'cara' ? 'cruz' : 'cara');

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

  quizBtn.addEventListener('click', () => {
    alert('🎬 Próximamente: quiz por niveles');
  });

  await registerOrLoadUser();
  await refreshBalance();
});
