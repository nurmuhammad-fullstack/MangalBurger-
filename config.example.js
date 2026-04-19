/**
 * Frontend config (public).
 *
 * 1) Copy this file to `config.js`
 * 2) Fill in your Supabase project URL + anon public key:
 *    Supabase Dashboard → Settings → API → Project URL / anon public
 *
 * IMPORTANT:
 * - Use ONLY the anon public key here (safe for frontend with RLS).
 * - NEVER put `service_role` key into the frontend.
 */

window.MANGAL_CONFIG = {
  // Example: 'https://xxxxxxxxxxxxxxxxxxxx.supabase.co'
  SUPABASE_URL: '',

  // Example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....' (anon public key)
  SUPABASE_ANON_KEY: '',
};

