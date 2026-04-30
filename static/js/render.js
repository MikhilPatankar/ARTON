// Indices for the contour/silhouette of the face in MediaPipe Face Mesh
const FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
];

// Global states for EMA (Exponential Moving Average) Smoothing
window.faceState = {
    x: null, y: null, scale: null, angle: null
};

window.lightState = {
    brightness: 1.0, r: 255, g: 255, b: 255
};

// Secret 1x1 canvas for zero-latency light sampling!
const sampleCanvas = document.createElement("canvas");
sampleCanvas.width = 1;
sampleCanvas.height = 1;
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

// Low-pass filter for smooth tracking
function lerp(start, end, amt) {
    if (start === null) return end;
    return (1 - amt) * start + amt * end;
}

function render(canvas, sellerVideo, buyerVideo) {
    const ctx = canvas.getContext("2d");

    canvas.width = sellerVideo.videoWidth || 640;
    canvas.height = sellerVideo.videoHeight || 480;

    // VERY IMPORTANT: Do NOT draw the seller video onto the canvas.
    // The canvas is now a strictly transparent overlay sitting physically over the native `<video>` element.
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const landmarks = window.buyerLandmarks;

    // Feedback loop: If tracking is running but no face found
    if (!landmarks && window.tryOn) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Looking for your face...", canvas.width / 2, 40);
        return;
    }

    if (!landmarks || !window.tryOn) return;

    // Only overlay if BOTH buyer and seller faces are detected
    const sLandmarks = window.sellerLandmarks;
    if (!sLandmarks || sLandmarks.length === 0) return;

    ctx.save();

    const vW = buyerVideo.videoWidth;
    const vH = buyerVideo.videoHeight;

    // Advanced bounds tracking using exact silhouette
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    landmarks.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });

    // Face dimensions in buyer video space
    const faceW = (maxX - minX) * vW;
    const faceH = (maxY - minY) * vH;

    // Face semantic center
    const cx = ((minX + maxX) / 2) * vW;
    const cy = ((minY + maxY) / 2) * vH;

    // Default target fallbacks if seller tracking fails for a frame
    let targetRawX = canvas.width / 2;
    let targetRawY = canvas.height * 0.28;
    let targetFaceW = canvas.width * 0.26;
    let sellerFaceColor = [255, 255, 255]; // fallback

    // Target anchor using SELLER facial bounding box AND Lighting Sample
    if (sLandmarks && sLandmarks.length > 0) {
        let sxMin = Infinity, syMin = Infinity, sxMax = -Infinity, syMax = -Infinity;
        sLandmarks.forEach(p => {
            if (p.x < sxMin) sxMin = p.x;
            if (p.x > sxMax) sxMax = p.x;
            if (p.y < syMin) syMin = p.y;
            if (p.y > syMax) syMax = p.y;
        });

        const svW = sellerVideo.videoWidth || 640;
        const svH = sellerVideo.videoHeight || 480;

        const sfW = (sxMax - sxMin) * svW;
        const sfH = (syMax - syMin) * svH;

        targetRawX = ((sxMin + sxMax) / 2) * svW;
        targetRawY = ((syMin + syMax) / 2) * svH;

        targetFaceW = sfW * 1.03;

        // Lighting Sample: Capture an exact 15% patch strictly isolated on the nose bridge
        // This completely avoids dark hair, open mouths, eyebrows, and room ceilings!
        const sellerNose = sLandmarks[1];
        const snX = sellerNose.x * svW;
        const snY = sellerNose.y * svH;
        const sSampleSize = sfW * 0.15;

        sampleCtx.drawImage(sellerVideo, snX - sSampleSize / 2, snY - sSampleSize / 2, sSampleSize, sSampleSize, 0, 0, 1, 1);
        sellerFaceColor = sampleCtx.getImageData(0, 0, 1, 1).data;
    }

    // Apply strict nose sampling for buyer as well
    const buyerNose = landmarks[1];
    const bnX = buyerNose.x * vW;
    const bnY = buyerNose.y * vH;
    const bSampleSize = faceW * 0.15;

    sampleCtx.drawImage(buyerVideo, bnX - bSampleSize / 2, bnY - bSampleSize / 2, bSampleSize, bSampleSize, 0, 0, 1, 1);
    const buyerFaceColor = sampleCtx.getImageData(0, 0, 1, 1).data;

    // Luminance math (BT.601)
    const sLum = 0.299 * sellerFaceColor[0] + 0.587 * sellerFaceColor[1] + 0.114 * sellerFaceColor[2];
    const bLum = 0.299 * buyerFaceColor[0] + 0.587 * buyerFaceColor[1] + 0.114 * buyerFaceColor[2];
    let brightnessRatio = sLum / Math.max(bLum, 1);

    // Prevent extreme blinding/blackout brightness bounds
    brightnessRatio = Math.max(0.6, Math.min(brightnessRatio, 1.8));

    // Smooth lighting parameters
    window.lightState.brightness = lerp(window.lightState.brightness, brightnessRatio, 0.1);
    window.lightState.r = lerp(window.lightState.r, sellerFaceColor[0], 0.1);
    window.lightState.g = lerp(window.lightState.g, sellerFaceColor[1], 0.1);
    window.lightState.b = lerp(window.lightState.b, sellerFaceColor[2], 0.1);

    const targetScale = targetFaceW / faceW;

    // 1-to-1 Mathematical Alignment
    const bLeftEye = landmarks[33];
    const bRightEye = landmarks[263];
    const buyerAngle = Math.atan2(bRightEye.y - bLeftEye.y, bRightEye.x - bLeftEye.x);

    let targetAngle = 0;
    if (sLandmarks && sLandmarks.length > 0) {
        const sLeftEye = sLandmarks[33];
        const sRightEye = sLandmarks[263];
        const sellerAngle = Math.atan2(sRightEye.y - sLeftEye.y, sRightEye.x - sLeftEye.x);

        /** 
         * CRITICAL FIX: 
         * If the buyer naturally tilts their head 10 deg, and the seller tilts 15 deg,
         * we only rotate the canvas by +5 degrees so they perfectly stack!
         * (If we rotated by 15 deg, the final face would be 25 deg off-axis!)
         */
        targetAngle = sellerAngle - buyerAngle;
    }

    // Apply Smoothing matrices (removes jitter from micro-movements)
    window.faceState.x = lerp(window.faceState.x, targetRawX, 0.4);
    window.faceState.y = lerp(window.faceState.y, targetRawY, 0.4);
    window.faceState.scale = lerp(window.faceState.scale, targetScale, 0.4);
    window.faceState.angle = lerp(window.faceState.angle, targetAngle, 0.35);

    // Apply affine transformation to seller canvas coordinate space
    ctx.translate(window.faceState.x, window.faceState.y);
    // Rotate canvas strictly by the mathematical delta difference!
    ctx.rotate(window.faceState.angle);
    ctx.scale(window.faceState.scale, window.faceState.scale);

    // ADVANCED MASKING: Segmentation mask (Full Head) or FACE_OVAL fallback
    if (window.useHeadMask && window.segMaskCanvas) {
        // ---- PIXEL-PERFECT SEGMENTATION MASK (Head-only crop) ----
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = vW;
        tempCanvas.height = vH;
        const tempCtx = tempCanvas.getContext("2d");

        // Draw the full-body segmentation mask
        tempCtx.drawImage(window.segMaskCanvas, 0, 0, vW, vH);

        // CROP: Erase body below the neck using an oval cutout
        // Chin = landmark 152, use face width for oval sizing
        const chin = landmarks[152];
        const neckPadding = faceH * 0.04; // Tight neck cut — just below chin
        const ovalCenterX = ((minX + maxX) / 2) * vW;  // Face horizontal center
        const ovalCenterY = chin.y * vH + neckPadding;  // Just below chin
        const ovalRadiusX = faceW * 0.35;  // Match face width for ears
        const ovalRadiusY = faceH * 0.16;  // Thin oval for clean cut

        // Erase everything below the oval line
        tempCtx.globalCompositeOperation = "destination-out";
        tempCtx.beginPath();
        // Draw the bottom half of an ellipse as the top edge of the erase zone
        tempCtx.ellipse(ovalCenterX, ovalCenterY, ovalRadiusX, ovalRadiusY, 0, 0, Math.PI);
        // Extend down to cover the entire body below
        tempCtx.lineTo(ovalCenterX - ovalRadiusX, vH);
        tempCtx.lineTo(ovalCenterX + ovalRadiusX, vH);
        tempCtx.closePath();
        tempCtx.fill();

        // Also erase the sides beyond the oval width (shoulders that stick out)
        tempCtx.fillRect(0, ovalCenterY - ovalRadiusY, ovalCenterX - ovalRadiusX, vH);
        tempCtx.fillRect(ovalCenterX + ovalRadiusX, ovalCenterY - ovalRadiusY, vW, vH);

        tempCtx.globalCompositeOperation = "source-in";

        // Apply lighting correction via filter on temp canvas
        tempCtx.filter = `brightness(${window.lightState.brightness})`;
        tempCtx.drawImage(buyerVideo, 0, 0, vW, vH);
        tempCtx.filter = "none";

        // Color grading overlay
        tempCtx.globalCompositeOperation = "source-atop";
        tempCtx.fillStyle = `rgba(${Math.round(window.lightState.r)}, ${Math.round(window.lightState.g)}, ${Math.round(window.lightState.b)}, 0.45)`;
        tempCtx.fillRect(0, 0, vW, vH);
        tempCtx.globalCompositeOperation = "source-over";

        // Draw the fully composited result onto the main canvas
        ctx.drawImage(tempCanvas, -cx, -cy, vW, vH);
    } else {
        // ---- FACE_OVAL POLYGON CLIP (Original fallback) ----
        ctx.beginPath();
        for (let i = 0; i < FACE_OVAL.length; i++) {
            const p = landmarks[FACE_OVAL[i]];
            let px = (p.x * vW) - cx;
            let py = (p.y * vH) - cy;

            const scaleOut = 1.03;
            px *= scaleOut;
            py *= scaleOut;

            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.clip();

        // Apply lighting correction
        ctx.filter = `brightness(${window.lightState.brightness})`;
        ctx.drawImage(buyerVideo, -cx, -cy, vW, vH);
        ctx.filter = "none";

        // Color grading overlay
        ctx.globalCompositeOperation = "color";
        ctx.fillStyle = `rgba(${Math.round(window.lightState.r)}, ${Math.round(window.lightState.g)}, ${Math.round(window.lightState.b)}, 0.45)`;
        ctx.fillRect(-cx - faceW, -cy - faceH, faceW * 3, faceH * 3);
        ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();
}

// ==========================================
// AFFINE GARMENT MAPPING OVER BUYER BODY
// ==========================================
window.renderGarment = function(canvas, video, buyerPose, garmentObj) {
    const ctx = canvas.getContext("2d");
    const vW = video.videoWidth || canvas.width;
    const vH = video.videoHeight || canvas.height;

    const gImg = garmentObj.image;
    const gLM = garmentObj.landmarks;
    if (!gLM) return; // Need static anchors to map!

    const part = garmentObj.part;
    
    // Default anchors: Shoulders
    let bAnchor1 = buyerPose[11], bAnchor2 = buyerPose[12];
    let gAnchor1 = gLM[11], gAnchor2 = gLM[12];
    let scaleBoost = 1.15; // padding for fit

    // If 'lower' garment, anchor by hips (23, 24)
    if (part === "lower") {
        bAnchor1 = buyerPose[23]; bAnchor2 = buyerPose[24];
        gAnchor1 = gLM[23]; gAnchor2 = gLM[24];
        scaleBoost = 1.25;
    }

    if (!bAnchor1 || !bAnchor2 || bAnchor1.visibility < 0.5 || bAnchor2.visibility < 0.5) return;
    if (!gAnchor1 || !gAnchor2) return;

    // Source (Garment) Anchors
    const gCW = gImg.width;
    const gCH = gImg.height;
    const gX1 = gAnchor1.x * gCW, gY1 = gAnchor1.y * gCH;
    const gX2 = gAnchor2.x * gCW, gY2 = gAnchor2.y * gCH;

    const gCY = (gY1 + gY2) / 2;
    const gWidth = Math.hypot(gX2 - gX1, gY2 - gY1);
    const gAngle = Math.atan2(gY2 - gY1, gX2 - gX1);

    // Compute Affine Transforms (Scale, Rotate, Translate)
    const scale = bWidth / (gWidth || 1) * scaleBoost;
    const rot = bAngle - gAngle;

    ctx.save();
    // 1. Move to target point
    ctx.translate(bCX, bCY);
    // 2. Align angles
    ctx.rotate(rot);
    // 3. Match relative size
    ctx.scale(scale, scale);
    // 4. Offset back by garment's anchor center
    ctx.translate(-gCX, -gCY);

    // Draw perfectly aligned garment!
    ctx.drawImage(gImg, 0, 0);
    ctx.restore();
};