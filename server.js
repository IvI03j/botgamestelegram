const express = require('express');
const { Telegraf } = require('telegraf');
const cors = require('cors');
const path = require('path');
const supabase = require('./supabase');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBAPP_URL = process.env.WEBAPP_URL;
const MOVIES_BOT_URL = process.env.MOVIES_BOT_URL;
const OFFICIAL_WEB_URL = process.env.OFFICIAL_WEB_URL;
const PORT = process.env.PORT || 8080;

const DOUBLE_GAME_COST = 1;
const DAILY_BONUS_REWARD = 3;
const WORDLE_REWARD_EVERY = 10;
const WORDLE_REWARD_COINS = 1;

const WORDLE_WORDS = [
  'perro', 'gatos', 'cielo', 'nieve', 'playa',
  'ronda', 'fuego', 'nubes', 'fruta', 'limon',
  'panel', 'mango', 'carta', 'barco', 'raton',
  'libro', 'silla', 'tenis', 'queso', 'piano',
  'tigre', 'avion', 'campo', 'rutas', 'metal',
  'cabra', 'dulce', 'verde', 'negro', 'blusa'
];

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan BOT_TOKEN, SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

console.log('Servidor iniciando...');
console.log('PORT:', PORT);
console.log('MOVIES_BOT_URL:', MOVIES_BOT_URL);
console.log('WEBAPP_URL:', WEBAPP_URL);
console.log('OFFICIAL_WEB_URL:', OFFICIAL_WEB_URL);

const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, status: 'running' });
});

app.get('/', (req, res) => {
  res.send('Ofica Hub funcionando');
});

// =========================
// REGISTRAR USUARIO
// =========================
async function registerUserIfNeeded(ctx) {
  try {
    const telegram_id = ctx.from?.id;
    const username = ctx.from?.username || null;
    const first_name = ctx.from?.first_name || null;

    if (!telegram_id) return null;

    const { data: existingUser, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .maybeSingle();

    if (error) {
      console.error('Error buscando usuario:', error.message);
      return null;
    }

    if (existingUser) return existingUser;

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([
        {
          telegram_id,
          username,
          first_name,
          coins: 0,
          wordle_level: 1,
          wordle_last_reward_level: 0
        }
      ])
      .select()
      .single();

    if (insertError) {
      console.error('Error creando usuario:', insertError.message);
      return null;
    }

    await supabase.from('transactions').insert([
      {
        telegram_id,
        type: 'register',
        amount: 0,
        description: 'Registro inicial del usuario',
        source: 'hub_bot'
      }
    ]);

    return newUser;
  } catch (error) {
    console.error('Error registrando usuario:', error.message);
    return null;
  }
}

// =========================
// OBTENER SALDO
// =========================
async function getUserBalance(telegramId) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('coins')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (error || !user) return 0;
    return user.coins || 0;
  } catch (error) {
    console.error('Error obteniendo saldo:', error.message);
    return 0;
  }
}

// =========================
// BONUS DIARIO
// =========================
async function claimDailyBonus(telegramId) {
  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (userError || !user) {
      return { ok: false, error: 'Usuario no encontrado' };
    }

    const now = new Date();
    const lastBonus = user.last_daily_bonus_at
      ? new Date(user.last_daily_bonus_at)
      : null;

    if (lastBonus) {
      const sameDay =
        now.getUTCFullYear() === lastBonus.getUTCFullYear() &&
        now.getUTCMonth() === lastBonus.getUTCMonth() &&
        now.getUTCDate() === lastBonus.getUTCDate();

      if (sameDay) {
        return {
          ok: false,
          error: 'Ya reclamaste tu bonus diario hoy',
          balance: user.coins
        };
      }
    }

    const newBalance = user.coins + DAILY_BONUS_REWARD;

    const { error: updateError } = await supabase
      .from('users')
      .update({
        coins: newBalance,
        last_daily_bonus_at: now.toISOString(),
        updated_at: now.toISOString()
      })
      .eq('telegram_id', telegramId);

    if (updateError) {
      console.error('Error actualizando bonus:', updateError.message);
      return { ok: false, error: 'No se pudo reclamar el bonus' };
    }

    await supabase.from('transactions').insert([
      {
        telegram_id: telegramId,
        type: 'daily_bonus',
        amount: DAILY_BONUS_REWARD,
        description: 'Bonus diario reclamado desde hub',
        source: 'hub_bot'
      }
    ]);

    return {
      ok: true,
      reward: DAILY_BONUS_REWARD,
      balance: newBalance
    };
  } catch (error) {
    console.error('Error en claimDailyBonus:', error.message);
    return { ok: false, error: 'Error interno reclamando bonus' };
  }
}

// =========================
// DOBLE O NADA
// =========================
app.post('/api/double-or-nothing', async (req, res) => {
  try {
    const { telegram_id } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        ok: false,
        error: 'Falta telegram_id'
      });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .maybeSingle();

    if (userError) {
      console.error('Error buscando usuario en doble o nada:', userError.message);
      return res.status(500).json({
        ok: false,
        error: 'Error buscando usuario'
      });
    }

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: 'Usuario no encontrado'
      });
    }

    if (user.coins < DOUBLE_GAME_COST) {
      return res.status(400).json({
        ok: false,
        error: 'No tienes monedas suficientes para jugar',
        balance: user.coins
      });
    }

    const win = Math.random() < 0.45;

    let newBalance = user.coins - DOUBLE_GAME_COST;
    let reward = 0;

    if (win) {
      reward = 2;
      newBalance += reward;
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({
        coins: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('telegram_id', telegram_id);

    if (updateError) {
      console.error('Error actualizando saldo en doble o nada:', updateError.message);
      return res.status(500).json({
        ok: false,
        error: 'No se pudo actualizar el saldo'
      });
    }

    await supabase.from('transactions').insert([
      {
        telegram_id,
        type: win ? 'double_win' : 'double_lose',
        amount: win ? 1 : -1,
        description: win
          ? 'Ganó en doble o nada (45%)'
          : 'Perdió en doble o nada (55%)',
        source: 'games_webapp'
      }
    ]);

    return res.json({
      ok: true,
      win,
      reward,
      cost: DOUBLE_GAME_COST,
      balance: newBalance,
      message: win
        ? `🎉 Has ganado. Recibes ${reward} monedas`
        : '💥 Has perdido tu moneda'
    });
  } catch (error) {
    console.error('Error en /api/double-or-nothing:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// =========================
// WORDLE
// =========================
app.get('/api/wordle-state/:telegramId', async (req, res) => {
  try {
    const telegramId = req.params.telegramId;

    const { data: user, error } = await supabase
      .from('users')
      .select('wordle_level, wordle_last_reward_level, coins')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({
        ok: false,
        error: 'Usuario no encontrado'
      });
    }

    const level = user.wordle_level || 1;
    const word = WORDLE_WORDS[(level - 1) % WORDLE_WORDS.length];

    return res.json({
      ok: true,
      level,
      wordLength: word.length,
      balance: user.coins
    });
  } catch (error) {
    console.error('Error en /api/wordle-state:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Error interno'
    });
  }
});

app.post('/api/wordle-submit', async (req, res) => {
  try {
    const { telegram_id, guess } = req.body;

    if (!telegram_id || !guess) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan datos'
      });
    }

    const normalizedGuess = String(guess).toLowerCase().trim();

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({
        ok: false,
        error: 'Usuario no encontrado'
      });
    }

    const currentLevel = user.wordle_level || 1;
    const currentRewardLevel = user.wordle_last_reward_level || 0;
    const targetWord = WORDLE_WORDS[(currentLevel - 1) % WORDLE_WORDS.length];

    if (normalizedGuess.length !== targetWord.length) {
      return res.status(400).json({
        ok: false,
        error: `La palabra debe tener ${targetWord.length} letras`
      });
    }

    const result = [];
    const targetArray = targetWord.split('');
    const guessArray = normalizedGuess.split('');
    const used = Array(targetArray.length).fill(false);

    // verdes
    for (let i = 0; i < guessArray.length; i++) {
      if (guessArray[i] === targetArray[i]) {
        result[i] = 'correct';
        used[i] = true;
      }
    }

    // amarillos/grises
    for (let i = 0; i < guessArray.length; i++) {
      if (result[i]) continue;

      let foundIndex = -1;
      for (let j = 0; j < targetArray.length; j++) {
        if (!used[j] && guessArray[i] === targetArray[j]) {
          foundIndex = j;
          break;
        }
      }

      if (foundIndex >= 0) {
        result[i] = 'present';
        used[foundIndex] = true;
      } else {
        result[i] = 'absent';
      }
    }

    const win = normalizedGuess === targetWord;
    let newLevel = currentLevel;
    let newBalance = user.coins;
    let reward = 0;
    let rewardedNow = false;

    if (win) {
      newLevel = currentLevel + 1;

      if (newLevel % WORDLE_REWARD_EVERY === 0 && currentRewardLevel < newLevel) {
        reward = WORDLE_REWARD_COINS;
        newBalance += reward;
        rewardedNow = true;
      }

      const { error: updateError } = await supabase
        .from('users')
        .update({
          wordle_level: newLevel,
          wordle_last_reward_level: rewardedNow ? newLevel : currentRewardLevel,
          coins: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegram_id);

      if (updateError) {
        return res.status(500).json({
          ok: false,
          error: 'No se pudo guardar el progreso'
        });
      }

      await supabase.from('transactions').insert([
        {
          telegram_id,
          type: 'wordle_win',
          amount: reward,
          description: rewardedNow
            ? `Nivel Wordle completado. Recompensa por nivel ${newLevel}`
            : `Nivel Wordle completado sin recompensa`,
          source: 'games_webapp'
        }
      ]);
    }

    return res.json({
      ok: true,
      win,
      result,
      reward,
      balance: newBalance,
      level: newLevel,
      nextRewardAt: Math.ceil(newLevel / WORDLE_REWARD_EVERY) * WORDLE_REWARD_EVERY
    });
  } catch (error) {
    console.error('Error en /api/wordle-submit:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// =========================
// API PARA WEBAPPS
// =========================
app.post('/api/auth/telegram', async (req, res) => {
  try {
    const { telegram_id, username, first_name } = req.body;

    if (!telegram_id) {
      return res.status(400).json({ ok: false, error: 'Falta telegram_id' });
    }

    const { data: existingUser, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ ok: false, error: 'Error buscando usuario' });
    }

    if (existingUser) {
      return res.json({ ok: true, user: existingUser });
    }

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([
        {
          telegram_id,
          username: username || null,
          first_name: first_name || null,
          coins: 0,
          wordle_level: 1,
          wordle_last_reward_level: 0
        }
      ])
      .select()
      .single();

    if (insertError) {
      return res.status(500).json({ ok: false, error: 'Error creando usuario' });
    }

    return res.json({ ok: true, user: newUser });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

app.get('/api/balance/:telegramId', async (req, res) => {
  try {
    const telegramId = req.params.telegramId;

    const { data: user, error } = await supabase
      .from('users')
      .select('coins, premium_until')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    return res.json({
      ok: true,
      balance: user.coins,
      premium_until: user.premium_until
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

app.post('/api/daily-bonus', async (req, res) => {
  try {
    const { telegram_id } = req.body;
    const result = await claimDailyBonus(telegram_id);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// =========================
// TECLADO PRINCIPAL
// =========================
function buildMainKeyboard() {
  const rows = [];

  if (MOVIES_BOT_URL && MOVIES_BOT_URL.trim() !== '') {
    rows.push([
      {
        text: '🎬 Películas',
        web_app: {
          url: MOVIES_BOT_URL
        }
      }
    ]);
  }

  if (WEBAPP_URL && WEBAPP_URL.trim() !== '') {
    rows.push([
      {
        text: '🎮 Abrir juegos',
        web_app: {
          url: WEBAPP_URL
        }
      }
    ]);
  }

  if (OFFICIAL_WEB_URL && OFFICIAL_WEB_URL.trim() !== '') {
    rows.push([
      {
        text: '🌐 Web oficial',
        web_app: {
          url: OFFICIAL_WEB_URL
        }
      }
    ]);
  }

  rows.push([
    { text: '💰 Ver saldo', callback_data: 'view_balance' },
    { text: '🎁 Bonus diario', callback_data: 'claim_bonus' }
  ]);

  return { inline_keyboard: rows };
}

// =========================
// MENÚ PRINCIPAL
// =========================
async function sendMainMenu(ctx) {
  const balance = await getUserBalance(ctx.from.id);

  const text = `🎮 *Ofica Hub*

💰 Saldo actual: *${balance} monedas*

Accede desde aquí a todo tu ecosistema.`;

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: buildMainKeyboard()
  });
}

// =========================
// COMANDOS
// =========================
bot.start(async (ctx) => {
  try {
    await registerUserIfNeeded(ctx);
    await sendMainMenu(ctx);
  } catch (error) {
    console.error('Error en /start:', error);
    await ctx.reply('❌ Error cargando el menú principal');
  }
});

bot.command('saldo', async (ctx) => {
  try {
    await registerUserIfNeeded(ctx);
    const balance = await getUserBalance(ctx.from.id);
    await ctx.reply(`💰 Tu saldo actual es: ${balance} monedas`);
  } catch (error) {
    console.error('Error en /saldo:', error);
    await ctx.reply('❌ Error consultando saldo');
  }
});

bot.command('bonus', async (ctx) => {
  try {
    await registerUserIfNeeded(ctx);
    const result = await claimDailyBonus(ctx.from.id);

    if (!result.ok) {
      return ctx.reply(`❌ ${result.error}\n💰 Saldo actual: ${result.balance ?? 0}`);
    }

    return ctx.reply(`🎁 Has ganado ${result.reward} monedas\n💰 Nuevo saldo: ${result.balance}`);
  } catch (error) {
    console.error('Error en /bonus:', error);
    await ctx.reply('❌ Error reclamando bonus');
  }
});

bot.command('peliculas', async (ctx) => {
  try {
    if (!MOVIES_BOT_URL || MOVIES_BOT_URL.trim() === '') {
      return ctx.reply('❌ La miniapp de películas no está configurada');
    }

    await ctx.reply('🎬 Abre la miniapp de películas:', {
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🎬 Abrir películas',
            web_app: {
              url: MOVIES_BOT_URL
            }
          }
        ]]
      }
    });
  } catch (error) {
    console.error('Error en /peliculas:', error);
    await ctx.reply('❌ Error abriendo la miniapp de películas');
  }
});

bot.command('juegos', async (ctx) => {
  try {
    if (!WEBAPP_URL || WEBAPP_URL.trim() === '') {
      return ctx.reply('❌ La web de juegos no está configurada');
    }

    await ctx.reply('🎮 Abre los juegos:', {
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🎮 Abrir juegos',
            web_app: {
              url: WEBAPP_URL
            }
          }
        ]]
      }
    });
  } catch (error) {
    console.error('Error en /juegos:', error);
    await ctx.reply('❌ Error abriendo juegos');
  }
});

bot.command('web', async (ctx) => {
  try {
    if (!OFFICIAL_WEB_URL || OFFICIAL_WEB_URL.trim() === '') {
      return ctx.reply('❌ La web oficial no está configurada');
    }

    await ctx.reply('🌐 Abre la web oficial:', {
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🌐 Abrir web oficial',
            web_app: {
              url: OFFICIAL_WEB_URL
            }
          }
        ]]
      }
    });
  } catch (error) {
    console.error('Error en /web:', error);
    await ctx.reply('❌ Error abriendo la web oficial');
  }
});

// =========================
// CALLBACKS
// =========================
bot.action('view_balance', async (ctx) => {
  try {
    const balance = await getUserBalance(ctx.from.id);
    await ctx.answerCbQuery(`💰 Tienes ${balance} monedas`);
  } catch (error) {
    console.error('Error en view_balance:', error);
    await ctx.answerCbQuery('Error consultando saldo');
  }
});

bot.action('claim_bonus', async (ctx) => {
  try {
    const result = await claimDailyBonus(ctx.from.id);

    if (!result.ok) {
      return ctx.answerCbQuery(result.error, { show_alert: true });
    }

    await ctx.answerCbQuery(`+${result.reward} monedas`, { show_alert: true });
    await ctx.reply(`🎁 Bonus diario reclamado\n💰 Nuevo saldo: ${result.balance}`);
  } catch (error) {
    console.error('Error en claim_bonus:', error);
    await ctx.answerCbQuery('Error reclamando bonus', { show_alert: true });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor en puerto ${PORT}`);
});

bot.launch()
  .then(() => console.log('Ofica Hub iniciado'))
  .catch((error) => console.error('Error iniciando bot:', error.message));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
