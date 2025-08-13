#include "compat_boost17.h"
#include "stereo_slam.hpp"
#include "stereo_calib_loader.hpp"
#include <opencv2/core.hpp>
#include <opencv2/video/tracking.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/features2d.hpp>
#include <iostream>
#include <vector>
#include <Eigen/Core>
#include <sophus/se3.hpp>
#include <cstring>
#include <chrono>
#include <random>
#include "visual_frontend.hpp"
#include "state.hpp"
#include "frame.hpp"
#include "map_manager.hpp"
#include "mapper.hpp"
#include "feature_tracker.hpp"
#include "system.hpp"

// Minimal OV2SLAM-style Stereo SLAM Interface for Browser
// Implements the pipeline directly in the interface function for browser performance

static std::string g_stereo_calib_yaml_string;

// Persistent buffer for last left image keypoints for JS visualization
static std::vector<cv::Point2f> lastStereoLeftKeypoints;

// Add temporal buffer for hybrid initialization
static cv::Mat prev_left_gray_for_init;
static std::vector<cv::Point2f> prev_left_kps_for_init;
static bool have_prev_left_for_init = false;

// Monocular SLAM system for pose updates after initialization
static std::unique_ptr<System> monocular_system;
static bool monocular_system_initialized = false;

namespace {
// Remove LocalMapPoint, LocalKeyframe, LocalMap, and g_map
}

extern "C" void setStereoCalibrationYAML(const char* yaml, int length) {
    g_stereo_calib_yaml_string.assign(yaml, length);
}

extern "C" int findStereoCameraPose(int leftImagePtr, int rightImagePtr, int posePtr) {
    using namespace std::chrono;
    auto t_start = high_resolution_clock::now();

    static StereoCameraCalibration calib;
    static bool calib_loaded = false;
    if (!calib_loaded) {
        // std::cerr << "[StereoSLAM] Loading calibration..." << std::endl;
        if (!g_stereo_calib_yaml_string.empty()) {
            if (!loadStereoCalibrationFromYAMLString(g_stereo_calib_yaml_string, calib)) {
                // std::cerr << "[findStereoCameraPose] ERROR: Failed to load calibration from YAML string." << std::endl;
                return 0;
            }
            calib_loaded = true;
            // std::cerr << "[StereoSLAM] Calibration loaded successfully" << std::endl;

        } else {
            // std::cerr << "[findStereoCameraPose] ERROR: Calibration YAML string not set. Call setStereoCalibrationYAML from JS first." << std::endl;
            return 0;
        }
    }

    int width = calib.left_.imgWidth_;
    int height = calib.left_.imgHeight_;

    // Print image size at startup
    static bool printed_image_size = false;
    if (!printed_image_size) {
        std::cerr << "[StereoSLAM] Image size: " << width << "x" << height << std::endl;
        printed_image_size = true;
    }

    // 1. Grayscale conversion
    auto t_gray0 = high_resolution_clock::now();
    cv::Mat left_rgba(height, width, CV_8UC4, reinterpret_cast<uint8_t*>(leftImagePtr));
    cv::Mat right_rgba(height, width, CV_8UC4, reinterpret_cast<uint8_t*>(rightImagePtr));
    cv::Mat left_gray, right_gray;
    cv::cvtColor(left_rgba, left_gray, cv::COLOR_RGBA2GRAY);
    cv::cvtColor(right_rgba, right_gray, cv::COLOR_RGBA2GRAY);
    

    auto t_gray1 = high_resolution_clock::now();

    // 2. Temporal KLT tracking (left)
    static cv::Mat prev_left_gray;
    static std::vector<cv::KeyPoint> tracked_kps_left;
    static cv::Mat tracked_desc_left;
    static bool is_first_frame = true;
    bool did_new_detection = false;
    // Use same parameters as monocular system for consistency
    int grid_cell_size = 40; // Same as monocular frameMaxCellSize
    int grid_max_per_cell = 1; // One feature per cell (like monocular)
    int grid_min_per_cell = 1;
    double grid_quality = 0.001; // Same as monocular extractorMaxQuality_
    int grid_num_cells_x = (width + grid_cell_size - 1) / grid_cell_size;
    int grid_num_cells_y = (height + grid_cell_size - 1) / grid_cell_size;
    ////////////////////////////////////////////////////////////////////////
    // int max_total_kps = 96; // Same as monocular: 12×8 = 96 features, this is for 480 x 360 resolution
    int max_total_kps = 160; // Upscaled for 640 x 480 resolution 
    ////////////////////////////////////////////////////////////////////////
    if (is_first_frame || prev_left_gray.empty()) {
        // First frame: detect and describe
        tracked_kps_left.clear();
        std::vector<cv::Point2f> detected_pts;
        for (int cy = 0; cy < grid_num_cells_y; ++cy) {
            for (int cx = 0; cx < grid_num_cells_x; ++cx) {
                int x0 = cx * grid_cell_size;
                int y0 = cy * grid_cell_size;
                int x1 = std::min(x0 + grid_cell_size, width);
                int y1 = std::min(y0 + grid_cell_size, height);
                cv::Rect roi(x0, y0, x1 - x0, y1 - y0);
                cv::Mat cell = left_gray(roi);
                std::vector<cv::Point2f> cell_pts;
                cv::goodFeaturesToTrack(cell, cell_pts, grid_max_per_cell, grid_quality, 5);
                for (auto& pt : cell_pts) {
                    cv::KeyPoint kp;
                    kp.pt.x = pt.x + x0;
                    kp.pt.y = pt.y + y0;
                    kp.size = 7;
                    tracked_kps_left.push_back(kp);
                    detected_pts.push_back(cv::Point2f(kp.pt.x, kp.pt.y));
                }
            }
        }
        if (!detected_pts.empty()) {
            cv::cornerSubPix(left_gray, detected_pts, cv::Size(3,3), cv::Size(-1,-1), cv::TermCriteria(cv::TermCriteria::EPS + cv::TermCriteria::MAX_ITER, 30, 0.01));
            for (size_t i = 0; i < detected_pts.size(); ++i) {
                tracked_kps_left[i].pt = detected_pts[i];
            }
        }
        cv::Ptr<cv::ORB> orb = cv::ORB::create((int)tracked_kps_left.size());
        orb->compute(left_gray, tracked_kps_left, tracked_desc_left);
        is_first_frame = false;
        did_new_detection = true;
    } else {
        // Temporal KLT tracking
        std::vector<cv::Point2f> prev_pts, curr_pts;
        for (const auto& kp : tracked_kps_left) prev_pts.push_back(kp.pt);
        std::vector<uchar> status_fwd;
        std::vector<float> err_fwd;
        cv::calcOpticalFlowPyrLK(prev_left_gray, left_gray, prev_pts, curr_pts, status_fwd, err_fwd,
            cv::Size(9,9), 3, cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 30, 0.01), 0, 0.001);
        // Outlier rejection
        std::vector<cv::KeyPoint> new_tracked_kps_left;
        cv::Mat new_tracked_desc_left;
        for (size_t i = 0; i < curr_pts.size(); ++i) {
            if (status_fwd[i] && curr_pts[i].x >= 0 && curr_pts[i].x < width && curr_pts[i].y >= 0 && curr_pts[i].y < height) {
                cv::KeyPoint kp = tracked_kps_left[i];
                kp.pt = curr_pts[i];
                new_tracked_kps_left.push_back(kp);
                new_tracked_desc_left.push_back(tracked_desc_left.row((int)i));
            }
        }
        tracked_kps_left = std::move(new_tracked_kps_left);
        tracked_desc_left = std::move(new_tracked_desc_left);
        // === Grid-based management: refill low-coverage cells ===
        std::vector<std::vector<int>> grid_indices(grid_num_cells_x * grid_num_cells_y);
        for (size_t i = 0; i < tracked_kps_left.size(); ++i) {
            int cx = std::min((int)(tracked_kps_left[i].pt.x / grid_cell_size), grid_num_cells_x - 1);
            int cy = std::min((int)(tracked_kps_left[i].pt.y / grid_cell_size), grid_num_cells_y - 1);
            int idx = cy * grid_num_cells_x + cx;
            grid_indices[idx].push_back((int)i);
        }
        std::vector<cv::KeyPoint> new_kps;
        std::vector<cv::Point2f> new_pts;
        for (int cy = 0; cy < grid_num_cells_y; ++cy) {
            for (int cx = 0; cx < grid_num_cells_x; ++cx) {
                int idx = cy * grid_num_cells_x + cx;
                int n_in_cell = (int)grid_indices[idx].size();
                if (n_in_cell < grid_min_per_cell) {
                    int x0 = cx * grid_cell_size;
                    int y0 = cy * grid_cell_size;
                    int x1 = std::min(x0 + grid_cell_size, width);
                    int y1 = std::min(y0 + grid_cell_size, height);
                    cv::Rect roi(x0, y0, x1 - x0, y1 - y0);
                    cv::Mat cell = left_gray(roi);
                    std::vector<cv::Point2f> cell_pts;
                    cv::goodFeaturesToTrack(cell, cell_pts, grid_min_per_cell - n_in_cell, grid_quality, 5);
                    for (auto& pt : cell_pts) {
                        cv::KeyPoint kp;
                        kp.pt.x = pt.x + x0;
                        kp.pt.y = pt.y + y0;
                        kp.size = 7;
                        new_kps.push_back(kp);
                        new_pts.push_back(cv::Point2f(kp.pt.x, kp.pt.y));
                    }
                }
            }
        }
        if (!new_pts.empty()) {
            cv::cornerSubPix(left_gray, new_pts, cv::Size(3,3), cv::Size(-1,-1), cv::TermCriteria(cv::TermCriteria::EPS + cv::TermCriteria::MAX_ITER, 30, 0.01));
            for (size_t i = 0; i < new_pts.size(); ++i) {
                new_kps[i].pt = new_pts[i];
            }
        }
        if (!new_kps.empty()) {
            cv::Mat new_desc;
            cv::Ptr<cv::ORB> orb = cv::ORB::create((int)new_kps.size());
            orb->compute(left_gray, new_kps, new_desc);
            for (size_t i = 0; i < new_kps.size(); ++i) {
                tracked_kps_left.push_back(new_kps[i]);
                tracked_desc_left.push_back(new_desc.row((int)i));
            }
        }
    }
    prev_left_gray = left_gray.clone();
    // === Grid-based filtering to cap max per cell and total ===
    std::vector<std::vector<std::pair<int, float>>> grid(grid_num_cells_x * grid_num_cells_y);
    for (size_t i = 0; i < tracked_kps_left.size(); ++i) {
        int cx = std::min((int)(tracked_kps_left[i].pt.x / grid_cell_size), grid_num_cells_x - 1);
        int cy = std::min((int)(tracked_kps_left[i].pt.y / grid_cell_size), grid_num_cells_y - 1);
        int idx = cy * grid_num_cells_x + cx;
        grid[idx].emplace_back(i, tracked_kps_left[i].response);
    }
    std::vector<int> selected_indices;
    for (auto& cell : grid) {
        std::sort(cell.begin(), cell.end(), [](const auto& a, const auto& b) { return a.second > b.second; });
        for (int i = 0; i < (int)cell.size() && i < grid_max_per_cell; ++i) {
            selected_indices.push_back(cell[i].first);
        }
    }
    // Cap total features
    if ((int)selected_indices.size() > max_total_kps) {
        std::partial_sort(selected_indices.begin(), selected_indices.begin() + max_total_kps, selected_indices.end());
        selected_indices.resize(max_total_kps);
    }
    // Update persistent buffer for JS dots
    lastStereoLeftKeypoints.clear();
    for (int idx : selected_indices) {
        lastStereoLeftKeypoints.push_back(tracked_kps_left[idx].pt);
    }
    std::vector<cv::KeyPoint> kps_left_filt;
    cv::Mat desc_left_filt;
    desc_left_filt = cv::Mat((int)selected_indices.size(), tracked_desc_left.cols, tracked_desc_left.type());
    for (size_t i = 0; i < selected_indices.size(); ++i) {
        kps_left_filt.push_back(tracked_kps_left[selected_indices[i]]);
        tracked_desc_left.row(selected_indices[i]).copyTo(desc_left_filt.row((int)i));
    }
    tracked_kps_left = std::move(kps_left_filt);
    tracked_desc_left = std::move(desc_left_filt);

    if (tracked_kps_left.empty()) {
        // std::cerr << "[StereoSLAM] No tracked keypoints, returning 0" << std::endl;
        return 0;
    }

    // Stereo KLT matching (left to right)
    std::vector<cv::Point2f> pts_left, pts_right_tracked;
    for (const auto& kp : tracked_kps_left) pts_left.push_back(kp.pt);
    std::vector<uchar> status;
    std::vector<float> err;
    cv::calcOpticalFlowPyrLK(left_gray, right_gray, pts_left, pts_right_tracked, status, err,
        cv::Size(9,9), 3, cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 30, 0.01), 0, 0.001);
    

    
    const float max_y_diff = 5.0f; // Back to reasonable for rectified images
    std::vector<cv::Point2f> good_pts_left, good_pts_right;
    int y_filtered = 0;
    for (size_t i = 0; i < pts_left.size(); ++i) {
        if (status[i]) {
            float y_diff = std::abs(pts_left[i].y - pts_right_tracked[i].y);
            if (y_diff < max_y_diff) {
                good_pts_left.push_back(pts_left[i]);
                good_pts_right.push_back(pts_right_tracked[i]);
            } else {
                y_filtered++;
            }
        }
    }

    

    // LOG: Number of good stereo matches (may slow browser if too frequent)
    // std::cerr << "[StereoSLAM] Total left keypoints: " << tracked_kps_left.size() << ", Good stereo matches: " << good_pts_left.size() << std::endl;
    if (good_pts_left.size() < 2) {
        // std::cerr << "[StereoSLAM] Not enough good stereo matches: " << good_pts_left.size() << ", returning 0" << std::endl;
        return 0;
    }

    // Triangulation
    std::vector<cv::Point3d> points3d;
    StereoSLAMUtils::triangulateStereoMatches(good_pts_left, good_pts_right, calib, points3d);
    // LOG: Number of triangulated 3D points
    // std::cerr << "[StereoSLAM] Triangulated 3D points: " << points3d.size() << std::endl;
    // LOG: Print first 5 3D points for debugging
    // for (size_t i = 0; i < std::min(points3d.size(), size_t(5)); ++i) {
    //     std::cerr << "[StereoSLAM] 3D point " << i << ": "
    //               << points3d[i].x << ", " << points3d[i].y << ", " << points3d[i].z << std::endl;
    // }
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

    if (filtered_points3d.size() < 10) {
        // std::cerr << "[StereoSLAM] WARNING: Fewer than 10 good 3D points for pose estimation. Pose may be unreliable." << std::endl;
    }
    if (filtered_points3d.size() < 2) {
        // std::cerr << "[StereoSLAM] Not enough 3D points after filtering: " << filtered_points3d.size() << ", returning 0" << std::endl;
        return 0;
    }

    // --- Map-based, keyframe-driven stereo SLAM ---
    static bool scale_initialized = false;
    static Sophus::SE3d last_pose = Sophus::SE3d();
    static Sophus::SE3d initial_pose = Sophus::SE3d(); // Store initial pose for drift correction
    Sophus::SE3d current_pose;
    static int lost_tracking_count = 0;
    const int lost_tracking_threshold = 10; // frames
    bool tracking_lost = false;
    double curr_timestamp = 0.0; // You may want to use a real timestamp if available

    static std::shared_ptr<State> state;
    static std::shared_ptr<Frame> frame;
    static std::shared_ptr<MapManager> mapManager;
    static std::shared_ptr<Mapper> mapper;
    static std::shared_ptr<FeatureTracker> featureTracker;
    static std::unique_ptr<VisualFrontend> visualFrontend;
    static bool visual_frontend_initialized = false;
    if (!visual_frontend_initialized) {
        state = std::make_shared<State>(width, height, 150); // adjust as needed
        frame = std::make_shared<Frame>(std::make_shared<CameraCalibration>(calib.left_), 60);
        mapManager = std::make_shared<MapManager>(state, frame, nullptr);
        mapper = std::make_shared<Mapper>(state, mapManager, frame);
        featureTracker = std::make_shared<FeatureTracker>(30, 0.01f); // adjust as needed
        visualFrontend = std::make_unique<VisualFrontend>(state, frame, mapManager, mapper, featureTracker);
        visual_frontend_initialized = true;
    }

    static int frame_counter = 0;
    static int last_drift_correction_frame = 0;
    frame_counter++;
    if (!scale_initialized || tracking_lost) {
        // --- Hybrid Stereo Initialization: 5-point + Stereo Scale Recovery ---
        if (!have_prev_left_for_init) {
            // First frame: buffer for next frame
            prev_left_gray_for_init = left_gray.clone();
            prev_left_kps_for_init.clear();
            for (const auto& kp : tracked_kps_left) prev_left_kps_for_init.push_back(kp.pt);
            have_prev_left_for_init = true;
            return 0; // Need next frame for initialization
        }

        // --- Step 1: 5-point Essential Matrix (Monocular) ---
        std::vector<cv::Point2f> curr_left_kps;
        for (const auto& kp : tracked_kps_left) curr_left_kps.push_back(kp.pt);
        
        // Track features from previous to current left frame
        std::vector<cv::Point2f> tracked_prev_kps, tracked_curr_kps;
        std::vector<uchar> status;
        std::vector<float> err;
        cv::calcOpticalFlowPyrLK(prev_left_gray_for_init, left_gray, prev_left_kps_for_init, tracked_curr_kps, status, err,
            cv::Size(9,9), 3, cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 30, 0.01), 0, 0.001);
        
        // Filter good temporal matches
        std::vector<cv::Point2f> good_prev_kps, good_curr_kps;
        for (size_t i = 0; i < status.size(); ++i) {
            if (status[i] && tracked_curr_kps[i].x >= 0 && tracked_curr_kps[i].x < width && 
                tracked_curr_kps[i].y >= 0 && tracked_curr_kps[i].y < height) {
                good_prev_kps.push_back(prev_left_kps_for_init[i]);
                good_curr_kps.push_back(tracked_curr_kps[i]);
            }
        }

        if (good_prev_kps.size() < 8) {
            // Not enough temporal matches, update buffer and try again
            // std::cerr << "[StereoSLAM] Not enough temporal matches: " << good_prev_kps.size() << ", returning 0" << std::endl;
            prev_left_gray_for_init = left_gray.clone();
            prev_left_kps_for_init = curr_left_kps;
            return 0;
        }

        // Compute 5-point essential matrix
        cv::Mat E = cv::findEssentialMat(good_prev_kps, good_curr_kps, 
            cv::Mat::eye(3, 3, CV_64F), cv::RANSAC, 0.999, 1.0);
        
        if (E.empty()) {
            // Essential matrix computation failed
            // std::cerr << "[StereoSLAM] Essential matrix computation failed, returning 0" << std::endl;
            prev_left_gray_for_init = left_gray.clone();
            prev_left_kps_for_init = curr_left_kps;
            return 0;
        }

        // Recover pose from essential matrix (up to scale)
        cv::Mat R, t;
        cv::recoverPose(E, good_prev_kps, good_curr_kps, R, t);
        
        // Convert to Sophus::SE3d (up to scale)
        Sophus::SE3d Twc_mono;
        Twc_mono.setRotationMatrix(Eigen::Map<Eigen::Matrix3d>((double*)R.data));
        Twc_mono.translation() = Eigen::Map<Eigen::Vector3d>((double*)t.data);

        // --- Step 2: Stereo Triangulation for Scale Recovery ---
        // Use stereo matching to get metric 3D points
        std::vector<cv::Point2f> stereo_prev_left, stereo_curr_left, stereo_curr_right;
        
        // Match current left features to right image
        std::vector<cv::Point2f> curr_left_pts, curr_right_pts;
        for (const auto& kp : tracked_kps_left) curr_left_pts.push_back(kp.pt);
        
        std::vector<uchar> stereo_status;
        std::vector<float> stereo_err;
        cv::calcOpticalFlowPyrLK(left_gray, right_gray, curr_left_pts, curr_right_pts, stereo_status, stereo_err,
            cv::Size(9,9), 3, cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 30, 0.01), 0, 0.001);
        
        // Filter good stereo matches
        std::vector<cv::Point2f> good_stereo_left, good_stereo_right;
        for (size_t i = 0; i < stereo_status.size(); ++i) {
            if (stereo_status[i] && std::abs(curr_left_pts[i].y - curr_right_pts[i].y) < 2.0f) {
                good_stereo_left.push_back(curr_left_pts[i]);
                good_stereo_right.push_back(curr_right_pts[i]);
            }
        }

        if (good_stereo_left.size() < 4) {
            // Not enough stereo matches
            // std::cerr << "[StereoSLAM] Not enough stereo matches: " << good_stereo_left.size() << ", returning 0" << std::endl;
            prev_left_gray_for_init = left_gray.clone();
            prev_left_kps_for_init = curr_left_kps;
            return 0;
        }

        // Triangulate stereo points to get metric 3D points
        std::vector<cv::Point3d> stereo_3d_points;
        StereoSLAMUtils::triangulateStereoMatches(good_stereo_left, good_stereo_right, calib, stereo_3d_points);
        
        // Filter valid 3D points
        std::vector<cv::Point3d> valid_stereo_3d;
        std::vector<cv::Point2f> valid_stereo_left;
        for (size_t i = 0; i < stereo_3d_points.size(); ++i) {
            if (stereo_3d_points[i].z > 0.1 && stereo_3d_points[i].z < 100.0) {
                valid_stereo_3d.push_back(stereo_3d_points[i]);
                valid_stereo_left.push_back(good_stereo_left[i]);
            }
        }

        if (valid_stereo_3d.size() < 4) {
            // Not enough valid stereo 3D points
            // std::cerr << "[StereoSLAM] Not enough valid stereo 3D points: " << valid_stereo_3d.size() << ", returning 0" << std::endl;
            prev_left_gray_for_init = left_gray.clone();
            prev_left_kps_for_init = curr_left_kps;
            return 0;
        }

        // --- Step 3: Scale Recovery ---
        // Find common points between temporal and stereo matches
        std::vector<cv::Point2f> common_prev, common_curr;
        std::vector<cv::Point3d> common_stereo_3d;
        for (size_t i = 0; i < good_curr_kps.size(); ++i) {
            for (size_t j = 0; j < valid_stereo_left.size(); ++j) {
                float dist = cv::norm(good_curr_kps[i] - valid_stereo_left[j]);
                if (dist < 5.0f) { // Within 5 pixels
                    common_prev.push_back(good_prev_kps[i]);
                    common_curr.push_back(good_curr_kps[i]);
                    common_stereo_3d.push_back(valid_stereo_3d[j]);
                    break;
                }
            }
        }

        if (common_prev.size() < 3) {
            // Not enough common points for scale recovery
            // std::cerr << "[StereoSLAM] Not enough common points for scale recovery: " << common_prev.size() << ", returning 0" << std::endl;
            prev_left_gray_for_init = left_gray.clone();
            prev_left_kps_for_init = curr_left_kps;
            return 0;
        }

        // Compute scale factor
        double scale_factor = 1.0;
        std::vector<double> scale_ratios;
        
        for (size_t i = 0; i < common_prev.size(); ++i) {
            for (size_t j = i + 1; j < common_prev.size(); ++j) {
                // Distance in stereo 3D points (metric)
                cv::Point3d diff_stereo = common_stereo_3d[i] - common_stereo_3d[j];
                double dist_stereo = cv::norm(diff_stereo);
                
                if (dist_stereo > 0.1) { // Avoid very close points
                    // Distance in monocular reconstruction (up to scale)
                    // Project points using monocular pose
                    cv::Point3d prev_3d_mono(common_prev[i].x, common_prev[i].y, 1.0);
                    cv::Point3d curr_3d_mono(common_curr[i].x, common_curr[i].y, 1.0);
                    
                    // Transform using monocular pose
                    Eigen::Vector3d prev_vec(prev_3d_mono.x, prev_3d_mono.y, prev_3d_mono.z);
                    Eigen::Vector3d curr_vec(curr_3d_mono.x, curr_3d_mono.y, curr_3d_mono.z);
                    
                    Eigen::Vector3d prev_world = Twc_mono * prev_vec;
                    Eigen::Vector3d curr_world = Twc_mono * curr_vec;
                    
                    double dist_mono = (curr_world - prev_world).norm();
                    
                    if (dist_mono > 0.001) { // Avoid division by zero
                        scale_ratios.push_back(dist_stereo / dist_mono);
                    }
                }
            }
        }

        if (scale_ratios.size() > 0) {
            // Use median scale ratio for robustness
            std::sort(scale_ratios.begin(), scale_ratios.end());
            scale_factor = scale_ratios[scale_ratios.size() / 2];
            
            // Ensure minimum scale factor to prevent extremely small translations
            const double min_scale = 0.1;
            if (scale_factor < min_scale) {
                // std::cerr << "[StereoSLAM] WARNING: Scale factor " << scale_factor << " too small, clamping to " << min_scale << std::endl;
                scale_factor = min_scale;
            }
        }

        // --- Step 4: Apply Scale and Set Initial Pose ---
        current_pose = Twc_mono;
        current_pose.translation() *= scale_factor;
        
        // Keep metric scale (no normalization for stereo)
        
        scale_initialized = true;
        last_pose = current_pose;
        initial_pose = current_pose; // Store initial pose
        lost_tracking_count = 0;
        tracking_lost = false;
        
        // Set initial pose in frame/state for VisualFrontend
        frame->setTwc(current_pose);
        // std::cerr << "[StereoSLAM] Hybrid initialization complete (5-point + stereo scale, scale_factor: " << scale_factor << ")" << std::endl;
        
        // Initialize monocular system for pose updates
        if (!monocular_system_initialized) {
            monocular_system = std::make_unique<System>();
            monocular_system->configure(width, height, calib.left_.fx_, calib.left_.fy_, calib.left_.cx_, calib.left_.cy_, 0, 0, 0, 0);
            monocular_system_initialized = true;
            // std::cerr << "[StereoSLAM] Monocular system initialized for pose updates" << std::endl;
        }
        
        // Update buffer for next frame
        prev_left_gray_for_init = left_gray.clone();
        prev_left_kps_for_init = curr_left_kps;
    } else {
        // --- Use Monocular SLAM for Pose Updates ---
        if (monocular_system_initialized && monocular_system && tracked_kps_left.size() >= 20) {
            // Convert left image to format expected by monocular system
            cv::Mat left_rgba_for_mono(height, width, CV_8UC4, reinterpret_cast<uint8_t*>(leftImagePtr));
            cv::Mat left_gray_for_mono;
            cv::cvtColor(left_rgba_for_mono, left_gray_for_mono, cv::COLOR_RGBA2GRAY);
            
            // Call monocular SLAM for pose update
            uint64_t timestamp = duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
            int status = monocular_system->processCameraPose(left_gray_for_mono, timestamp);
            
            if (status == 1) {
                // Get pose from monocular system
                float pose_data[16];
                monocular_system->findCameraPose(leftImagePtr, reinterpret_cast<int>(pose_data));
                
                // Convert 16-element pose to 7-element format (translation + quaternion)
                // pose_data[12-14] contains translation, pose_data[0-11] contains rotation matrix
                Eigen::Matrix3d R;
                R << pose_data[0], pose_data[1], pose_data[2],
                     pose_data[4], pose_data[5], pose_data[6],
                     pose_data[8], pose_data[9], pose_data[10];
                
                Eigen::Vector3d t(pose_data[12], pose_data[13], pose_data[14]);
                Eigen::Quaterniond q(R);
                
                current_pose = Sophus::SE3d(q, t);
                last_pose = current_pose;
                
                // Update frame for compatibility
                frame->setTwc(current_pose);
                
                        // Debug: Log successful tracking
        //std::cerr << "[StereoSLAM] Monocular tracking successful (features: " << tracked_kps_left.size() << ")" << std::endl;
            } else {
                // If monocular SLAM fails, keep the last pose
                current_pose = last_pose;
                
                // Debug: Log tracking failure
                //std::cerr << "[StereoSLAM] Monocular tracking failed (status: " << status << ")" << std::endl;
            }
        } else {
            // Fallback: keep the last pose if monocular system not available
            current_pose = last_pose;
        }
    }
    // --- Output pose (always update AR object) ---
    Eigen::Vector3d t = current_pose.translation();
    Eigen::Quaterniond q(current_pose.unit_quaternion());
    float* out = reinterpret_cast<float*>(posePtr);
    
    // Output raw translation (like monocular SLAM) - no additional scaling
    out[0] = static_cast<float>(t.x());
    out[1] = static_cast<float>(t.y());
    out[2] = static_cast<float>(t.z());
    out[3] = static_cast<float>(q.x());
    out[4] = static_cast<float>(q.y());
    out[5] = static_cast<float>(q.z());
    out[6] = static_cast<float>(q.w());

    // Debug: Print pose values
    // std::cerr << "[StereoSLAM] Pose output: t=[" << t.x() << ", " << t.y() << ", " << t.z() 
    //           << "], q=[" << q.x() << ", " << q.y() << ", " << q.z() << ", " << q.w() << "]" << std::endl;

    // Profiling output
    auto t_end = high_resolution_clock::now();
    // std::cerr << "[PROFILE] TOTAL: " << duration_cast<milliseconds>(t_end-t_start).count() << " ms\n";

    return 1;
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