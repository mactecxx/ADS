// supabase-config.js
// Ensure you have replaced the placeholders below with your actual API keys from Supabase Settings > API

const SUPABASE_URL = "https://vzgvemhweifmnlziwjcl.supabase.co";
const SUPABASE_KEY = "sb_publishable_96qqkELktW9TSJblFX694Q_6lgGfxaK";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Shared RTC Configuration for both sides
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};
