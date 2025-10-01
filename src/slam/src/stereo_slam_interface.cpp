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

// ===== CONFIGURABLE THRESHOLDS =====
// Epipolar and stereo matching thresholds
static const double EPIPOLAR_THRESHOLD = 1.0;           // Essential matrix RANSAC threshold (pixels) - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 1.0 (very strict)
static const double OPTICAL_FLOW_ERROR = 0.001;          // Optical flow error threshold - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 0.001 (extremely strict)
static const double FEATURE_QUALITY = 0.001;            // Corner detection quality threshold
static const double SUBPIXEL_ACCURACY = 0.01;           // Sub-pixel refinement accuracy (pixels)
static const double Y_DIFF_THRESHOLD = 5.0;             // Y-coordinate difference for stereo matching (pixels) - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 5.0 (moderate)
static const double Y_DIFF_STRICT = 2.0;                // Stricter Y-difference for scale recovery (pixels) - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 2.0 (strict)
static const double MIN_DEPTH = 0.1;                     // Minimum valid depth (meters) - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 0.1 (10cm minimum)
static const double MAX_DEPTH = 100.0;                   // Maximum valid depth (meters) - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 100.0 (100m maximum)
static const int MIN_STEREO_MATCHES = 2;                 // Minimum stereo matches for triangulation - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 2 (minimum)
static const int MIN_STEREO_MATCHES_STRICT = 4;          // Minimum stereo matches for scale recovery - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 4 (moderate)
static const int MIN_3D_POINTS = 2;                      // Minimum 3D points after filtering - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 2 (minimum)
static const int MIN_3D_POINTS_WARNING = 10;             // Warning threshold for 3D points - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 10 (strict warning)
static const int LOST_TRACKING_THRESHOLD = 10;           // Frames before declaring tracking lost - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 10 (moderate)
static const double MIN_SCALE_FACTOR = 0.0001;          // Minimum scale factor - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 0.0001 (very permissive)
static const double MAX_SCALE_FACTOR = 50.0;             // Maximum scale factor - RESTORED TO ORIGINAL
                                                         // ORIGINAL: 50.0 (reasonable maximum)

static std::string g_stereo_calib_yaml_string;

// Persistent buffer for last left image keypoints for JS visualization
static std::vector<cv::Point2f> lastStereoLeftKeypoints;

// Persistent buffer for last triangulated 3D points for plane detection (camera coordinates)
static std::vector<cv::Point3d> lastStereo3DPoints;

// Buffer for world coordinates output to JavaScript
static std::vector<cv::Point3d> world_points_buffer;

// Add temporal buffer for hybrid initialization
static cv::Mat prev_left_gray_for_init;
static std::vector<cv::Point2f> prev_left_kps_for_init;
static bool have_prev_left_for_init = false;

// Monocular SLAM system for pose updates after initialization
static std::unique_ptr<System> monocular_system;
static bool monocular_system_initialized = false;

// Scale factor for maintaining metric scale in monocular continuation
static double scale_factor = 1.0;

namespace {
// Remove LocalMapPoint, LocalKeyframe, LocalMap, and g_map
}

extern "C" void setStereoCalibrationYAML(const char* yaml, int length) {
    g_stereo_calib_yaml_string.assign(yaml, length);
}

extern "C" int findStereoCameraPose(int leftImagePtr, int rightImagePtr, int posePtr) {
    using namespace std::chrono;
    auto t_start = high_resolution_clock::now();

    //std::cerr << "[StereoSLAM] DEBUG: Function entry - posePtr: " << posePtr << std::endl;

    // Initialize pose buffer with zeros to prevent memory access errors
    float* out = reinterpret_cast<float*>(posePtr);
    //std::cerr << "[StereoSLAM] DEBUG: Initializing pose buffer at address: " << out << std::endl;
    for (int i = 0; i < 16; ++i) {
        out[i] = 0.0f;
    }
    //std::cerr << "[StereoSLAM] DEBUG: Pose buffer initialized with zeros" << std::endl;

    static StereoCameraCalibration calib;
    static bool calib_loaded = false;
    if (!calib_loaded) {
        std::cerr << "[StereoSLAM] DEBUG: Loading calibration..." << std::endl;
        if (!g_stereo_calib_yaml_string.empty()) {
            if (!loadStereoCalibrationFromYAMLString(g_stereo_calib_yaml_string, calib)) {
                std::cerr << "[StereoSLAM] DEBUG: ERROR: Failed to load calibration from YAML string." << std::endl;
                return 0;
            }
            calib_loaded = true;
            std::cerr << "[StereoSLAM] DEBUG: Calibration loaded successfully" << std::endl;

        } else {
            std::cerr << "[StereoSLAM] DEBUG: ERROR: Calibration YAML string not set. Call setStereoCalibrationYAML from JS first." << std::endl;
            return 0;
        }
    }

    int width = calib.left_.imgWidth_;
    int height = calib.left_.imgHeight_;

    //std::cerr << "[StereoSLAM] DEBUG: Image size: " << width << "x" << height << std::endl;

    // Print image size at startup
    static bool printed_image_size = false;
    if (!printed_image_size) {
        //std::cerr << "[StereoSLAM] Image size: " << width << "x" << height << std::endl;
        printed_image_size = true;
    }

    // 1. Grayscale conversion
    //std::cerr << "[StereoSLAM] DEBUG: Starting grayscale conversion" << std::endl;
    auto t_gray0 = high_resolution_clock::now();
    cv::Mat left_rgba(height, width, CV_8UC4, reinterpret_cast<uint8_t*>(leftImagePtr));
    cv::Mat right_rgba(height, width, CV_8UC4, reinterpret_cast<uint8_t*>(rightImagePtr));
    cv::Mat left_gray, right_gray;
    cv::cvtColor(left_rgba, left_gray, cv::COLOR_RGBA2GRAY);
    cv::cvtColor(right_rgba, right_gray, cv::COLOR_RGBA2GRAY);
    //std::cerr << "[StereoSLAM] DEBUG: Grayscale conversion completed" << std::endl;
    

    auto t_gray1 = high_resolution_clock::now();

    // 2. Temporal KLT tracking (left)
    static cv::Mat prev_left_gray;
    static std::vector<cv::KeyPoint> tracked_kps_left;
    static cv::Mat tracked_desc_left;
    static bool is_first_frame = true;
    bool did_new_detection = false;
    // Use same parameters as monocular system for consistency
    int grid_cell_size = 40; // Same as monocular frameMaxCellSize
    int grid_max_per_cell = 2; // originally 1, lower back to 1 if there are performance issues
    int grid_min_per_cell = 1; // originally 1
    double grid_quality = FEATURE_QUALITY;
    int grid_num_cells_x = (width + grid_cell_size - 1) / grid_cell_size;
    int grid_num_cells_y = (height + grid_cell_size - 1) / grid_cell_size;
    ////////////////////////////////////////////////////////////////////////
    // int max_total_kps = 96; // Same as monocular: 12×8 = 96 features, this is for 480 x 360 resolution
    int max_total_kps = 320; // Upscaled for 640 x 480 resolution, lower back to 160 if there are performance issues
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
            cv::cornerSubPix(left_gray, detected_pts, cv::Size(3,3), cv::Size(-1,-1), cv::TermCriteria(cv::TermCriteria::EPS + cv::TermCriteria::MAX_ITER, 30, SUBPIXEL_ACCURACY));
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
            cv::Size(9,9), 3, cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 30, SUBPIXEL_ACCURACY), 0, OPTICAL_FLOW_ERROR);
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
            cv::cornerSubPix(left_gray, new_pts, cv::Size(3,3), cv::Size(-1,-1), cv::TermCriteria(cv::TermCriteria::EPS + cv::TermCriteria::MAX_ITER, 30, SUBPIXEL_ACCURACY));
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
        //std::cerr << "[StereoSLAM] DEBUG: No tracked keypoints, returning 0" << std::endl;
        return 0;
    }

    // Stereo KLT matching (left to right)
    std::vector<cv::Point2f> pts_left, pts_right_tracked;
    for (const auto& kp : tracked_kps_left) pts_left.push_back(kp.pt);
    std::vector<uchar> status;
    std::vector<float> err;
    cv::calcOpticalFlowPyrLK(left_gray, right_gray, pts_left, pts_right_tracked, status, err,
        cv::Size(9,9), 3, cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 30, SUBPIXEL_ACCURACY), 0, OPTICAL_FLOW_ERROR);
    

    
    const float max_y_diff = Y_DIFF_THRESHOLD; // Back to reasonable for rectified images
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
    
    // Initialize 3D points as empty - will be populated if stereo triangulation succeeds
    std::vector<cv::Point3d> filtered_points3d;
    bool has_stereo_triangulation = false;
    
    if (good_pts_left.size() >= MIN_STEREO_MATCHES) {
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
        std::vector<cv::Point2f> filtered_keypoints_left;
        std::vector<cv::Point2f> filtered_keypoints_right;
        for (size_t i = 0; i < points3d.size(); ++i) {
            if (points3d[i].z > 0) {
                filtered_points3d.push_back(points3d[i]);
                filtered_keypoints_left.push_back(good_pts_left[i]);
                filtered_keypoints_right.push_back(good_pts_right[i]);
            }
        }

        if (filtered_points3d.size() < MIN_3D_POINTS_WARNING) {
            // std::cerr << "[StereoSLAM] WARNING: Fewer than " << MIN_3D_POINTS_WARNING << " good 3D points for pose estimation. Pose may be unreliable." << std::endl;
        }
        
        if (filtered_points3d.size() >= MIN_3D_POINTS) {
            has_stereo_triangulation = true;
            //std::cerr << "[StereoSLAM] DEBUG: Stereo triangulation successful with " << filtered_points3d.size() << " 3D points" << std::endl;
        } else {
            //std::cerr << "[StereoSLAM] DEBUG: Insufficient 3D points (" << filtered_points3d.size() << "), but continuing with monocular tracking" << std::endl;
        }
    } else {
        //std::cerr << "[StereoSLAM] DEBUG: Insufficient stereo matches (" << good_pts_left.size() << "), but continuing with monocular tracking" << std::endl;
    }

    // Store 3D points for plane detection (empty if no stereo triangulation)
    lastStereo3DPoints = filtered_points3d;

    // --- Map-based, keyframe-driven stereo SLAM ---
    static bool scale_initialized = false;
    static Sophus::SE3d last_pose = Sophus::SE3d();
    static Sophus::SE3d initial_pose = Sophus::SE3d(); // Store initial pose for drift correction
    Sophus::SE3d current_pose;
    static int lost_tracking_count = 0;
    const int lost_tracking_threshold = LOST_TRACKING_THRESHOLD; // frames
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
        featureTracker = std::make_shared<FeatureTracker>(30, FEATURE_QUALITY); // adjust as needed
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
            cv::Size(9,9), 3, cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 30, SUBPIXEL_ACCURACY), 0, OPTICAL_FLOW_ERROR);
        
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
            //std::cerr << "[StereoSLAM] DEBUG: Not enough temporal matches: " << good_prev_kps.size() << ", returning 0" << std::endl;
            prev_left_gray_for_init = left_gray.clone();
            prev_left_kps_for_init = curr_left_kps;
            return 0;
        }

        // Compute 5-point essential matrix using proper camera calibration
        cv::Mat K = (cv::Mat_<double>(3,3) << calib.left_.fx_, 0, calib.left_.cx_, 
                                         0, calib.left_.fy_, calib.left_.cy_, 
                                         0, 0, 1);
        cv::Mat E = cv::findEssentialMat(good_prev_kps, good_curr_kps, 
            K, cv::RANSAC, 0.999, EPIPOLAR_THRESHOLD);
        
        if (E.empty()) {
            // Essential matrix computation failed
            //std::cerr << "[StereoSLAM] DEBUG: Essential matrix computation failed, returning 0" << std::endl;
            prev_left_gray_for_init = left_gray.clone();
            prev_left_kps_for_init = curr_left_kps;
            return 0;
        }

        // Recover pose from essential matrix (up to scale) using proper camera calibration
        cv::Mat R, t;
        cv::recoverPose(E, good_prev_kps, good_curr_kps, K, R, t);
        
        // Convert to Sophus::SE3d (up to scale)
        Sophus::SE3d Twc_mono;
        Twc_mono.setRotationMatrix(Eigen::Map<Eigen::Matrix3d>((double*)R.data));
        Twc_mono.translation() = Eigen::Map<Eigen::Vector3d>((double*)t.data);
        
        // CRITICAL FIX: Use a more direct scale recovery approach
        // Instead of triangulating with unit translation, use the stereo baseline as reference
        double stereo_baseline = std::abs(calib.T_left_right_.translation().x());
        if (stereo_baseline < 1e-6) stereo_baseline = 0.1; // Fallback baseline
        
        std::cerr << "[StereoSLAM] DEBUG: Stereo baseline: " << stereo_baseline << " meters" << std::endl;
        std::cerr << "[StereoSLAM] DEBUG: Monocular translation (raw): [" 
                  << Twc_mono.translation().x() << ", " 
                  << Twc_mono.translation().y() << ", " 
                  << Twc_mono.translation().z() << "]" << std::endl;

        // --- Step 2: Stereo Triangulation for Scale Recovery ---
        // Use stereo matching to get metric 3D points
        std::vector<cv::Point2f> stereo_prev_left, stereo_curr_left, stereo_curr_right;
        
        // Match current left features to right image
        std::vector<cv::Point2f> curr_left_pts, curr_right_pts;
        for (const auto& kp : tracked_kps_left) curr_left_pts.push_back(kp.pt);
        
        std::vector<uchar> stereo_status;
        std::vector<float> stereo_err;
        cv::calcOpticalFlowPyrLK(left_gray, right_gray, curr_left_pts, curr_right_pts, stereo_status, stereo_err,
            cv::Size(9,9), 3, cv::TermCriteria(cv::TermCriteria::COUNT+cv::TermCriteria::EPS, 30, SUBPIXEL_ACCURACY), 0, OPTICAL_FLOW_ERROR);
        
        // Filter good stereo matches
        std::vector<cv::Point2f> good_stereo_left, good_stereo_right;
        for (size_t i = 0; i < stereo_status.size(); ++i) {
            if (stereo_status[i] && std::abs(curr_left_pts[i].y - curr_right_pts[i].y) < Y_DIFF_STRICT) {
                good_stereo_left.push_back(curr_left_pts[i]);
                good_stereo_right.push_back(curr_right_pts[i]);
            }
        }

        if (good_stereo_left.size() < MIN_STEREO_MATCHES_STRICT) {
            // Not enough stereo matches
            //std::cerr << "[StereoSLAM] DEBUG: Not enough stereo matches: " << good_stereo_left.size() << ", returning 0" << std::endl;
            prev_left_gray_for_init = left_gray.clone();
            prev_left_kps_for_init = curr_left_kps;
            return 0;
        }

        // Triangulate stereo points to get metric 3D points
        std::vector<cv::Point3d> stereo_3d_points;
        StereoSLAMUtils::triangulateStereoMatches(good_stereo_left, good_stereo_right, calib, stereo_3d_points);
        
        std::cerr << "[StereoSLAM] DEBUG: Triangulated " << stereo_3d_points.size() 
                  << " stereo 3D points from " << good_stereo_left.size() << " matches" << std::endl;
        
        // Filter valid 3D points
        std::vector<cv::Point3d> valid_stereo_3d;
        std::vector<cv::Point2f> valid_stereo_left;
        for (size_t i = 0; i < stereo_3d_points.size(); ++i) {
            if (stereo_3d_points[i].z > MIN_DEPTH && stereo_3d_points[i].z < MAX_DEPTH) {
                valid_stereo_3d.push_back(stereo_3d_points[i]);
                valid_stereo_left.push_back(good_stereo_left[i]);
            }
        }
        
        std::cerr << "[StereoSLAM] DEBUG: Filtered to " << valid_stereo_3d.size() 
                  << " valid stereo 3D points" << std::endl;

        if (valid_stereo_3d.size() < MIN_STEREO_MATCHES_STRICT) {
            // Not enough valid stereo 3D points
            //std::cerr << "[StereoSLAM] DEBUG: Not enough valid stereo 3D points: " << valid_stereo_3d.size() << ", returning 0" << std::endl;
            prev_left_gray_for_init = left_gray.clone();
            prev_left_kps_for_init = curr_left_kps;
            return 0;
        }

        // --- Step 3: Direct Scale Recovery using Stereo Baseline ---
        // Instead of complex triangulation comparison, use the stereo baseline directly
        // The monocular translation from essential matrix is up to scale
        // We can recover the scale by comparing it to the known stereo baseline
        
        // Use the static scale_factor variable
        
        // Method: Use stereo baseline as reference
        // The monocular translation should be scaled to match the stereo baseline
        double mono_translation_norm = Twc_mono.translation().norm();
        if (mono_translation_norm > 1e-6) {
        // Scale factor = monocular_translation_norm / stereo_baseline
        // This brings the up-to-scale monocular pose down to metric scale
        scale_factor =  stereo_baseline / mono_translation_norm;
            
            std::cerr << "[StereoSLAM] DEBUG: Direct scale recovery method:" << std::endl;
            std::cerr << "[StereoSLAM] DEBUG: Stereo baseline: " << stereo_baseline << " meters" << std::endl;
            std::cerr << "[StereoSLAM] DEBUG: Monocular translation norm: " << mono_translation_norm << std::endl;
            std::cerr << "[StereoSLAM] DEBUG: Calculated scale factor: " << scale_factor << std::endl;
        } else {
            std::cerr << "[StereoSLAM] WARNING: Monocular translation norm too small, using default scale factor 1.0" << std::endl;
        }
        
        // Apply scale factor bounds to prevent extremely small or large values
        const double min_scale = MIN_SCALE_FACTOR;  // Allow smaller minimum
        const double max_scale = MAX_SCALE_FACTOR;  // Add maximum scale factor to prevent extremely large values
        if (scale_factor < min_scale) {
            std::cerr << "[StereoSLAM] WARNING: Scale factor " << scale_factor 
                      << " too small, clamping to " << min_scale << std::endl;
            scale_factor = min_scale;
        } else if (scale_factor > max_scale) {
            std::cerr << "[StereoSLAM] WARNING: Scale factor " << scale_factor 
                      << " too large, clamping to " << max_scale << std::endl;
            scale_factor = max_scale;
        }
        
        std::cerr << "[StereoSLAM] DEBUG: Final scale factor after clamping: " << scale_factor << std::endl;

        // --- Step 4: Apply Scale and Set Initial Pose ---
        std::cerr << "[StereoSLAM] DEBUG: Before scaling - translation: [" 
                  << Twc_mono.translation().x() << ", " 
                  << Twc_mono.translation().y() << ", " 
                  << Twc_mono.translation().z() << "]" << std::endl;
        
        current_pose = Twc_mono;
        current_pose.translation() *= scale_factor;
        
        std::cerr << "[StereoSLAM] DEBUG: After scaling - translation: [" 
                  << current_pose.translation().x() << ", " 
                  << current_pose.translation().y() << ", " 
                  << current_pose.translation().z() << "]" << std::endl;
        std::cerr << "[StereoSLAM] DEBUG: Applied scale factor: " << scale_factor << std::endl;
        
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
            monocular_system->configure(width, height, calib.left_.fx_, calib.left_.fy_, calib.left_.cx_, calib.left_.cy_, 
                                       calib.left_.k1_, calib.left_.k2_, calib.left_.p1_, calib.left_.p2_);
            
            // CRITICAL: Set the initial pose in the monocular system to match stereo scale
            // This prevents the monocular system from reinitializing in its own scale space
            monocular_system->setInitialPose(current_pose);
            
            monocular_system_initialized = true;
            std::cerr << "[StereoSLAM] Monocular system initialized with calibration: fx=" << calib.left_.fx_ 
                      << ", fy=" << calib.left_.fy_ << ", k1=" << calib.left_.k1_ << ", k2=" << calib.left_.k2_ << std::endl;
            std::cerr << "[StereoSLAM] Initial pose set in monocular system: t=[" << current_pose.translation().x() 
                      << ", " << current_pose.translation().y() << ", " << current_pose.translation().z() << "]" << std::endl;
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
                
                // Apply scale factor to monocular pose to maintain metric scale
                // If scale_factor is not set (no previous stereo initialization), calculate it from stereo baseline
                if (scale_factor == 1.0 && !has_stereo_triangulation) {
                    // Fallback: calculate scale factor from stereo baseline for monocular tracking
                    double stereo_baseline = std::abs(calib.T_left_right_.translation().x());
                    if (stereo_baseline < 1e-6) stereo_baseline = 0.1; // Fallback baseline
                    
                    double mono_translation_norm = t.norm();
                    if (mono_translation_norm > 1e-6) {
                        scale_factor = stereo_baseline / mono_translation_norm;
                        
                        // Apply scale factor bounds
                        const double min_scale = MIN_SCALE_FACTOR;
                        const double max_scale = MAX_SCALE_FACTOR;
                        if (scale_factor < min_scale) {
                            scale_factor = min_scale;
                        } else if (scale_factor > max_scale) {
                            scale_factor = max_scale;
                        }
                        
                        //std::cerr << "[StereoSLAM] DEBUG: Fallback scale recovery for monocular tracking: baseline=" << stereo_baseline 
                        //          << ", mono_norm=" << mono_translation_norm << ", scale_factor=" << scale_factor << std::endl;
                    }
                }
                
                t = t * scale_factor;
                current_pose = Sophus::SE3d(q, t);
                last_pose = current_pose;
                
                // Update frame for compatibility
                frame->setTwc(current_pose);
                
                // Debug: Log scaled monocular pose
                // std::cerr << "[StereoSLAM] DEBUG: Monocular pose after scaling: [" 
                //           << current_pose.translation().x() << ", " 
                //           << current_pose.translation().y() << ", " 
                //           << current_pose.translation().z() << "] (scale factor: " << scale_factor << ")" << std::endl;
                
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
    
    // --- Fallback for when stereo triangulation fails but we still want pose tracking ---
    if (!scale_initialized && !has_stereo_triangulation && tracked_kps_left.size() >= 20) {
        // Try monocular-only initialization if stereo failed
        if (monocular_system_initialized && monocular_system) {
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
                Eigen::Matrix3d R;
                R << pose_data[0], pose_data[1], pose_data[2],
                     pose_data[4], pose_data[5], pose_data[6],
                     pose_data[8], pose_data[9], pose_data[10];
                
                Eigen::Vector3d t(pose_data[12], pose_data[13], pose_data[14]);
                Eigen::Quaterniond q(R);
                
                // Use stereo baseline for scale even in monocular-only mode
                // This ensures consistent metric scale regardless of stereo triangulation success
                double stereo_baseline = std::abs(calib.T_left_right_.translation().x());
                if (stereo_baseline < 1e-6) stereo_baseline = 0.1; // Fallback baseline
                
                // Calculate scale factor using stereo baseline (same as stereo initialization)
                double mono_translation_norm = t.norm();
                if (mono_translation_norm > 1e-6) {
                    scale_factor = stereo_baseline / mono_translation_norm;
                    
                    // Apply scale factor bounds
                    const double min_scale = MIN_SCALE_FACTOR;
                    const double max_scale = MAX_SCALE_FACTOR;
                    if (scale_factor < min_scale) {
                        scale_factor = min_scale;
                    } else if (scale_factor > max_scale) {
                        scale_factor = max_scale;
                    }
                    
                    t = t * scale_factor;
                    
                    //std::cerr << "[StereoSLAM] DEBUG: Monocular-only scale recovery: baseline=" << stereo_baseline 
                    //          << ", mono_norm=" << mono_translation_norm << ", scale_factor=" << scale_factor << std::endl;
                } else {
                    // Fallback to default scale if monocular translation is too small
                    t = t * 1.0;
                    scale_factor = 1.0;
                    //std::cerr << "[StereoSLAM] WARNING: Monocular translation too small, using default scale" << std::endl;
                }
                current_pose = Sophus::SE3d(q, t);
                last_pose = current_pose;
                
                // Update frame for compatibility
                frame->setTwc(current_pose);
                
                // Mark as initialized for future frames
                scale_initialized = true;
                
                //std::cerr << "[StereoSLAM] DEBUG: Monocular-only initialization successful (no stereo triangulation)" << std::endl;
            } else {
                // If monocular SLAM also fails, keep the last pose
                current_pose = last_pose;
                //std::cerr << "[StereoSLAM] DEBUG: Monocular-only initialization failed (status: " << status << ")" << std::endl;
            }
        } else {
            // No monocular system available, keep last pose
            current_pose = last_pose;
        }
    }
    // --- Output pose (always update AR object) ---
    //std::cerr << "[StereoSLAM] DEBUG: About to output pose using Utils::toPoseArray" << std::endl;
    // Use same 16-element format as monocular SLAM for 
    Utils::toPoseArray(current_pose, out);
    //std::cerr << "[StereoSLAM] DEBUG: Pose output completed successfully" << std::endl;

    // --- Transform 3D points from camera coordinates to world coordinates ---

    world_points_buffer.clear();
    world_points_buffer.reserve(lastStereo3DPoints.size());
    
    for (const auto& pt : lastStereo3DPoints) {
        // Transform point from camera coordinates to world coordinates
        // current_pose is the camera's pose in world coordinates (Twc)
        // To transform camera points to world: pt_world = Twc * pt_camera
        Eigen::Vector3d pt_camera(pt.x, pt.y, pt.z);
        Eigen::Vector3d pt_world = current_pose * pt_camera;
        world_points_buffer.emplace_back(pt_world.x(), pt_world.y(), pt_world.z());
    }


    // Debug: Print pose values
    // std::cerr << "[StereoSLAM] Pose output: t=[" << t.x() << ", " << t.y() << ", " << t.z() 
    //           << "], q=[" << q.x() << ", " << q.y() << ", " << q.z() << ", " << q.w() << "]" << std::endl;

    // Profiling output
    auto t_end = std::chrono::high_resolution_clock::now();
    // std::cerr << "[PROFILE] TOTAL: " << std::chrono::duration_cast<std::chrono::milliseconds>(t_end-t_start).count() << " ms\n";

    //std::cerr << "[StereoSLAM] DEBUG: Function returning 1 (success)" << std::endl;
    return 1;
}

// Expose 2D keypoints to JS for visualization
extern "C" int getStereoFrameKeypoints(int pointsPtr) {
    int n = std::min((int)lastStereoLeftKeypoints.size(), 4096);
    int* data = reinterpret_cast<int*>(pointsPtr);
    for (int i = 0, j = 0; i < n; ++i) {
        data[j++] = (int)lastStereoLeftKeypoints[i].x;
        data[j++] = (int)lastStereoLeftKeypoints[i].y;
    }
    return n;
}

// Expose 3D points in camera coordinates to JS for left frame display
extern "C" int getStereoFramePoints(int points3DPtr) {
    int n = std::min((int)lastStereo3DPoints.size(), 1000); // Limit for performance
    float* data = reinterpret_cast<float*>(points3DPtr);
    for (int i = 0; i < n; ++i) {
        data[i * 3] = (float)lastStereo3DPoints[i].x;
        data[i * 3 + 1] = (float)lastStereo3DPoints[i].y;
        data[i * 3 + 2] = (float)lastStereo3DPoints[i].z;
    }
    return n;
}

// Expose 3D points in world coordinates to JS for plane detection and right visualizer
extern "C" int getStereoFramePoints3D(int points3DPtr) {
    int n = std::min((int)world_points_buffer.size(), 1000); // Limit for performance
    float* data = reinterpret_cast<float*>(points3DPtr);
    for (int i = 0; i < n; ++i) {
        data[i * 3] = (float)world_points_buffer[i].x;
        data[i * 3 + 1] = (float)world_points_buffer[i].y;
        data[i * 3 + 2] = (float)world_points_buffer[i].z;
    }
    return n;
} 