// supabase-config.js
// 1. PASTE YOUR KEYS HERE
const SUPABASE_URL = "https://vzgvemhweifmnlziwjcl.supabase.co";
const SUPABASE_KEY = "sb_publishable_96qqkELktW9TSJblFX694Q_6lgGfxaK";


// 2. Initialize the client safely
// We use 'window.supabaseClient' to avoid the "Duplicate Identifier" error
if (!window.supabaseClient) {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

// 3. Export for use in other files
const supabase = window.supabaseClient;

// 4. WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};
