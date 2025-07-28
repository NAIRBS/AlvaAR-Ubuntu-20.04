#pragma once
#include <opencv2/core.hpp>
#include <vector>
#include <memory>
#include "camera_calibration.hpp"
#include "state.hpp"
#include "frame.hpp"
#include "map_manager.hpp"
#include "mapper.hpp"
#include "visual_frontend.hpp"
#include "feature_extractor.hpp"

// OV2SLAM-style Stereo SLAM for AlvaAR
// This header defines the main stereo SLAM class and interface, adapted from OV2SLAM.

class StereoSLAM {
public:
    StereoSLAM();
    ~StereoSLAM();

    // Initialize with calibration
    void initialize(const CameraCalibration& left, const CameraCalibration& right);

    // Process a stereo frame and estimate pose
    // left_rgba, right_rgba: RGBA images from JS/WASM
    // width, height: image dimensions
    // pose_out: output pose (4x4 matrix or [tx,ty,tz,qx,qy,qz,qw])
    bool processFrame(const uint8_t* left_rgba, const uint8_t* right_rgba, int width, int height, float* pose_out);

    // Public getters for calibration (for interface use)
    const CameraCalibration& getLeftCalibration() const { return left_calib_; }
    const CameraCalibration& getRightCalibration() const { return right_calib_; }

private:
    // Calibration
    CameraCalibration left_calib_;
    CameraCalibration right_calib_;

    // OV2SLAM-style pipeline modules
    std::shared_ptr<State> state_;
    std::shared_ptr<Frame> currFrame_;
    std::shared_ptr<MapManager> mapManager_;
    std::shared_ptr<Mapper> mapper_;
    std::unique_ptr<VisualFrontend> visualFrontend_;
    std::shared_ptr<FeatureExtractor> featureExtractor_;
    std::shared_ptr<FeatureTracker> featureTracker_;
    // Add more as needed (e.g., keyframe database, loop closure, etc.)
    Sophus::SE3d lastKeyframePose_;
    int lastKeyframeTracked_ = 0;
};

// Add OV2SLAM-style stereo helpers for browser pipeline
namespace StereoSLAMUtils {
int triangulateStereoMatches(const std::vector<cv::Point2f>& pts_left,
                            const std::vector<cv::Point2f>& pts_right,
                            const StereoCameraCalibration& calib,
                            std::vector<cv::Point3d>& points3d_out);

bool estimateStereoPose(
    const std::vector<cv::Point3d>& points3d,
    const std::vector<cv::Point2f>& keypoints_left,
    const std::vector<cv::Point2f>& keypoints_right,
    const StereoCameraCalibration& calib,
    Sophus::SE3d& pose_out);
} 