require('dotenv').config();

const https = require('https');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const MENU_IMAGES_BUCKET = (process.env.MENU_IMAGES_BUCKET || 'menu-images').trim();

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing');
if (!SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY missing');

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
          reject(new Error(`download failed: ${status}`));
          return;
        }

        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function ensureMenuImagesBucket() {
  const { data: buckets, error } = await sb.storage.listBuckets();
  if (error) throw error;

  const found = (buckets || []).find((b) => b?.name === MENU_IMAGES_BUCKET || b?.id === MENU_IMAGES_BUCKET);
  if (!found) {
    const { error: createErr } = await sb.storage.createBucket(MENU_IMAGES_BUCKET, { public: true });
    if (createErr) throw createErr;
    return;
  }

  if (found.public === false) {
    const { error: updErr } = await sb.storage.updateBucket(MENU_IMAGES_BUCKET, { public: true });
    if (updErr) throw updErr;
  }
}

async function telegramGetFile(fileId) {
  const endpoint = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const res = await fetch(endpoint, { method: 'GET' });
  const json = await res.json().catch(() => null);
  if (!json?.ok) {
    const msg = json?.description || `HTTP ${res.status}`;
    throw new Error(`getFile failed: ${msg}`);
  }
  return json.result;
}

async function uploadTelegramFileId(fileId, menuId) {
  const file = await telegramGetFile(fileId);
  const filePath = file?.file_path;
  if (!filePath) throw new Error('file_path missing');

  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const buffer = await downloadBuffer(url);

  const ext = path.extname(filePath) || '.jpg';
  const contentType = contentTypeFromExt(ext);
  const objectPath = `menu/backfill/${menuId}_${Date.now()}_${randomId()}${ext.toLowerCase()}`;

  const { error: uploadErr } = await sb.storage
    .from(MENU_IMAGES_BUCKET)
    .upload(objectPath, buffer, { contentType, upsert: false, cacheControl: '31536000' });
  if (uploadErr) throw uploadErr;

  const { data } = sb.storage.from(MENU_IMAGES_BUCKET).getPublicUrl(objectPath);
  if (!data?.publicUrl) throw new Error('publicUrl missing');

  return data.publicUrl;
}

function isLikelyUrl(value) {
  const v = String(value || '').trim();
  return v.startsWith('http://') || v.startsWith('https://');
}

async function main() {
  await ensureMenuImagesBucket();

  const { data, error } = await sb
    .from('menu')
    .select('id,title,image_url,created_at')
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;

  const rows = (data || []).filter((r) => r.image_url && !isLikelyUrl(r.image_url));
  if (!rows.length) {
    console.log('✅ Nothing to backfill');
    return;
  }

  console.log(`Found ${rows.length} menu rows with Telegram file_id images.`);

  const cache = new Map(); // fileId -> publicUrl
  let ok = 0;
  let failed = 0;

  for (const row of rows) {
    const fileId = String(row.image_url || '').trim();
    if (!fileId) continue;

    try {
      let publicUrl = cache.get(fileId);
      if (!publicUrl) {
        publicUrl = await uploadTelegramFileId(fileId, row.id);
        cache.set(fileId, publicUrl);
      }

      const { error: updErr } = await sb
        .from('menu')
        .update({ image_url: publicUrl })
        .eq('id', row.id);
      if (updErr) throw updErr;

      ok += 1;
      console.log(`✅ menu#${row.id} updated`);
    } catch (e) {
      failed += 1;
      console.warn(`❌ menu#${row.id} failed: ${e?.message || e}`);
    }

    await sleep(200);
  }

  console.log(`Done. ok=${ok}, failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

