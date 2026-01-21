// --- 0. IMMEDIATE UI FUNCTIONS (Must be loaded first) ---
// This function is attached to the button onclick. 
// We define it on 'window' to make sure the HTML can see it immediately.
window.toggleSupportMenu = function() {
    const wrapper = document.getElementById('support-wrapper');
    if (wrapper) {
        wrapper.classList.toggle('active');
    } else {
        console.error("Support wrapper not found!");
    }
};

window.openPanel = function() { 
    document.getElementById('cvd-panel').classList.add('panel-open'); 
};

window.closePanel = function() { 
    document.getElementById('cvd-panel').classList.remove('panel-open'); 
};

window.triggerAnimation = function(type) {
    window.openPanel();
    document.getElementById('support-wrapper').classList.remove('active'); // Close small buttons
    if (type === 'call' && currentUser) startCall();
};

// --- CONFIGURATION CHECK ---
if (typeof _CONFIG === 'undefined' || typeof window.supabase === 'undefined') {
    console.error("Config or Supabase missing. Check index.html");
}

const supabase = window.supabase.createClient(_CONFIG.supabaseUrl, _CONFIG.supabaseKey);

// --- GLOBAL STATE ---
let currentUser = null;
let currentChatId = null;
let peerConnection = null;
let localStream = null;
let rtcChannel = null;
let callTimerInterval = null;
const rtcConfig = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302'] }] };

// --- 1. INITIALIZATION ---
window.addEventListener('load', async () => {
    // Check Session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        handleSession(session.user);
    }

    // Listen for Auth
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) handleSession(session.user);
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('support-wrapper');
        const isClickInside = wrapper.contains(e.target);
        
        if (!isClickInside && wrapper.classList.contains('active')) {
            wrapper.classList.remove('active');
        }
    });
});

// ... (The rest of the logic remains the same as before) ...

async function handleSession(user) {
    currentUser = user;
    const { data: conv } = await supabase.from('conversations').select('*').eq('user_id', user.id).single();
    
    if (conv) {
        currentChatId = conv.id;
    } else {
        const { data: newConv } = await supabase.from('conversations').insert([{
            user_id: user.id,
            user_email: user.email,
            user_name: user.user_metadata.full_name,
            uid_display: Math.floor(100000 + Math.random() * 900000).toString()
        }]).select().single();
        currentChatId = newConv.id;
    }

    showChatInterface();
    subscribeRealtime();
}

function showChatInterface() {
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('chat-view').style.display = 'flex';
}

async function handleChatLogin() {
    const name = document.getElementById('chat-name').value;
    const email = document.getElementById('chat-email').value;
    const dob = document.getElementById('chat-dob').value;

    if (!name || !email) return alert("Name and Email are required.");

    const status = document.getElementById('login-status');
    status.innerText = "Sending login link...";
    status.style.color = "blue";

    const { error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
            emailRedirectTo: window.location.href,
            data: { full_name: name, dob: dob }
        }
    });

    if (error) {
        status.innerText = "Error: " + error.message;
        status.style.color = "red";
    } else {
        status.innerText = "Link sent! Please check your email.";
        status.style.color = "green";
    }
}

// --- MESSAGING ---
function subscribeRealtime() {
    loadMessages();
    rtcChannel = supabase.channel(`room:${currentChatId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${currentChatId}` }, 
        payload => renderMessage(payload.new))
        .on('broadcast', { event: 'signal' }, payload => handleWebRTCSignal(payload.payload))
        .subscribe();
}

async function loadMessages() {
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', currentChatId).order('created_at', { ascending: true });
    const area = document.getElementById('msgs-area');
    area.innerHTML = '';
    if(data) data.forEach(msg => renderMessage(msg));
}

function renderMessage(msg) {
    const area = document.getElementById('msgs-area');
    const isMe = msg.sender_id === currentUser.id;
    const time = new Date(msg.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    
    let content = msg.text || '';
    if (msg.file_url) content += `<br><u style="cursor:pointer; color:blue" onclick="previewFile('${msg.file_url}', '${msg.file_type}')">📄 View Attachment</u>`;

    area.innerHTML += `<div class="msg ${isMe ? 'me' : 'agent'}">${content}<span class="timestamp">${time}</span></div>`;
    area.scrollTop = area.scrollHeight;
}

async function sendMsg() {
    const input = document.getElementById('msg-input');
    const txt = input.value.trim();
    if (!txt) return;
    input.value = '';
    await supabase.from('messages').insert([{ conversation_id: currentChatId, sender_id: currentUser.id, text: txt }]);
    await supabase.from('conversations').update({ status: 'active', last_message_at: new Date() }).eq('id', currentChatId);
}

// --- FILES ---
function triggerFileSelect() { document.getElementById('file-input').click(); }

async function uploadFile(input) {
    const file = input.files[0];
    if(!file) return;
    const path = `${currentUser.id}/${Date.now()}_${file.name}`;
    const { data, error } = await supabase.storage.from('chat-files').upload(path, file);
    if(!error) {
        await supabase.from('messages').insert([{
            conversation_id: currentChatId, sender_id: currentUser.id, text: '', file_url: data.path, file_type: file.type
        }]);
    } else { alert("Upload Failed"); }
}

window.previewFile = async function(path, type) {
    const { data } = await supabase.storage.from('chat-files').createSignedUrl(path, 60);
    document.getElementById('file-modal').style.display = 'flex';
    document.getElementById('file-modal-content').innerHTML = type.includes('image') ? 
        `<img src="${data.signedUrl}" style="width:100%">` : `<iframe src="${data.signedUrl}" style="width:100%; height:100%"></iframe>`;
}

window.closeFileModal = function() { document.getElementById('file-modal').style.display = 'none'; }

// --- CALLING ---
async function startCall() {
    document.getElementById('call-modal').style.display = 'block';
    setupPeerConnection(true);
}

async function setupPeerConnection(isInitiator) {
    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

    peerConnection.ontrack = e => {
        const aud = new Audio();
        aud.srcObject = e.streams[0];
        aud.play();
        startTimer();
    };

    peerConnection.onicecandidate = e => {
        if(e.candidate) rtcChannel.send({ type: 'broadcast', event: 'signal', payload: { type: 'candidate', candidate: e.candidate } });
    };

    if(isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        rtcChannel.send({ type: 'broadcast', event: 'signal', payload: { type: 'offer', sdp: offer } });
        setTimeout(() => { if(peerConnection.connectionState !== 'connected') handleMissed(); }, 90000);
    }
}

async function handleWebRTCSignal(signal) {
    if(!peerConnection) setupPeerConnection(false);
    if(signal.type === 'offer') {
        if (peerConnection.connectionState !== 'connected') {
            document.getElementById('call-modal').style.display = 'block';
            document.getElementById('call-status-text').innerText = "Incoming Call...";
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        rtcChannel.send({ type: 'broadcast', event: 'signal', payload: { type: 'answer', sdp: answer } });
    }
    else if(signal.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        document.getElementById('call-status-text').innerText = "Connected";
    }
    else if(signal.type === 'candidate') {
        await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
    else if(signal.type === 'end') closeCall();
}

function startTimer() {
    document.getElementById('call-modal').style.display = 'none';
    document.getElementById('active-call-strip').style.display = 'flex';
    let sec = 0;
    callTimerInterval = setInterval(() => {
        sec++;
        const m = Math.floor(sec/60).toString().padStart(2,'0');
        const s = (sec%60).toString().padStart(2,'0');
        document.getElementById('call-timer').innerText = `${m}:${s}`;
    }, 1000);
}

function endCall() {
    rtcChannel.send({ type: 'broadcast', event: 'signal', payload: { type: 'end' } });
    closeCall();
}

function closeCall() {
    if(peerConnection) peerConnection.close();
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    if(callTimerInterval) clearInterval(callTimerInterval);
    document.getElementById('call-modal').style.display = 'none';
    document.getElementById('active-call-strip').style.display = 'none';
}

function handleMissed() {
    closeCall();
    alert("Call not answered.");
    supabase.from('missed_calls').insert([{ client_id: currentUser.id }]);
}

function toggleMute() {
    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
}

async function shareScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = stream.getVideoTracks()[0];
    screenTrack.onended = () => {
        const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
        if (sender) peerConnection.removeTrack(sender);
    };
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(screenTrack);
    else peerConnection.addTrack(screenTrack, localStream);
    
    // Renegotiate
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    rtcChannel.send({ type: 'broadcast', event: 'signal', payload: { type: 'offer', sdp: offer } });
}
