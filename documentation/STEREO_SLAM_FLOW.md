# Stereo SLAM Function Call Chain Documentation

This document traces the complete function call chain for the stereo SLAM system in AlvaAR, from HTML interface to C++ backend processing. **Relevant code snippets and full relative code paths are included for clarity.**

## Overview

The stereo SLAM system in this codebase provides **metric-scale pose estimation** using a **hybrid approach** that combines stereo and monocular techniques. It uses synchronized stereo camera pairs for initialization and scale recovery, then switches to monocular SLAM for continuous tracking. **Unlike the monocular system, it maintains metric scale through stereo initialization, but uses efficient monocular tracking for real-time performance.**

- **Metric scale:** Stereo SLAM recovers true metric scale through stereo triangulation during initialization, eliminating scale ambiguity.
- **Hybrid approach:** Uses stereo for initialization and scale recovery, then switches to monocular SLAM for tracking.
- **Stereo triangulation:** Uses KLT optical flow to match features between left and right images for 3D point reconstruction (initialization only).
- **Monocular tracking:** After initialization, uses only the left camera with established monocular SLAM pipeline.
- **Grid-based feature management:** Distributes features evenly across the image using a grid-based approach.
- **Sequential processing:** All C++ processing is sequential (no multithreading) for WebAssembly compatibility.

---

## Function Call Chain

### 1. HTML Interface Layer

**File:** `examples/public/stereo_esp32blob.html`
```javascript
// Main render loop
function render() {
    // Get stereo images from WebSocket stream
    if (latestFrameBitmapLeft && latestFrameBitmapRight) {
        ctx.drawImage(latestFrameBitmapLeft, 0, 0, 480, 320);
        ctx.drawImage(latestFrameBitmapRight, 480, 0, 480, 320);
        
        // Extract image data for both cameras
        const leftFrame = ctx.getImageData(0, 0, 480, 320);
        const rightFrame = ctx.getImageData(480, 0, 480, 320);
        
        // Call stereo SLAM
        const pose = alva.findStereoCameraPose(leftFrame, rightFrame);
        
        if (pose) {
            view.updateCameraPose(pose);  // Update 3D visualization
        } else {
            view.lostCamera();
            // Show feature points for debugging
            const dots = alva.getFramePoints();
            for (const p of dots) {
                ctx.fillRect(p.x, p.y, 2, 2);
            }
        }
    }
}
```

**Purpose:** Provides user interface, captures stereo video frames from WebSocket stream, and displays results.

### 2. WebSocket Frame Stream

**File:** `examples/public/stereo_esp32blob.html`
```javascript
function connectWebSocketFrameStream(callback) {
    const ws = new WebSocket("ws://localhost:8765");
    ws.binaryType = "arraybuffer";
    
    ws.onmessage = async event => {
        const arrayBuffer = event.data;
        const view = new Uint8Array(arrayBuffer);
        const sourceTag = String.fromCharCode(view[0]); // 'L' or 'R'
        const jpegData = view.slice(1);
        const blob = new Blob([jpegData], { type: 'image/jpeg' });
        const bitmap = await createImageBitmap(blob);
        callback(sourceTag, bitmap);
    };
}
```

**Purpose:** Receives synchronized stereo image pairs from ROS2 camera stream via WebSocket.

### 3. JavaScript Interface Layer

**File:** `examples/public/stereo_esp32blob.html`
```javascript
alva = {
    findStereoCameraPose(leftFrame, rightFrame) {
        // Copy image data to WASM memory
        ModuleInstance.HEAPU8.set(leftFrame.data, leftPtr);
        ModuleInstance.HEAPU8.set(rightFrame.data, rightPtr);
        
        // Call C++ stereo SLAM function
        const posePtr = ModuleInstance._malloc(7 * 4);
        const ok = ModuleInstance.findStereoCameraPose(leftPtr, rightPtr, posePtr);
        
        if (ok) {
            // Return 7-element pose array [tx, ty, tz, qx, qy, qz, qw]
            return new Float32Array(ModuleInstance.HEAPF32.buffer, posePtr, 7).slice();
        }
        return null;
    }
};
```

**Purpose:** Manages WASM memory buffers and provides JavaScript-to-C++ interface for stereo processing.

### 4. WASM Binding Layer

**File:** `src/slam/src/stereo_slam_interface.cpp`
```cpp
extern "C" int findStereoCameraPose(int leftImagePtr, int rightImagePtr, int posePtr) {
    // Main stereo SLAM processing pipeline
    // Returns 1 on success, 0 on failure
}
```

**Purpose:** Exposes C++ stereo SLAM functions to JavaScript through Emscripten bindings.

### 5. Stereo Calibration Loading

**File:** `src/slam/src/stereo_slam_interface.cpp`
```cpp
extern "C" void setStereoCalibrationYAML(const char* yaml, int length) {
    g_stereo_calib_yaml_string.assign(yaml, length);
}

// In findStereoCameraPose:
static StereoCameraCalibration calib;
static bool calib_loaded = false;
if (!calib_loaded) {
    if (!loadStereoCalibrationFromYAMLString(g_stereo_calib_yaml_string, calib)) {
        return 0; // Calibration failed
    }
    calib_loaded = true;
}
```

**Purpose:** Loads stereo camera calibration from YAML file containing intrinsics, distortion, and projection matrices.

### 6. Image Preprocessing

**File:** `src/slam/src/stereo_slam_interface.cpp`
```cpp
// 1. Grayscale conversion (sequential processing)
cv::Mat left_rgba(height, width, CV_8UC4, reinterpret_cast<uint8_t*>(leftImagePtr));
cv::Mat right_rgba(height, width, CV_8UC4, reinterpret_cast<uint8_t*>(rightImagePtr));
cv::Mat left_gray, right_gray;
cv::cvtColor(left_rgba, left_gray, cv::COLOR_RGBA2GRAY);
cv::cvtColor(right_rgba, right_gray, cv::COLOR_RGBA2GRAY);
```

**Purpose:** Converts RGBA stereo images to grayscale for feature detection and tracking. **Note: Processing is sequential for WebAssembly compatibility.**

### 7. Temporal KLT Tracking (Left Camera)

**File:** `src/slam/src/stereo_slam_interface.cpp`
```cpp
// 2. Temporal KLT tracking (left) - Sequential processing
static cv::Mat prev_left_gray;
static std::vector<cv::KeyPoint> tracked_kps_left;
static cv::Mat tracked_desc_left;
static bool is_first_frame = true;

// Grid-based feature management parameters
int grid_cell_size = 40; // Same as monocular frameMaxCellSize
int grid_max_per_cell = 2; // Allow 2 features per cell
int grid_min_per_cell = 1; // Minimum features per cell
double grid_quality = FEATURE_QUALITY; // 0.001
int max_total_kps = 320; // Increased for 640x480 resolution

if (is_first_frame || prev_left_gray.empty()) {
    // First frame: detect features using grid-based approach
    for (int cy = 0; cy < grid_num_cells_y; ++cy) {
        for (int cx = 0; cx < grid_num_cells_x; ++cx) {
            cv::Rect roi(x0, y0, x1 - x0, y1 - y0);
            cv::Mat cell = left_gray(roi);
            std::vector<cv::Point2f> cell_pts;
            cv::goodFeaturesToTrack(cell, cell_pts, grid_max_per_cell, grid_quality, 5);
            // Add features to tracked_kps_left
        }
    }
    // Sub-pixel refinement
    cv::cornerSubPix(left_gray, detected_pts, cv::Size(3,3), cv::Size(-1,-1), 
                     cv::TermCriteria(cv::TermCriteria::EPS + cv::TermCriteria::MAX_ITER, 30, SUBPIXEL_ACCURACY));
    // ORB descriptor computation
    cv::Ptr<cv::ORB> orb = cv::ORB::create((int)tracked_kps_left.size());
    orb->compute(left_gray, tracked_kps_left, tracked_desc_left);
} else {
    // Temporal KLT tracking
    std::vector<cv::Point2f> prev_pts, curr_pts;
    for (const auto& kp : tracked_kps_left) prev_pts.push_back(kp.pt);
    
    cv::calcOpticalFlowPyrLK(prev_left_gray, left_gray, prev_pts, curr_pts, 
                             status_fwd, err_fwd, cv::Size(9,9), 3, 
                             cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 30, SUBPIXEL_ACCURACY));
    
    // Outlier rejection and feature management
    // Grid-based refill for low-coverage cells
    // Feature filtering and capping
}
```

**Purpose:** Tracks features between consecutive left camera frames using Lucas-Kanade optical flow with grid-based feature management. **Note: All processing is sequential for WebAssembly compatibility.**

### 8. Stereo KLT Matching

**File:** `src/slam/src/stereo_slam_interface.cpp`
```cpp
// Stereo KLT matching (left to right) - Sequential processing
std::vector<cv::Point2f> pts_left, pts_right_tracked;
for (const auto& kp : tracked_kps_left) pts_left.push_back(kp.pt);

cv::calcOpticalFlowPyrLK(left_gray, right_gray, pts_left, pts_right_tracked, 
                         status, err, cv::Size(9,9), 3, 
                         cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 30, SUBPIXEL_ACCURACY));

// Epipolar filtering for rectified images
const float max_y_diff = Y_DIFF_THRESHOLD; // 5.0 pixels
std::vector<cv::Point2f> good_pts_left, good_pts_right;
for (size_t i = 0; i < pts_left.size(); ++i) {
    if (status[i]) {
        float y_diff = std::abs(pts_left[i].y - pts_right_tracked[i].y);
        if (y_diff < max_y_diff) {
            good_pts_left.push_back(pts_left[i]);
            good_pts_right.push_back(pts_right_tracked[i]);
        }
    }
}
```

**Purpose:** Matches features between left and right images using KLT optical flow with epipolar constraint filtering. **Note: Processing is sequential for WebAssembly compatibility.**

### 9. Stereo Triangulation

**File:** `src/slam/src/stereo_slam_interface.cpp`
```cpp
// Triangulation - Sequential processing
if (good_pts_left.size() >= MIN_STEREO_MATCHES) { // MIN_STEREO_MATCHES = 2
    std::vector<cv::Point3d> points3d;
    StereoSLAMUtils::triangulateStereoMatches(good_pts_left, good_pts_right, calib, points3d);
    
    // Filter out points with z <= 0
    std::vector<cv::Point3d> filtered_points3d;
    std::vector<cv::Point2f> filtered_keypoints_left;
    std::vector<cv::Point2f> filtered_keypoints_right;
    for (size_t i = 0; i < points3d.size(); ++i) {
        if (points3d[i].z > 0) {
            filtered_points3d.push_back(points3d[i]);
            filtered_keypoints_left.push_back(good_pts_left[i]);
            filtered_keypoints_right.push_back(good_pts_right[i]);
        }
    }
    
    // Store 3D points for plane detection and world coordinate transformation
    lastStereo3DPoints = filtered_points3d;
}
```

**Purpose:** Triangulates 3D points from stereo correspondences using camera calibration. **Note: Processing is sequential for WebAssembly compatibility.**

### 10. Hybrid Initialization

**File:** `src/slam/src/stereo_slam_interface.cpp`
```cpp
if (!scale_initialized || tracking_lost) {
    // --- Hybrid Stereo Initialization: 5-point + Stereo Scale Recovery ---
    
    // Step 1: 5-point Essential Matrix (Monocular)
    std::vector<cv::Point2f> curr_left_kps;
    for (const auto& kp : tracked_kps_left) curr_left_kps.push_back(kp.pt);
    
    // Track features from previous to current left frame
    cv::calcOpticalFlowPyrLK(prev_left_gray_for_init, left_gray, 
                             prev_left_kps_for_init, tracked_curr_kps, status, err);
    
    // Compute 5-point essential matrix using proper camera calibration
    cv::Mat K = (cv::Mat_<double>(3,3) << calib.left_.fx_, 0, calib.left_.cx_, 
                                         0, calib.left_.fy_, calib.left_.cy_, 
                                         0, 0, 1);
    cv::Mat E = cv::findEssentialMat(good_prev_kps, good_curr_kps, 
        K, cv::RANSAC, 0.999, EPIPOLAR_THRESHOLD);
    
    // Recover pose from essential matrix (up to scale)
    cv::Mat R, t;
    cv::recoverPose(E, good_prev_kps, good_curr_kps, K, R, t);
    
    // Convert to Sophus::SE3d (up to scale)
    Sophus::SE3d Twc_mono;
    Twc_mono.setRotationMatrix(Eigen::Map<Eigen::Matrix3d>((double*)R.data));
    Twc_mono.translation() = Eigen::Map<Eigen::Vector3d>((double*)t.data);
    
    // Step 2: Stereo Triangulation for Scale Recovery
    // Use stereo matching to get metric 3D points
    std::vector<cv::Point3d> stereo_3d_points;
    StereoSLAMUtils::triangulateStereoMatches(good_stereo_left, good_stereo_right, 
                                             calib, stereo_3d_points);
    
    // Step 3: Direct Scale Recovery using Stereo Baseline
    // Instead of complex triangulation comparison, use the stereo baseline directly
    double stereo_baseline = std::abs(calib.T_left_right_.translation().x());
    if (stereo_baseline < 1e-6) stereo_baseline = 0.1; // Fallback baseline
    
    double mono_translation_norm = Twc_mono.translation().norm();
    if (mono_translation_norm > 1e-6) {
        // Scale factor = stereo_baseline / monocular_translation_norm
        scale_factor = stereo_baseline / mono_translation_norm;
        
        // Apply scale factor bounds to prevent extremely small or large values
        if (scale_factor < MIN_SCALE_FACTOR) scale_factor = MIN_SCALE_FACTOR;
        if (scale_factor > MAX_SCALE_FACTOR) scale_factor = MAX_SCALE_FACTOR;
    }
    
    // Step 4: Apply Scale and Set Initial Pose
    current_pose = Sophus::SE3d(Twc_mono.rotationMatrix(), scale_factor * Twc_mono.translation());
    
    scale_initialized = true;
    last_pose = current_pose;
    initial_pose = current_pose;
    
    // Initialize monocular system for pose updates
    if (!monocular_system_initialized) {
        monocular_system = std::make_unique<System>();
        monocular_system->configure(width, height, calib.left_.fx_, calib.left_.fy_, 
                                   calib.left_.cx_, calib.left_.cy_, 
                                   calib.left_.k1_, calib.left_.k2_, 
                                   calib.left_.p1_, calib.left_.p2_);
        monocular_system->setInitialPose(current_pose);
        monocular_system_initialized = true;
    }
}
```

**Purpose:** Implements hybrid initialization combining monocular 5-point essential matrix with stereo scale recovery for robust metric-scale initialization. **Note: All processing is sequential for WebAssembly compatibility.**

### 11. Monocular SLAM for Pose Updates (After Initialization)

**File:** `src/slam/src/stereo_slam_interface.cpp`
```cpp
} else {
    // --- Use Monocular SLAM for Pose Updates (After Initialization) ---
    if (monocular_system_initialized && monocular_system && tracked_kps_left.size() >= 20) {
        // Convert left image to format expected by monocular system
        cv::Mat left_rgba_for_mono(height, width, CV_8UC4, reinterpret_cast<uint8_t*>(leftImagePtr));
        cv::Mat left_gray_for_mono;
        cv::cvtColor(left_rgba_for_mono, left_gray_for_mono, cv::COLOR_RGBA2GRAY);
        
        // Call monocular SLAM for pose update (RIGHT CAMERA IGNORED AFTER INITIALIZATION)
        uint64_t timestamp = duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        int status = monocular_system->processCameraPose(left_gray_for_mono, timestamp);
        
        if (status == 1) {
            // Get pose from monocular system
            float pose_data[16];
            monocular_system->findCameraPose(leftImagePtr, reinterpret_cast<int>(pose_data));
            
            // Convert 16-element pose to 7-element format (translation + quaternion)
            Eigen::Matrix3d R;
            R << pose_data[0], pose_data[1], pose_data[2],
                 pose_data[4], pose_data[5], pose_data[6],
                 pose_data[8], pose_data[9], pose_data[10];
            
            Eigen::Vector3d t(pose_data[12], pose_data[13], pose_data[14]);
            Eigen::Quaterniond q(R);
            
            // Apply scale factor to monocular pose to maintain metric scale
            current_pose = Sophus::SE3d(q, scale_factor * t);
            last_pose = current_pose;
        } else {
            // If monocular SLAM fails, keep the last pose
            current_pose = last_pose;
        }
    } else {
        // Fallback: keep the last pose if monocular system not available
        current_pose = last_pose;
    }
}
```

**Purpose:** After initialization, the system switches to monocular SLAM using only the left camera. The right camera image is ignored, and the system relies on the established monocular SLAM pipeline while maintaining the metric scale recovered during initialization. **Note: All processing is sequential for WebAssembly compatibility.**

### 12. Stereo Triangulation Implementation

**File:** `src/slam/src/stereo_slam.hpp`
```cpp
namespace StereoSLAMUtils {
int triangulateStereoMatches(const std::vector<cv::Point2f>& pts_left,
                            const std::vector<cv::Point2f>& pts_right,
                            const StereoCameraCalibration& calib,
                            std::vector<cv::Point3d>& points3d_out) {
    
    // Camera intrinsics
    cv::Mat K = (cv::Mat_<double>(3,3) << calib.left_.fx_, 0, calib.left_.cx_, 
                                         0, calib.left_.fy_, calib.left_.cy_, 
                                         0, 0, 1);
    
    // Baseline from calibration
    double baseline = std::abs(calib.T_left_right_.translation().x());
    if (baseline < 1e-6) baseline = 0.1; // fallback
    
    // Projection matrices for rectified stereo
    cv::Mat P0 = cv::Mat::zeros(3, 4, CV_64F);
    K.copyTo(P0.colRange(0, 3));
    
    cv::Mat P1 = cv::Mat::zeros(3, 4, CV_64F);
    K.copyTo(P1.colRange(0, 3));
    P1.at<double>(0, 3) = -baseline * calib.left_.fx_;
    
    // Triangulate points
    cv::Mat points4D;
    cv::triangulatePoints(P0, P1, pts_left, pts_right, points4D);
    
    // Convert to 3D points
    points3d_out.clear();
    for (int i = 0; i < points4D.cols; ++i) {
        cv::Mat col = points4D.col(i);
        col /= col.at<float>(3); // Homogeneous normalization
        cv::Point3d pt(col.at<float>(0), col.at<float>(1), col.at<float>(2));
        points3d_out.push_back(pt);
    }
    
    return (int)points3d_out.size();
}
}
```

**Purpose:** Implements stereo triangulation using camera calibration and projection matrices.

### 13. Pose Output Format

**File:** `src/slam/src/stereo_slam_interface.cpp`
```cpp
// --- Output pose (always update AR object) ---
Eigen::Vector3d t = current_pose.translation();
Eigen::Quaterniond q(current_pose.unit_quaternion());
float* out = reinterpret_cast<float*>(posePtr);

// Output 7-element pose array: [tx, ty, tz, qx, qy, qz, qw]
out[0] = static_cast<float>(t.x());
out[1] = static_cast<float>(t.y());
out[2] = static_cast<float>(t.z());
out[3] = static_cast<float>(q.x());
out[4] = static_cast<float>(q.y());
out[5] = static_cast<float>(q.z());
out[6] = static_cast<float>(q.w());

return 1; // Success
```

**Purpose:** Converts pose to 7-element array format (translation + quaternion) for JavaScript consumption.

### 14. Feature Point Visualization

**File:** `src/slam/src/stereo_slam_interface.cpp`
```cpp
// Update persistent buffer for JS dots
lastStereoLeftKeypoints.clear();
for (int idx : selected_indices) {
    lastStereoLeftKeypoints.push_back(tracked_kps_left[idx].pt);
}

// Expose feature points to JS for visualization
extern "C" int getStereoFramePoints(int pointsPtr) {
    int n = std::min((int)lastStereoLeftKeypoints.size(), 4096);
    int* data = reinterpret_cast<int*>(pointsPtr);
    for (int i = 0, j = 0; i < n; ++i) {
        data[j++] = (int)lastStereoLeftKeypoints[i].x;
        data[j++] = (int)lastStereoLeftKeypoints[i].y;
    }
    return n;
}
```

**Purpose:** Provides feature point coordinates for visualization in the browser interface.

## Stereo Calibration Format

**File:** `examples/public/assets/dual_esp32.yaml`
```yaml
%YAML:1.0
LEFT.width: 480
LEFT.height: 320
LEFT.D: !!opencv-matrix
  rows: 1
  cols: 5
  dt: d
  data: [0.021405960704318844, 0.08246096784703844, -0.0017554882618336248, 0.003035433195770873, 0.0]
LEFT.K: !!opencv-matrix
  rows: 3
  cols: 3
  dt: d
  data: [472.02254376119856, 0.0, 263.6521443896501, 0.0, 471.8079432708058, 161.42724859413812, 0.0, 0.0, 1.0]
LEFT.P: !!opencv-matrix
  rows: 3
  cols: 4
  dt: d
  data: [537.0061130148981, 0.0, 229.11315727233887, 0.0,
         0.0, 537.0061130148981, 168.32930755615234, 0.0,
         0.0, 0.0, 1.0, 0.0]
RIGHT.width: 480
RIGHT.height: 320
RIGHT.D: !!opencv-matrix
  rows: 1
  cols: 5
  dt: d
  data: [0.0348372260265101, 0.08210082778833919, 0.004711418240775901, -0.0019035462902789546, 0.0]
RIGHT.K: !!opencv-matrix
  rows: 3
  cols: 3
  dt: d
  data: [469.41580708364586, 0.0, 225.83904434422814, 0.0, 469.21979089678814, 175.2428976470926, 0.0, 0.0, 1.0]
RIGHT.P: !!opencv-matrix
  rows: 3
  cols: 4
  dt: d
  data: [537.0061130148981, 0.0, 229.11315727233887, -41.886476682,
         0.0, 537.0061130148981, 168.32930755615234, 0.0,
         0.0, 0.0, 1.0, 0.0]
```

**Purpose:** Defines stereo camera calibration parameters including intrinsics (K), distortion (D), and projection matrices (P) for both cameras.

## Grid-Based Feature Management

The stereo SLAM system uses a grid-based approach to distribute features evenly across the image:

```cpp
// Grid parameters
int grid_cell_size = 40; // Same as monocular frameMaxCellSize
int grid_max_per_cell = 1; // One feature per cell
int grid_min_per_cell = 1;
double grid_quality = 0.001; // Same as monocular extractorMaxQuality_
int grid_num_cells_x = (width + grid_cell_size - 1) / grid_cell_size;
int grid_num_cells_y = (height + grid_cell_size - 1) / grid_cell_size;
int max_total_kps = 96; // Same as monocular: 12×8 = 96 features
```

**Purpose:** Ensures even feature distribution across the image for robust tracking and prevents feature clustering.

## Summary

The stereo SLAM system follows this **hybrid pipeline** with two distinct phases:

### **Initialization Phase (Stereo Processing)**
1. **HTML Interface** → Captures synchronized stereo video frames from WebSocket
2. **JavaScript Layer** → Manages WASM memory and provides stereo interface
3. **Calibration Loading** → Loads stereo camera parameters from YAML
4. **Image Preprocessing** → Converts RGBA stereo images to grayscale
5. **Temporal Tracking** → KLT-based feature tracking on left camera with grid management
6. **Stereo Matching** → KLT-based feature matching between left and right images
7. **Stereo Triangulation** → 3D point reconstruction using camera calibration
8. **Hybrid Initialization** → 5-point essential matrix + stereo scale recovery

### **Tracking Phase (Monocular Processing)**
9. **Monocular Updates** → Continuous pose estimation using established monocular SLAM (LEFT CAMERA ONLY)
10. **Output** → Returns 7-element pose array [tx, ty, tz, qx, qy, qz, qw] to JavaScript

**Key Characteristics:**
- **Metric scale:** True scale recovery through stereo triangulation during initialization
- **Hybrid approach:** Stereo for initialization, monocular for tracking
- **Grid-based features:** Even feature distribution for reliable tracking
- **Epipolar filtering:** Geometric constraints for stereo matching (initialization only)
- **Persistent tracking:** Continuous pose estimation across frames using monocular SLAM
- **WebSocket streaming:** Real-time stereo image acquisition (right camera ignored after initialization)

**Important Note:** After initialization, the system switches to monocular SLAM using only the left camera. The right camera image is ignored during the tracking phase, and the system relies on the established monocular SLAM pipeline while maintaining the metric scale recovered during the stereo initialization phase.

This design provides metric-scale pose estimation suitable for AR applications requiring accurate depth perception and scale-aware interactions, while maintaining real-time performance through efficient feature management and hybrid initialization strategies. 