import io, base64
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
import onnxruntime as ort
import mediapipe as mp
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit

app = Flask(__name__)
CORS(app)
app.config['TEMPLATES_AUTO_RELOAD'] = True
socketio = SocketIO(app, cors_allowed_origins="*")
model_loaded = False

# ─────────────────────────────────────────────────────────────────────────────
#  Model setup
# ─────────────────────────────────────────────────────────────────────────────
MODEL_PATH = Path(__file__).parent / "models" / "cloth_seg.onnx"
ort_session = None

def load_model():
    global ort_session
    if ort_session is not None:
        return
    if not MODEL_PATH.exists():
        print(f"⏳ Downloading model to {MODEL_PATH}...")
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        import urllib.request
        url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_cloth_seg.onnx"
        urllib.request.urlretrieve(url, MODEL_PATH)
        print("✅ Download complete!")
    
    print(f"⏳ Loading cloth segmentation model from {MODEL_PATH}...")
    ort_session = ort.InferenceSession(
        str(MODEL_PATH),
        providers=["CPUExecutionProvider"]
    )
    print("✅ Cloth segmentation model ready!")

# ─────────────────────────────────────────────────────────────────────────────
#  Pose detection helper (single persistent instance for perf)
# ─────────────────────────────────────────────────────────────────────────────
mp_pose = mp.solutions.pose
pose_detector = mp_pose.Pose(
    static_image_mode=True,
    model_complexity=1,
    min_detection_confidence=0.5
)

def detect_pose_landmarks(img_pil):
    """Run mediapipe pose on a PIL image, return list of {x,y,z,visibility} dicts."""
    img_rgb = np.array(img_pil.convert("RGB"))
    results = pose_detector.process(img_rgb)
    if results.pose_landmarks:
        return [
            {"x": lm.x, "y": lm.y, "z": lm.z, "visibility": lm.visibility}
            for lm in results.pose_landmarks.landmark
        ]
    return None

# ─────────────────────────────────────────────────────────────────────────────
#  Inference Logic
# ─────────────────────────────────────────────────────────────────────────────
INPUT_SIZE = 768  # u2net_cloth_seg specifically trained on 768x768

def preprocess(img: Image.Image) -> np.ndarray:
    img_rgb = img.convert("RGB").resize((INPUT_SIZE, INPUT_SIZE), Image.LANCZOS)
    arr = np.array(img_rgb, dtype=np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406])
    std  = np.array([0.229, 0.224, 0.225])
    arr = (arr - mean) / std
    arr = arr.transpose(2, 0, 1)[np.newaxis, :]
    return arr.astype(np.float32)

def postprocess(mask_tensor: np.ndarray, orig_size: tuple, part: str) -> Image.Image:
    """
    u2net_cloth_seg output is (1, 4, 768, 768).
    Channels: 
      0: Background / Skin
      1: Upper body clothing (Shirts)
      2: Lower body clothing (Pants/Skirts)
      3: Full body clothing (Dresses / Long Kurtas)
    """
    logits = mask_tensor[0] # Shape: (4, 768, 768)
    logits = logits - np.max(logits, axis=0, keepdims=True) # Numerical stability
    exp_logits = np.exp(logits)
    probs = exp_logits / np.sum(exp_logits, axis=0, keepdims=True)
    
    if part == "upper":
        mask = probs[1] + probs[3]
    elif part == "lower":
        mask = probs[2]
    else:
        mask = 1.0 - probs[0] 
        
    mask = np.clip((mask - 0.2) / 0.6, 0, 1)
    
    alpha_arr = (mask * 255).astype(np.uint8)
    alpha = Image.fromarray(alpha_arr).resize(orig_size, Image.LANCZOS)
    
    kernel_size = max(3, orig_size[0] // 150)
    if kernel_size % 2 == 0: kernel_size += 1
    
    alpha = alpha.filter(ImageFilter.MinFilter(kernel_size))
    alpha = alpha.filter(ImageFilter.MaxFilter(kernel_size))
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=1))
    
    return alpha

def extract(img: Image.Image, part: str) -> Image.Image:
    orig_size = img.size
    inp = preprocess(img)
    
    input_name = ort_session.get_inputs()[0].name
    outputs = ort_session.run(None, {input_name: inp})
    
    alpha = postprocess(outputs[0], orig_size, part)
    
    rgba = img.convert("RGBA")
    rgba.putalpha(alpha)
    
    bbox = rgba.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
        
    return rgba

clients = {}

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/buyer")
def buyer():
    return render_template("buyer.html")

@app.route("/seller")
def seller():
    return render_template("seller.html")

@app.route("/extract", methods=["POST"])
def extract_route():
    if "image" not in request.files:
        return jsonify({"error": "No image field"}), 400
    
    part = request.form.get("part", "full")
    file = request.files["image"]
    
    try:
        if not model_loaded:
            load_model()
        
        img = Image.open(io.BytesIO(file.read())).convert("RGBA")
        result = extract(img, part)
        
        buf = io.BytesIO()
        result.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        
        return jsonify({
            "garment_b64": b64,
            "width": result.width,
            "height": result.height,
            "part": part
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@socketio.on("join")
def on_join(data):
    clients[request.sid] = data["role"]

    emit("clients", [
        {"id": sid, "role": role}
        for sid, role in clients.items()
    ], broadcast=True)

@socketio.on("offer")
def on_offer(data):
    emit("offer", {
        "offer": data["offer"],
        "from": request.sid
    }, room=data["target"])

@socketio.on("answer")
def on_answer(data):
    emit("answer", {
        "answer": data["answer"],
        "from": request.sid
    }, room=data["target"])

@socketio.on("ice")
def on_ice(data):
    emit("ice", {
        "candidate": data["candidate"],
        "from": request.sid
    }, room=data["target"])

@socketio.on("garment_snapshot")
def on_garment_snapshot(data):
    """Receive garment from seller, run server-side pose detection, broadcast with landmarks."""
    image_b64 = data.get("image", "")
    part = data.get("part", "full")
    
    landmarks = None
    try:
        img_bytes = base64.b64decode(image_b64)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
        landmarks = detect_pose_landmarks(img)
        if landmarks:
            print(f"✅ Server-side pose: {len(landmarks)} landmarks detected on garment")
        else:
            print("⚠️ No pose landmarks detected on garment image")
    except Exception as e:
        print(f"⚠️ Pose detection on garment failed: {e}")
    
    emit("garment_snapshot", {
        "image": image_b64,
        "part": part,
        "landmarks": landmarks
    }, broadcast=True)

@socketio.on("buyer_frame")
def on_buyer_frame(data):
    """Receive a video frame from buyer, run pose detection, send landmarks back."""
    try:
        img_bytes = base64.b64decode(data["image"])
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        landmarks = detect_pose_landmarks(img)
        if landmarks:
            emit("buyer_pose", {"landmarks": landmarks})
    except Exception as e:
        pass

@socketio.on("disconnect")
def on_disconnect():
    clients.pop(request.sid, None)
    emit("clients", [
        {"id": sid, "role": role}
        for sid, role in clients.items()
    ], broadcast=True)

if __name__ == "__main__":
    import os
    if not os.path.exists('server.crt') or not os.path.exists('server.key'):
        from werkzeug.serving import make_ssl_devcert
        make_ssl_devcert('./server', host='0.0.0.0')
        
    load_model()
    model_loaded = True
    socketio.run(app, host="0.0.0.0", port=5500, certfile='server.crt', keyfile='server.key')