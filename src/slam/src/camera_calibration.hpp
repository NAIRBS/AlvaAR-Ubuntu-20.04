#pragma once

#include <iostream>
#include <string>

#include <Eigen/Core>
#include <Eigen/Geometry>
#include <Eigen/LU>

#include <sophus/se3.hpp>

#include <opencv2/core.hpp>
#include <opencv2/core/eigen.hpp>
#include <opencv2/calib3d.hpp>
#include <opencv2/imgproc.hpp>

class CameraCalibration
{

public:
    EIGEN_MAKE_ALIGNED_OPERATOR_NEW

    CameraCalibration()
    {}

    CameraCalibration(double fx, double fy, double cx, double cy, double k1, double k2, double p1, double p2, double imgWidth, double imgHeight, double imgBorder);

    cv::Point2f projectCamToImageDist(const Eigen::Vector3d &point) const;

    cv::Point2f projectCamToImage(const Eigen::Vector3d &point) const;

    cv::Point2f undistortImagePoint(const cv::Point2f &point) const;

    Eigen::Matrix3d getRotation() const;

    Eigen::Vector3d getTranslation() const;

    double fx_, fy_, cx_, cy_;
    double k1_, k2_, p1_, p2_;

    double imgWidth_;
    double imgHeight_;
    double imgBorder_;

    cv::Mat Kcv_;
    cv::Mat Dcv_;

    Eigen::Vector4d D_;
    Eigen::Matrix3d K_;
    Eigen::Matrix3d inverseK_;

    // Extrinsic Parameters
    Sophus::SE3d Tc0ci_;
    cv::Mat Rcv_c0ci_;
    cv::Mat tcv_c0ci_;

    // ROI Mask for detection
    cv::Rect roi_rect_;
    cv::Mat roi_mask_;
};

// ==== STEREO SLAM ADDITION ====
// The following class is added to support stereo camera calibration for stereo SLAM.
// This is necessary because stereo SLAM requires knowledge of both left and right camera intrinsics
// as well as the extrinsic transformation (rotation and translation) between them.
// This mirrors OV2SLAM's approach, where stereo calibration is a core requirement for triangulation and pose estimation.
// This class is completely separate from the existing CameraCalibration class, so monocular code is unaffected.

class StereoCameraCalibration {
public:
    EIGEN_MAKE_ALIGNED_OPERATOR_NEW

    // Default constructor for flexibility in initialization.
    StereoCameraCalibration() {}

    // Constructor that takes two CameraCalibration objects (left and right) and the transformation from left to right.
    // This matches the OV2SLAM convention, where T_left_right is used for stereo geometry.
    StereoCameraCalibration(const CameraCalibration& left,
                           const CameraCalibration& right,
                           const Sophus::SE3d& T_left_right)
        : left_(left), right_(right), T_left_right_(T_left_right) {}

    CameraCalibration left_;         // Intrinsics and distortion for the left camera
    CameraCalibration right_;        // Intrinsics and distortion for the right camera
    Sophus::SE3d T_left_right_;      // Extrinsic: transform from left to right camera

    // This structure is essential for stereo feature matching and triangulation,
    // as it allows us to project points from one camera to the other and compute 3D positions.
};
// ---- END STEREO SLAM ADDITION ----
