#pragma once

#include <string>
#include "camera_calibration.hpp"

// ==== STEREO SLAM ADDITION ====
// Stereo Calibration YAML Loader for AlvaAR Stereo SLAM
//
// This loader reads stereo camera calibration from a YAML file and fills a StereoCameraCalibration structure.
//
// === YAML File Placement ===
// Place your stereo camera YAML file in a configuration directory, e.g.:
//   config/stereo_camera.yaml
//
// === Usage Example ===
//   StereoCameraCalibration calib;
//   bool ok = loadStereoCalibrationFromYAML("config/stereo_camera.yaml", calib);
//   if (!ok) { /* handle error */ }
//
// === Constraints ===
// - The YAML file must follow the format provided by the user (see current_plan_18th_July.md).
// - This loader does NOT perform any rectification or calibration computation.
// - It simply loads the parameters as provided and fills the StereoCameraCalibration structure.
// - If you update your calibration, just replace the YAML file—no code changes needed.
//
// === Error Handling ===
// - The loader returns false and prints an error if the file is missing or unreadable.
//
// ---- END STEREO SLAM ADDITION ----

bool loadStereoCalibrationFromYAML(const std::string& yaml_path, StereoCameraCalibration& calib);
bool loadStereoCalibrationFromYAMLString(const std::string& yaml_string, StereoCameraCalibration& calib);
// New overload for direct left/right calibration extraction
bool loadStereoCalibrationFromYAMLString(const std::string& yaml_string, CameraCalibration& left, CameraCalibration& right); 