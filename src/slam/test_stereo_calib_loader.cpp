#include "src/slam/src/stereo_calib_loader.hpp"
#include <iostream>

int main() {
    StereoCameraCalibration calib;
    std::cout << "[Test] Loading stereo calibration from config/stereo_camera.yaml..." << std::endl;
    if (!loadStereoCalibrationFromYAML("config/stereo_camera.yaml", calib)) {
        std::cerr << "[Test] ERROR: Failed to load stereo calibration!" << std::endl;
        return 1;
    }
    // Print loaded parameters for manual inspection
    std::cout << "[Test] Left Camera Intrinsics:" << std::endl;
    std::cout << "  fx: " << calib.left_.fx_ << ", fy: " << calib.left_.fy_ << std::endl;
    std::cout << "  cx: " << calib.left_.cx_ << ", cy: " << calib.left_.cy_ << std::endl;
    std::cout << "  k1: " << calib.left_.k1_ << ", k2: " << calib.left_.k2_ << ", p1: " << calib.left_.p1_ << ", p2: " << calib.left_.p2_ << std::endl;
    std::cout << "[Test] Right Camera Intrinsics:" << std::endl;
    std::cout << "  fx: " << calib.right_.fx_ << ", fy: " << calib.right_.fy_ << std::endl;
    std::cout << "  cx: " << calib.right_.cx_ << ", cy: " << calib.right_.cy_ << std::endl;
    std::cout << "  k1: " << calib.right_.k1_ << ", k2: " << calib.right_.k2_ << ", p1: " << calib.right_.p1_ << ", p2: " << calib.right_.p2_ << std::endl;
    std::cout << "[Test] Baseline (meters): " << calib.T_left_right_.translation().x() << std::endl;
    std::cout << "[Test] All parameters loaded successfully!" << std::endl;
    return 0;
} 