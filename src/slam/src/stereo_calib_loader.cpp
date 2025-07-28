#include "stereo_calib_loader.hpp"
#include <opencv2/core.hpp>
#include <opencv2/core/persistence.hpp>
#include <iostream>

// ==== STEREO SLAM ADDITION ====
// Implementation of the stereo calibration YAML loader for AlvaAR Stereo SLAM.
// This function reads the user's YAML file and fills a StereoCameraCalibration structure.
// It does NOT perform any rectification or calibration computation—just loads the data as provided.
//
// See stereo_calib_loader.hpp for usage, placement, and constraints.
// ----

bool loadStereoCalibrationFromYAML(const std::string& yaml_path, StereoCameraCalibration& calib) {
    cv::FileStorage fs(yaml_path, cv::FileStorage::READ);
    if (!fs.isOpened()) {
        std::cerr << "[StereoCalibLoader] ERROR: Could not open YAML file: " << yaml_path << std::endl;
        return false;
    }

    // Helper lambda to read a matrix
    auto readMat = [&](const std::string& key, cv::Mat& mat) {
        if (!fs[key].empty()) {
            fs[key] >> mat;
        } else {
            std::cerr << "[StereoCalibLoader] ERROR: Missing key '" << key << "' in YAML." << std::endl;
            return false;
        }
        return true;
    };

    // Read left camera intrinsics and distortion
    cv::Mat K1, D1;
    if (!readMat("LEFT.K", K1) || !readMat("LEFT.D", D1)) return false;
    double fx1 = K1.at<double>(0,0), fy1 = K1.at<double>(1,1), cx1 = K1.at<double>(0,2), cy1 = K1.at<double>(1,2);
    double k1_1 = D1.at<double>(0,0), k2_1 = D1.at<double>(0,1), p1_1 = D1.at<double>(0,2), p2_1 = D1.at<double>(0,3);
    int width1 = (int)fs["LEFT.width"], height1 = (int)fs["LEFT.height"];

    // Read right camera intrinsics and distortion
    cv::Mat K2, D2;
    if (!readMat("RIGHT.K", K2) || !readMat("RIGHT.D", D2)) return false;
    double fx2 = K2.at<double>(0,0), fy2 = K2.at<double>(1,1), cx2 = K2.at<double>(0,2), cy2 = K2.at<double>(1,2);
    double k1_2 = D2.at<double>(0,0), k2_2 = D2.at<double>(0,1), p1_2 = D2.at<double>(0,2), p2_2 = D2.at<double>(0,3);
    int width2 = (int)fs["RIGHT.width"], height2 = (int)fs["RIGHT.height"];

    // Fill CameraCalibration objects
    CameraCalibration left(fx1, fy1, cx1, cy1, k1_1, k2_1, p1_1, p2_1, width1, height1, 0);
    CameraCalibration right(fx2, fy2, cx2, cy2, k1_2, k2_2, p1_2, p2_2, width2, height2, 0);

    // Read projection matrices (for rectified images)
    cv::Mat P1, P2;
    if (!readMat("LEFT.P", P1) || !readMat("RIGHT.P", P2)) return false;

    // Compute baseline from projection matrices (assuming P1 and P2 are 3x4)
    // For rectified stereo, the baseline is encoded in the projection matrix
    // P2[0,3] = -fx * baseline (where fx is the focal length)
    double baseline = -P2.at<double>(0,3) / P2.at<double>(0,0); // Use fx from P2 matrix
    std::cerr << "[StereoSLAM] Computed baseline (meters): " << baseline << std::endl;

    // Fill the extrinsic transform (T_left_right)
    // For rectified images, rotation is identity, translation is (baseline, 0, 0)
    Eigen::Matrix3d R = Eigen::Matrix3d::Identity();
    Eigen::Vector3d t(baseline, 0, 0);
    Sophus::SE3d T_left_right(R, t);

    calib = StereoCameraCalibration(left, right, T_left_right);

    std::cout << "[StereoCalibLoader] Loaded stereo calibration from: " << yaml_path << std::endl;
    std::cout << "  Baseline: " << baseline << " meters" << std::endl;
    return true;
}

bool loadStereoCalibrationFromYAMLString(const std::string& yaml_string, StereoCameraCalibration& calib) {
    cv::FileStorage fs(yaml_string, cv::FileStorage::READ | cv::FileStorage::MEMORY);
    if (!fs.isOpened()) {
        std::cerr << "[StereoCalibLoader] ERROR: Could not open YAML string from memory." << std::endl;
        return false;
    }
    // Copy the rest of the logic from loadStereoCalibrationFromYAML
    auto readMat = [&](const std::string& key, cv::Mat& mat) {
        if (!fs[key].empty()) {
            fs[key] >> mat;
        } else {
            std::cerr << "[StereoCalibLoader] ERROR: Missing key '" << key << "' in YAML." << std::endl;
            return false;
        }
        return true;
    };
    cv::Mat K1, D1;
    if (!readMat("LEFT.K", K1) || !readMat("LEFT.D", D1)) return false;
    double fx1 = K1.at<double>(0,0), fy1 = K1.at<double>(1,1), cx1 = K1.at<double>(0,2), cy1 = K1.at<double>(1,2);
    double k1_1 = D1.at<double>(0,0), k2_1 = D1.at<double>(0,1), p1_1 = D1.at<double>(0,2), p2_1 = D1.at<double>(0,3);
    int width1 = (int)fs["LEFT.width"], height1 = (int)fs["LEFT.height"];
    cv::Mat K2, D2;
    if (!readMat("RIGHT.K", K2) || !readMat("RIGHT.D", D2)) return false;
    double fx2 = K2.at<double>(0,0), fy2 = K2.at<double>(1,1), cx2 = K2.at<double>(0,2), cy2 = K2.at<double>(1,2);
    double k1_2 = D2.at<double>(0,0), k2_2 = D2.at<double>(0,1), p1_2 = D2.at<double>(0,2), p2_2 = D2.at<double>(0,3);
    int width2 = (int)fs["RIGHT.width"], height2 = (int)fs["RIGHT.height"];
    CameraCalibration left(fx1, fy1, cx1, cy1, k1_1, k2_1, p1_1, p2_1, width1, height1, 0);
    CameraCalibration right(fx2, fy2, cx2, cy2, k1_2, k2_2, p1_2, p2_2, width2, height2, 0);
    cv::Mat P1, P2;
    if (!readMat("LEFT.P", P1) || !readMat("RIGHT.P", P2)) return false;
    double baseline = -P2.at<double>(0,3) / P2.at<double>(0,0); // Use fx from P2 matrix
    std::cerr << "[StereoSLAM] Computed baseline (meters): " << baseline << std::endl;
    Eigen::Matrix3d R = Eigen::Matrix3d::Identity();
    Eigen::Vector3d t(baseline, 0, 0);
    Sophus::SE3d T_left_right(R, t);
    calib = StereoCameraCalibration(left, right, T_left_right);
    std::cout << "[StereoCalibLoader] Loaded stereo calibration from YAML string (memory)." << std::endl;
    std::cout << "  Baseline: " << baseline << " meters" << std::endl;
    return true;
}

// New overload for direct left/right calibration extraction
bool loadStereoCalibrationFromYAMLString(const std::string& yaml_string, CameraCalibration& left, CameraCalibration& right) {
    cv::FileStorage fs(yaml_string, cv::FileStorage::READ | cv::FileStorage::MEMORY);
    if (!fs.isOpened()) {
        std::cerr << "[StereoCalibLoader] ERROR: Could not open YAML string from memory." << std::endl;
        return false;
    }
    auto readMat = [&](const std::string& key, cv::Mat& mat) {
        if (!fs[key].empty()) {
            fs[key] >> mat;
        } else {
            std::cerr << "[StereoCalibLoader] ERROR: Missing key '" << key << "' in YAML." << std::endl;
            return false;
        }
        return true;
    };
    cv::Mat K1, D1;
    if (!readMat("LEFT.K", K1) || !readMat("LEFT.D", D1)) return false;
    double fx1 = K1.at<double>(0,0), fy1 = K1.at<double>(1,1), cx1 = K1.at<double>(0,2), cy1 = K1.at<double>(1,2);
    double k1_1 = D1.at<double>(0,0), k2_1 = D1.at<double>(0,1), p1_1 = D1.at<double>(0,2), p2_1 = D1.at<double>(0,3);
    int width1 = (int)fs["LEFT.width"], height1 = (int)fs["LEFT.height"];
    cv::Mat K2, D2;
    if (!readMat("RIGHT.K", K2) || !readMat("RIGHT.D", D2)) return false;
    double fx2 = K2.at<double>(0,0), fy2 = K2.at<double>(1,1), cx2 = K2.at<double>(0,2), cy2 = K2.at<double>(1,2);
    double k1_2 = D2.at<double>(0,0), k2_2 = D2.at<double>(0,1), p1_2 = D2.at<double>(0,2), p2_2 = D2.at<double>(0,3);
    int width2 = (int)fs["RIGHT.width"], height2 = (int)fs["RIGHT.height"];
    left = CameraCalibration(fx1, fy1, cx1, cy1, k1_1, k2_1, p1_1, p2_1, width1, height1, 0);
    right = CameraCalibration(fx2, fy2, cx2, cy2, k1_2, k2_2, p1_2, p2_2, width2, height2, 0);
    std::cout << "[StereoCalibLoader] Loaded stereo calibration from YAML string (memory) [left/right objects]." << std::endl;
    return true;
}
// ---- END STEREO SLAM ADDITION ---- 