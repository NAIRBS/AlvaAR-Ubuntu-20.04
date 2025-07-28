#include "stereo_slam.hpp"
#include "camera_calibration.hpp"
#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>
#include <vector>
#include <memory>
#include <iostream>
#include "orb_extractor.hpp"
#include "map_point.hpp"
#include <opencv2/video/tracking.hpp>

// OV2SLAM-style Stereo SLAM for AlvaAR
// This file implements the main stereo SLAM class and logic, adapted from OV2SLAM.

StereoSLAM::StereoSLAM() {}
StereoSLAM::~StereoSLAM() {}

void StereoSLAM::initialize(const CameraCalibration& left, const CameraCalibration& right) {
    left_calib_ = left;
    right_calib_ = right;
    // Set up OV2SLAM-style pipeline
    int width = static_cast<int>(left.imgWidth_);
    int height = static_cast<int>(left.imgHeight_);
    state_ = std::make_shared<State>(width, height, 20); // Lower max keypoints for speed
    state_->debug_ = false;
    state_->claheEnabled_ = false;
    state_->mapKeyframeFilteringRatio_ = 0.95;
    state_->p3pEnabled_ = true;
    state_->frameMaxNumKeypoints_ = 20; // Aggressively limit keypoints
    state_->extractorMaxQuality_ = 0.01; // Be more selective
    currFrame_ = std::make_shared<Frame>(std::make_shared<CameraCalibration>(left), state_->frameMaxCellSize_);
    featureExtractor_ = std::make_shared<FeatureExtractor>(state_->extractorMaxQuality_);
    mapManager_ = std::make_shared<MapManager>(state_, currFrame_, featureExtractor_);
    mapper_ = std::make_shared<Mapper>(state_, mapManager_, currFrame_);
    featureTracker_ = std::make_shared<FeatureTracker>(state_->trackerMaxIterations_, state_->trackerMaxPxPrecision_);
    visualFrontend_ = std::make_unique<VisualFrontend>(state_, currFrame_, mapManager_, mapper_, featureTracker_);
}

// Helper: Triangulate and create stereo map points (adapted from OV2SLAM)
void triangulateStereoMapPoints(const std::vector<cv::KeyPoint>& leftKps, const std::vector<cv::KeyPoint>& rightKps, const std::vector<cv::DMatch>& matches, const CameraCalibration& left_calib, const CameraCalibration& right_calib, std::vector<float>& stereo_depth) {
    // Camera intrinsics
    cv::Mat K = (cv::Mat_<double>(3,3) << left_calib.fx_, 0, left_calib.cx_, 0, left_calib.fy_, left_calib.cy_, 0, 0, 1);
    double baseline = std::abs(right_calib.getTranslation().x());
    if (baseline < 1e-6) baseline = 0.1;
    // Proper 3x4 projection matrices
    cv::Mat P0 = cv::Mat::zeros(3, 4, CV_64F);
    K.copyTo(P0.colRange(0, 3));
    cv::Mat P1 = cv::Mat::zeros(3, 4, CV_64F);
    K.copyTo(P1.colRange(0, 3));
    P1.at<double>(0, 3) = -baseline * left_calib.fx_;
    std::vector<cv::Point2f> pts_left, pts_right;
    for (const auto& m : matches) {
        pts_left.push_back(leftKps[m.queryIdx].pt);
        pts_right.push_back(rightKps[m.trainIdx].pt);
    }
    cv::Mat points4D;
    cv::triangulatePoints(P0, P1, pts_left, pts_right, points4D);
    stereo_depth.clear();
    for (int i = 0; i < points4D.cols; ++i) {
        cv::Mat col = points4D.col(i);
        col /= col.at<float>(3);
        float z = col.at<float>(2);
        stereo_depth.push_back(z);
    }
}

// Helper: Create new stereo map points and add to map manager (adapted from OV2SLAM)
void createStereoMapPoints(const std::vector<cv::KeyPoint>& leftKps, const std::vector<cv::KeyPoint>& rightKps, const std::vector<cv::DMatch>& matches, const std::vector<float>& stereo_depth, std::shared_ptr<MapManager> mapManager, std::shared_ptr<Frame> keyframe) {
    const size_t max_points = 20; // Limit number of 3D points per frame for speed
    size_t num_created = 0;
    for (size_t i = 0; i < matches.size(); ++i) {
        if (num_created >= max_points) break;
        int idxL = matches[i].queryIdx;
        int idxR = matches[i].trainIdx;
        float z = stereo_depth[i];
        if (z > 0.1 && z < 100.0) {
            // Triangulate 3D point in camera coordinates
            float uL = leftKps[idxL].pt.x;
            float vL = leftKps[idxL].pt.y;
            float uR = rightKps[idxR].pt.x;
            // Use calibration to compute 3D point (simplified, as in OV2SLAM)
            float fx = keyframe->cameraCalibration_->fx_;
            float cx = keyframe->cameraCalibration_->cx_;
            float cy = keyframe->cameraCalibration_->cy_;
            float x = (uL - cx) * z / fx;
            float y = (vL - cy) * z / fx;
            float X = x, Y = y, Z = z;
            Eigen::Vector3d pt3d(X, Y, Z);
            // Add to map manager (in OV2SLAM, creates MapPoint and adds observation)
            mapManager->addMapPoint(pt3d, keyframe, idxL);
            num_created++;
        }
    }
}

// Helper: Create and add a new keyframe to the map manager (adapted from OV2SLAM)
void createAndAddKeyframe(const std::vector<cv::KeyPoint>& leftKps, const cv::Mat& leftDesc, const std::vector<cv::KeyPoint>& rightKps, const cv::Mat& rightDesc, const std::vector<float>& stereo_depth, std::shared_ptr<MapManager> mapManager, std::shared_ptr<CameraCalibration> calib, Sophus::SE3d pose, double timestamp) {
    // Create a new Frame (keyframe) with all stereo data
    std::shared_ptr<Frame> newKeyframe = std::make_shared<Frame>(calib, 35); // 35: cell size as in OV2SLAM
    newKeyframe->setStereoData(rightKps, rightDesc, stereo_depth);
    newKeyframe->Twc_ = pose;
    newKeyframe->timestamp_ = timestamp;
    // Add to map manager (in OV2SLAM, also updates covisibility graph)
    mapManager->addKeyframe(newKeyframe);
    // TODO: Update covisibility graph and keyframe connections as in OV2SLAM
}

bool shouldInsertKeyframe(const Sophus::SE3d& lastPose, const Sophus::SE3d& currPose, int trackedPoints, int minTracked = 50, double minTrans = 0.1, double minRot = 0.05) {
    double trans = (lastPose.translation() - currPose.translation()).norm();
    double rot = (lastPose.so3().log() - currPose.so3().log()).norm();
    return (trans > minTrans || rot > minRot || trackedPoints < minTracked);
}

bool StereoSLAM::processFrame(const uint8_t* left_rgba, const uint8_t* right_rgba, int width, int height, float* pose_out) {
    // Watchdog timer start
    auto t_start = std::chrono::high_resolution_clock::now();
    // 1. Convert RGBA to grayscale
    cv::Mat left_img(height, width, CV_8UC4, const_cast<uint8_t*>(left_rgba));
    cv::Mat right_img(height, width, CV_8UC4, const_cast<uint8_t*>(right_rgba));
    cv::Mat left_gray, right_gray;
    cv::cvtColor(left_img, left_gray, cv::COLOR_RGBA2GRAY);
    cv::cvtColor(right_img, right_gray, cv::COLOR_RGBA2GRAY);

    static bool initialized = false;
    static int frame_count = 0;
    frame_count++;

    static ORBExtractor orb_extractor(2000, 1.2f, 8, 20, 7); // OV2SLAM-like params

    if (!initialized) {
        // --- Stereo Initialization: Use both images to triangulate initial map points ---
        std::vector<cv::KeyPoint> keypoints_left, keypoints_right;
        cv::Mat descriptors_left, descriptors_right;
        orb_extractor(left_gray, keypoints_left, descriptors_left);
        orb_extractor(right_gray, keypoints_right, descriptors_right);

        if (keypoints_left.empty() || keypoints_right.empty()) {
            std::cerr << "[StereoSLAM] Initialization failed: no keypoints." << std::endl;
            return false;
        }

        // === OV2SLAM-style KLT stereo matching ===
        // Track left keypoints to right image using KLT optical flow
        std::vector<cv::Point2f> pts_left, pts_right_tracked;
        for (const auto& kp : keypoints_left) pts_left.push_back(kp.pt);
        std::vector<uchar> status;
        std::vector<float> err;
        cv::calcOpticalFlowPyrLK(left_gray, right_gray, pts_left, pts_right_tracked, status, err,
            cv::Size(7,7), 2, cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 20, 0.03), 0, 0.003);
        // Epipolar filtering (y-diff < 2.0)
        const float max_y_diff = 2.0f;
        std::vector<cv::DMatch> matches;
        for (size_t i = 0; i < pts_left.size(); ++i) {
            if (status[i] && std::abs(pts_left[i].y - pts_right_tracked[i].y) < max_y_diff) {
                cv::DMatch m;
                m.queryIdx = (int)i; // left
                m.trainIdx = (int)i; // right (tracked)
                m.distance = 0;
                matches.push_back(m);
            }
        }

        if (matches.size() < 8) {
            std::cerr << "[StereoSLAM] Initialization failed: not enough matches." << std::endl;
            return false;
        }

        // Triangulate initial map points (DISABLED)
        /*
        std::vector<cv::Point2f> pts_left, pts_right;
        for (const auto& m : matches) {
            pts_left.push_back(keypoints_left[m.queryIdx].pt);
            pts_right.push_back(keypoints_right[m.trainIdx].pt);
        }

        // Camera intrinsics
        cv::Mat K = (cv::Mat_<double>(3,3) << left_calib_.fx_, 0, left_calib_.cx_, 0, left_calib_.fy_, left_calib_.cy_, 0, 0, 1);
        double baseline = std::abs(right_calib_.getTranslation().x());
        if (baseline < 1e-6) baseline = 0.1; // fallback if not set
        // Proper 3x4 projection matrices
        cv::Mat P0 = cv::Mat::zeros(3, 4, CV_64F);
        K.copyTo(P0.colRange(0, 3));
        cv::Mat P1 = cv::Mat::zeros(3, 4, CV_64F);
        K.copyTo(P1.colRange(0, 3));
        P1.at<double>(0, 3) = -baseline * left_calib_.fx_;

        cv::Mat points4D;
        cv::triangulatePoints(P0, P1, pts_left, pts_right, points4D);

        // Convert to 3D points and add to map
        int n_points = points4D.cols;
        int n_good = 0;
        std::vector<float> stereo_depth;
        stereo_depth.reserve(n_points);
        for (int i = 0; i < n_points; ++i) {
            cv::Mat col = points4D.col(i);
            col /= col.at<float>(3);
            float x = col.at<float>(0);
            float y = col.at<float>(1);
            float z = col.at<float>(2);
            if (z > 0.1 && z < 100.0) {
                // Add to map (in a real OV2SLAM, would create MapPoint, add to Frame, etc.)
                n_good++;
            }
            stereo_depth.push_back(z);
            // Watchdog: abort if too slow
            auto t_now = std::chrono::high_resolution_clock::now();
            double elapsed_ms = std::chrono::duration<double, std::milli>(t_now - t_start).count();
            if (elapsed_ms > 100.0) {
                std::cerr << "[StereoSLAM] Watchdog: Initialization step exceeded 100ms, aborting frame." << std::endl;
                return false;
            }
        }
        currFrame_->setStereoData(keypoints_right, descriptors_right, stereo_depth);
        std::cout << "[StereoSLAM] Stereo initialization: " << n_good << " good 3D points." << std::endl;
        */
        // Add first keyframe (in a real OV2SLAM, would use Frame, MapManager, Mapper)
        currFrame_->timestamp_ = 0.0;
        initialized = true;
    } else {
        // --- Normal SLAM operation: Track and map ---
        // In your main processFrame or SLAM loop, do NOT run expensive steps every frame.
        // Only run them when a new keyframe is inserted (as determined by VisualFrontend::track and checkNewKeyframeRequired).
        // This matches the fast monocular AlvaAR approach.
        currFrame_->timestamp_ += 1.0; // Dummy timestamp increment
        visualFrontend_->track(left_gray, currFrame_->timestamp_);
        // Stereo map point creation for this frame
        std::vector<cv::KeyPoint> keypoints_left, keypoints_right;
        cv::Mat descriptors_left, descriptors_right;
        static ORBExtractor orb_extractor(2000, 1.2f, 8, 20, 7);
        orb_extractor(left_gray, keypoints_left, descriptors_left);
        orb_extractor(right_gray, keypoints_right, descriptors_right);
        // === OV2SLAM-style KLT stereo matching ===
        // Track left keypoints to right image using KLT optical flow
        std::vector<cv::Point2f> pts_left, pts_right_tracked;
        for (const auto& kp : keypoints_left) pts_left.push_back(kp.pt);
        std::vector<uchar> status;
        std::vector<float> err;
        cv::calcOpticalFlowPyrLK(left_gray, right_gray, pts_left, pts_right_tracked, status, err,
            cv::Size(7,7), 2, cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 20, 0.03), 0, 0.003);
        // Epipolar filtering (y-diff < 2.0)
        const float max_y_diff = 2.0f;
        std::vector<cv::DMatch> matches;
        for (size_t i = 0; i < pts_left.size(); ++i) {
            if (status[i] && std::abs(pts_left[i].y - pts_right_tracked[i].y) < max_y_diff) {
                cv::DMatch m;
                m.queryIdx = (int)i; // left
                m.trainIdx = (int)i; // right (tracked)
                m.distance = 0;
                matches.push_back(m);
            }
        }
        std::vector<float> stereo_depth;
        triangulateStereoMapPoints(keypoints_left, keypoints_right, matches, left_calib_, right_calib_, stereo_depth);
        currFrame_->setStereoData(keypoints_right, descriptors_right, stereo_depth);
        // Decide if we should insert a new keyframe (simple OV2SLAM-style policy)
        Sophus::SE3d currPose = currFrame_->getTwc();
        int trackedPoints = (int)matches.size();
        if (shouldInsertKeyframe(lastKeyframePose_, currPose, trackedPoints)) {
            std::cout << "[StereoSLAM] Inserting new keyframe at frame " << frame_count << " with " << trackedPoints << " tracked points." << std::endl;
            lastKeyframePose_ = currPose;
            lastKeyframeTracked_ = trackedPoints;
            // Create new stereo map points and add to map manager (OV2SLAM logic)
            createStereoMapPoints(keypoints_left, keypoints_right, matches, stereo_depth, mapManager_, currFrame_);
            // Create and add a new keyframe to the map manager (OV2SLAM logic)
            createAndAddKeyframe(keypoints_left, descriptors_left, keypoints_right, descriptors_right, stereo_depth, mapManager_, currFrame_->cameraCalibration_, currPose, currFrame_->timestamp_);
            // Update covisibility graph (OV2SLAM logic)
            mapManager_->updateKeyframeConnections(currFrame_);
            // Call local mapping (OV2SLAM logic)
            mapper_->localMapping(currFrame_);
        }
        // Watchdog: check after main steps
        auto t_now = std::chrono::high_resolution_clock::now();
        double elapsed_ms = std::chrono::duration<double, std::milli>(t_now - t_start).count();
        if (elapsed_ms > 100.0) {
            std::cerr << "[StereoSLAM] Watchdog: Frame processing exceeded 100ms, aborting frame." << std::endl;
            return false;
        }
    }

    // Output pose (use current frame's Twc)
    Sophus::SE3d Twc = currFrame_->getTwc();
    Eigen::Vector3d t = Twc.translation();
    Eigen::Quaterniond q(Twc.rotationMatrix());
    pose_out[0] = static_cast<float>(t.x());
    pose_out[1] = static_cast<float>(t.y());
    pose_out[2] = static_cast<float>(t.z());
    pose_out[3] = static_cast<float>(q.x());
    pose_out[4] = static_cast<float>(q.y());
    pose_out[5] = static_cast<float>(q.z());
    pose_out[6] = static_cast<float>(q.w());
    return true;
} 

// OV2SLAM-style stereo helpers for browser pipeline
namespace StereoSLAMUtils {
int triangulateStereoMatches(const std::vector<cv::Point2f>& pts_left,
                            const std::vector<cv::Point2f>& pts_right,
                            const StereoCameraCalibration& calib,
                            std::vector<cv::Point3d>& points3d_out) {
    // Build projection matrices for left and right cameras
    cv::Mat K_left = calib.left_.Kcv_;
    cv::Mat K_right = calib.right_.Kcv_;
    cv::Mat R, t;
    cv::eigen2cv(calib.T_left_right_.rotationMatrix(), R);
    cv::eigen2cv(calib.T_left_right_.translation(), t);
    // Left: [I|0]
    cv::Mat I = cv::Mat::eye(3, 3, CV_64F);
    cv::Mat zero = cv::Mat::zeros(3, 1, CV_64F);
    cv::Mat leftRt;
    cv::hconcat(I, zero, leftRt);
    cv::Mat P0 = K_left * leftRt;
    // Right: [R|t]
    cv::Mat rightRt;
    cv::hconcat(R, t, rightRt);
    cv::Mat P1 = K_right * rightRt;
    // Triangulate
    cv::Mat points4d;
    cv::triangulatePoints(P0, P1, pts_left, pts_right, points4d);
    points3d_out.clear();
    for (int i = 0; i < points4d.cols; ++i) {
        cv::Mat col = points4d.col(i);
        cv::Point3d pt(
            col.at<float>(0) / col.at<float>(3),
            col.at<float>(1) / col.at<float>(3),
            col.at<float>(2) / col.at<float>(3)
        );
        points3d_out.push_back(pt);
    }

    return static_cast<int>(points3d_out.size());
}

bool estimateStereoPose(
    const std::vector<cv::Point3d>& points3d,
    const std::vector<cv::Point2f>& keypoints_left,
    const std::vector<cv::Point2f>& /*keypoints_right*/,
    const StereoCameraCalibration& calib,
    Sophus::SE3d& pose_out)
{
    if (points3d.size() < 4 || keypoints_left.size() < 4 || points3d.size() != keypoints_left.size()) {
        std::cerr << "[StereoSLAM] ERROR: Not enough correspondences for pose estimation." << std::endl;
        return false;
    }
    // Camera intrinsics for the left camera
    cv::Mat K = calib.left_.Kcv_;
    cv::Mat D = calib.left_.Dcv_;
    // Prepare data for solvePnP
    std::vector<cv::Point3f> objectPoints;
    for (const auto& pt : points3d) {
        objectPoints.emplace_back(static_cast<float>(pt.x), static_cast<float>(pt.y), static_cast<float>(pt.z));
    }
    cv::Mat rvec, tvec;
    bool success = cv::solvePnP(
        objectPoints, keypoints_left, K, D, rvec, tvec, false, cv::SOLVEPNP_ITERATIVE);
    if (!success) {
        std::cerr << "[StereoSLAM] ERROR: solvePnP failed." << std::endl;
        return false;
    }
    // Convert rvec, tvec to Sophus::SE3d
    cv::Mat R;
    cv::Rodrigues(rvec, R);
    Eigen::Matrix3d R_eigen;
    cv::cv2eigen(R, R_eigen);
    Eigen::Vector3d t_eigen;
    cv::cv2eigen(tvec, t_eigen);
    pose_out = Sophus::SE3d(R_eigen, t_eigen);
    return true;
}
} // namespace StereoSLAMUtils 