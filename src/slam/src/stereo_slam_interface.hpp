#pragma once

#ifdef __cplusplus
extern "C" {
#endif

int findStereoCameraPose(int leftImagePtr, int rightImagePtr, int posePtr);
void setStereoCalibrationYAML(const char* yaml, int length);

// ==== STEREO SLAM ADDITION: STEREO FRAMEPOINTS EXPORT ====
// Returns the last set of left image keypoints (2D points) for visualization in JS.
// This function is strictly for stereo mode and does not affect monocular code.
extern "C" int getStereoFramePoints(int pointsPtr);

// ==== STEREO SLAM ADDITION: 3D POINTS EXPORT FOR PLANE DETECTION ====
// Returns the last set of triangulated 3D points for plane detection in JS.
// This function is strictly for stereo mode and does not affect monocular code.
extern "C" int getStereoFramePoints3D(int points3DPtr);

#ifdef __cplusplus
}
#endif 