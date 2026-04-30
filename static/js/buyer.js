// ==========================================
// MODE SYSTEM — Mutual exclusion for different features
// Modes: 'idle' | 'face-swap' | 'garment' | 'size-estimation'
// ALL MediaPipe now uses @mediapipe/tasks-vision (unified WASM)
// ==========================================
import {
    FaceLandmarker,
    PoseLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

let currentMode = 'idle';

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const clientsDiv = document.getElementById("clients");

window.tryOn = false;
window.buyerLandmarks = null;
window.sellerLandmarks = null;
window.useHeadMask = false;
window.segMaskCanvas = null;
window.buyerPoseLandmarks = null;

// ==========================================
// UNIFIED WASM RUNTIME — shared by all Tasks Vision models
// ==========================================
let visionWasm = null;

async function getVisionWasm() {
    if (!visionWasm) {
        console.log("🔧 Loading Tasks Vision WASM runtime...");
        visionWasm = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
        );
        console.log("✅ WASM runtime ready");
    }
    return visionWasm;
}

// ==========================================
// FACELANDMARKER — replaces legacy @mediapipe/face_mesh
// Both buyer + seller face detection in one instance
// ==========================================
let faceLandmarker = null;
let faceLandmarkerLoading = false;
let faceLoopRunning = false;
let faceSellerLoopRunning = false;
let faceLastVideoTime = -1;
let faceSellerLastVideoTime = -1;

async function initFaceLandmarker() {
    if (faceLandmarker || faceLandmarkerLoading) return;
    faceLandmarkerLoading = true;

    try {
        const vision = await getVisionWasm();
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numFaces: 1,
            minFaceDetectionConfidence: 0.3,
            minFacePresenceConfidence: 0.3,
            minTrackingConfidence: 0.5,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false
        });
        console.log("🎭 FaceLandmarker loaded successfully");
    } catch (e) {
        console.error("Failed to load FaceLandmarker:", e);
    } finally {
        faceLandmarkerLoading = false;
    }
}

// Detect buyer face from localVideo
function faceLoop() {
    if (!faceLoopRunning || currentMode !== 'face-swap') return;

    if (localVideo.readyState >= 2 && faceLandmarker) {
        if (faceLastVideoTime !== localVideo.currentTime) {
            faceLastVideoTime = localVideo.currentTime;
            try {
                const results = faceLandmarker.detectForVideo(localVideo, performance.now());
                if (results.faceLandmarks && results.faceLandmarks.length > 0) {
                    window.buyerLandmarks = results.faceLandmarks[0];
                } else {
                    window.buyerLandmarks = null;
                }
            } catch (e) { /* ignore detection errors during shutdown */ }
        }
    }

    if (faceLoopRunning) requestAnimationFrame(faceLoop);
}

// Detect seller face from remoteVideo (separate instance to avoid mode conflicts)
let faceLandmarkerSeller = null;

async function initFaceLandmarkerSeller() {
    if (faceLandmarkerSeller) return;

    try {
        const vision = await getVisionWasm();
        faceLandmarkerSeller = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numFaces: 1,
            minFaceDetectionConfidence: 0.3,
            minFacePresenceConfidence: 0.3,
            minTrackingConfidence: 0.5,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false
        });
        console.log("🎭 FaceLandmarker (Seller) loaded");
    } catch (e) {
        console.error("Failed to load seller FaceLandmarker:", e);
    }
}

function faceSellerLoop() {
    if (!faceSellerLoopRunning || currentMode !== 'face-swap') return;

    if (remoteVideo.readyState >= 2 && window.tryOn && faceLandmarkerSeller) {
        if (faceSellerLastVideoTime !== remoteVideo.currentTime) {
            faceSellerLastVideoTime = remoteVideo.currentTime;
            try {
                const results = faceLandmarkerSeller.detectForVideo(remoteVideo, performance.now());
                if (results.faceLandmarks && results.faceLandmarks.length > 0) {
                    window.sellerLandmarks = results.faceLandmarks[0];
                } else {
                    window.sellerLandmarks = null;
                }
            } catch (e) { /* ignore */ }
        }
    }

    if (faceSellerLoopRunning) requestAnimationFrame(faceSellerLoop);
}

async function startFaceLoops() {
    await initFaceLandmarker();
    await initFaceLandmarkerSeller();
    
    if (!faceLoopRunning) {
        faceLoopRunning = true;
        faceLoop();
    }
    if (!faceSellerLoopRunning) {
        faceSellerLoopRunning = true;
        faceSellerLoop();
    }
}

function stopFaceLoops() {
    faceLoopRunning = false;
    faceSellerLoopRunning = false;
    window.buyerLandmarks = null;
    window.sellerLandmarks = null;
}

// ==========================================
// SELFIE SEGMENTATION (Full Head Mask)
// Using legacy @mediapipe/selfie_segmentation (separate WASM, no conflict)
// ==========================================
let selfieSegmentation = null;
let segRunning = false;

function createSelfieSegmentation() {
    if (selfieSegmentation) return;
    selfieSegmentation = new SelfieSegmentation({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
    });
    selfieSegmentation.setOptions({ modelSelection: 1 });
    selfieSegmentation.onResults((results) => {
        if (!results.segmentationMask) return;
        const maskCanvas = document.getElementById("segMaskCanvas");
        if (!maskCanvas) return;
        maskCanvas.width = results.segmentationMask.width;
        maskCanvas.height = results.segmentationMask.height;
        const maskCtx = maskCanvas.getContext("2d");
        maskCtx.drawImage(results.segmentationMask, 0, 0);
        window.segMaskCanvas = maskCanvas;
    });
}

async function segLoop() {
    if (!segRunning) return;
    if (window.useHeadMask && localVideo.readyState >= 2 && selfieSegmentation) {
        try {
            await selfieSegmentation.send({ image: localVideo });
        } catch (e) { /* ignore */ }
    }
    if (segRunning) requestAnimationFrame(segLoop);
}

function startSegLoop() {
    createSelfieSegmentation();
    if (!segRunning) {
        segRunning = true;
        segLoop();
    }
}

function stopSegLoop() {
    segRunning = false;
    window.segMaskCanvas = null;
}

// ==========================================
// POSELANDMARKER — for size estimation
// ==========================================
let poseLandmarker = null;
let poseLandmarkerLoading = false;

async function initPoseLandmarker() {
    if (poseLandmarker || poseLandmarkerLoading) return;
    poseLandmarkerLoading = true;

    try {
        console.log("📐 Loading PoseLandmarker...");
        const vision = await getVisionWasm();
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.7,
            minTrackingConfidence: 0.7
        });
        console.log("✅ PoseLandmarker loaded successfully");

        // Auto-start if user already clicked "Scan My Body" while loading
        if (isEstimatingSize && currentMode === 'size-estimation') {
            estimatorStatus.innerText = "⏳ Detecting pose...";
            estimatorStatus.style.color = "#fbbf24";
            document.getElementById("startEstimatorBtn").innerText = "Tracking...";
            cancelAnimationFrame(poseRafId);
            poseRafId = requestAnimationFrame(poseLoop);
        }
    } catch (e) {
        console.error("Failed to load PoseLandmarker:", e);
        estimatorStatus.innerText = "❌ Failed to load AI model";
        estimatorStatus.style.color = "#f87171";
    } finally {
        poseLandmarkerLoading = false;
    }
}

// ==========================================
// MODE SWITCHING
// ==========================================
function switchMode(newMode) {
    if (currentMode === newMode) return;
    console.log(`🔀 Mode switch: ${currentMode} → ${newMode}`);

    // Tear down current mode
    switch (currentMode) {
        case 'face-swap':
            stopFaceLoops();
            stopSegLoop();
            break;
        case 'garment':
            stopBuyerPoseSender();
            break;
        case 'size-estimation':
            isEstimatingSize = false;
            cancelAnimationFrame(poseRafId);
            poseRafId = null;
            break;
    }

    currentMode = newMode;

    // Set up new mode
    switch (newMode) {
        case 'face-swap':
            startFaceLoops();
            startSegLoop();
            break;
        case 'garment':
            startBuyerPoseSender();
            break;
        case 'size-estimation':
            // PoseLandmarker init handled by the button click
            break;
    }
}

// ==========================================
// CAMERA START
// ==========================================
socket.emit("join", { role: "buyer" });

window.startCamera = async function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Camera access is blocked! Mobile browsers require HTTPS or localhost.");
        throw new Error("Secure Context Required");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false
    });

    localVideo.srcObject = stream;
    window.localStream = stream;

    window.onTrack = stream => {
        remoteVideo.srcObject = stream;
    };

    // Default to face-swap mode
    switchMode('face-swap');
};

// ==========================================
// SELLERS LIST
// ==========================================
let callingInProgress = false;

socket.on("clients", list => {
    if (callingInProgress) return;

    clientsDiv.innerHTML = "";
    let hasSellers = false;

    list.forEach(client => {
        if (client.role === "seller") {
            hasSellers = true;
            const btn = document.createElement("button");
            btn.innerText = `🎥 Connect to Seller (${client.id.substring(0, 4)})`;

            btn.onclick = async () => {
                callingInProgress = true;

                if (!window.localStream) {
                    btn.innerText = "Starting Camera...";
                    try {
                        await startCamera();
                    } catch (e) {
                        btn.innerText = `🎥 Connect to Seller (${client.id.substring(0, 4)})`;
                        callingInProgress = false;
                        return;
                    }
                }

                btn.innerText = "Calling...";
                callUser(client.id, window.localStream, stream => {
                    window.remoteStream = stream;
                    remoteVideo.srcObject = stream;
                    remoteVideo.play().catch(e => console.warn("Video play blocked:", e));

                    const clientsUI = document.getElementById("clients");
                    const mainUI = document.getElementById("mainView");
                    const canvasUI = document.getElementById("canvas");
                    const estimatorUI = document.getElementById("sizeEstimatorContainer");

                    if (clientsUI) clientsUI.style.display = "none";
                    if (mainUI) mainUI.style.display = "block";
                    if (canvasUI) canvasUI.classList.add("active");
                    if (estimatorUI) estimatorUI.style.display = "flex";

                    window.tryOn = true;
                    callingInProgress = false;

                    switchMode('face-swap');
                    renderLoop();
                });
            };

            clientsDiv.appendChild(btn);
        }
    });

    if (!hasSellers) {
        clientsDiv.innerHTML = "<p style='color: var(--text-secondary);'>No sellers available yet. Waiting for a seller to stream...</p>";
    }
});

// ==========================================
// FACE-SWAP TOGGLE
// ==========================================
const tryOnToggle = document.getElementById("tryOnToggle");
if (tryOnToggle) {
    tryOnToggle.onclick = () => {
        window.tryOn = !window.tryOn;
        tryOnToggle.innerText = window.tryOn ? "✨ Try-On ON" : "❌ Try-On OFF";
        tryOnToggle.classList.toggle("btn-tryon", window.tryOn);

        if (window.tryOn && currentMode !== 'face-swap') {
            switchMode('face-swap');
        }
    };
}

const headMaskToggle = document.getElementById("headMaskToggle");
if (headMaskToggle) {
    headMaskToggle.onclick = () => {
        window.useHeadMask = !window.useHeadMask;
        headMaskToggle.innerText = window.useHeadMask ? "💇 Full Head: ON" : "💇 Full Head: OFF";
        headMaskToggle.style.background = window.useHeadMask ? "rgba(139,92,246,0.5)" : "rgba(30,41,59,0.75)";
    };
}

// ==========================================
// VIEW SWAPPING
// ==========================================
function swapViews(garmentActive) {
    const overlayActions = document.getElementById("overlayActions");
    const canvas = document.getElementById("canvas");

    if (garmentActive) {
        if (overlayActions) overlayActions.style.display = "none";
        if (window.localStream) remoteVideo.srcObject = window.localStream;
        if (window.remoteStream) localVideo.srcObject = window.remoteStream;
        remoteVideo.style.transform = "scaleX(-1)";
        if (canvas) canvas.style.transform = "scaleX(-1)";
        localVideo.style.transform = "none";
    } else {
        if (overlayActions) overlayActions.style.display = "flex";
        if (window.remoteStream) remoteVideo.srcObject = window.remoteStream;
        if (window.localStream) localVideo.srcObject = window.localStream;
        remoteVideo.style.transform = "none";
        if (canvas) canvas.style.transform = "none";
        localVideo.style.transform = "scaleX(-1)";
    }

    remoteVideo.play().catch(e => console.log("Video play request failed:", e));
    localVideo.play().catch(e => console.log("Video play request failed:", e));
}

// ==========================================
// GARMENT RECEIVE & GALLERY
// ==========================================
window.availableGarments = [];
window.activeGarment = null;

socket.on("garment_snapshot", (data) => {
    console.log("👗 Garment received from seller!");
    const { image, part, landmarks } = data;

    const img = new Image();
    img.src = "data:image/png;base64," + image;

    img.onload = () => {
        const garment = {
            id: Date.now(),
            image: img,
            part: part,
            landmarks: landmarks
        };

        if (landmarks) {
            console.log("✅ Garment pose landmarks:", landmarks.length, "points");
        } else {
            console.warn("⚠️ No pose landmarks for this garment.");
        }

        window.availableGarments.push(garment);
        renderGarmentGallery();
    };
});

function renderGarmentGallery() {
    const list = document.getElementById("garmentList");
    const container = document.getElementById("garmentGallery");
    if (!list || !container) return;

    container.style.display = "block";
    list.innerHTML = "";

    const clearBtn = document.createElement("div");
    clearBtn.className = "garment-thumb" + (!window.activeGarment ? " active" : "");
    clearBtn.style.display = "flex";
    clearBtn.style.alignItems = "center";
    clearBtn.style.justifyContent = "center";
    clearBtn.style.fontSize = "28px";
    clearBtn.innerHTML = "🚫";
    clearBtn.onclick = () => {
        window.activeGarment = null;
        switchMode('face-swap');
        swapViews(false);
        renderGarmentGallery();
    };
    list.appendChild(clearBtn);

    window.availableGarments.forEach(g => {
        const thumb = document.createElement("img");
        thumb.src = g.image.src;
        thumb.className = "garment-thumb" + (window.activeGarment && window.activeGarment.id === g.id ? " active" : "");

        thumb.onclick = () => {
            window.activeGarment = g;
            swapViews(true);
            switchMode('garment');
            renderGarmentGallery();
        };

        list.appendChild(thumb);
    });
}

// ==========================================
// BUYER POSE FRAME SENDER (Garment mode — server-side)
// ==========================================
let buyerPoseSendInterval = null;
const BUYER_POSE_FPS = 8;

function startBuyerPoseSender() {
    if (buyerPoseSendInterval) return;

    const captureCanvas = document.createElement("canvas");
    const captureCtx = captureCanvas.getContext("2d");

    buyerPoseSendInterval = setInterval(() => {
        const buyerView = window.activeGarment ? remoteVideo : localVideo;
        if (buyerView.readyState < 2) return;

        const scale = 0.35;
        captureCanvas.width = (buyerView.videoWidth || 640) * scale;
        captureCanvas.height = (buyerView.videoHeight || 480) * scale;
        captureCtx.drawImage(buyerView, 0, 0, captureCanvas.width, captureCanvas.height);

        const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.5);
        const b64 = dataUrl.split(",")[1];
        socket.emit("buyer_frame", { image: b64 });
    }, 1000 / BUYER_POSE_FPS);
}

function stopBuyerPoseSender() {
    if (buyerPoseSendInterval) {
        clearInterval(buyerPoseSendInterval);
        buyerPoseSendInterval = null;
    }
}

socket.on("buyer_pose", (data) => {
    if (data.landmarks) {
        window.buyerPoseLandmarks = data.landmarks;
    }
});

// ==========================================
// RENDER LOOP
// ==========================================
function renderLoop() {
    const canvas = document.getElementById("canvas");

    function loop() {
        if (remoteVideo.readyState >= 2) {
            if (window.activeGarment && currentMode === 'garment') {
                const ctx = canvas.getContext("2d");
                canvas.width = remoteVideo.videoWidth || 640;
                canvas.height = remoteVideo.videoHeight || 480;
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                if (window.buyerPoseLandmarks && window.renderGarment) {
                    window.renderGarment(canvas, remoteVideo, window.buyerPoseLandmarks, window.activeGarment);
                }
            } else if (currentMode === 'face-swap') {
                render(canvas, remoteVideo, localVideo);
            }
        }
        requestAnimationFrame(loop);
    }
    loop();
}

// ==========================================
// SIZE ESTIMATOR — Measurement helpers
// ==========================================
let isEstimatingSize = false;
let poseRafId = null;
let lastVideoTime = -1;

const skeletonCanvas = document.getElementById("skeletonCanvas");
const skelCtx = skeletonCanvas.getContext("2d");
const estimatorStatus = document.getElementById("estimatorStatus");

const SAMPLE_COUNT = 10;
let sampleBuffer = [];

function dist3D(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function mid3D(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function ellipseCircumference(a, b) {
    const h = Math.pow(a - b, 2) / Math.pow(a + b, 2);
    return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

function extractWorldMeasurements(wlm, poseLm) {
    const torsoM = dist3D(mid3D(wlm[11], wlm[12]), mid3D(wlm[23], wlm[24]));

    const leftArmM = dist3D(wlm[11], wlm[13]) + dist3D(wlm[13], wlm[15]);
    const rightArmM = dist3D(wlm[12], wlm[14]) + dist3D(wlm[14], wlm[16]);
    const armsM = (leftArmM + rightArmM) / 2;

    const heelVis = poseLm ? (poseLm[29].visibility + poseLm[30].visibility) / 2 : 0;
    let skeletalHeightM;
    if (heelVis > 0.3) {
        skeletalHeightM = dist3D(wlm[0], mid3D(wlm[29], wlm[30]));
    } else {
        skeletalHeightM = torsoM * 3.1;
    }

    return { shoulderM, torsoM, hipM, armsM, skeletalHeightM };
}

function computeFinalMeasurements(samples, userHeightCm) {
    const avg = { shoulderM: 0, torsoM: 0, hipM: 0, armsM: 0, skeletalHeightM: 0 };

    for (const s of samples) {
        avg.shoulderM += s.shoulderM;
        avg.torsoM += s.torsoM;
        avg.hipM += s.hipM;
        avg.armsM += s.armsM;
        avg.skeletalHeightM += s.skeletalHeightM;
    }
    const n = samples.length;
    avg.shoulderM /= n;
    avg.torsoM /= n;
    avg.hipM /= n;
    avg.armsM /= n;
    avg.skeletalHeightM /= n;

    const userHeightM = userHeightCm / 100;
    const scaleMultiplier = userHeightM / avg.skeletalHeightM;

    const shoulderCm = parseFloat((avg.shoulderM * scaleMultiplier * 100).toFixed(1));
    const torsoCm = parseFloat((avg.torsoM * scaleMultiplier * 100).toFixed(1));
    const armsCm = parseFloat((avg.armsM * scaleMultiplier * 100).toFixed(1));

    return { shoulderCm, torsoCm, chestCm, waistCm, armsCm };
}

function mapSize(chestCm, userHeightCm) {
    const sizeMap = { "XS": 0, "S": 1, "M": 2, "L": 3, "XL": 4, "2XL": 5, "3XL": 6, "4XL": 7, "5XL": 8 };
    const revMap = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

    let widthSize = "5XL";
    if (chestCm <= 84) widthSize = "XS";
    else if (chestCm <= 94) widthSize = "S";
    else if (chestCm <= 104) widthSize = "M";
    else if (chestCm <= 114) widthSize = "L";
    else if (chestCm <= 124) widthSize = "XL";
    else if (chestCm <= 135) widthSize = "2XL";
    else if (chestCm <= 145) widthSize = "3XL";
    else if (chestCm <= 155) widthSize = "4XL";

    let lengthSize = "5XL";
    if (userHeightCm <= 165) lengthSize = "XS";
    else if (userHeightCm <= 170) lengthSize = "S";
    else if (userHeightCm <= 178) lengthSize = "M";
    else if (userHeightCm <= 185) lengthSize = "L";
    else if (userHeightCm <= 190) lengthSize = "XL";
    else if (userHeightCm <= 195) lengthSize = "2XL";
    else lengthSize = "3XL";

    const finalIndex = Math.max(sizeMap[widthSize], sizeMap[lengthSize]);
    return revMap[finalIndex];
}

// ==========================================
// POSE RESULTS HANDLER
// ==========================================
function handlePoseResults(results) {
    if (!isEstimatingSize || currentMode !== 'size-estimation') return;

    if (skeletonCanvas.width !== localVideo.videoWidth) {
        skeletonCanvas.width = localVideo.videoWidth || 480;
        skeletonCanvas.height = localVideo.videoHeight || 640;
    }

    skelCtx.clearRect(0, 0, skeletonCanvas.width, skeletonCanvas.height);

    if (!results.landmarks || results.landmarks.length === 0 || !results.worldLandmarks || results.worldLandmarks.length === 0) {
        estimatorStatus.innerText = "🔍 Looking for body...";
        estimatorStatus.style.color = "#fbbf24";
        return;
    }

    const lm = results.landmarks[0];
    const wlm = results.worldLandmarks[0];

    const shoulderVis = (lm[11].visibility + lm[12].visibility) / 2;
    const hipVis = (lm[23].visibility + lm[24].visibility) / 2;
    const handVis = (lm[15].visibility + lm[16].visibility) / 2;

    const handsInFrame = lm[15].y > 0.25 && lm[15].y < 0.65 && lm[16].y > 0.05 && lm[16].y < 0.65;

    const isBodyValid = (shoulderVis > 0.5 && hipVis > 0.5 && handVis > 0.5 && hipsInFrame && shouldersInFrame && handsInFrame);

    if (!isBodyValid) {
        if (window.stabilizationTimer) { clearTimeout(window.stabilizationTimer); window.stabilizationTimer = null; }
        window.stabilizationAngle = null;
        sampleBuffer = [];
        estimatorStatus.innerText = (shoulderVis < 0.5 || hipVis < 0.5 || handVis < 0.5)
            ? "⚠️ Step back! Shoulders, Hips & Hands must be visible"
            : "⚠️ Move further back to fit torso & hands in frame";
        estimatorStatus.style.color = "#f87171";
        return;
    }

    const zDiff = wlm[11].z - wlm[12].z;
    if (lm[11].x < lm[12].x) angleDeg = 180 - angleDeg;
    else if (angleDeg < 0) angleDeg = 360 + angleDeg;
    if (angleDeg > 180) angleDeg -= 360;

    if (window.stabilizationAngle == null) window.stabilizationAngle = angleDeg;

    let diff = Math.abs(angleDeg - window.stabilizationAngle);
    if (diff > 180) diff = 360 - diff;

    if (diff > 4) {
        if (window.stabilizationTimer) { clearTimeout(window.stabilizationTimer); window.stabilizationTimer = null; }
        window.stabilizationAngle = angleDeg;
        sampleBuffer = [];
        estimatorStatus.innerText = "🔄 Adjusting angle... Hold still!";
        estimatorStatus.style.color = "#fbbf24";
        return;
    }

    if (sampleBuffer.length < SAMPLE_COUNT) {
        try { sampleBuffer.push(extractWorldMeasurements(wlm, lm)); } catch (e) { }
    }

    if (!window.stabilizationTimer) {
        sampleBuffer = [];
        try { sampleBuffer.push(extractWorldMeasurements(wlm, lm)); } catch (e) { }

        estimatorStatus.innerText = "🟢 Perfect! Hold still for 1 second...";
        estimatorStatus.style.color = "#34d399";

        window.stabilizationTimer = setTimeout(() => {
            if (sampleBuffer.length < 3) {
                estimatorStatus.innerText = "⚠️ Not enough data, try again";
                estimatorStatus.style.color = "#f87171";
                window.stabilizationTimer = null;
                window.stabilizationAngle = null;
                sampleBuffer = [];
                return;
            }

            const userHeightCm = parseFloat(document.getElementById("userHeight").value) || 165;
            const result = computeFinalMeasurements(sampleBuffer, userHeightCm);

            document.getElementById("mShoulder").innerText = result.shoulderCm + " cm";
            document.getElementById("mWaist").innerText = result.waistCm + " cm";
            document.getElementById("mArms").innerText = result.armsCm + " cm";
            document.getElementById("mChest").innerText = result.chestCm + " cm";
            document.getElementById("mTorso").innerText = result.torsoCm + " cm";

            const size = mapSize(result.chestCm, userHeightCm);
            document.getElementById("mSize").innerText = size;

            estimatorStatus.innerText = `✅ ${size} | Chest ${result.chestCm}cm | Shoulder ${result.shoulderCm}cm`;
            document.getElementById("startEstimatorBtn").innerText = "🔄 Re-measure";
            estimatorStatus.style.color = "#34d399";

            isEstimatingSize = false;
            setTimeout(() => { skelCtx.clearRect(0, 0, skeletonCanvas.width, skeletonCanvas.height); }, 3000);

            // Return to face-swap after measurement
            switchMode('face-swap');

            window.stabilizationTimer = null;
            window.stabilizationAngle = null;
            sampleBuffer = [];
        }, 1000);
    }
}

// ==========================================
// POSE LOOP & START BUTTON
// ==========================================
function poseLoop() {
    if (!isEstimatingSize || !poseLandmarker || currentMode !== 'size-estimation') return;

    if (localVideo.readyState >= 2) {
        if (lastVideoTime !== localVideo.currentTime) {
            lastVideoTime = localVideo.currentTime;
            const results = poseLandmarker.detectForVideo(localVideo, performance.now());
            handlePoseResults(results);
        }
    }
    poseRafId = requestAnimationFrame(poseLoop);
}

document.getElementById("startEstimatorBtn").addEventListener("click", () => {
    isEstimatingSize = true;
    sampleBuffer = [];
    window.stabilizationTimer = null;
    window.stabilizationAngle = null;

    // Switch to size-estimation (stops face loops)
    switchMode('size-estimation');

    if (!poseLandmarker) {
        estimatorStatus.innerText = "⏳ Loading AI model... (first time ~10s)";
        estimatorStatus.style.color = "#fbbf24";
        document.getElementById("startEstimatorBtn").innerText = "Loading...";
        initPoseLandmarker();
        return;
    }

    estimatorStatus.innerText = "⏳ Detecting pose...";
    estimatorStatus.style.color = "#fbbf24";
    document.getElementById("startEstimatorBtn").innerText = "Tracking...";

    cancelAnimationFrame(poseRafId);
    poseRafId = requestAnimationFrame(poseLoop);
});

// ==========================================
// DRAGGABLE PIP BUBBLE
// ==========================================
let isDragging = false;
let dragStartX, dragStartY;
let initialLeft, initialTop;

window.dragStart = function (e) {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;

    isDragging = true;
    const pip = document.getElementById("pipContainer");
    pip.style.cursor = "grabbing";

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    dragStartX = clientX;
    dragStartY = clientY;

    const rect = pip.getBoundingClientRect();
    const parentRect = pip.parentElement.getBoundingClientRect();

    if (pip.style.right) {
        pip.style.right = 'auto';
        pip.style.left = (rect.left - parentRect.left) + 'px';
        pip.style.top = (rect.top - parentRect.top) + 'px';
    }

    initialLeft = parseFloat(pip.style.left) || (rect.left - parentRect.left);
    initialTop = parseFloat(pip.style.top) || (rect.top - parentRect.top);

    document.addEventListener("mousemove", dragMove, { passive: false });
    document.addEventListener("touchmove", dragMove, { passive: false });
    document.addEventListener("mouseup", dragEnd);
    document.addEventListener("touchend", dragEnd);
};

function dragMove(e) {
    if (!isDragging) return;
    e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const dx = clientX - dragStartX;
    const dy = clientY - dragStartY;

    const pip = document.getElementById("pipContainer");

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    const parentRect = pip.parentElement.getBoundingClientRect();
    const pipRect = pip.getBoundingClientRect();

    newLeft = Math.max(0, Math.min(newLeft, parentRect.width - pipRect.width));
    newTop = Math.max(0, Math.min(newTop, parentRect.height - pipRect.height));

    pip.style.left = newLeft + 'px';
    pip.style.top = newTop + 'px';
}

function dragEnd() {
    isDragging = false;
    document.getElementById("pipContainer").style.cursor = "grab";

    document.removeEventListener("mousemove", dragMove);
    document.removeEventListener("touchmove", dragMove);
    document.removeEventListener("mouseup", dragEnd);
    document.removeEventListener("touchend", dragEnd);
}