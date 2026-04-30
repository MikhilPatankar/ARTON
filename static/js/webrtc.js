// Uses global socket from HTML
const socket = window.socket;

let pc = null;
let iceQueue = []; 
let isRemoteSet = false; // Explicit lock for setRemoteDescription

async function flushIceQueue() {
    while (iceQueue.length > 0) {
        const candidate = iceQueue.shift();
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error("ICE Queue error:", e);
        }
    }
}

// Create peer connection
async function createPeerConnection(targetId, localStream, onTrack) {
    isRemoteSet = false;
    pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    pc.ontrack = event => {
        if (onTrack) onTrack(event.streams[0]);
    };

    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit("ice", {
                target: targetId,
                candidate: event.candidate
            });
        }
    };

    return pc;
}

// Call a user
async function callUser(targetId, localStream, onTrack) {
    iceQueue = []; // Clear queue on outbound call
    await createPeerConnection(targetId, localStream, onTrack);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("offer", {
        target: targetId,
        offer: offer
    });
}

// Receive offer
socket.on("offer", async data => {
    iceQueue = []; // Clear queue on inbound call
    await createPeerConnection(data.from, window.localStream, window.onTrack);

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    isRemoteSet = true; // Lock opened!
    await flushIceQueue(); 

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("answer", {
        target: data.from,
        answer: answer
    });
});

// Receive answer
socket.on("answer", async data => {
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        isRemoteSet = true; // Lock opened!
        await flushIceQueue();
    }
});

// Receive ICE
socket.on("ice", async data => {
    if (data.candidate) {
        try {
            // Buffer ALL candidates arriving before the async remote description promise fully resolves
            if (pc && isRemoteSet) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
                iceQueue.push(data.candidate);
            }
        } catch (e) {
            console.error("ICE error:", e);
        }
    }
});

window.callUser = callUser;