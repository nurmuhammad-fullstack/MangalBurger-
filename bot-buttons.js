require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');

// ─── ENV ───────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
function normalizeWebAppUrl(raw) {
  if (!raw) return null;
  let url = String(raw).trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) {
    const isLocalhost = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);
    url = `${isLocalhost ? 'http' : 'https'}://${url}`;
  }
  return url;
}

function inferWebAppUrl() {
  const flyAppName = String(process.env.FLY_APP_NAME || '').trim();
  if (flyAppName) return `https://${flyAppName}.fly.dev`;
  return null;
}

const WEBAPP_URL = normalizeWebAppUrl(process.env.WEBAPP_URL) || inferWebAppUrl();
const PORT = Number(process.env.PORT || 3000);
const MENU_IMAGES_BUCKET = process.env.MENU_IMAGES_BUCKET || 'menu-images';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN berilmagan');
if (!ADMIN_ID) throw new Error('ADMIN_ID berilmagan');
if (!SUPABASE_URL) throw new Error('SUPABASE_URL berilmagan');
if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY berilmagan');
if (!WEBAPP_URL)
  throw new Error('WEBAPP_URL berilmagan (Fly.io: fly secrets set WEBAPP_URL=https://<app>.fly.dev)');

const orderApi = require('./api/order');
const configApi = require('./api/config');

// ─── HTTP SERVER ──────────────────────────────────
async function readFileSafe(filePath) {
  try {
    return await fs.promises.readFile(filePath);
  } catch {
    return null;
  }
}

function send(res, status, headers, body) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
  if (body && res.req?.method !== 'HEAD') res.end(body);
  else res.end();
}

http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `localhost:${PORT}`;
    const url = new URL(req.url || '/', `http://${host}`);
    const pathname = url.pathname;

    if (pathname === '/api/order') return orderApi(req, res);
    if (pathname === '/api/config') return configApi(req, res);

    if (pathname === '/health' || pathname === '/healthz') {
      send(res, 200, { 'Content-Type': 'text/plain; charset=utf-8' }, 'ok');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      const html = await readFileSafe(path.join(__dirname, 'index.html'));
      if (!html) {
        send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'index.html not found');
        return;
      }
      send(res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, html);
      return;
    }

    if (pathname === '/config.js') {
      const js =
        (await readFileSafe(path.join(__dirname, 'config.js'))) ||
        (await readFileSafe(path.join(__dirname, 'config.example.js')));
      if (!js) {
        send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'config.js not found');
        return;
      }
      send(
        res,
        200,
        { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
        js
      );
      return;
    }

    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
  } catch (err) {
    console.error('HTTP server xato:', err);
    send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Internal Server Error');
  }
}).listen(PORT, () => {
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
const ORDER_STATUS_MAP = {
  yangi: 'new',
  tayyorlanmoqda: 'preparing',
  yetkazilmoqda: 'delivering',
  yetkazildi: 'delivered',
  bekor: 'cancelled',
};

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

function escapeMarkdown(text) {
  return String(text ?? '').replace(/([_*`\\[])/g, '\\$1');
}

function formatPaymentType(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'cash') return 'Naqd';
  if (v === 'card') return 'Karta';
  return value || '-';
}

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function contentTypeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve(downloadBuffer(res.headers.location));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`Telegram file download failed: ${status}`));
          return;
        }

        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

let bucketReady = false;
async function ensureMenuImagesBucket() {
  if (bucketReady) return;

  try {
    const { data: buckets, error } = await sb.storage.listBuckets();
    if (error) throw error;

    const found = (buckets || []).find((b) => b?.name === MENU_IMAGES_BUCKET || b?.id === MENU_IMAGES_BUCKET);
    if (!found) {
      const { error: createErr } = await sb.storage.createBucket(MENU_IMAGES_BUCKET, { public: true });
      if (createErr && !String(createErr.message || '').toLowerCase().includes('exists')) {
        throw createErr;
      }
    } else if (found.public === false) {
      const { error: updErr } = await sb.storage.updateBucket(MENU_IMAGES_BUCKET, { public: true });
      if (updErr) console.warn('bucket public update xato:', updErr);
    }
  } catch (e) {
    console.warn('ensureMenuImagesBucket xato:', e?.message || e);
  } finally {
    bucketReady = true;
  }
}

async function uploadTelegramPhotoToStorage(fileId, fileUniqueId) {
  await ensureMenuImagesBucket();

  const file = await bot.telegram.getFile(fileId);
  const filePath = file?.file_path;
  if (!filePath) throw new Error('Telegram file_path topilmadi');

  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const buffer = await downloadBuffer(url);

  const ext = path.extname(filePath) || '.jpg';
  const contentType = contentTypeFromExt(ext);

  const namePart = safeId(fileUniqueId) || randomId();
  const objectPath = `menu/${Date.now()}_${namePart}${ext.toLowerCase()}`;

  const { error: uploadErr } = await sb.storage
    .from(MENU_IMAGES_BUCKET)
    .upload(objectPath, buffer, { contentType, upsert: false, cacheControl: '31536000' });

  if (uploadErr) throw uploadErr;

  const { data } = sb.storage.from(MENU_IMAGES_BUCKET).getPublicUrl(objectPath);
  if (!data?.publicUrl) throw new Error('Public URL olinmadi');

  return data.publicUrl;
}

function orderActionKeyboard(orderId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Qabul qilish', `status_${orderId}_tayyorlanmoqda`),
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getOrderItemsWithRetry(orderId, attempts = 6, delayMs = 250) {
  for (let i = 0; i < attempts; i++) {
    const items = await getOrderItems(orderId);
    if (items.length) return items;
    await sleep(delayMs);
  }
  return getOrderItems(orderId);
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

    const items = await getOrderItemsWithRetry(orderId);
    const total = calculateTotalFromItems(items);

    const itemLines = items.length
      ? items.map(i =>
          `• ${escapeMarkdown(i.title)} × ${i.quantity} = ${formatMoney(Number(i.price || 0) * Number(i.quantity || 0))} so'm`
        ).join('\n')
      : '• Mahsulot yo‘q';

    const statusEmoji = STATUS_EMOJI[order.status] || '⚪';
    const paymentType = formatPaymentType(order.payment_type);
    const paymentStatus = order.payment_status ? String(order.payment_status) : null;
    const tableNo = order.delivery_address ? escapeMarkdown(order.delivery_address) : null;
    const note = order.note ? escapeMarkdown(order.note) : null;

    return (
      `🍔 *BUYURTMA #${order.id}*\n\n` +
      `👤 Mijoz: *${escapeMarkdown(order.customer_name || '-')}*\n` +
      `📞 Telefon: \`${order.customer_phone || '-'}\`\n` +
      `${tableNo ? `🪑 Stol: *${tableNo}*\n` : ''}` +
      `💳 To'lov: *${escapeMarkdown(paymentType)}*${paymentStatus ? ` (${escapeMarkdown(paymentStatus)})` : ''}\n` +
      `${note ? `📝 Izoh: ${note}\n` : ''}` +
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

    const updatePayload = { status: newStatus };
    const orderStatus = ORDER_STATUS_MAP[newStatus];
    if (orderStatus) updatePayload.order_status = orderStatus;

    const { error } = await sb
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId);

    if (error) {
      console.error('status update xato:', error);
      return ctx.answerCbQuery('❌ Yangilashda xato');
    }

    await ctx.answerCbQuery(
      newStatus === 'tayyorlanmoqda'
        ? '🟡 Tayyorlash boshlandi'
        : `${STATUS_EMOJI[newStatus]} Yangilandi`
    );

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
        `${STATUS_EMOJI[order.status] || '⚪'} *#${order.id}* — ${escapeMarkdown(order.customer_name || '-')}\n` +
        `📞 ${escapeMarkdown(order.customer_phone || '-')}\n` +
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
        `${STATUS_EMOJI[order.status] || '⚪'} *#${order.id}* — ${escapeMarkdown(order.customer_name || '-')}\n` +
        `📞 ${escapeMarkdown(order.customer_phone || '-')}\n` +
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

    const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
    const photoId = photo?.file_id;
    const photoUniqueId = photo?.file_unique_id;
    if (!photoId) {
      return ctx.reply("❌ Rasm olinmadi. Qayta yuboring.");
    }

    await ctx.reply('⏳ Rasm saqlanmoqda...');

    try {
      const publicUrl = await uploadTelegramPhotoToStorage(photoId, photoUniqueId);
      session.data.image_url = publicUrl;
      session.step = 'wait_title';

      await ctx.reply("✅ Rasm saqlandi.\n\n✏️ Endi taomning *nomini* kiriting:", {
        parse_mode: 'Markdown'
      });
    } catch (e) {
      console.error('photo upload xato:', e);
      session.data.image_url = null;
      session.step = 'wait_photo';
      await ctx.reply("❌ Rasmni saqlashda xato bo'ldi. Qayta yuboring.");
    }
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
