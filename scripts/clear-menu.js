#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

async function getCounts(sb) {
  const totalRes = await sb.from('menu').select('id', { count: 'exact', head: true });
  if (totalRes.error) throw totalRes.error;

  const availableRes = await sb
    .from('menu')
    .select('id', { count: 'exact', head: true })
    .eq('is_available', true);
  if (availableRes.error) throw availableRes.error;

  return {
    total: Number(totalRes.count || 0),
    available: Number(availableRes.count || 0),
  };
}

async function main() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseServiceKey = String(
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  ).trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing env vars: SUPABASE_URL + SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)');
    process.exit(1);
  }

  const mode = hasFlag('--delete') ? 'delete' : 'hide';
  const confirmed = hasFlag('--yes') || process.env.CONFIRM_CLEAR_MENU === 'YES';

  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const before = await getCounts(sb);
  console.log(`Supabase: ${supabaseUrl}`);
  console.log(`menu rows: total=${before.total}, available=${before.available}`);

  if (mode === 'delete') {
    if (!confirmed) {
      console.log('\nRefusing to DELETE without confirmation.');
      console.log('Run with: CONFIRM_CLEAR_MENU=YES node scripts/clear-menu.js --delete');
      console.log('  or:     node scripts/clear-menu.js --delete --yes');
      process.exit(2);
    }

    const delRes = await sb.from('menu').delete().not('id', 'is', null);
    if (delRes.error) throw delRes.error;
    console.log('\n✅ Deleted all rows from `menu`.');
  } else {
    const updRes = await sb.from('menu').update({ is_available: false }).eq('is_available', true);
    if (updRes.error) throw updRes.error;
    console.log('\n✅ Set `is_available=false` for all available rows in `menu`.');
  }

  const after = await getCounts(sb);
  console.log(`menu rows now: total=${after.total}, available=${after.available}`);
}

main().catch((err) => {
  console.error('Error:', err?.message || err);
  process.exit(1);
});

