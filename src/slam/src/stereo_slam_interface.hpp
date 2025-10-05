#pragma once

#ifdef __cplusplus
extern "C" {
#endif

int findStereoCameraPose(int leftImagePtr, int rightImagePtr, int posePtr);
void setStereoCalibrationYAML(const char* yaml, int length);

// ==== STEREO SLAM ADDITION: 2D KEYPOINTS EXPORT ====
// Returns the last set of left image keypoints (2D points) for visualization in JS.
// This function is strictly for stereo mode and does not affect monocular code.
extern "C" int getStereoFrameKeypoints(int pointsPtr);

// ==== STEREO SLAM ADDITION: 3D POINTS IN CAMERA COORDINATES ====
// Returns the last set of triangulated 3D points in camera coordinates for left frame display.
// This function is strictly for stereo mode and does not affect monocular code.
extern "C" int getStereoFramePoints(int pointsPtr);

// ==== STEREO SLAM ADDITION: 3D POINTS IN WORLD COORDINATES ====
// Returns the last set of triangulated 3D points in world coordinates for plane detection.
// This function is strictly for stereo mode and does not affect monocular code.
extern "C" int getStereoFramePoints3D(int points3DPtr);

#ifdef __cplusplus
}
#endif 