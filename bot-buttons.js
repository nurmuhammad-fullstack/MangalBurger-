require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');

// ─── ENV ───────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WEBAPP_URL = process.env.WEBAPP_URL;
const PORT = Number(process.env.PORT || 3000);

if (!BOT_TOKEN) throw new Error('BOT_TOKEN berilmagan');
if (!ADMIN_ID) throw new Error('ADMIN_ID berilmagan');
if (!SUPABASE_URL) throw new Error('SUPABASE_URL berilmagan');
if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY berilmagan');
if (!WEBAPP_URL) throw new Error('WEBAPP_URL berilmagan');

// ─── HTTP SERVER ──────────────────────────────────
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🍔 Mangal Burger Bot ishlayapti!');
  })
  .listen(PORT, () => {
    console.log(`🌐 Server ${PORT}-portda ishlamoqda`);
  });

// ─── CLIENTS ──────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── CONSTANTS ────────────────────────────────────
const CATEGORIES = [
  'Burgerlar',
  'Garniturlar',
  'Salatlar',
  'Pizzalar',
  'Nonushtalar',
  'Ichimliklar',
  'Boshqa',
];

const STATUS_EMOJI = {
  yangi: '🟢',
  tayyorlanmoqda: '🟡',
  yetkazilmoqda: '🔵',
  yetkazildi: '✅',
  bekor: '❌',
};

const STATUS_LIST = Object.keys(STATUS_EMOJI);

// ─── SESSION ──────────────────────────────────────
const sessions = {};

function getSession(userId) {
  if (!sessions[userId]) {
    sessions[userId] = { step: null, data: {} };
  }
  return sessions[userId];
}

function clearSession(userId) {
  sessions[userId] = { step: null, data: {} };
}

// ─── HELPERS ──────────────────────────────────────
async function adminOnly(ctx, next) {
  if (ctx.from?.id !== ADMIN_ID) {
    return ctx.reply("❌ Ruxsat yo'q!");
  }
  return next();
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('uz-UZ');
}

function orderActionKeyboard(orderId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🟡 Tayyorlanmoqda', `status_${orderId}_tayyorlanmoqda`),
      Markup.button.callback('❌ Bekor', `status_${orderId}_bekor`)
    ],
    [
      Markup.button.callback('🔵 Yetkazilmoqda', `status_${orderId}_yetkazilmoqda`),
      Markup.button.callback('✅ Yetkazildi', `status_${orderId}_yetkazildi`)
    ]
  ]).reply_markup;
}

const MAIN_MENU = Markup.inlineKeyboard([
  [
    Markup.button.callback('📋 Buyurtmalar', 'btn_orders'),
    Markup.button.callback('📊 Statistika', 'btn_stats')
  ],
  [
    Markup.button.callback('📂 Menyu', 'btn_menu'),
    Markup.button.callback("📝 Qo'shish", 'btn_add')
  ],
  [
    Markup.button.callback('🔧 Boshqaruv', 'btn_admin')
  ]
]);

async function sendMainMenu(ctx, text = '🍔 *Mangal Burger Admin Bot*\n\n*Asosiy menyu:*') {
  return ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: MAIN_MENU.reply_markup
  });
}

async function getOrderItems(orderId) {
  const { data, error } = await sb
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);

  if (error) {
    console.error('order_items olishda xato:', error);
    return [];
  }

  return data || [];
}

function calculateTotalFromItems(items) {
  return (items || []).reduce((sum, item) => {
    return sum + Number(item.price || 0) * Number(item.quantity || 0);
  }, 0);
}

async function buildOrderMessage(orderId) {
  try {
    const { data: order, error: orderError } = await sb
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('order olishda xato:', orderError);
      return null;
    }

    const items = await getOrderItems(orderId);
    const total = calculateTotalFromItems(items);

    const itemLines = items.length
      ? items.map(i =>
          `• ${i.title} × ${i.quantity} = ${formatMoney(Number(i.price || 0) * Number(i.quantity || 0))} so'm`
        ).join('\n')
      : '• Mahsulot yo‘q';

    const statusEmoji = STATUS_EMOJI[order.status] || '⚪';

    return (
      `🍔 *BUYURTMA #${order.id}*\n\n` +
      `👤 Mijoz: *${order.customer_name || '-'}*\n` +
      `📞 Telefon: \`${order.customer_phone || '-'}\`\n` +
      `${order.note ? `📝 Izoh: ${order.note}\n` : ''}` +
      `\n📋 *Buyurtma tarkibi:*\n${itemLines}\n\n` +
      `💰 *Jami: ${formatMoney(total)} so'm*\n` +
      `${statusEmoji} Status: *${order.status || 'yangi'}*\n` +
      `🕐 Vaqt: ${new Date(order.created_at).toLocaleString('uz-UZ')}`
    );
  } catch (error) {
    console.error('buildOrderMessage xato:', error);
    return null;
  }
}

// ─── START ────────────────────────────────────────
bot.start(adminOnly, async (ctx) => {
  clearSession(ctx.from.id);

  await ctx.reply(
    '👋 Assalomu alaykum, Admin!\n\n🍔 *Mangal Burger Boshqaruv Paneliga xush kelibsiz!*',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🌐 Menyuni ochish', web_app: { url: WEBAPP_URL } }],
          [
            { text: '📋 Buyurtmalar', callback_data: 'btn_orders' },
            { text: '📊 Statistika', callback_data: 'btn_stats' }
          ],
          [
            { text: '📂 Menyu', callback_data: 'btn_menu' },
            { text: "📝 Qo'shish", callback_data: 'btn_add' }
          ],
          [{ text: '🔧 Boshqaruv', callback_data: 'btn_admin' }]
        ]
      }
    }
  );
});

// ─── REALTIME SUBSCRIBE ───────────────────────────
function subscribeToOrders() {
  sb.channel('orders-channel')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      async (payload) => {
        try {
          const orderId = payload.new?.id;
          if (!orderId) return;

          console.log('📦 Yangi buyurtma:', orderId);

          const msg = await buildOrderMessage(orderId);
          if (!msg) return;

          await bot.telegram.sendMessage(ADMIN_ID, msg, {
            parse_mode: 'Markdown',
            reply_markup: orderActionKeyboard(orderId)
          });
        } catch (error) {
          console.error('realtime xato:', error);
        }
      }
    )
    .subscribe((status) => {
      console.log('📡 Realtime status:', status);
    });
}

// ─── STATUS UPDATE ────────────────────────────────
bot.action(/^status_(\d+)_(.+)$/, adminOnly, async (ctx) => {
  try {
    const [, orderId, newStatus] = ctx.match;

    if (!STATUS_LIST.includes(newStatus)) {
      return ctx.answerCbQuery("❌ Noma'lum status");
    }

    const { error } = await sb
      .from('orders')
      .update({ status: newStatus })
      .eq('id', orderId);

    if (error) {
      console.error('status update xato:', error);
      return ctx.answerCbQuery('❌ Yangilashda xato');
    }

    await ctx.answerCbQuery(`${STATUS_EMOJI[newStatus]} Yangilandi`);

    const msg = await buildOrderMessage(orderId);
    if (msg) {
      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        reply_markup: orderActionKeyboard(orderId)
      });
    }
  } catch (error) {
    console.error('status action xato:', error);
    await ctx.answerCbQuery('❌ Xato yuz berdi');
  }
});

// ─── BUYURTMALAR ──────────────────────────────────
bot.action('btn_orders', adminOnly, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const { data: orders, error } = await sb
      .from('orders')
      .select('id, customer_name, customer_phone, note, status, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error(error);
      return sendMainMenu(ctx, "❌ Buyurtmalarni olishda xato bo'ldi.");
    }

    if (!orders?.length) {
      return sendMainMenu(ctx, "📋 Buyurtma yo'q.");
    }

    const lines = [];
    for (const order of orders) {
      const items = await getOrderItems(order.id);
      const total = calculateTotalFromItems(items);

      lines.push(
        `${STATUS_EMOJI[order.status] || '⚪'} *#${order.id}* — ${order.customer_name || '-'}\n` +
        `📞 ${order.customer_phone || '-'}\n` +
        `💰 ${formatMoney(total)} so'm\n` +
        `🕐 ${new Date(order.created_at).toLocaleTimeString('uz-UZ')}`
      );
    }

    await ctx.reply(`📋 *So'nggi 10 ta buyurtma:*\n\n${lines.join('\n\n')}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback('🟢 Yangi', 'btn_orders_yangi'),
          Markup.button.callback('🟡 Tayyorlanmoqda', 'btn_orders_tayyorlanmoqda')
        ],
        [
          Markup.button.callback('🔵 Yetkazilmoqda', 'btn_orders_yetkazilmoqda'),
          Markup.button.callback('✅ Yetkazildi', 'btn_orders_yetkazildi')
        ]
      ]).reply_markup
    });
  } catch (error) {
    console.error('btn_orders xato:', error);
    await sendMainMenu(ctx, '❌ Xato yuz berdi.');
  }
});

bot.action(/^btn_orders_(.+)$/, adminOnly, async (ctx) => {
  try {
    const statusFilter = ctx.match[1];
    await ctx.answerCbQuery();

    const { data: orders, error } = await sb
      .from('orders')
      .select('id, customer_name, customer_phone, note, status, created_at')
      .eq('status', statusFilter)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error(error);
      return sendMainMenu(ctx, "❌ Filter bo'yicha xato.");
    }

    if (!orders?.length) {
      return sendMainMenu(ctx, `📋 "${statusFilter}" statusida buyurtmalar yo'q.`);
    }

    const lines = [];
    for (const order of orders) {
      const items = await getOrderItems(order.id);
      const total = calculateTotalFromItems(items);

      lines.push(
        `${STATUS_EMOJI[order.status] || '⚪'} *#${order.id}* — ${order.customer_name || '-'}\n` +
        `📞 ${order.customer_phone || '-'}\n` +
        `💰 ${formatMoney(total)} so'm`
      );
    }

    await ctx.reply(`📋 *${statusFilter.toUpperCase()}*\n\n${lines.join('\n\n')}`, {
      parse_mode: 'Markdown'
    });

    await sendMainMenu(ctx);
  } catch (error) {
    console.error('btn_orders_status xato:', error);
    await sendMainMenu(ctx, '❌ Xato yuz berdi.');
  }
});

// ─── STATISTIKA ───────────────────────────────────
bot.action('btn_stats', adminOnly, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

    const { data: orders, error } = await sb
      .from('orders')
      .select('id, status, created_at')
      .gte('created_at', startOfDay);

    if (error) {
      console.error(error);
      return sendMainMenu(ctx, "❌ Statistikani olishda xato bo'ldi.");
    }

    if (!orders?.length) {
      return sendMainMenu(ctx, "📊 Bugun hozircha buyurtma yo'q.");
    }

    let grandTotal = 0;
    for (const order of orders) {
      const items = await getOrderItems(order.id);
      grandTotal += calculateTotalFromItems(items);
    }

    const counts = STATUS_LIST.reduce((acc, status) => {
      acc[status] = orders.filter(o => o.status === status).length;
      return acc;
    }, {});

    const text =
      `📊 *Bugungi statistika*\n\n` +
      `📦 Jami buyurtmalar: *${orders.length} ta*\n` +
      `💰 Umumiy summa: *${formatMoney(grandTotal)} so'm*\n\n` +
      STATUS_LIST.map(status => `${STATUS_EMOJI[status]} ${status}: ${counts[status]} ta`).join('\n');

    await ctx.reply(text, { parse_mode: 'Markdown' });
    await sendMainMenu(ctx);
  } catch (error) {
    console.error('btn_stats xato:', error);
    await sendMainMenu(ctx, '❌ Xato yuz berdi.');
  }
});

// ─── MENU ─────────────────────────────────────────
bot.action('btn_menu', adminOnly, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const { data, error } = await sb
      .from('menu')
      .select('id, title, price, category, is_available, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error(error);
      return sendMainMenu(ctx, "❌ Menyuni olishda xato bo'ldi.");
    }

    if (!data?.length) {
      return sendMainMenu(ctx, "📂 Menyu bo'sh.");
    }

    const text = data
      .map(
        p => `${p.is_available ? '✅' : '🚫'} *[ID: ${p.id}] ${p.title}* — ${formatMoney(p.price)} so'm | ${p.category || '-'}`
      )
      .join('\n\n');

    await ctx.reply(`📂 *Menyu (so'nggi 20 ta):*\n\n${text}`, {
      parse_mode: 'Markdown'
    });

    await sendMainMenu(ctx);
  } catch (error) {
    console.error('btn_menu xato:', error);
    await sendMainMenu(ctx, '❌ Xato yuz berdi.');
  }
});

// ─── ADD PRODUCT ──────────────────────────────────
bot.action('btn_add', adminOnly, async (ctx) => {
  await ctx.answerCbQuery();
  clearSession(ctx.from.id);
  getSession(ctx.from.id).step = 'wait_photo';

  await ctx.reply("📸 *Yangi taom qo'shish*\n\n1-qadam: Taom rasmini yuboring", {
    parse_mode: 'Markdown'
  });
});

bot.action('btn_admin', adminOnly, async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.reply(
    "🔧 *Boshqaruv komandalari:*\n\n/list - Barcha taomlar\n/hide [id] - Menyudan yashirish\n/show [id] - Menyuda ko'rsatish\n/delete [id] - O'chirish",
    { parse_mode: 'Markdown' }
  );

  await sendMainMenu(ctx);
});

// ─── COMMANDS ─────────────────────────────────────
bot.command('list', adminOnly, async (ctx) => {
  try {
    const { data, error } = await sb
      .from('menu')
      .select('id, title, price, is_available')
      .order('id', { ascending: true });

    if (error) {
      console.error(error);
      return ctx.reply("❌ Menyuni olishda xato bo'ldi.");
    }

    if (!data?.length) {
      return ctx.reply("📂 Menyu bo'sh.");
    }

    const text = data
      .map(p => `${p.is_available ? '✅' : '🚫'} *ID: ${p.id}* - ${p.title} (${formatMoney(p.price)} so'm)`)
      .join('\n');

    await ctx.reply(`*Barcha taomlar ro'yxati:*\n\n${text}`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('/list xato:', error);
    await ctx.reply('❌ Xato yuz berdi.');
  }
});

bot.command('hide', adminOnly, async (ctx) => {
  try {
    const id = ctx.message.text.split(' ')[1];
    if (!id) return ctx.reply('❌ Masalan: /hide 5');

    const { error } = await sb.from('menu').update({ is_available: false }).eq('id', id);
    if (error) {
      console.error(error);
      return ctx.reply("❌ Yashirishda xato bo'ldi.");
    }

    await ctx.reply(`✅ ID ${id} yashirildi.`);
  } catch (error) {
    console.error('/hide xato:', error);
    await ctx.reply('❌ Xato yuz berdi.');
  }
});

bot.command('show', adminOnly, async (ctx) => {
  try {
    const id = ctx.message.text.split(' ')[1];
    if (!id) return ctx.reply('❌ Masalan: /show 5');

    const { error } = await sb.from('menu').update({ is_available: true }).eq('id', id);
    if (error) {
      console.error(error);
      return ctx.reply("❌ Ko'rsatishda xato bo'ldi.");
    }

    await ctx.reply(`✅ ID ${id} ko'rinadigan bo'ldi.`);
  } catch (error) {
    console.error('/show xato:', error);
    await ctx.reply('❌ Xato yuz berdi.');
  }
});

bot.command('delete', adminOnly, async (ctx) => {
  try {
    const id = ctx.message.text.split(' ')[1];
    if (!id) return ctx.reply('❌ Masalan: /delete 5');

    const { error } = await sb.from('menu').delete().eq('id', id);
    if (error) {
      console.error(error);
      return ctx.reply("❌ O'chirishda xato bo'ldi.");
    }

    await ctx.reply(`🗑 ID ${id} o'chirildi.`);
  } catch (error) {
    console.error('/delete xato:', error);
    await ctx.reply('❌ Xato yuz berdi.');
  }
});

// ─── PHOTO HANDLER ────────────────────────────────
bot.on('photo', adminOnly, async (ctx) => {
  try {
    const session = getSession(ctx.from.id);

    if (session.step !== 'wait_photo') {
      return ctx.reply("Avval 'Qo'shish' tugmasini bosing.");
    }

    const photoId = ctx.message.photo?.[ctx.message.photo.length - 1]?.file_id;
    if (!photoId) {
      return ctx.reply("❌ Rasm olinmadi. Qayta yuboring.");
    }

    session.data.image_url = photoId;
    session.step = 'wait_title';

    await ctx.reply("✏️ Endi taomning *nomini* kiriting:", {
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('photo handler xato:', error);
    await ctx.reply('❌ Xato yuz berdi.');
  }
});

// ─── TEXT HANDLER ─────────────────────────────────
bot.on('text', adminOnly, async (ctx) => {
  try {
    const session = getSession(ctx.from.id);
    const text = ctx.message.text?.trim();

    if (!text) return;

    if (text.startsWith('/')) {
      clearSession(ctx.from.id);
      return;
    }

    if (session.step === 'wait_title') {
      session.data.title = text;
      session.step = 'wait_desc';

      return ctx.reply(
        "📝 Taom haqida ma'lumot kiriting:\n_(Kerak bo'lmasa `-` yuboring)_",
        { parse_mode: 'Markdown' }
      );
    }

    if (session.step === 'wait_desc') {
      session.data.description = text === '-' ? null : text;
      session.step = 'wait_price';

      return ctx.reply("💰 Narxini kiriting (masalan: 25000):");
    }

    if (session.step === 'wait_price') {
      const price = Number(text);

      if (Number.isNaN(price) || price <= 0) {
        return ctx.reply("❌ To'g'ri narx kiriting. Masalan: 25000");
      }

      session.data.price = price;
      session.step = 'wait_category';

      return ctx.reply(
        '📂 Kategoriyani tanlang:',
        Markup.keyboard(CATEGORIES.map(c => [c])).resize().oneTime()
      );
    }

    if (session.step === 'wait_category') {
      if (!CATEGORIES.includes(text)) {
        return ctx.reply("❌ Pastdagi kategoriyalardan birini tanlang.");
      }

      session.data.category = text;

      const { error } = await sb.from('menu').insert([{
        title: session.data.title,
        description: session.data.description,
        price: session.data.price,
        category: session.data.category,
        image_url: session.data.image_url,
        is_available: true
      }]);

      clearSession(ctx.from.id);

      if (error) {
        console.error('menu insert xato:', error);
        return sendMainMenu(ctx, "❌ Bazaga saqlashda xato bo'ldi.");
      }

      await ctx.reply("✅ Yangi taom muvaffaqiyatli qo'shildi!", Markup.removeKeyboard());
      return sendMainMenu(ctx);
    }
  } catch (error) {
    console.error('text handler xato:', error);
    await ctx.reply('❌ Xato yuz berdi.');
  }
});

// ─── GLOBAL ERROR ─────────────────────────────────
bot.catch((err, ctx) => {
  console.error('BOT GLOBAL ERROR:', err);
  if (ctx?.reply) {
    ctx.reply('❌ Kutilmagan xato yuz berdi.');
  }
});

// ─── LAUNCH ───────────────────────────────────────
subscribeToOrders();

bot.launch()
  .then(() => {
    console.log("✅ BOT TO'LIQ ISHGA TUSHDI! Admin ID:", ADMIN_ID);
  })
  .catch((error) => {
    console.error('bot launch xato:', error);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));