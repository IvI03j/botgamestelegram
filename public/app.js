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

  const API_BASE = 'https://botneflixtelegram.fly.dev';

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
        alert(`🎁 ${data.message}\n💰 Saldo actual: ${data.balance}`);
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
