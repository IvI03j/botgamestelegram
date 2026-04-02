

const express = require('express');
const { Telegraf } = require('telegraf');
const cors = require('cors');
const path = require('path');
const supabase = require('./supabase');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const INDEXWEBOFICA_URL = process.env.INDEXWEBOFICA_URL || 'https://indexwebofica-pzwchg.fly.dev';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = process.env.PORT || 8080;

const ALLOWED_CHAT_ID = -1003043513364;
const ALLOWED_THREAD_ID = 38;
const MOVIE_PRICE = 3;
const DAILY_BONUS_REWARD = 3;

if (!BOT_TOKEN || !WEBAPP_URL) {
  console.error('Faltan BOT_TOKEN o WEBAPP_URL en las variables de entorno');
  process.exit(1);
}

console.log('Iniciando servidor...');
console.log('PORT:', PORT);
console.log('WEBAPP_URL:', WEBAPP_URL);
console.log('INDEXWEBOFICA_URL:', INDEXWEBOFICA_URL);
console.log('SUPABASE configurado:', !!SUPABASE_URL && !!SUPABASE_SERVICE_ROLE_KEY);

const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, status: 'running' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =========================
// REGISTRAR / ACTUALIZAR USUARIO TELEGRAM
// =========================
app.post('/api/auth/telegram', async (req, res) => {
  try {
    const { telegram_id, username, first_name } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        ok: false,
        error: 'Falta telegram_id'
      });
    }

    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .maybeSingle();

    if (selectError) {
      console.error('Error buscando usuario:', selectError.message);
      return res.status(500).json({
        ok: false,
        error: 'Error buscando usuario'
      });
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
        console.error('Error creando usuario:', insertError.message);
        return res.status(500).json({
          ok: false,
          error: 'Error creando usuario'
        });
      }

      user = newUser;

      await supabase.from('transactions').insert([
        {
          telegram_id,
          type: 'register',
          amount: 0,
          description: 'Registro inicial del usuario',
          source: 'webapp'
        }
      ]);
    } else {
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({
          username: username || existingUser.username,
          first_name: first_name || existingUser.first_name,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegram_id)
        .select()
        .single();

      if (updateError) {
        console.error('Error actualizando usuario:', updateError.message);
        return res.status(500).json({
          ok: false,
          error: 'Error actualizando usuario'
        });
      }

      user = updatedUser;
    }

    return res.json({
      ok: true,
      user: {
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        coins: user.coins,
        premium_until: user.premium_until
      }
    });
  } catch (error) {
    console.error('Error en /api/auth/telegram:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// =========================
// CONSULTAR SALDO
// =========================
app.get('/api/balance/:telegramId', async (req, res) => {
  try {
    const telegramId = req.params.telegramId;

    const { data: user, error } = await supabase
      .from('users')
      .select('telegram_id, coins, premium_until')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (error) {
      console.error('Error obteniendo saldo:', error.message);
      return res.status(500).json({
        ok: false,
        error: 'Error obteniendo saldo'
      });
    }

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: 'Usuario no encontrado'
      });
    }

    return res.json({
      ok: true,
      balance: user.coins,
      premium_until: user.premium_until
    });
  } catch (error) {
    console.error('Error en /api/balance:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// =========================
// BONUS DIARIO
// =========================
app.post('/api/daily-bonus', async (req, res) => {
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
      console.error('Error buscando usuario bonus diario:', userError.message);
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

    const now = new Date();
    const lastBonus = user.last_daily_bonus_at ? new Date(user.last_daily_bonus_at) : null;

    if (lastBonus) {
      const sameDay =
        now.getUTCFullYear() === lastBonus.getUTCFullYear() &&
        now.getUTCMonth() === lastBonus.getUTCMonth() &&
        now.getUTCDate() === lastBonus.getUTCDate();

      if (sameDay) {
        return res.status(400).json({
          ok: false,
          error: 'Ya reclamaste tu bonus diario hoy',
          balance: user.coins
        });
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
      .eq('telegram_id', telegram_id);

    if (updateError) {
      console.error('Error actualizando bonus diario:', updateError.message);
      return res.status(500).json({
        ok: false,
        error: 'No se pudo actualizar el bonus diario'
      });
    }

    await supabase.from('transactions').insert([
      {
        telegram_id,
        type: 'daily_bonus',
        amount: DAILY_BONUS_REWARD,
        description: 'Bonus diario reclamado',
        source: 'arcade'
      }
    ]);

    return res.json({
      ok: true,
      message: `Has ganado ${DAILY_BONUS_REWARD} monedas`,
      reward: DAILY_BONUS_REWARD,
      balance: newBalance
    });
  } catch (error) {
    console.error('Error en /api/daily-bonus:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// =========================
// CATÁLOGO REMOTO
// =========================
app.get('/api/movies', async (req, res) => {
  try {
    const response = await fetch(`${INDEXWEBOFICA_URL}/_api/catalog`);

    if (!response.ok) {
      throw new Error(`Error ${response.status} de indexwebofica`);
    }

    const data = await response.json();

    const adapted = data.map(item => ({
      id: item.tmdb_id,
      title: item.title || 'Sin título',
      year: item.year ? parseInt(item.year) : null,
      genre: item.genres || [],
      type: item.media_type === 'movie' ? 'pelicula' : 'serie',
      poster: item.poster || 'https://via.placeholder.com/300x450?text=Sin+imagen',
      backdrop: item.backdrop || null,
      description: item.overview || 'Sin descripción disponible.',
      rating: item.rating || null,
      trailer_url: item.trailer_url || null,
      telegram_link: item.telegram_link || null,
    }));

    res.json(adapted);
  } catch (error) {
    console.error('Error obteniendo catálogo:', error.message);
    res.status(500).json({
      ok: false,
      error: 'No se pudieron cargar las películas'
    });
  }
});

// =========================
// PARSEAR LINKS DE TELEGRAM
// =========================
function parseTelegramLink(link) {
  try {
    const url = new URL(link);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] === 'c' && parts.length >= 4) {
      const internalId = parts[1];
      const threadId = parseInt(parts[2], 10);
      const messageId = parseInt(parts[3], 10);

      if (!internalId || !messageId) return null;

      return {
        chat_id: Number(`-100${internalId}`),
        message_thread_id: threadId,
        message_id: messageId
      };
    }

    if (parts[0] === 'c' && parts.length >= 3) {
      const internalId = parts[1];
      const messageId = parseInt(parts[2], 10);

      if (!internalId || !messageId) return null;

      return {
        chat_id: Number(`-100${internalId}`),
        message_id: messageId
      };
    }

    if (parts.length >= 2) {
      const username = parts[0];
      const messageId = parseInt(parts[1], 10);

      if (!username || !messageId) return null;

      return {
        chat_id: `@${username}`,
        message_id: messageId
      };
    }

    return null;
  } catch (err) {
    console.error('Error parseando telegram_link:', err.message);
    return null;
  }
}

async function tryCopyMessage(toUserId, fromChatId, messageId) {
  try {
    await bot.telegram.copyMessage(
      toUserId,
      fromChatId,
      messageId,
      {
        protect_content: true
      }
    );
    return true;
  } catch (error) {
    console.error(`No se pudo copiar message_id ${messageId}:`, error.response?.description || error.message);
    return false;
  }
}

// =========================
// ENVIAR PELÍCULA COBRANDO MONEDAS
// =========================
app.post('/api/send-movie', async (req, res) => {
  try {
    const { userId, telegram_link } = req.body;

    if (!userId || !telegram_link) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan userId o telegram_link'
      });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', userId)
      .maybeSingle();

    if (userError) {
      console.error('Error buscando usuario para cobro:', userError.message);
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

    if (user.coins < MOVIE_PRICE) {
      return res.status(400).json({
        ok: false,
        error: `No tienes suficientes monedas. Esta película cuesta ${MOVIE_PRICE} monedas.`,
        balance: user.coins,
        price: MOVIE_PRICE
      });
    }

    const parsed = parseTelegramLink(telegram_link);

    if (!parsed) {
      return res.status(400).json({
        ok: false,
        error: 'No se pudo interpretar telegram_link'
      });
    }

    const newBalance = user.coins - MOVIE_PRICE;

    const { error: updateCoinsError } = await supabase
      .from('users')
      .update({
        coins: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('telegram_id', userId);

    if (updateCoinsError) {
      console.error('Error descontando monedas:', updateCoinsError.message);
      return res.status(500).json({
        ok: false,
        error: 'No se pudieron descontar las monedas'
      });
    }

    await supabase.from('transactions').insert([
      {
        telegram_id: userId,
        type: 'spend_movie',
        amount: -MOVIE_PRICE,
        description: 'Compra de película en Botneflixtelegram',
        source: 'bot_catalog'
      }
    ]);

    let sentText = false;

    sentText = await tryCopyMessage(userId, parsed.chat_id, parsed.message_id + 1);

    if (!sentText) {
      sentText = await tryCopyMessage(userId, parsed.chat_id, parsed.message_id - 1);
    }

    const sentVideo = await tryCopyMessage(userId, parsed.chat_id, parsed.message_id);

    if (!sentVideo) {
      await supabase
        .from('users')
        .update({
          coins: user.coins,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', userId);

      await supabase.from('transactions').insert([
        {
          telegram_id: userId,
          type: 'refund_movie',
          amount: MOVIE_PRICE,
          description: 'Reembolso por fallo al enviar película',
          source: 'bot_catalog'
        }
      ]);

      return res.status(500).json({
        ok: false,
        error: 'No se pudo enviar el video principal. Se te devolvieron las monedas.'
      });
    }

    return res.json({
      ok: true,
      message: 'Película enviada correctamente',
      textSent: sentText,
      videoSent: sentVideo,
      charged: MOVIE_PRICE,
      balance: newBalance
    });
  } catch (error) {
    console.error('ERROR send-movie:', error.response?.description || error.message);

    return res.status(500).json({
      ok: false,
      error: 'No se pudo enviar la película',
      detail: error.response?.description || error.message
    });
  }
});

function isAllowedThread(ctx) {
  const chatId = ctx.chat?.id;
  const threadId = ctx.message?.message_thread_id;
  return chatId === ALLOWED_CHAT_ID && threadId === ALLOWED_THREAD_ID;
}

async function sendBibliotecaButton() {
  await bot.telegram.sendMessage(
    ALLOWED_CHAT_ID,
    '🎬 Biblioteca oficial\n\nPulsa el botón para abrir:',
    {
      message_thread_id: ALLOWED_THREAD_ID,
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🌐 Abrir biblioteca',
            url: WEBAPP_URL
          }
        ]]
      }
    }
  );
}

bot.start(async (ctx) => {
  await ctx.reply('Bienvenido. Abre la biblioteca y elige una película.');
});

bot.on('message', async (ctx) => {
  try {
    const chatId = ctx.chat?.id;
    const threadId = ctx.message?.message_thread_id;
    const text = ctx.message?.text || '[sin texto]';

    if (!isAllowedThread(ctx)) {
      return;
    }

    const normalizedText = text.trim().toLowerCase();

    if (
      normalizedText.startsWith('/start') ||
      normalizedText.startsWith('/biblioteca') ||
      normalizedText === 'biblioteca' ||
      normalizedText === 'pelis' ||
      normalizedText === 'ver'
    ) {
      await sendBibliotecaButton();
    }
  } catch (error) {
    console.error('Error en manejo de mensajes:', error.message);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor en puerto ${PORT}`);
});

bot.launch()
  .then(() => console.log('Bot iniciado'))
  .catch((error) => console.error('Error iniciando el bot:', error.message));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
