# Monocular SLAM Function Call Chain Documentation

This document traces the complete function call chain for the monocular SLAM system in AlvaAR, from HTML interface to C++ backend processing, and compares it to the current stereo SLAM implementation. **Relevant code snippets and full relative code paths are included for clarity.**

## Overview

The monocular SLAM system in this codebase provides **bare-basics pose estimation** without persistent state management. It processes each frame independently to estimate camera pose using feature tracking and pose estimation from existing 3D map points. **It does not triangulate new 3D points from the current frame, does not maintain a persistent map or keyframes, and does not perform full bundle adjustment.**

- **No triangulation:** Monocular SLAM only uses 3D points that were already available (e.g., from initialization or previous mapping), and does not create new 3D points from the current frame.
- **No persistent map or keyframes:** There is no long-term map or keyframe management; each frame is processed independently.
- **Pose estimation:** Camera pose is estimated using P3P/PnP with existing 3D points and tracked 2D features.
- **Bundle adjustment:** Only motion-only BA (Ceres PnP) is used for pose refinement, not full BA over a map.
- **Scale ambiguity:** As with all monocular pipelines, the scale of the reconstruction is ambiguous.

---

## Function Call Chain

### 1. HTML Interface Layer

**File:** `examples/public/camera.html` (or similar HTML files)
```javascript
// Main render loop
function render() {
    // Get image from video/camera
    ctx.drawImage(video, 0, 0, width, height);
    const frame = ctx.getImageData(0, 0, width, height);
    
    // Call monocular SLAM
    const pose = alva.findCameraPose(frame);
    
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
```

**Purpose:** Provides user interface, captures video frames, and displays results.

### 2. JavaScript Interface Layer

**File:** `src/system.js`
```javascript
class AlvaAR {
    findCameraPose(frame) {
        // Copy image data to WASM memory
        this.memImg.write(frame.data);
        
        // Call C++ SLAM function
        const status = this.system.findCameraPose(
            this.memImg.heap.byteOffset, 
            this.memCam.ptr
        );
        
        if (status === 1) {
            // Return 4x4 pose matrix [R|t; 0|1]
            return this.memCam.read(16);
        }
        return null; // Tracking failed or initializing
    }
}
```

**Purpose:** Manages WASM memory buffers and provides JavaScript-to-C++ interface.

### 3. WASM Binding Layer

**File:** `src/slam/src/embind.cpp`
```cpp
EMSCRIPTEN_BINDINGS(Module) {
    class_<System>("System")
        .function("findCameraPose", &System::findCameraPose, allow_raw_pointers())
        .function("getFramePoints", &System::getFramePoints);
}
```

**Purpose:** Exposes C++ functions to JavaScript through Emscripten bindings.

### 4. System Entry Point

**File:** `src/slam/src/system.cpp`
```cpp
int System::findCameraPose(int imageRGBADataPtr, int posePtr) {
    // Convert RGBA to grayscale
    auto *imageData = reinterpret_cast<uint8_t *>(imageRGBADataPtr);
    cv::Mat image = cv::Mat(state_->imgHeight_, state_->imgWidth_, CV_8UC4, imageData);
    cv::cvtColor(image, image, cv::COLOR_RGBA2GRAY);
    
    // Process with timestamp
    uint64_t timestamp = duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
    
    int status = processCameraPose(image, timestamp);
    
    // Convert pose to output array
    Utils::toPoseArray(currFrame_->getTwc(), poseData);
    return status;
}
```

**Purpose:** Converts image data format and calls the main SLAM processing pipeline.

### 5. Main SLAM Processing

**File:** `src/slam/src/system.cpp`
```cpp
int System::processCameraPose(cv::Mat &image, double timestamp) {
    currFrame_->id_++;
    currFrame_->timestamp_ = timestamp;
    
    // Main SLAM processing through VisualFrontend
    visualFrontend_->track(image, timestamp);
    
    // Handle system state
    if (state_->slamResetRequested_) {
        reset();
        return 2;  // Reset requested
    }
    
    if (!state_->slamReadyForInit_) {
        return 3;  // Not ready for initialization
    }
    
    return 1;  // Success
}
```

**Purpose:** Manages frame processing and system state transitions.

### 6. Visual Frontend Processing

**File:** `src/slam/src/visual_frontend.cpp`
```cpp
void VisualFrontend::track(cv::Mat &image, double timestamp) {
    bool isKeyFrameRequired = process(image, timestamp);
    
    if (isKeyFrameRequired) {
        // Create new keyframe and process with mapper
        mapManager_->createKeyframe(currImage_, image);
        
        if (!state_->slamResetRequested_ && state_->slamReadyForInit_) {
            Keyframe kf(currFrame_->keyframeId_, image);
            mapper_->processNewKeyframe(kf);
        }
    }
}
```

**Purpose:** Orchestrates the main SLAM pipeline including feature tracking and pose estimation.

### 7. Core Processing Pipeline

**File:** `src/slam/src/visual_frontend.cpp`
```cpp
bool VisualFrontend::process(cv::Mat &image, double timestamp) {
    // 1. Preprocess image (CLAHE, pyramid building)
    preprocessImage(image);
    
    // 2. First frame handling
    if (currFrame_->id_ == 0) {
        return true;  // Create keyframe
    }
    
    // 3. Motion model prediction
    Sophus::SE3d Twc = currFrame_->getTwc();
    motionModel_.applyMotionModel(Twc, timestamp);
    currFrame_->setTwc(Twc);
    
    // 4. KLT tracking from motion prior
    kltTrackingFromMotionPrior();
    
    // 5. Initialization check
    if (!state_->slamReadyForInit_) {
        if (currFrame_->numKeypoints2d_ < 50) {
            state_->slamResetRequested_ = true;
            return false;
        }
        
        if (checkReadyForInit()) {
            state_->slamReadyForInit_ = true;
            return true;
        }
        return false;
    }
    
    // 6. Pose computation (after initialization)
    bool success = computePose();
    if (!success) {
        poseFailedCounter_++;
        if (poseFailedCounter_ > 3) {
            state_->slamResetRequested_ = true;
            return false;
        }
    }
    
    // 7. Update motion model and check for new keyframe
    motionModel_.updateMotionModel(currFrame_->Twc_, timestamp);
    bool keyFrameRequired = checkNewKeyframeRequired();
    return keyFrameRequired;
}
```

**Purpose:** Implements the core SLAM logic with initialization, tracking, and pose estimation.

### 8. Image Preprocessing

**File:** `src/slam/src/visual_frontend.cpp`
```cpp
void VisualFrontend::preprocessImage(cv::Mat &image) {
    // Update previous image
    cv::swap(currImage_, prevImage_);
    
    // Apply CLAHE if enabled
    if (state_->claheEnabled_) {
        clahe_->apply(image, currImage_);
    } else {
        currImage_ = image;
    }
    
    // Build optical flow pyramid for KLT tracking
    if (state_->kltEnabled_) {
        if (!currPyramid_.empty()) {
            prevPyramid_.swap(currPyramid_);
        }
        cv::buildOpticalFlowPyramid(currImage_, currPyramid_, 
                                   state_->kltWinSize_, state_->kltPyramidLevels_);
    }
}
```

**Purpose:** Prepares images for feature tracking by applying contrast enhancement and building image pyramids.

### 9. KLT Feature Tracking

**File:** `src/slam/src/visual_frontend.cpp`
```cpp
void VisualFrontend::kltTrackingFromMotionPrior() {
    // Separate 3D and 2D keypoints for different tracking strategies
    std::vector<cv::Point2f> v3dkps, v3dpriors;
    std::vector<cv::Point2f> vkps, vpriors;
    
    // Track 3D keypoints with motion prior (fewer pyramid levels)
    if (state_->kltUsePrior_ && !v3dpriors.empty()) {
        featureTracker_->fbKltTracking(
            prevPyramid_, currPyramid_,
            state_->kltWinSizeWH_, 1,  // 1 pyramid level for 3D points
            state_->kltError_, state_->kltMaxFbDistance_,
            v3dkps, v3dpriors, keypointStatus
        );
    }
    
    // Track 2D keypoints with full pyramid
    if (!vkps.empty()) {
        featureTracker_->fbKltTracking(
            prevPyramid_, currPyramid_,
            state_->kltWinSizeWH_, state_->kltPyramidLevels_,
            state_->kltError_, state_->kltMaxFbDistance_,
            vkps, vpriors, keypointStatus
        );
    }
}
```

**Purpose:** Tracks features between consecutive frames using Lucas-Kanade optical flow.

### 10. Feature Tracker Implementation

**File:** `src/slam/src/feature_tracker.cpp`
```cpp
void FeatureTracker::fbKltTracking(const std::vector<cv::Mat> &prevPyramid, 
                                   const std::vector<cv::Mat> &currPyramid,
                                   int winSize, int numPyramidLevels, 
                                   float errorValue, float maxFbkltDistance,
                                   std::vector<cv::Point2f> &points,
                                   std::vector<cv::Point2f> &priorKeypoints, 
                                   std::vector<bool> &keypointStatus) const {
    // Forward tracking
    cv::calcOpticalFlowPyrLK(prevPyramid, currPyramid, points, priorKeypoints, 
                             status, errors, cv::Size(winSize, winSize), 
                             numPyramidLevels, kltConvCriteria_,
                             cv::OPTFLOW_USE_INITIAL_FLOW + cv::OPTFLOW_LK_GET_MIN_EIGENVALS);
    
    // Backward tracking for outlier rejection
    cv::calcOpticalFlowPyrLK(currPyramid, prevPyramid, priorKeypoints, backKeypoints,
                             backStatus, backErrors, cv::Size(winSize, winSize),
                             numPyramidLevels, kltConvCriteria_,
                             cv::OPTFLOW_USE_INITIAL_FLOW + cv::OPTFLOW_LK_GET_MIN_EIGENVALS);
    
    // Outlier rejection based on forward-backward consistency
    for (size_t i = 0; i < points.size(); i++) {
        float fbDistance = cv::norm(points[i] - backKeypoints[i]);
        keypointStatus[i] = status[i] && backStatus[i] && fbDistance < maxFbkltDistance;
    }
}
```

**Purpose:** Implements forward-backward KLT tracking with outlier rejection.

### 11. Initialization Check

**File:** `src/slam/src/visual_frontend.cpp`
```cpp
bool VisualFrontend::checkReadyForInit() {
    // Compute parallax between current frame and previous keyframe
    double avgComputedRotParallax = computeParallax(currFrame_->keyframeId_, false, true);
    
    if (avgComputedRotParallax <= state_->minAvgRotationParallax_) {
        return false;
    }
    
    // Check minimum keypoint count
    if (currFrame_->numKeypoints_ < 8) {
        return false;
    }
    
    // Compute 5-point essential matrix for initialization
    bool success = MultiViewGeometry::compute5ptEssentialMatrix(
        vkfbvs, vcurbvs,
        state_->multiViewRansacNumIterations_,
        state_->multiViewRansacError_,
        true, // optimize
        state_->multiViewRandomEnabled_,
        currFrame_->cameraCalibration_->fx_,
        currFrame_->cameraCalibration_->fy_,
        Rwc, twc, outliersIndices
    );
    
    if (success) {
        // Normalize translation scale and set initial pose
        twc.normalize();
        currFrame_->setTwc(Rwc, twc);
        return true;
    }
    
    return false;
}
```

**Purpose:** Determines when the system is ready for SLAM initialization using essential matrix estimation.

### 12. Essential Matrix Computation

**File:** `src/slam/src/multi_view_geometry.cpp`
```cpp
bool MultiViewGeometry::compute5ptEssentialMatrix(
    const std::vector<Eigen::Vector3d> &observations1,
    const std::vector<Eigen::Vector3d> &observations2,
    const int maxIterations, const float errorThreshold,
    const bool optimize, const bool doRandom,
    const float fx, const float fy,
    Eigen::Matrix3d &Rwc, Eigen::Vector3d &twc,
    std::vector<int> &outliersIndices) {
    
    // Create OpenGV adapter for bearing vectors
    opengv::relative_pose::CentralRelativeAdapter adapter(bearingVectors1, bearingVectors2);
    
    // Create RANSAC problem for 5-point essential matrix
    opengv::sac::Ransac<opengv::sac_problems::relative_pose::CentralRelativePoseSacProblem> ransac;
    
    std::shared_ptr<opengv::sac_problems::relative_pose::CentralRelativePoseSacProblem> relposeproblem_ptr(
        new opengv::sac_problems::relative_pose::CentralRelativePoseSacProblem(
            adapter, opengv::sac_problems::relative_pose::CentralRelativePoseSacProblem::NISTER, doRandom
        )
    );
    
    // Run RANSAC
    ransac.sac_model_ = relposeproblem_ptr;
    ransac.threshold_ = 2.0 * (1.0 - cos(atan(errorThreshold / focal)));
    ransac.max_iterations_ = maxIterations;
    ransac.computeModel(0);
    
    // Extract rotation and translation from essential matrix
    if (ransac.inliers_.size() >= 5) {
        // Decompose essential matrix to get R and t
        // ... (OpenGV decomposition logic)
        return true;
    }
    
    return false;
}
```

**Purpose:** Computes the essential matrix between two views using the 5-point algorithm with RANSAC.

### 13. Pose Computation

**File:** `src/slam/src/visual_frontend.cpp`
```cpp
bool VisualFrontend::computePose() {
    size_t num3dKeypoints = currFrame_->numKeypoints3d_;
    
    if (num3dKeypoints < 4) {
        return false;
    }
    
    // Prepare data for P3P-RANSAC
    std::vector<Eigen::Vector3d> vbvs, vwpts;
    std::vector<Eigen::Vector2d> vkps;
    std::vector<int> outliersIndices;
    
    // Collect 3D keypoints and their world coordinates
    for (const auto &it: currFrame_->mapKeypoints_) {
        if (!it.second.is3d_) continue;
        
        auto &kp = it.second;
        auto plm = mapManager_->mapMapPoints_.at(kp.keypointId_);
        
        if (plm == nullptr) continue;
        
        vbvs.push_back(kp.bv_);
        vkps.push_back(Eigen::Vector2d(kp.unpx_.x, kp.unpx_.y));
        vwpts.push_back(plm->getPoint());
    }
    
    Sophus::SE3d Twc = currFrame_->getTwc();
    bool success = false;
    
    // P3P-RANSAC for robust pose estimation
    if (p3pReq_ || state_->p3pEnabled_) {
        success = MultiViewGeometry::p3pRansac(
            vbvs, vwpts,
            state_->multiViewRansacNumIterations_,
            state_->multiViewRansacError_,
            false, // doOptimize
            state_->multiViewRandomEnabled_,
            currFrame_->cameraCalibration_->fx_,
            currFrame_->cameraCalibration_->fy_,
            Twc, outliersIndices
        );
        
        // Check pose quality
        size_t numInliers = vwpts.size() - outliersIndices.size();
        if (!success || numInliers < 5) {
            resetFrame();
            return false;
        }
        
        currFrame_->setTwc(Twc);
    }
    
    // Ceres-based PnP refinement
    success = MultiViewGeometry::ceresPnP(
        vkps, vwpts, Twc,
        5, // maxIterations
        state_->robustCostThreshold_,
        true, // useRobust
        state_->robustCostRefineWithL2_,
        currFrame_->cameraCalibration_->fx_,
        currFrame_->cameraCalibration_->fy_,
        currFrame_->cameraCalibration_->cx_,
        currFrame_->cameraCalibration_->cy_,
        outliersIndices
    );
    
    if (success) {
        currFrame_->setTwc(Twc);
        return true;
    }
    
    return false;
}
```

**Purpose:** Estimates camera pose using P3P-RANSAC followed by Ceres-based optimization.

### 14. P3P-RANSAC Implementation

**File:** `src/slam/src/multi_view_geometry.cpp`
```cpp
bool MultiViewGeometry::p3pRansac(
    const std::vector<Eigen::Vector3d> &observations,
    const std::vector<Eigen::Vector3d> &wPoints,
    const int maxIterations, const float errorThreshold,
    const bool optimize, const bool doRandom,
    const float fx, const float fy,
    Sophus::SE3d &Twc, std::vector<int> &outliersIndices) {
    
    // Create OpenGV adapter for absolute pose estimation
    opengv::absolute_pose::CentralAbsoluteAdapter adapter(gvbvs, gvwpt);
    
    // Create RANSAC problem for P3P
    opengv::sac::Lmeds<opengv::sac_problems::absolute_pose::AbsolutePoseSacProblem> ransac;
    
    std::shared_ptr<opengv::sac_problems::absolute_pose::AbsolutePoseSacProblem> absposeproblem_ptr(
        new opengv::sac_problems::absolute_pose::AbsolutePoseSacProblem(
            adapter, opengv::sac_problems::absolute_pose::AbsolutePoseSacProblem::KNEIP, doRandom
        )
    );
    
    // Run RANSAC
    ransac.sac_model_ = absposeproblem_ptr;
    ransac.threshold_ = (1.0 - cos(atan(errorThreshold / focal)));
    ransac.max_iterations_ = maxIterations;
    ransac.computeModel(0);
    
    // Extract pose from RANSAC result
    if (ransac.inliers_.size() >= 5) {
        // Convert OpenGV pose to Sophus::SE3d
        // ... (pose conversion logic)
        return true;
    }
    
    return false;
}
```

**Purpose:** Implements robust P3P pose estimation using RANSAC with LMEDS.

### 15. Ceres PnP Refinement

**File:** `src/slam/src/multi_view_geometry.cpp`
```cpp
bool MultiViewGeometry::ceresPnP(
    const std::vector<Eigen::Vector2d> &unKeypoints,
    const std::vector<Eigen::Vector3d> &wPoints,
    Sophus::SE3d &Twc, const int maxIterations,
    const float chi2th, const bool useRobust,
    const bool applyL2AfterRobust,
    const float fx, const float fy, const float cx, const float cy,
    std::vector<int> &outliersIndices) {
    
    ceres::Problem problem;
    
    // Set up loss function for robust optimization
    ceres::LossFunctionWrapper *lossFunction;
    lossFunction = new ceres::LossFunctionWrapper(new ceres::HuberLoss(chi2ThresholdSqrt), ceres::TAKE_OWNERSHIP);
    
    if (!useRobust) {
        lossFunction->Reset(NULL, ceres::TAKE_OWNERSHIP);
    }
    
    // Add pose parameter block
    ceres::LocalParameterization *local_parameterization = new SE3Parameterization();
    PoseParametersBlock posepar = PoseParametersBlock(0, Twc);
    problem.AddParameterBlock(posepar.values(), 7, local_parameterization);
    
    // Add reprojection error residuals
    for (size_t i = 0; i < numKeyPoints; i++) {
        DirectSE3::ReprojectionErrorSE3 *f = new DirectSE3::ReprojectionErrorSE3(
            unKeypoints[i].x(), unKeypoints[i].y(), fx, fy, cx, cy, wPoints.at(i), scale
        );
        problem.AddResidualBlock(f, lossFunction, posepar.values());
    }
    
    // Solve optimization problem
    ceres::Solver::Options options;
    options.linear_solver_type = ceres::DENSE_QR;
    options.trust_region_strategy_type = ceres::LEVENBERG_MARQUARDT;
    options.max_num_iterations = maxIterations;
    
    ceres::Solver::Summary summary;
    ceres::Solve(options, &problem, &summary);
    
    // Update pose
    Twc = posepar.getPose();
    
    return summary.termination_type == ceres::CONVERGENCE;
}
```

**Purpose:** Refines pose estimation using Ceres-based bundle adjustment optimization.

## Summary

The monocular SLAM system follows this simplified pipeline:

1. **HTML Interface** → Captures video frames and displays results
2. **JavaScript Layer** → Manages WASM memory and provides interface
3. **System Entry** → Converts image format and manages frame processing
4. **Visual Frontend** → Orchestrates the SLAM pipeline
5. **Feature Tracking** → KLT-based feature tracking between frames
6. **Initialization** → 5-point essential matrix for initial pose
7. **Pose Estimation** → P3P-RANSAC + Ceres optimization for robust pose
8. **Output** → Returns 4x4 pose matrix to JavaScript

**Key Characteristics:**
- **No persistent state**: Each frame processed independently
- **Bare basics only**: No map maintenance or loop closure
- **Scale ambiguity**: No metric scale recovery
- **Reset on failure**: Complete restart when tracking fails
- **Real-time focus**: Optimized for speed over accuracy

This design prioritizes real-time performance and simplicity over full SLAM capabilities, making it suitable for basic AR applications where immediate pose estimates are more important than long-term mapping. 