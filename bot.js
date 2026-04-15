// =====================================================
// 🍔 MANGAL BURGER — Telegram Admin Bot v2
// Yangilik: buyurtmalar + realtime bildirishnoma
// =====================================================

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const http = require('http');

// ─── ENV ───────────────────────────────────────────
const BOT_TOKEN           = process.env.BOT_TOKEN;
const ADMIN_ID            = Number(process.env.ADMIN_ID);
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if(!BOT_TOKEN)            throw new Error('BOT_TOKEN berilmagan');
if(!ADMIN_ID)             throw new Error('ADMIN_ID berilmagan');
if(!SUPABASE_URL)         throw new Error('SUPABASE_URL berilmagan');
if(!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY berilmagan');

// ─── HTTP SERVER (Render/Glitch uchun) ─────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type':'text/plain'});
  res.end('🍔 Mangal Burger Bot ishlayapti!');
}).listen(PORT, () => {
  console.log(`🌐 HTTP server ${PORT}-portda ishlamoqda`);
});

// ─── SUPABASE VA BOT ───────────────────────────────
const sb  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ─── KATEGORIYALAR ─────────────────────────────────
const CATEGORIES = ['Burgerlar','Garniturlar','Salatlar','Pizzalar','Nonushtalar','Ichimliklar','Boshqa'];

// ─── STATUS EMOJI MAP ──────────────────────────────
const STATUS_EMOJI = {
  'yangi':           '🟢',
  'tayyorlanmoqda':  '🟡',
  'yetkazilmoqda':   '🔵',
  'yetkazildi':      '✅',
  'bekor':           '❌',
};
const STATUS_LIST = Object.keys(STATUS_EMOJI);

// ─── SESSION ───────────────────────────────────────
const sessions = {};
function getSession(id) {
  if(!sessions[id]) sessions[id] = {step:null,data:{}};
  return sessions[id];
}
function clearSession(id) { sessions[id] = {step:null,data:{}}; }

// ─── ADMIN CHECK ───────────────────────────────────
const adminOnly = (ctx, next) => {
  if(ctx.from?.id !== ADMIN_ID) return ctx.reply('❌ Ruxsat yo\'q!');
  return next();
};

// ─── YORDAMCHI: BUYURTMA XABARI ────────────────────
async function buildOrderMessage(orderId) {
  const { data: order } = await sb.from('orders').select('*').eq('id', orderId).single();
  const { data: items }  = await sb.from('order_items').select('*').eq('order_id', orderId);
  if(!order) return null;

  const itemLines = (items||[]).map(i =>
    `  • ${i.title} × ${i.quantity} = ${Number(i.price*i.quantity).toLocaleString()} so'm`
  ).join('\n');

  const statusEmoji = STATUS_EMOJI[order.status] || '⚪';

  return (
    `🍔 *YANGI BUYURTMA #${order.id}*\n\n` +
    `👤 Mijoz: *${order.customer_name}*\n` +
    `📞 Telefon: \`${order.customer_phone}\`\n` +
    `${order.note ? `📝 Izoh: ${order.note}\n` : ''}` +
    `\n📋 *Buyurtma tarkibi:*\n${itemLines}\n\n` +
    `💰 *Jami: ${Number(order.total_price).toLocaleString()} so'm*\n` +
    `${statusEmoji} Status: *${order.status}*\n` +
    `🕐 Vaqt: ${new Date(order.created_at).toLocaleString('uz-UZ')}`
  );
}

// ─── REALTIME: YANGI BUYURTMA ──────────────────────
function subscribeToOrders() {
  sb.channel('orders-channel')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'orders'
    }, async (payload) => {
      console.log('📦 Yangi buyurtma:', payload.new.id);
      try {
        const msg = await buildOrderMessage(payload.new.id);
        if(!msg) return;

        // Adminga xabar yuborish
        await bot.telegram.sendMessage(ADMIN_ID, msg, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('🟡 Tayyorlanmoqda', `status_${payload.new.id}_tayyorlanmoqda`),
              Markup.button.callback('❌ Bekor', `status_${payload.new.id}_bekor`),
            ],
            [
              Markup.button.callback('🔵 Yetkazilmoqda', `status_${payload.new.id}_yetkazilmoqda`),
              Markup.button.callback('✅ Yetkazildi', `status_${payload.new.id}_yetkazildi`),
            ]
          ])
        });
      } catch(err) {
        console.error('Xabar yuborishda xato:', err.message);
      }
    })
    .subscribe((status) => {
      console.log('📡 Realtime status:', status);
    });
}

// ─── INLINE KEYBOARD: STATUS O'ZGARTIRISH ──────────
bot.action(/^status_(\d+)_(.+)$/, adminOnly, async (ctx) => {
  const orderId = parseInt(ctx.match[1]);
  const newStatus = ctx.match[2];

  if(!STATUS_LIST.includes(newStatus)) return ctx.answerCbQuery('❌ Noma\'lum status');

  const { error } = await sb.from('orders').update({status: newStatus}).eq('id', orderId);
  if(error) return ctx.answerCbQuery('❌ Xato: ' + error.message);

  await ctx.answerCbQuery(`${STATUS_EMOJI[newStatus]} Status yangilandi!`);

  // Xabarni yangilash
  const msg = await buildOrderMessage(orderId);
  if(msg) {
    await ctx.editMessageText(msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🟡 Tayyorlanmoqda', `status_${orderId}_tayyorlanmoqda`),
          Markup.button.callback('❌ Bekor', `status_${orderId}_bekor`),
        ],
        [
          Markup.button.callback('🔵 Yetkazilmoqda', `status_${orderId}_yetkazilmoqda`),
          Markup.button.callback('✅ Yetkazildi', `status_${orderId}_yetkazildi`),
        ]
      ])
    }).catch(()=>{});
  }
});

// ══════════════════════════════════════════════════
// BOT BUYRUQLARI
// ══════════════════════════════════════════════════

// ─── /start ────────────────────────────────────────
bot.start(adminOnly, (ctx) => {
  ctx.reply(
    `🍔 *Mangal Burger Admin Bot*\n\nSalom, ${ctx.from.first_name}!\n\n` +
    `📋 *Buyruqlar:*\n\n` +
    `*Buyurtmalar:*\n` +
    `/orders — oxirgi buyurtmalar\n` +
    `/order [id] — bitta buyurtma\n\n` +
    `*Menyu boshqaruvi:*\n` +
    `/add — yangi taom qo'shish\n` +
    `/list — barcha taomlar\n` +
    `/hide [id] — taomni yashirish\n` +
    `/show [id] — taomni ko'rsatish\n` +
    `/delete [id] — taomni o'chirish\n\n` +
    `*Statistika:*\n` +
    `/stats — bugungi statistika`,
    { parse_mode: 'Markdown' }
  );
});

// ─── /orders ───────────────────────────────────────
bot.command('orders', adminOnly, async (ctx) => {
  const args = ctx.message.text.split(' ');
  const statusFilter = args[1]; // masalan: /orders yangi

  let query = sb.from('orders').select('id,customer_name,customer_phone,total_price,status,created_at').order('created_at',{ascending:false}).limit(10);
  if(statusFilter && STATUS_LIST.includes(statusFilter)) query = query.eq('status',statusFilter);

  const { data, error } = await query;
  if(error || !data?.length) return ctx.reply(statusFilter ? `📋 "${statusFilter}" buyurtmalar yo'q.` : '📋 Hozircha buyurtma yo\'q.');

  const text = data.map(o =>
    `${STATUS_EMOJI[o.status]||'⚪'} *#${o.id}* — ${o.customer_name} | ${Number(o.total_price).toLocaleString()} so'm\n` +
    `   📞 ${o.customer_phone} | 🕐 ${new Date(o.created_at).toLocaleTimeString('uz-UZ')}`
  ).join('\n\n');

  ctx.reply(`📋 *Buyurtmalar:*\n\n${text}`, {parse_mode:'Markdown'});
});

// ─── /order [id] ───────────────────────────────────
bot.command('order', adminOnly, async (ctx) => {
  const id = parseInt(ctx.message.text.split(' ')[1]);
  if(isNaN(id)) return ctx.reply('❌ ID kiriting: /order 5');

  const msg = await buildOrderMessage(id);
  if(!msg) return ctx.reply('❌ Buyurtma topilmadi.');

  ctx.reply(msg, {
    parse_mode:'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🟡 Tayyorlanmoqda',`status_${id}_tayyorlanmoqda`), Markup.button.callback('❌ Bekor',`status_${id}_bekor`)],
      [Markup.button.callback('🔵 Yetkazilmoqda',`status_${id}_yetkazilmoqda`), Markup.button.callback('✅ Yetkazildi',`status_${id}_yetkazildi`)]
    ])
  });
});

// ─── /stats ────────────────────────────────────────
bot.command('stats', adminOnly, async (ctx) => {
  const today = new Date().toISOString().slice(0,10);
  const { data } = await sb.from('orders').select('status,total_price').gte('created_at', today+'T00:00:00');

  if(!data?.length) return ctx.reply('📊 Bugun hali buyurtma yo\'q.');

  const total    = data.reduce((s,o) => s + Number(o.total_price), 0);
  const counts   = {};
  STATUS_LIST.forEach(s => counts[s] = data.filter(o=>o.status===s).length);

  ctx.reply(
    `📊 *Bugungi statistika:*\n\n` +
    `📦 Jami buyurtma: *${data.length} ta*\n` +
    `💰 Jami summa: *${total.toLocaleString()} so'm*\n\n` +
    STATUS_LIST.map(s => `${STATUS_EMOJI[s]} ${s}: ${counts[s]} ta`).join('\n'),
    {parse_mode:'Markdown'}
  );
});

// ─── /list ─────────────────────────────────────────
bot.command('list', adminOnly, async (ctx) => {
  const { data } = await sb.from('menu').select('id,title,price,category,is_available').order('created_at',{ascending:false}).limit(20);
  if(!data?.length) return ctx.reply('📋 Menyu bo\'sh.');
  const text = data.map(p => `${p.is_available?'✅':'🚫'} *[${p.id}] ${p.title}* — ${Number(p.price).toLocaleString()} so'm | ${p.category}`).join('\n');
  ctx.reply('📋 *Menyu:*\n\n'+text, {parse_mode:'Markdown'});
});

// ─── /hide [id] ────────────────────────────────────
bot.command('hide', adminOnly, async (ctx) => {
  const id = parseInt(ctx.message.text.split(' ')[1]);
  if(isNaN(id)) return ctx.reply('❌ ID kiriting: /hide 3');
  const { error } = await sb.from('menu').update({is_available:false}).eq('id',id);
  if(error) return ctx.reply('❌ Xato: '+error.message);
  ctx.reply(`🚫 Taom #${id} yashirildi.`);
});

// ─── /show [id] ────────────────────────────────────
bot.command('show', adminOnly, async (ctx) => {
  const id = parseInt(ctx.message.text.split(' ')[1]);
  if(isNaN(id)) return ctx.reply('❌ ID kiriting: /show 3');
  const { error } = await sb.from('menu').update({is_available:true}).eq('id',id);
  if(error) return ctx.reply('❌ Xato: '+error.message);
  ctx.reply(`✅ Taom #${id} yana ko'rinadi.`);
});

// ─── /delete [id] ──────────────────────────────────
bot.command('delete', adminOnly, async (ctx) => {
  const id = parseInt(ctx.message.text.split(' ')[1]);
  if(isNaN(id)) return ctx.reply('❌ ID kiriting: /delete 3');
  const { error } = await sb.from('menu').delete().eq('id',id);
  if(error) return ctx.reply('❌ Xato: '+error.message);
  ctx.reply(`🗑 Taom #${id} o'chirildi.`);
});

// ─── /add — STEP BY STEP ───────────────────────────
bot.command('add', adminOnly, (ctx) => {
  clearSession(ctx.from.id);
  getSession(ctx.from.id).step = 'wait_photo';
  ctx.reply('📸 *1-qadam:* Taom rasmini yuboring:', {parse_mode:'Markdown'});
});

bot.on('photo', adminOnly, async (ctx) => {
  const session = getSession(ctx.from.id);
  if(session.step !== 'wait_photo') return ctx.reply('Avval /add yuboring.');
  const msg = await ctx.reply('⏳ Rasm yuklanmoqda...');
  try {
    const photo = ctx.message.photo.at(-1);
    const file  = await ctx.telegram.getFile(photo.file_id);
    const url   = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const res   = await axios.get(url, {responseType:'arraybuffer'});
    const buf   = Buffer.from(res.data);
    const name  = `${Date.now()}.jpg`;
    const { error } = await sb.storage.from('menu-images').upload(name, buf, {contentType:'image/jpeg',upsert:false});
    if(error) throw error;
    const { data: urlData } = sb.storage.from('menu-images').getPublicUrl(name);
    session.data.image_url = urlData.publicUrl;
    session.step = 'wait_title';
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '✅ Rasm yuklandi!');
    ctx.reply('✏️ *2-qadam:* Taom nomini yozing:', {parse_mode:'Markdown'});
  } catch(err) {
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ Rasm yuklanmadi: '+err.message);
  }
});

bot.on('text', adminOnly, async (ctx) => {
  const session = getSession(ctx.from.id);
  const text    = ctx.message.text.trim();

  if(session.step==='wait_title') {
    session.data.title = text;
    session.step = 'wait_price';
    return ctx.reply('💰 *3-qadam:* Narxini yozing (so\'mda):\nMasalan: _35000_', {parse_mode:'Markdown'});
  }
  if(session.step==='wait_price') {
    const price = parseFloat(text.replace(/\D/g,''));
    if(isNaN(price)||price<=0) return ctx.reply('❌ Noto\'g\'ri narx. Faqat raqam kiriting.');
    session.data.price = price;
    session.step = 'wait_category';
    return ctx.reply('📂 *4-qadam:* Kategoriya tanlang:', {parse_mode:'Markdown', ...Markup.keyboard(CATEGORIES.map(c=>[c])).oneTime().resize()});
  }
  if(session.step==='wait_category') {
    if(!CATEGORIES.includes(text)) return ctx.reply('❌ Ro\'yxatdan tanlang.');
    session.data.category = text;
    session.step = 'wait_description';
    return ctx.reply('📝 *5-qadam:* Tavsif yozing:', {parse_mode:'Markdown', ...Markup.removeKeyboard()});
  }
  if(session.step==='wait_description') {
    session.data.description = text;
    session.step = 'confirm';
    const {title,price,category,description} = session.data;
    return ctx.reply(
      `📋 *Tasdiqlang:*\n\n📌 *${title}*\n💰 ${Number(price).toLocaleString()} so'm\n📂 ${category}\n📝 ${description}\n🖼 Rasm: ✅`,
      {parse_mode:'Markdown', ...Markup.keyboard([['✅ Saqlash','❌ Bekor']]).oneTime().resize()}
    );
  }
  if(session.step==='confirm') {
    if(text==='❌ Bekor') { clearSession(ctx.from.id); return ctx.reply('❌ Bekor.', Markup.removeKeyboard()); }
    if(text==='✅ Saqlash') {
      try {
        const {data,error} = await sb.from('menu').insert([{
          title:session.data.title, price:session.data.price,
          category:session.data.category, description:session.data.description,
          image_url:session.data.image_url, is_available:true
        }]).select().single();
        if(error) throw error;
        clearSession(ctx.from.id);
        ctx.reply(`🎉 *Taom qo'shildi!*\n🆔 ID: \`${data.id}\`\n📌 *${data.title}*\n💰 ${Number(data.price).toLocaleString()} so'm`, {parse_mode:'Markdown', ...Markup.removeKeyboard()});
      } catch(err) { ctx.reply('❌ Xato: '+err.message); }
    }
  }
});

// ─── XATO ──────────────────────────────────────────
bot.catch((err,ctx) => {
  console.error('Bot xatosi:', err.message);
  ctx.reply('⚠️ Xato yuz berdi.');
});

// ─── ISHGA TUSHISH ─────────────────────────────────
bot.launch().then(() => {
  console.log('✅ Mangal Burger Bot ishga tushdi!');
  console.log(`👤 Admin ID: ${ADMIN_ID}`);
  subscribeToOrders();
  console.log('📡 Realtime buyurtmalar kuzatilmoqda...');
}).catch(err => {
  console.error('❌ Bot ishga tushmadi:', err.message);
  process.exit(1);
});

process.once('SIGINT',  ()=>bot.stop('SIGINT'));
process.once('SIGTERM', ()=>bot.stop('SIGTERM'));
