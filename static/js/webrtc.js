const socket = window.socket;

let pc = null;
let iceQueue = []; 
let isRemoteSet = false;

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

async function callUser(targetId, localStream, onTrack) {
    iceQueue = [];
    await createPeerConnection(targetId, localStream, onTrack);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("offer", {
        target: targetId,
        offer: offer
    });
}

socket.on("offer", async data => {
    iceQueue = [];
    await createPeerConnection(data.from, window.localStream, window.onTrack);

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    isRemoteSet = true;
    await flushIceQueue(); 

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("answer", {
        target: data.from,
        answer: answer
    });
});

socket.on("answer", async data => {
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        isRemoteSet = true;
        await flushIceQueue();
    }
});

socket.on("ice", async data => {
    if (data.candidate) {
        try {
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