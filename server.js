const express = require('express');
const { Telegraf } = require('telegraf');
const cors = require('cors');
const path = require('path');
const supabase = require('./supabase');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBAPP_URL = process.env.WEBAPP_URL;
const MOVIES_WEBAPP_URL = process.env.MOVIES_WEBAPP_URL;
const OFFICIAL_WEB_URL = process.env.OFFICIAL_WEB_URL;
const PORT = process.env.PORT || 8080;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan BOT_TOKEN, SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

console.log('Servidor iniciando...');
console.log('PORT:', PORT);
console.log('MOVIES_WEBAPP_URL:', MOVIES_WEBAPP_URL);
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
          coins: 0
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
    const DAILY_BONUS_REWARD = 3;

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (userError || !user) {
      return { ok: false, error: 'Usuario no encontrado' };
    }

    const now = new Date();
    const lastBonus = user.last_daily_bonus_at ? new Date(user.last_daily_bonus_at) : null;

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
// TECLADO PRINCIPAL
// =========================
function buildMainKeyboard() {
  const rows = [];

  if (MOVIES_WEBAPP_URL && MOVIES_WEBAPP_URL.trim() !== '') {
    rows.push([
      {
        text: '🎬 Películas',
        web_app: {
          url: MOVIES_WEBAPP_URL
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
    if (!MOVIES_WEBAPP_URL || MOVIES_WEBAPP_URL.trim() === '') {
      return ctx.reply('❌ La miniapp de películas no está configurada');
    }

    await ctx.reply('🎬 Abre la miniapp de películas:', {
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🎬 Abrir películas',
            web_app: {
              url: MOVIES_WEBAPP_URL
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
