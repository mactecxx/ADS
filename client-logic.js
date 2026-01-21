// --- 0. SAFETY CHECKS ---
if (typeof _CONFIG === 'undefined') {
    console.error("CRITICAL: config.js is missing.");
    alert("System Error: Configuration missing.");
}

// --- 1. GLOBAL UI FUNCTIONS ---
window.toggleSupportMenu = function() {
    const wrapper = document.getElementById('support-wrapper');
    if(wrapper) wrapper.classList.toggle('active');
};

window.openPanel = function() { 
    document.getElementById('cvd-panel').classList.add('panel-open'); 
};

window.closePanel = function() { 
    document.getElementById('cvd-panel').classList.remove('panel-open'); 
};

window.triggerAnimation = function(type) {
    window.openPanel();
    const wrapper = document.getElementById('support-wrapper');
    if(wrapper) wrapper.classList.remove('active');
    
    // If user is already logged in, jump to feature
    if (type === 'call' && window.currentUser) startCall();
};

window.triggerFileSelect = function() { document.getElementById('file-input').click(); };
window.closeFileModal = function() { document.getElementById('file-modal').style.display = 'none'; };

// --- 2. SUPABASE SETUP ---
const supabaseClient = window.supabase.createClient(_CONFIG.supabaseUrl, _CONFIG.supabaseKey);

// --- GLOBAL VARIABLES ---
window.currentUser = null;
let currentChatId = null;
let peerConnection = null;
let localStream = null;
let rtcChannel = null;
let callTimerInterval = null;
const rtcConfig = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302'] }] };

// --- 3. INITIALIZATION ---
window.addEventListener('load', async () => {
    // Check for existing session (Returning from Email Link)
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        handleSession(session.user);
    }

    // Auth Listener
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) handleSession(session.user);
    });

    // Close menu on outside click
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('support-wrapper');
        const btn = document.querySelector('.floating-support-btn');
        if (wrapper && wrapper.classList.contains('active') && !wrapper.contains(e.target) && !btn.contains(e.target)) {
            wrapper.classList.remove('active');
        }
    });
});

// --- 4. THE NEW "INSTANT VS VERIFY" LOGIC ---
window.handleChatLogin = async function() {
    const name = document.getElementById('chat-name').value;
    const email = document.getElementById('chat-email').value;
    const dob = document.getElementById('chat-dob').value;
    const btn = document.querySelector('#auth-view .cvd-btn');
    const status = document.getElementById('login-status');

    if (!name || !email) return alert("Name and Email are required.");

    // Lock Button
    btn.disabled = true;
    btn.innerText = "Connecting...";
    btn.style.opacity = "0.7";

    try {
        // STEP 1: Check if this user exists in our database
        // We use the SQL function 'check_email_exists' we just created
        const { data: exists, error: checkError } = await supabaseClient
            .rpc('check_email_exists', { email_check: email });

        if (checkError) throw checkError;

        if (exists) {
            // --- SCENARIO A: RETURNING USER (Send Link) ---
            status.innerText = "Account found. Sending verification link...";
            status.style.color = "blue";
            
            const { error: authError } = await supabaseClient.auth.signInWithOtp({
                email: email,
                options: {
                    emailRedirectTo: window.location.href, // Redirects to Netlify URL
                    data: { full_name: name, dob: dob }
                }
            });

            if (authError) throw authError;

            status.innerText = "Welcome back! Verification link sent to your email.";
            status.style.color = "green";
            btn.innerText = "Check Email ✉️";
            
        } else {
            // --- SCENARIO B: NEW USER (Instant Access) ---
            status.innerText = "Starting secure session...";
            
            // 1. Sign in Anonymously
            const { data: authData, error: anonError } = await supabaseClient.auth.signInAnonymously({
                options: {
                    data: { full_name: name, dob: dob, email_hint: email } // Save meta
                }
            });

            if (anonError) throw anonError;

            // 2. We are now logged in! handleSession will trigger automatically.
            // But we must manually save their email to the conversation so they become "Returning" next time.
            // This happens inside 'handleSession' logic below.
        }

    } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.innerText = "Start Conversation";
        btn.style.opacity = "1";
        
        if (err.message.includes("security purposes")) {
            status.innerText = "Please wait 60 seconds before trying again.";
        } else {
            status.innerText = "Error: " + err.message;
        }
        status.style.color = "red";
    }
};

// --- 5. SESSION HANDLER ---
async function handleSession(user) {
    window.currentUser = user;
    const emailInput = document.getElementById('chat-email').value;
    const nameInput = document.getElementById('chat-name').value;

    // Determine Email (From Input OR from User Metadata)
    const userEmail = user.email || user.user_metadata.email_hint || emailInput;
    const userName = user.user_metadata.full_name || nameInput || "Guest";

    // Find or Create Conversation
    // We try to find by User ID first
    let { data: conv } = await supabaseClient.from('conversations').select('*').eq('user_id', user.id).single();

    if (!conv) {
        // Create NEW Conversation
        const { data: newConv, error } = await supabaseClient.from('conversations').insert([{
            user_id: user.id,
            user_email: userEmail, // CRITICAL: This allows us to find them next time!
            user_name: userName,
            uid_display: Math.floor(100000 + Math.random() * 900000).toString(),
            status: 'queued'
        }]).select().single();
        
        if (error) console.error("Conv Creation Error", error);
        conv = newConv;
    }

    if (conv) {
        currentChatId = conv.id;
        showChatInterface();
        subscribeRealtime();
    }
}

function showChatInterface() {
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('chat-view').style.display = 'flex';
}

// --- 6. MESSAGING ---
function subscribeRealtime() {
    loadMessages();
    rtcChannel = supabaseClient.channel(`room:${currentChatId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${currentChatId}` }, 
        payload => renderMessage(payload.new))
        .on('broadcast', { event: 'signal' }, payload => handleWebRTCSignal(payload.payload))
        .subscribe();
}

async function loadMessages() {
    const { data } = await supabaseClient.from('messages').select('*').eq('conversation_id', currentChatId).order('created_at', { ascending: true });
    const area = document.getElementById('msgs-area');
    area.innerHTML = '';
    
    let lastDate = '';
    if (data) {
        data.forEach(msg => {
            const d = new Date(msg.created_at).toLocaleDateString();
            if(d !== lastDate) {
                area.innerHTML += `<div class="date-divider">${d}</div>`;
                lastDate = d;
            }
            renderMessage(msg);
        });
    }
}

function renderMessage(msg) {
    const area = document.getElementById('msgs-area');
    const isMe = msg.sender_id === window.currentUser.id;
    const time = new Date(msg.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    
    let content = msg.text || '';
    if (msg.file_url) content += `<br><u class="file-preview-link" style="cursor:pointer; color:blue" onclick="previewFile('${msg.file_url}', '${msg.file_type}')">📄 View Attachment</u>`;

    area.innerHTML += `
        <div class="msg ${isMe ? 'me' : 'agent'}">
            ${content}
            <span class="timestamp">${time}</span>
        </div>
    `;
    area.scrollTop = area.scrollHeight;
}

window.sendMsg = async function() {
    const input = document.getElementById('msg-input');
    const txt = input.value.trim();
    if (!txt) return;
    input.value = '';
    await supabaseClient.from('messages').insert([{ conversation_id: currentChatId, sender_id: window.currentUser.id, text: txt }]);
    await supabaseClient.from('conversations').update({ status: 'active', last_message_at: new Date() }).eq('id', currentChatId);
};

// --- 7. FILES & WEBRTC (Standard Logic) ---
window.uploadFile = async function(input) {
    const file = input.files[0];
    if(!file) return;
    const path = `${window.currentUser.id}/${Date.now()}_${file.name}`;
    const { data, error } = await supabaseClient.storage.from('chat-files').upload(path, file);
    if(!error) {
        await supabaseClient.from('messages').insert([{
            conversation_id: currentChatId, sender_id: window.currentUser.id, text: '', file_url: data.path, file_type: file.type
        }]);
    } else { alert("Upload Failed"); }
};

window.previewFile = async function(path, type) {
    const { data } = await supabaseClient.storage.from('chat-files').createSignedUrl(path, 60);
    document.getElementById('file-modal').style.display = 'flex';
    document.getElementById('file-modal-content').innerHTML = type && type.includes('image') ? 
        `<img src="${data.signedUrl}" style="max-width:100%; max-height:100%">` : `<iframe src="${data.signedUrl}" style="width:100%; height:100%"></iframe>`;
};

// --- WEBRTC CORE ---
window.startCall = async function() {
    document.getElementById('call-modal').style.display = 'block';
    setupPeerConnection(true);
};

window.toggleMute = function() {
    if(localStream) {
        const track = localStream.getAudioTracks()[0];
        track.enabled = !track.enabled;
    }
};

window.endCall = function() {
    sendSignal({ type: 'end' });
    closeCall();
};

window.shareScreen = async function() {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = stream.getVideoTracks()[0];
        screenTrack.onended = () => {
            const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
            if(sender) sender.replaceTrack(localStream.getVideoTracks()[0] || null);
        };
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
        else peerConnection.addTrack(screenTrack, localStream);
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal({ type: 'offer', sdp: offer });
    } catch(e) { console.error("Screen share cancelled", e); }
};

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
        sendSignal({ type: 'answer', sdp: answer });
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

function sendSignal(payload) {
    if(rtcChannel) rtcChannel.send({ type: 'broadcast', event: 'signal', payload });
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
    supabaseClient.from('missed_calls').insert([{ client_id: window.currentUser.id }]);
}
