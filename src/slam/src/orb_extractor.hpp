#pragma once
#include <opencv2/core.hpp>
#include <opencv2/features2d.hpp>
#include <vector>

// Adapted from OV2SLAM's ORBextractor.h
class ORBExtractor {
public:
    ORBExtractor(int nfeatures, float scaleFactor, int nlevels, int iniThFAST, int minThFAST);
    void operator()(const cv::Mat& image, std::vector<cv::KeyPoint>& keypoints, cv::Mat& descriptors);

private:
    void ComputePyramid(const cv::Mat& image);
    void ComputeKeyPointsOctTree(std::vector<std::vector<cv::KeyPoint>>& allKeypoints);
    // OctTree node structure (from OV2SLAM)
    struct Node {
        Node() : bNoMore(false) {}
        std::vector<cv::KeyPoint> vKeys;
        cv::Point2i UL, UR, BL, BR;
        std::vector<Node> vChildren;
        bool bNoMore;
        void DivideNode(Node &n1, Node &n2, Node &n3, Node &n4);
    };
    // OctTree-based feature distribution (from OV2SLAM)
    std::vector<cv::KeyPoint> DistributeOctTree(const std::vector<cv::KeyPoint>& vToDistributeKeys, int minX, int maxX, int minY, int maxY, int N, int level);

    int nfeatures_;
    float scaleFactor_;
    int nlevels_;
    int iniThFAST_;
    int minThFAST_;
    std::vector<float> scaleFactors_;
    std::vector<float> invScaleFactors_;
    std::vector<float> levelSigma2_;
    std::vector<float> invLevelSigma2_;
    std::vector<cv::Mat> imagePyramid_;
    std::vector<int> nfeaturesPerLevel_;
    cv::Ptr<cv::ORB> orb_; // for descriptor computation
}; 