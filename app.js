const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();

  try {
    tg.setHeaderColor('#111111');
    tg.setBackgroundColor('#111111');
  } catch (e) {}
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

  if (telegramUser?.first_name) {
    welcomeTitle.textContent = `Bienvenido, ${telegramUser.first_name}`;
  }

  async function registerOrLoadUser() {
    try {
      if (!telegramUser?.id) {
        console.warn('No se pudo obtener usuario de Telegram');
        return;
      }

      // OJO:
      // Cambia esta URL por la URL de tu backend que ya usa Supabase
      const res = await fetch('https://botneflixtelegram.fly.dev/api/auth/telegram', {
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
      console.error('Error registrando/cargando usuario:', error);
    }
  }

  async function refreshBalance() {
    try {
      if (!telegramUser?.id) return;

      const res = await fetch(`https://botneflixtelegram.fly.dev/api/balance/${telegramUser.id}`);
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
    alert('🎁 Próximamente: bonus diario conectado a monedas reales');
  });

  rouletteBtn.addEventListener('click', () => {
    alert('🎡 Próximamente: ruleta');
  });

  quizBtn.addEventListener('click', () => {
    alert('🎬 Próximamente: quiz de películas');
  });

  doubleBtn.addEventListener('click', () => {
    alert('💥 Próximamente: doble o nada');
  });

  await registerOrLoadUser();
  await refreshBalance();
});
