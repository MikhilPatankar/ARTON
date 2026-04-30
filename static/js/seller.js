// Removed redundant socket declaration
const video = document.getElementById("localVideo");

// Start camera
window.startCamera = async function () {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert("Camera access is blocked! Mobile browsers require an HTTPS connection (e.g. via ngrok) or 'localhost' to use the camera.");
            return;
        }

        const btn = document.getElementById("startStreamBtn");
        if (btn) btn.innerText = "Starting Camera...";

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });

        video.srcObject = stream;
        window.localStream = stream;

        socket.emit("join", { role: "seller" });

        // Update UI to show LIVE status and hide button
        document.getElementById("actionBar").style.display = "none";
        document.getElementById("snapBar").style.display = "block";
        document.getElementById("streamStatus").style.display = "block";
        document.getElementById("connectedBuyers").style.display = "block";

    } catch (err) {
        alert("Camera error: " + err.message);
        const btn = document.getElementById("startStreamBtn");
        if (btn) btn.innerText = "📡 Start Streaming";
    }
};

// Track connected buyers dynamically securely
const activeBuyers = new Set();
const buyersListEl = document.getElementById("buyersList");

function renderBuyers() {
    if (!buyersListEl) return;
    buyersListEl.innerHTML = "";
    if (activeBuyers.size === 0) {
        buyersListEl.innerHTML = "<li style='color: #64748b; font-size: 13px; font-style: italic;'>Waiting for buyers...</li>";
    } else {
        for (const buyerId of activeBuyers) {
            const li = document.createElement("li");
            li.style.background = "rgba(59, 130, 246, 0.1)";
            li.style.border = "1px solid rgba(59, 130, 246, 0.2)";
            li.style.padding = "10px 14px";
            li.style.borderRadius = "8px";
            li.style.fontSize = "13px";
            li.style.color = "#e2e8f0";
            li.style.display = "flex";
            li.style.alignItems = "center";
            li.style.gap = "8px";
            li.innerHTML = `<span style="display:inline-block; width:8px; height:8px; background:#34d399; border-radius:50%; box-shadow: 0 0 5px #34d399;"></span> Buyer <b>${buyerId.substring(0,5).toUpperCase()}</b> connected`;
            buyersListEl.appendChild(li);
        }
    }
}

// When a buyer actively initiates an AR session
socket.on("offer", data => {
    if (!activeBuyers.has(data.from)) {
        activeBuyers.add(data.from);
        renderBuyers();
    }
});

// When ANY socket connects or disconnects (handles buyer dropouts automatically)
socket.on("clients", list => {
    const currentClients = new Set(list.map(c => c.id));
    let changed = false;
    
    // Remove buyers that dropped connection
    for (const buyerId of activeBuyers) {
        if (!currentClients.has(buyerId)) {
            activeBuyers.delete(buyerId);
            changed = true;
        }
    }
    
    if (changed) renderBuyers();
});

// ==========================================
// Garment Snap & Extract Logic
// ==========================================
window.snappedBlob = null;
window.extractedGarmentB64 = null;

window.snapGarment = function() {
    const video = document.getElementById("localVideo");
    if(!video || video.readyState < 2) {
        alert("Video stream not ready!");
        return;
    }
    
    // Create canvas to grab the current frame
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to JPG blob
    canvas.toBlob(blob => {
        window.snappedBlob = blob;
        const url = URL.createObjectURL(blob);
        document.getElementById("snapPreview").src = url;
        
        // Reset modal state
        document.getElementById("extractResult").style.display = "none";
        document.getElementById("extractLoading").style.display = "none";
        document.getElementById("extractBtn").style.display = "inline-block";
        
        // Show modal
        document.getElementById("extractModal").style.display = "flex";
    }, "image/jpeg", 0.9);
};

window.closeSnapModal = function() {
    document.getElementById("extractModal").style.display = "none";
};

window.processExtraction = async function() {
    if (!window.snappedBlob) return;
    
    document.getElementById("extractLoading").style.display = "block";
    document.getElementById("extractBtn").style.display = "none";
    
    const part = document.querySelector('input[name="gPart"]:checked').value;
    
    // Using multipart/form-data to send image file + part
    const formData = new FormData();
    formData.append("image", window.snappedBlob, "snap.jpg");
    formData.append("part", part);
    
    try {
        const res = await fetch("/extract", {
            method: "POST",
            body: formData
        });
        
        if (!res.ok) throw new Error("Server returned " + res.status);
        
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        window.extractedGarmentB64 = data.garment_b64;
        document.getElementById("extractedGarmentPreview").src = "data:image/png;base64," + data.garment_b64;
        
        document.getElementById("extractLoading").style.display = "none";
        document.getElementById("extractResult").style.display = "block";
    } catch(err) {
        alert("Extraction failed: " + err.message);
        document.getElementById("extractLoading").style.display = "none";
        document.getElementById("extractBtn").style.display = "inline-block";
    }
};

window.sendToBuyers = function() {
    if (!window.extractedGarmentB64) return;
    
    const part = document.querySelector('input[name="gPart"]:checked').value;
    
    // Emit the new extracted garment to all connected buyers
    socket.emit("garment_snapshot", {
        image: window.extractedGarmentB64,
        part: part
    });
    
    alert("Garment snapshot sent to all active buyers!");
    closeSnapModal();
};