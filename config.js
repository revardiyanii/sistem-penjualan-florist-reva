// Isi dari Supabase: Project Settings > API
const SUPABASE_URL = 'https://hwxewfngrkwygxzqgyym.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lH4pEP8hXnNasqBGJiRkmQ_r_JHD_LG';
// Jangan pernah memakai service_role key di file front-end.
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);