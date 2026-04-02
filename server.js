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

const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, status: 'running' });
});

app.get('/', (req, res) => {
  res.send('Bot principal funcionando');
});

async function registerUserIfNeeded(ctx) {
  const telegram_id = ctx.from?.id;
  const username = ctx.from?.username || null;
  const first_name = ctx.from?.first_name || null;

  if (!telegram_id) return null;

  const { data: existingUser, error: selectError } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegram_id)
    .maybeSingle();

  if (selectError) {
    console.error('Error buscando usuario:', selectError.message);
    return null;
  }

  if (!existingUser) {
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
  }

  return existingUser;
}

async function getUserBalance(telegramId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('coins')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (error || !user) return 0;
  return user.coins || 0;
}

async function claimDailyBonus(telegramId) {
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
    return { ok: false, error: 'No se pudo reclamar el bonus' };
  }

  await supabase.from('transactions').insert([
    {
      telegram_id: telegramId,
      type: 'daily_bonus',
      amount: DAILY_BONUS_REWARD,
      description: 'Bonus diario reclamado desde bot principal',
      source: 'hub_bot'
    }
  ]);

  return {
    ok: true,
    reward: DAILY_BONUS_REWARD,
    balance: newBalance
  };
}

// APIs
app.post('/api/auth/telegram', async (req, res) => {
  try {
    const { telegram_id, username, first_name } = req.body;

    if (!telegram_id) {
      return res.status(400).json({ ok: false, error: 'Falta telegram_id' });
    }

    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .maybeSingle();

    if (selectError) {
      return res.status(500).json({ ok: false, error: 'Error buscando usuario' });
    }

    let user;

    if (!existingUser) {
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([
          {
            telegram_id,
            username: username || null,
            first_name: first_name || null,
            coins: 0
          }
        ])
        .select()
        .single();

      if (insertError) {
        return res.status(500).json({ ok: false, error: 'Error creando usuario' });
      }

      user = newUser;
    } else {
      user = existingUser;
    }

    return res.json({ ok: true, user });
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

function buildMainKeyboard() {
  const rows = [];

  if (MOVIES_WEBAPP_URL) {
    rows.push([
      {
        text: '🎬 Películas',
        web_app: { url: MOVIES_WEBAPP_URL }
      }
    ]);
  }

  if (WEBAPP_URL) {
    rows.push([
      {
        text: '🎮 Abrir juegos',
        web_app: { url: WEBAPP_URL }
      }
    ]);
  }

  if (OFFICIAL_WEB_URL) {
    rows.push([
      {
        text: '🌐 Web oficial',
        web_app: { url: OFFICIAL_WEB_URL }
      }
    ]);
  }

  rows.push([
    { text: '💰 Ver saldo', callback_data: 'view_balance' },
    { text: '🎁 Bonus diario', callback_data: 'claim_bonus' }
  ]);

  return { inline_keyboard: rows };
}

async function sendMainMenu(ctx, extraText = '') {
  const telegramId = ctx.from.id;
  const balance = await getUserBalance(telegramId);

  const text = `🎮 *Bienvenido al centro principal*

💰 Saldo actual: *${balance} monedas*

Desde aquí puedes acceder a todo:

• 🎬 Películas
• 🎮 Juegos
• 🌐 Web oficial
• 🎁 Bonus diario
• 💰 Consultar saldo

${extraText}`.trim();

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: buildMainKeyboard()
  });
}

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
    console.error(error);
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
    console.error(error);
    await ctx.reply('❌ Error reclamando bonus');
  }
});

bot.command('peliculas', async (ctx) => {
  if (!MOVIES_WEBAPP_URL) {
    return ctx.reply('❌ La miniapp de películas no está configurada');
  }

  await ctx.reply('🎬 Abre la miniapp de películas:', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '🎬 Abrir películas',
          web_app: { url: MOVIES_WEBAPP_URL }
        }
      ]]
    }
  });
});

bot.command('juegos', async (ctx) => {
  if (!WEBAPP_URL) {
    return ctx.reply('❌ La web de juegos no está configurada');
  }

  await ctx.reply('🎮 Abre los juegos:', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '🎮 Abrir juegos',
          web_app: { url: WEBAPP_URL }
        }
      ]]
    }
  });
});

bot.command('web', async (ctx) => {
  if (!OFFICIAL_WEB_URL) {
    return ctx.reply('❌ La web oficial no está configurada');
  }

  await ctx.reply('🌐 Abre la web oficial:', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '🌐 Abrir web oficial',
          web_app: { url: OFFICIAL_WEB_URL }
        }
      ]]
    }
  });
});

bot.action('view_balance', async (ctx) => {
  try {
    await registerUserIfNeeded(ctx);
    const balance = await getUserBalance(ctx.from.id);
    await ctx.answerCbQuery(`💰 Tienes ${balance} monedas`);
  } catch (error) {
    console.error(error);
    await ctx.answerCbQuery('Error consultando saldo');
  }
});

bot.action('claim_bonus', async (ctx) => {
  try {
    await registerUserIfNeeded(ctx);
    const result = await claimDailyBonus(ctx.from.id);

    if (!result.ok) {
      return ctx.answerCbQuery(result.error, { show_alert: true });
    }

    await ctx.answerCbQuery(`+${result.reward} monedas`, { show_alert: true });
    await ctx.reply(`🎁 Bonus diario reclamado\n💰 Nuevo saldo: ${result.balance}`);
  } catch (error) {
    console.error(error);
    await ctx.answerCbQuery('Error reclamando bonus', { show_alert: true });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor en puerto ${PORT}`);
});

bot.launch()
  .then(() => console.log('Bot principal iniciado'))
  .catch((error) => console.error('Error iniciando bot:', error.message));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
