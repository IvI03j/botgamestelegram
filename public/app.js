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
  const welcomeTitle = document.getElementById('welcomeTitle');

  const dailyBonusBtn = document.getElementById('dailyBonusBtn');
  const rouletteBtn = document.getElementById('rouletteBtn');
  const quizBtn = document.getElementById('quizBtn');
  const doubleBtn = document.getElementById('doubleBtn');

  const telegramUser = tg?.initDataUnsafe?.user;

  // CAMBIA ESTA URL SI TU BACKEND REAL ES OTRO
  const API_BASE = 'https://botneflixtelegram.fly.dev';

  if (telegramUser?.first_name) {
    welcomeTitle.textContent = `Bienvenido, ${telegramUser.first_name}`;
  } else {
    welcomeTitle.textContent = 'Bienvenido al Arcade';
  }

  async function registerOrLoadUser() {
    try {
      if (!telegramUser?.id) {
        console.warn('No se pudo obtener usuario de Telegram');
        return;
      }

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
      } else {
        console.error('Error cargando usuario:', data.error);
      }
    } catch (error) {
      console.error('Error registrando/cargando usuario:', error);
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
  }

  dailyBonusBtn.addEventListener('click', () => {
    alert('🎁 Próximamente: bonus diario con monedas reales');
  });

  rouletteBtn.addEventListener('click', () => {
    alert('🎡 Próximamente: ruleta diaria');
  });

  quizBtn.addEventListener('click', () => {
    alert('🎬 Próximamente: quiz por niveles');
  });

  doubleBtn.addEventListener('click', () => {
    alert('💥 Próximamente: doble o nada');
  });

  await registerOrLoadUser();
  await refreshBalance();
});
