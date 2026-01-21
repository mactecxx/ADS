// --- 1. CONFIGURATION ---
const SUPABASE_URL = "https://botuspjtaqkqibyqkacd.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvdHVzcGp0YXFrcWlieXFrYWNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NjIyODYsImV4cCI6MjA4NDUzODI4Nn0.CpWLFp1rS_lZz3KtoD1ctcJA29KQ21NOce-g2-6Vt68";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- GLOBAL VARS ---
let currentUser = null;
let currentChatId = null;
let peerConnection = null;
let localStream = null;
let rtcChannel = null;
let callTimer = null;
const rtcConfig = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302'] }] };

// --- 2. INITIALIZATION ---
window.addEventListener('load', async () => {
    // Check for Magic Link Session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        handleSession(session.user);
    }

    // Listen for Auth Changes
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) handleSession(session.user);
    });
});

async function handleSession(user) {
    currentUser = user;
    
    // Find or Create Conversation
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

    // Switch View to Chat
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('chat-view').style.display = 'flex';
    document.getElementById('cvd-panel').classList.add('panel-open');
    
    subscribeRealtime();
}

// --- 3. LOGIN (MAGIC LINK) ---
async function handleChatLogin() {
    const name = document.getElementById('chat-name').value;
    const email = document.getElementById('chat-email').value;
    const dob = document.getElementById('chat-dob').value;

    if (!name || !email) return alert("Name and Email are required.");

    const statusDiv = document.getElementById('login-status');
    statusDiv.innerText = "Sending verification link...";
    statusDiv.style.color = "blue";

    const { error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
            emailRedirectTo: window.location.href,
            data: { full_name: name, dob: dob }
        }
    });

    if (error) {
        statusDiv.innerText = "Error: " + error.message;
        statusDiv.style.color = "red";
    } else {
        statusDiv.innerText = "Check your email for the login link!";
        statusDiv.style.color = "green";
    }
}

// --- 4. MESSAGING (REALTIME) ---
function subscribeRealtime() {
    loadMessages();

    // Channel for Chat & Calls
    rtcChannel = supabase.channel(`room:${currentChatId}`)
        .on('postgres_changes', { 
            event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${currentChatId}` 
        }, payload => {
            renderMessage(payload.new);
        })
        .on('broadcast', { event: 'signal' }, payload => {
            handleWebRTCSignal(payload.payload);
        })
        .subscribe();
}

async function loadMessages() {
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', currentChatId).order('created_at');
    const area = document.getElementById('msgs-area');
    area.innerHTML = '';
    
    let lastDate = '';
    data.forEach(msg => {
        const d = new Date(msg.created_at).toLocaleDateString();
        if(d !== lastDate) {
            area.innerHTML += `<div class="date-divider">${d}</div>`;
            lastDate = d;
        }
        renderMessage(msg);
    });
}

function renderMessage(msg) {
    const area = document.getElementById('msgs-area');
    const isMe = msg.sender_id === currentUser.id;
    const time = new Date(msg.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    
    let content = msg.text || '';
    if (msg.file_url) {
        content += `<br><u style="cursor:pointer; color:blue;" onclick="previewFile('${msg.file_url}', '${msg.file_type}')">📄 View Attachment</u>`;
    }

    area.innerHTML += `
        <div class="msg ${isMe ? 'me' : 'agent'}">
            ${content}
            <span class="timestamp">${time}</span>
        </div>
    `;
    area.scrollTop = area.scrollHeight;
}

async function sendMsg() {
    const inp = document.getElementById('msg-input');
    const txt = inp.value.trim();
    if (!txt) return;
    
    inp.value = '';
    await supabase.from('messages').insert([{
        conversation_id: currentChatId,
        sender_id: currentUser.id,
        text: txt
    }]);
    
    await supabase.from('conversations').update({ 
        status: 'active', last_message_at: new Date() 
    }).eq('id', currentChatId);
}

// --- 5. FILE UPLOAD ---
async function uploadFile(input) {
    const file = input.files[0];
    if(!file) return;

    // Upload to 'chat-files' bucket
    const path = `${currentUser.id}/${Date.now()}_${file.name}`;
    const { data, error } = await supabase.storage.from('chat-files').upload(path, file);

    if(!error) {
        await supabase.from('messages').insert([{
            conversation_id: currentChatId,
            sender_id: currentUser.id,
            text: '',
            file_url: data.path,
            file_type: file.type
        }]);
    } else {
        alert("Upload failed. Check console.");
        console.error(error);
    }
}

window.previewFile = async function(path, type) {
    // Get Secure Signed URL
    const { data } = await supabase.storage.from('chat-files').createSignedUrl(path, 60);
    const overlay = document.getElementById('file-modal');
    const content = document.getElementById('file-content');
    overlay.style.display = 'flex';
    
    if(type.startsWith('image')) content.innerHTML = `<img src="${data.signedUrl}">`;
    else content.innerHTML = `<iframe src="${data.signedUrl}"></iframe>`;
}

// --- 6. WEBRTC CALLING ---
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
        if(e.candidate) sendSignal({ type: 'candidate', candidate: e.candidate });
    };

    if(isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal({ type: 'offer', sdp: offer });
        
        setTimeout(() => {
            if(peerConnection.connectionState !== 'connected') handleMissed();
        }, 90000); // 1.30 min timeout
    }
}

async function handleWebRTCSignal(signal) {
    if(!peerConnection) setupPeerConnection(false);

    if(signal.type === 'offer') {
        // Prevent popup if already active
        if (peerConnection.connectionState !== 'connected' && peerConnection.connectionState !== 'connecting') {
            document.getElementById('call-modal').style.display = 'block';
            document.getElementById('call-status-text').innerText = "Incoming Call...";
        }
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendSignal({ type: 'answer', sdp: answer });
    }
    else if(signal.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        document.getElementById('call-status-text').innerText = "Connected";
    }
    else if(signal.type === 'candidate') {
        await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
    else if(signal.type === 'end') {
        closeCall();
    }
}

function sendSignal(payload) {
    rtcChannel.send({ type: 'broadcast', event: 'signal', payload });
}

// --- 7. CALL UTILS (TIMER, SCREEN, MUTE) ---
function startTimer() {
    document.getElementById('call-modal').style.display = 'none';
    document.getElementById('active-call-strip').style.display = 'flex';
    let sec = 0;
    callTimer = setInterval(() => {
        sec++;
        const m = Math.floor(sec/60).toString().padStart(2,'0');
        const s = (sec%60).toString().padStart(2,'0');
        document.getElementById('call-timer').innerText = `${m}:${s}`;
    }, 1000);
}

function endCall() {
    sendSignal({ type: 'end' });
    closeCall();
}

function closeCall() {
    if(peerConnection) peerConnection.close();
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    if(callTimer) clearInterval(callTimer);
    document.getElementById('call-modal').style.display = 'none';
    document.getElementById('active-call-strip').style.display = 'none';
}

function handleMissed() {
    closeCall();
    alert("Call not answered. Please leave a message.");
    supabase.from('missed_calls').insert([{ client_id: currentUser.id }]);
}

function toggleMute() {
    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
}

async function shareScreen() {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = stream.getVideoTracks()[0];

        screenTrack.onended = () => stopScreenShare();

        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(screenTrack);
        } else {
            peerConnection.addTrack(screenTrack, localStream);
            // Renegotiate
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            sendSignal({ type: 'offer', sdp: offer });
        }
    } catch(e) { console.error("Screen share cancelled", e); }
}

function stopScreenShare() {
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
        peerConnection.removeTrack(sender);
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => sendSignal({ type: 'offer', sdp: peerConnection.localDescription }));
    }
}
