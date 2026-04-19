const { createClient } = require('@supabase/supabase-js');

function pickCorsOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!origin || !host) return null;

  try {
    const originHost = new URL(origin).host;
    if (originHost === host) return origin;
  } catch {}

  const allowList = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return allowList.includes(origin) ? origin : null;
}

function setCors(res, origin) {
  if (!origin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, payload, origin) {
  setCors(res, origin);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
  if (digits.length === 9) return `+998${digits}`;

  return null;
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < min || i > max) return null;
  return i;
}

function normalizeTableNumber(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return clampInt(digits, 1, 999);
}

let cachedSb = null;
function getSupabaseAdmin() {
  if (cachedSb) return cachedSb;
  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !serviceKey) return null;

  cachedSb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cachedSb;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];

  const map = new Map(); // productId -> qty
  for (const it of items) {
    const productId = clampInt(it?.product_id ?? it?.menu_id ?? it?.id, 1, 1_000_000_000);
    const qty = clampInt(it?.quantity ?? it?.qty, 1, 99);
    if (!productId || !qty) continue;
    map.set(productId, (map.get(productId) || 0) + qty);
  }

  return [...map.entries()].map(([productId, quantity]) => ({
    productId,
    quantity: Math.min(quantity, 99),
  }));
}

module.exports = async (req, res) => {
  const origin = pickCorsOrigin(req);

  if (req.method === 'OPTIONS') {
    setCors(res, origin);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { message: 'Method not allowed' }, origin);
    return;
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    sendJson(res, 500, { message: 'Server misconfigured: Supabase env vars missing' }, origin);
    return;
  }

  let body = req.body;
  try {
    if (!body) {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } else if (typeof body === 'string') {
      body = body ? JSON.parse(body) : {};
    }
  } catch (e) {
    sendJson(res, 400, { message: 'Invalid JSON body' }, origin);
    return;
  }

  const customerName = String(body.customer_name || '').trim();
  const customerPhone = normalizePhone(body.customer_phone);
  const note = String(body.note || '').trim() || null;
  const tableNumber = normalizeTableNumber(
    body.table_number ?? body.tableNo ?? body.table ?? body.delivery_address
  );
  const paymentType = body.payment_type === 'card' ? 'card' : 'cash';

  const itemsNorm = normalizeItems(body.items);

  if (customerName.length < 2 || customerName.length > 60) {
    sendJson(res, 400, { message: "Ism 2-60 ta belgi bo'lishi kerak" }, origin);
    return;
  }

  if (!customerPhone) {
    sendJson(res, 400, { message: "Telefon raqam noto'g'ri (masalan: +998901234567)" }, origin);
    return;
  }

  if (note && note.length > 300) {
    sendJson(res, 400, { message: 'Izoh 300 ta belgidan oshmasin' }, origin);
    return;
  }

  if (!tableNumber) {
    sendJson(res, 400, { message: 'Stol raqami noto‘g‘ri (1–999)' }, origin);
    return;
  }

  if (!itemsNorm.length) {
    sendJson(res, 400, { message: 'Savat bo‘sh' }, origin);
    return;
  }

  if (itemsNorm.length > 50) {
    sendJson(res, 400, { message: 'Savatda mahsulotlar soni juda ko‘p' }, origin);
    return;
  }

  const productIds = itemsNorm.map((x) => x.productId);
  const { data: products, error: productsErr } = await sb
    .from('menu')
    .select('id,title,price,is_available')
    .in('id', productIds);

  if (productsErr) {
    sendJson(res, 500, { message: 'Menyu tekshirishda xato' }, origin);
    return;
  }

  const productById = new Map((products || []).map((p) => [p.id, p]));
  const missing = productIds.filter((id) => !productById.has(id));
  if (missing.length) {
    sendJson(res, 400, { message: `Menyuda topilmadi: ${missing.join(', ')}` }, origin);
    return;
  }

  const unavailable = productIds.filter((id) => productById.get(id)?.is_available === false);
  if (unavailable.length) {
    sendJson(res, 400, { message: `Mavjud emas: ${unavailable.join(', ')}` }, origin);
    return;
  }

  const orderItems = itemsNorm.map(({ productId, quantity }) => {
    const p = productById.get(productId);
    const price = Number(p.price || 0);
    const total = price * quantity;
    return {
      product_id: productId,
      title: p.title,
      price,
      quantity,
      total,
    };
  });

  const subtotalAmount = orderItems.reduce((sum, it) => sum + Number(it.total || 0), 0);
  const deliveryFee = 0;
  const totalAmount = subtotalAmount + deliveryFee;

  const { data: order, error: orderErr } = await sb
    .from('orders')
    .insert([
      {
        customer_name: customerName,
        customer_phone: customerPhone,
        delivery_address: String(tableNumber),
        note,
        payment_type: paymentType,
        payment_status: 'unpaid',
        order_status: 'new',
        status: 'yangi',
        subtotal_amount: subtotalAmount,
        delivery_fee: deliveryFee,
        total_amount: totalAmount,
      },
    ])
    .select('id,total_amount')
    .single();

  if (orderErr || !order) {
    sendJson(res, 500, { message: 'Buyurtmani saqlashda xato' }, origin);
    return;
  }

  const itemsToInsert = orderItems.map((it) => ({ ...it, order_id: order.id }));
  const { error: itemsErr } = await sb.from('order_items').insert(itemsToInsert);

  if (itemsErr) {
    await sb.from('orders').delete().eq('id', order.id);
    sendJson(res, 500, { message: 'Buyurtma tarkibini saqlashda xato' }, origin);
    return;
  }

  sendJson(
    res,
    201,
    { orderId: order.id, totalAmount: order.total_amount, tableNumber },
    origin
  );
};
