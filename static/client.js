
let localStream;
let peerConnection;
let socket;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startButton = document.getElementById('startButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');

startButton.addEventListener('click', startVideo);
callButton.addEventListener('click', callUser);
hangupButton.addEventListener('click', hangup);

socket = io();

socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('offer', async (data) => {
    if (!peerConnection) {
        createPeerConnection();
    }
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('answer', { sdp: answer });
});

socket.on('answer', async (data) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
});

socket.on('ice_candidate', async (data) => {
    if (data.candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
            console.error('Error adding ice candidate:', e);
        }
    }
});

async function startVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        startButton.disabled = true;
        callButton.disabled = false;
    } catch (e) {
        console.error('Error accessing media devices:', e);
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', { candidate: event.candidate });
        }
    };
    
    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };
    
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
}

async function callUser() {
    try {
        callButton.disabled = true;
        hangupButton.disabled = false;
        
        if (!peerConnection) {
            createPeerConnection();
        }
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('offer', { sdp: offer });
    } catch (e) {
        console.error('Error creating offer:', e);
    }
}

function hangup() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    
    startButton.disabled = false;
    callButton.disabled = true;
    hangupButton.disabled = true;
}

socket.on('user_disconnected', () => {
    hangup();
});
