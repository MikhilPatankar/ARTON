const FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
];

window.faceState = {
    x: null, y: null, scale: null, angle: null
};

window.lightState = {
    brightness: 1.0, r: 255, g: 255, b: 255
};

const sampleCanvas = document.createElement("canvas");
sampleCanvas.width = 1;
sampleCanvas.height = 1;
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

function lerp(start, end, amt) {
    if (start === null) return end;
    return (1 - amt) * start + amt * end;
}

function render(canvas, sellerVideo, buyerVideo) {
    const ctx = canvas.getContext("2d");

    canvas.width = sellerVideo.videoWidth || 640;
    canvas.height = sellerVideo.videoHeight || 480;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const landmarks = window.buyerLandmarks;

    if (!landmarks && window.tryOn) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Looking for your face...", canvas.width / 2, 40);
        return;
    }

    if (!landmarks || !window.tryOn) return;

    const sLandmarks = window.sellerLandmarks;
    if (!sLandmarks || sLandmarks.length === 0) return;

    ctx.save();

    const vW = buyerVideo.videoWidth;
    const vH = buyerVideo.videoHeight;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    landmarks.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });

    const faceW = (maxX - minX) * vW;
    const faceH = (maxY - minY) * vH;

    const cx = ((minX + maxX) / 2) * vW;
    const cy = ((minY + maxY) / 2) * vH;

    let targetRawX = canvas.width / 2;
    let targetRawY = canvas.height * 0.28;
    let targetFaceW = canvas.width * 0.26;
    let sellerFaceColor = [255, 255, 255];

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

        const sellerNose = sLandmarks[1];
        const snX = sellerNose.x * svW;
        const snY = sellerNose.y * svH;
        const sSampleSize = sfW * 0.15;

        sampleCtx.drawImage(sellerVideo, snX - sSampleSize / 2, snY - sSampleSize / 2, sSampleSize, sSampleSize, 0, 0, 1, 1);
        sellerFaceColor = sampleCtx.getImageData(0, 0, 1, 1).data;
    }

    const buyerNose = landmarks[1];
    const bnX = buyerNose.x * vW;
    const bnY = buyerNose.y * vH;
    const bSampleSize = faceW * 0.15;

    sampleCtx.drawImage(buyerVideo, bnX - bSampleSize / 2, bnY - bSampleSize / 2, bSampleSize, bSampleSize, 0, 0, 1, 1);
    const buyerFaceColor = sampleCtx.getImageData(0, 0, 1, 1).data;

    const sLum = 0.299 * sellerFaceColor[0] + 0.587 * sellerFaceColor[1] + 0.114 * sellerFaceColor[2];
    const bLum = 0.299 * buyerFaceColor[0] + 0.587 * buyerFaceColor[1] + 0.114 * buyerFaceColor[2];
    let brightnessRatio = sLum / Math.max(bLum, 1);

    brightnessRatio = Math.max(0.6, Math.min(brightnessRatio, 1.8));

    window.lightState.brightness = lerp(window.lightState.brightness, brightnessRatio, 0.1);
    window.lightState.r = lerp(window.lightState.r, sellerFaceColor[0], 0.1);
    window.lightState.g = lerp(window.lightState.g, sellerFaceColor[1], 0.1);
    window.lightState.b = lerp(window.lightState.b, sellerFaceColor[2], 0.1);

    const targetScale = targetFaceW / faceW;

    const bLeftEye = landmarks[33];
    const bRightEye = landmarks[263];
    const buyerAngle = Math.atan2(bRightEye.y - bLeftEye.y, bRightEye.x - bLeftEye.x);

    let targetAngle = 0;
    if (sLandmarks && sLandmarks.length > 0) {
        const sLeftEye = sLandmarks[33];
        const sRightEye = sLandmarks[263];
        const sellerAngle = Math.atan2(sRightEye.y - sLeftEye.y, sRightEye.x - sLeftEye.x);

        targetAngle = sellerAngle - buyerAngle;
    }

    window.faceState.x = lerp(window.faceState.x, targetRawX, 0.4);
    window.faceState.y = lerp(window.faceState.y, targetRawY, 0.4);
    window.faceState.scale = lerp(window.faceState.scale, targetScale, 0.4);
    window.faceState.angle = lerp(window.faceState.angle, targetAngle, 0.35);

    ctx.translate(window.faceState.x, window.faceState.y);
    ctx.rotate(window.faceState.angle);
    ctx.scale(window.faceState.scale, window.faceState.scale);

    if (window.useHeadMask && window.segMaskCanvas) {
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = vW;
        tempCanvas.height = vH;
        const tempCtx = tempCanvas.getContext("2d");

        tempCtx.drawImage(window.segMaskCanvas, 0, 0, vW, vH);

        const chin = landmarks[152];
        const neckPadding = faceH * 0.04;
        const ovalCenterX = ((minX + maxX) / 2) * vW;
        const ovalCenterY = chin.y * vH + neckPadding;
        const ovalRadiusX = faceW * 0.35;
        const ovalRadiusY = faceH * 0.16;

        tempCtx.globalCompositeOperation = "destination-out";
        tempCtx.beginPath();
        tempCtx.ellipse(ovalCenterX, ovalCenterY, ovalRadiusX, ovalRadiusY, 0, 0, Math.PI);
        tempCtx.lineTo(ovalCenterX - ovalRadiusX, vH);
        tempCtx.lineTo(ovalCenterX + ovalRadiusX, vH);
        tempCtx.closePath();
        tempCtx.fill();

        tempCtx.fillRect(0, ovalCenterY - ovalRadiusY, ovalCenterX - ovalRadiusX, vH);
        tempCtx.fillRect(ovalCenterX + ovalRadiusX, ovalCenterY - ovalRadiusY, vW, vH);

        tempCtx.globalCompositeOperation = "source-in";

        tempCtx.filter = `brightness(${window.lightState.brightness})`;
        tempCtx.drawImage(buyerVideo, 0, 0, vW, vH);
        tempCtx.filter = "none";

        tempCtx.globalCompositeOperation = "source-atop";
        tempCtx.fillStyle = `rgba(${Math.round(window.lightState.r)}, ${Math.round(window.lightState.g)}, ${Math.round(window.lightState.b)}, 0.45)`;
        tempCtx.fillRect(0, 0, vW, vH);
        tempCtx.globalCompositeOperation = "source-over";

        ctx.drawImage(tempCanvas, -cx, -cy, vW, vH);
    } else {
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

        ctx.filter = `brightness(${window.lightState.brightness})`;
        ctx.drawImage(buyerVideo, -cx, -cy, vW, vH);
        ctx.filter = "none";

        ctx.globalCompositeOperation = "color";
        ctx.fillStyle = `rgba(${Math.round(window.lightState.r)}, ${Math.round(window.lightState.g)}, ${Math.round(window.lightState.b)}, 0.45)`;
        ctx.fillRect(-cx - faceW, -cy - faceH, faceW * 3, faceH * 3);
        ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();
}

window.renderGarment = function(canvas, video, buyerPose, garmentObj) {
    const ctx = canvas.getContext("2d");
    const vW = video.videoWidth || canvas.width;
    const vH = video.videoHeight || canvas.height;

    const gImg = garmentObj.image;
    const gLM = garmentObj.landmarks;
    if (!gLM) return;

    const part = garmentObj.part;
    
    let bAnchor1 = buyerPose[11], bAnchor2 = buyerPose[12];
    let gAnchor1 = gLM[11], gAnchor2 = gLM[12];
    let scaleBoost = 1.15;

    if (part === "lower") {
        bAnchor1 = buyerPose[23]; bAnchor2 = buyerPose[24];
        gAnchor1 = gLM[23]; gAnchor2 = gLM[24];
        scaleBoost = 1.25;
    }

    if (!bAnchor1 || !bAnchor2 || bAnchor1.visibility < 0.5 || bAnchor2.visibility < 0.5) return;
    if (!gAnchor1 || !gAnchor2) return;

    const gCW = gImg.width;
    const gCH = gImg.height;
    const gX1 = gAnchor1.x * gCW, gY1 = gAnchor1.y * gCH;
    const gX2 = gAnchor2.x * gCW, gY2 = gAnchor2.y * gCH;

    const gCX = (gX1 + gX2) / 2;
    const gCY = (gY1 + gY2) / 2;
    const gWidth = Math.hypot(gX2 - gX1, gY2 - gY1);
    const gAngle = Math.atan2(gY2 - gY1, gX2 - gX1);

    const bX1 = bAnchor1.x * vW, bY1 = bAnchor1.y * vH;
    const bX2 = bAnchor2.x * vW, bY2 = bAnchor2.y * vH;

    const bCX = (bX1 + bX2) / 2;
    const bCY = (bY1 + bY2) / 2;
    const bWidth = Math.hypot(bX2 - bX1, bY2 - bY1);
    const bAngle = Math.atan2(bY2 - bY1, bX2 - bX1);

    const scale = bWidth / (gWidth || 1) * scaleBoost;
    const rot = bAngle - gAngle;

    ctx.save();
    ctx.translate(bCX, bCY);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-gCX, -gCY);

    ctx.drawImage(gImg, 0, 0);
    ctx.restore();
};