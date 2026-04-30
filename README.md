# 🧥 Real-Time Virtual Try-On System (Client-Side Rendering)

---

## 📌 Overview

This project implements a **real-time virtual try-on system** where a buyer’s face is composited onto a seller’s mannequin video stream. The system is designed with a strict constraint:

> **All computer vision, rendering, and transformation logic runs entirely on the client (browser).**

The backend (Flask) is used **only for signaling and session coordination**, ensuring:

* No video processing on the server
* Minimal infrastructure load
* Privacy-preserving design

---

## 🎯 Core Objective

To simulate a real-time try-on experience where:

* A **seller streams a mannequin wearing garments**
* A **buyer streams their face**
* The system **extracts the buyer’s face**, aligns it, and overlays it onto the mannequin head in real time

---

## 🧠 High-Level Architecture

### System Layers

```
[ Buyer Browser ] 
    ├── Camera Capture
    ├── Face Detection (MediaPipe)
    ├── Face Extraction + Masking
    ├── Alignment (Rotation + Scaling)
    ├── Rendering Engine (Canvas/WebGL)
    └── WebRTC Client

[ Seller Browser ]
    ├── Camera Capture (Mannequin)
    └── WebRTC Client

[ Flask Server ]
    ├── Socket.IO Signaling
    ├── Client Registry
    └── Session Coordination
```

---

## 🔄 Data Flow

### 1. Connection Phase

* Buyer and seller connect to Flask server via WebSocket
* Server maintains a list of active clients
* Buyer selects a seller
* WebRTC offer/answer exchange establishes a peer connection

### 2. Streaming Phase

* Seller sends video stream (mannequin)
* Buyer receives seller stream
* Buyer simultaneously captures their own camera

### 3. Processing Phase (Client-Side)

* Face is detected from buyer’s stream
* Facial landmarks are extracted
* Face region is cropped and masked
* Orientation and scale are computed
* Face is transformed and aligned

### 4. Rendering Phase

* Seller frame is drawn to canvas
* Transformed buyer face is composited on top
* Final output is rendered in real time

---

## 📡 Networking Architecture (WebRTC)

### Signaling (Flask + Socket.IO)

The server handles:

* Client join/leave events
* Role assignment (buyer/seller)
* Exchange of:

  * SDP offers
  * SDP answers
  * ICE candidates

### Peer-to-Peer Connection

* Media streams flow **directly between buyer and seller**
* No media passes through the server

### ICE Configuration

* Public STUN server is used for NAT traversal
* TURN server can be added for production reliability

---

## 🧑‍💻 Client Responsibilities

### Buyer Client

The buyer is the **processing node** and performs:

#### 1. Video Capture

* Captures front camera stream
* Ensures mobile compatibility (`playsinline`, user interaction)

#### 2. Face Detection (MediaPipe Face Mesh)

* Runs continuously on video frames
* Outputs 468 facial landmarks
* Provides normalized coordinates (0–1)

#### 3. Face Extraction

* Identifies bounding region using key landmarks:

  * Cheeks (horizontal bounds)
  * Forehead and chin (vertical bounds)
* Extracts region of interest (ROI)

#### 4. Mask Generation

* Applies a mask to isolate face from background
* Current implementation uses geometric masking
* Future improvements include segmentation models

#### 5. Pose Estimation

* Calculates face rotation using eye landmarks
* Determines orientation angle

#### 6. Scaling

* Computes scale based on inter-cheek distance
* Ensures proportional alignment with mannequin head

#### 7. Rendering

* Draws seller frame onto canvas
* Applies transformations:

  * Translation (position)
  * Rotation (angle)
  * Scaling (size)
* Overlays processed face onto mannequin

---

### Seller Client

The seller acts as a **video source node**:

* Captures rear camera (environment-facing)
* Streams mannequin wearing garments
* Does not perform any processing
* Maintains lightweight client footprint

---

## 🎨 Rendering Pipeline

### Step-by-Step

1. **Frame Acquisition**

   * Seller video frame is received
   * Buyer video frame is captured

2. **Canvas Preparation**

   * Canvas size matches seller video resolution

3. **Base Layer**

   * Seller frame is drawn as background

4. **Transformation Setup**

   * Compute:

     * Translation (target head position)
     * Rotation (based on eye angle)
     * Scale (based on face width)

5. **Mask Application**

   * Clipping region applied (face boundary)

6. **Face Projection**

   * Cropped buyer face is drawn onto canvas
   * Transformed using computed parameters

7. **Final Output**

   * Composite frame displayed in real time

---

## 🧠 Face Alignment Logic

### Rotation

* Derived from slope between left and right eye
* Ensures face tilts correctly with head orientation

### Scaling

* Based on horizontal distance between cheeks
* Maintains proportional sizing

### Translation

* Face is positioned relative to a predefined mannequin anchor
* Can be upgraded to dynamic head tracking

---

## 🎭 Masking Strategy

### Current Approach

* Circular or rectangular clipping region
* Fast and efficient for real-time rendering

### Limitations

* Visible edges
* No hair or neck blending

### Future Enhancements

* Convex hull masking
* Alpha feathering
* Shader-based blending
* Semantic segmentation

---

## 📱 Mobile Compatibility

### Requirements

* Must be served over HTTPS or localhost
* Camera must be triggered by user interaction
* Video elements must include:

  * `playsinline`
  * `muted` (for autoplay)

### Common Issues

* Black video feed → autoplay restriction
* Camera not opening → missing user gesture
* Lag → excessive processing per frame

---

## ⚡ Performance Considerations

### Optimization Strategies

* Run face detection at reduced frequency (e.g., 10–15 FPS)
* Render loop runs at 60 FPS independently
* Cache previous landmarks when detection skips frames
* Use requestAnimationFrame for smooth rendering

### Bottlenecks

* Face detection (CPU-intensive)
* Canvas drawing operations
* Mobile device limitations

---

## 🔐 Privacy & Security

* No video data is sent to the server
* All processing is local to the browser
* Peer-to-peer communication ensures minimal exposure
* Suitable for privacy-sensitive applications

---

## 🚀 Deployment Considerations

### Development

* Run Flask locally
* Use ngrok for mobile testing

### Production

* Deploy Flask on HTTPS server
* Add TURN server for reliability
* Optimize assets (minified JS, CDN usage)

---

## ⚠️ Known Limitations

* Static mannequin head position
* No occlusion handling (hair, collar)
* Lighting mismatch between streams
* Basic masking quality
* No depth awareness

---

## 🔮 Future Roadmap

### Visual Improvements

* Skin tone matching
* Lighting normalization
* Shadow rendering

### Geometry Improvements

* 3D head pose estimation
* Depth-aware alignment
* Multi-angle support

### Rendering Upgrades

* WebGL shaders
* GPU acceleration
* Real-time blending

### UX Enhancements

* Seller preview thumbnails
* Call status indicators
* Smooth transitions

---

## 🧠 Conceptual Insight

This system is not a deepfake pipeline. It is better understood as:

> **A real-time geometric face projection system using landmark-based alignment**

---

## 🏁 Conclusion

This implementation provides a complete foundation for:

* Real-time video communication (WebRTC)
* Client-side computer vision (MediaPipe)
* Live compositing and rendering
* Scalable and privacy-preserving architecture

It is designed to be extended toward:

* AR try-on systems
* Virtual avatars
* Interactive retail experiences

---
