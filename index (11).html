// --- CONFIGURATION ---
// Set these in your Netlify Environment Variables
const SUPABASE_URL = "https://botuspjtaqkqibyqkacd.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_BkBSWY_1ii3OivvOWeCYoQ_slnEL-HN";

const supabase = showSupabaseInstance(); 

function showSupabaseInstance() {
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

let currentUser = null;
let currentChatId = null;
let peerConnection = null;
let localStream = null;
let realtimeChannel = null;
let callTimerInterval = null;

const rtcConfig = {
    iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }]
};

// --- 1. INITIALIZATION & AUTH ---
window.addEventListener('load', async () => {
    // Check for Magic Link return
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
        currentUser = session.user;
        initializeSession(currentUser);
    }

    // Handle Auth State Changes
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
            currentUser = session.user;
            initializeSession(currentUser);
        }
    });
});

async function initializeSession(user) {
    // Check if conversation exists
    const { data: conv } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', user.id)
        .single();

    if (conv) {
        currentChatId = conv.id;
        showChatInterface();
        subscribeToChat(conv.id);
    } else {
        // Create new conversation
        const { data: newConv } = await supabase
            .from('conversations')
            .insert([{ 
                user_id: user.id, 
                user_email: user.email,
                uid_display: Math.floor(100000 + Math.random() * 900000).toString() 
            }])
            .select()
            .single();
        
        currentChatId = newConv.id;
        showChatInterface();
        subscribeToChat(newConv.id);
    }
}

// --- 2. LOGIN LOGIC ---
async function handleChatLogin() {
    const email = document.getElementById('chat-email').value;
    const name = document.getElementById('chat-name').value;
    
    if (!email || !name) return alert("Please fill in details.");

    // Check if user exists (Logic handled by Supabase Auth)
    // We attempt to sign in with OTP (Magic Link)
    const { error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
            emailRedirectTo: window.location.href, // Returns to master page
            data: { full_name: name }
        }
    });

    if (error) {
        alert("Error sending link: " + error.message);
    } else {
        alert(`Verification link sent to ${email}. Please check your Inbox/Spam.`);
        // For Instant Access (Guest Mode), we could allow temporary chat here,
        // but your requirement prefers verifying existing users.
    }
}

// --- 3. MESSAGING (REALTIME) ---
function subscribeToChat(chatId) {
    // 1. Load History
    loadMessageHistory(chatId);

    // 2. Setup Realtime Channel
    realtimeChannel = supabase.channel(`chat:${chatId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chatId}` }, 
        payload => {
            appendMessage(payload.new);
        })
        .on('broadcast', { event: 'signal' }, payload => {
            handleWebRTCSignal(payload.payload);
        })
        .subscribe();
}

async function loadMessageHistory(chatId) {
    const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', chatId)
        .order('created_at', { ascending: true });

    const div = document.getElementById('msgs-area');
    div.innerHTML = '';
    let lastDate = '';

    msgs.forEach(msg => {
        const date = new Date(msg.created_at).toLocaleDateString();
        if (date !== lastDate) {
            div.innerHTML += `<div class="date-divider">${date}</div>`;
            lastDate = date;
        }
        appendMessage(msg);
    });
}

function appendMessage(msg) {
    const div = document.getElementById('msgs-area');
    const isMe = msg.sender_id === currentUser.id;
    const time = new Date(msg.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    
    let content = msg.text || '';
    if (msg.file_url) {
        content += `<br><button class="file-preview-link" onclick="previewFile('${msg.file_url}', '${msg.file_type}')">📄 View Attachment</button>`;
    }

    div.innerHTML += `
        <div class="msg ${isMe ? 'me' : 'agent'}">
            ${content}
            <span class="timestamp">${time}</span>
        </div>
    `;
    div.scrollTop = div.scrollHeight;
}

async function sendMsg() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if(!text) return;
    
    input.value = '';
    await supabase.from('messages').insert([{
        conversation_id: currentChatId,
        sender_id: currentUser.id,
        text: text
    }]);
    
    // Update conversation last_activity
    await supabase.from('conversations').update({ status: 'active', last_message_at: new Date() }).eq('id', currentChatId);
}

// --- 4. FILE UPLOAD (SECURE) ---
async function uploadFile(input) {
    const file = input.files[0];
    if(!file) return;

    const fileName = `${Date.now()}_${file.name}`;
    const { data, error } = await supabase.storage
        .from('chat-files')
        .upload(`${currentUser.id}/${fileName}`, file);

    if (error) return alert("Upload failed");

    await supabase.from('messages').insert([{
        conversation_id: currentChatId,
        sender_id: currentUser.id,
        text: "", // Empty text for file msg
        file_url: data.path,
        file_type: file.type
    }]);
}

window.previewFile = async function(path, type) {
    // Generate temporary signed URL (Hidden from global public access)
    const { data } = await supabase.storage.from('chat-files').createSignedUrl(path, 60);
    
    const modal = document.getElementById('file-modal');
    const content = document.getElementById('file-modal-content');
    modal.style.display = 'flex';
    
    if (type.includes('image')) {
        content.innerHTML = `<img src="${data.signedUrl}">`;
    } else {
        content.innerHTML = `<iframe src="${data.signedUrl}"></iframe>`;
    }
}

// --- 5. WEBRTC CALLING (BROADCAST SIGNALING) ---
async function startCall() {
    document.getElementById('call-modal').style.display = 'block';
    setupPeerConnection(true); // Is Initiator
}

async function setupPeerConnection(isInitiator) {
    peerConnection = new RTCPeerConnection(rtcConfig);
    
    // Add Local Stream
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // Handle Remote Stream
    peerConnection.ontrack = event => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
        startCallTimer();
    };

    // ICE Candidates
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendSignal({ type: 'candidate', candidate: event.candidate });
        }
    };

    if (isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal({ type: 'offer', sdp: offer });
        
        // Timeout Logic
        setTimeout(() => {
            if (peerConnection.connectionState !== 'connected') {
                handleMissedCall();
            }
        }, 90000); // 1.30 min
    }
}

async function handleWebRTCSignal(signal) {
    if (!peerConnection) setupPeerConnection(false);

    if (signal.type === 'offer') {
        // Show Answer UI
        document.getElementById('call-modal').style.display = 'block';
        document.getElementById('call-status-text').innerText = "Incoming Call...";
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendSignal({ type: 'answer', sdp: answer });
    } 
    else if (signal.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        document.getElementById('call-status-text').innerText = "Connected";
    } 
    else if (signal.type === 'candidate') {
        await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
    else if (signal.type === 'end') {
        closeCallUI();
    }
}

function sendSignal(data) {
    realtimeChannel.send({
        type: 'broadcast',
        event: 'signal',
        payload: data
    });
}

function endCall() {
    sendSignal({ type: 'end' });
    closeCallUI();
}

function closeCallUI() {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    document.getElementById('call-modal').style.display = 'none';
    document.getElementById('call-active-banner').style.display = 'none';
    clearInterval(callTimerInterval);
}

function handleMissedCall() {
    closeCallUI();
    alert("Call not connected. Please leave a message.");
    
    supabase.from('missed_calls').insert([{
        client_id: currentUser.id,
        status: 'unattended'
    }]);

    document.getElementById('msg-input').focus();
    document.getElementById('msg-input').placeholder = "Leave a message...";
}

// --- UI HELPERS ---
function toggleSupportMenu() { document.getElementById('support-wrapper').classList.toggle('active'); }
function showChatInterface() {
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('chat-view').style.display = 'flex';
}
function startCallTimer() {
    document.getElementById('call-active-banner').style.display = 'flex';
    let sec = 0;
    callTimerInterval = setInterval(() => {
        sec++;
        const m = Math.floor(sec / 60).toString().padStart(2, '0');
        const s = (sec % 60).toString().padStart(2, '0');
        document.getElementById('call-timer').innerText = `${m}:${s}`;
    }, 1000);
}
