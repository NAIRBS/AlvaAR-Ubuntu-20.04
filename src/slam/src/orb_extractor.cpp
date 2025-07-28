#include "orb_extractor.hpp"
#include <opencv2/imgproc.hpp>
#include <algorithm>
#include <cmath>
#include <list>

// Adapted from OV2SLAM's ORBextractor.cc
ORBExtractor::ORBExtractor(int nfeatures, float scaleFactor, int nlevels, int iniThFAST, int minThFAST)
    : nfeatures_(nfeatures), scaleFactor_(scaleFactor), nlevels_(nlevels), iniThFAST_(iniThFAST), minThFAST_(minThFAST) {
    // Compute scale factors
    scaleFactors_.resize(nlevels_);
    invScaleFactors_.resize(nlevels_);
    levelSigma2_.resize(nlevels_);
    invLevelSigma2_.resize(nlevels_);
    scaleFactors_[0] = 1.0f;
    for (int i = 1; i < nlevels_; ++i)
        scaleFactors_[i] = scaleFactors_[i - 1] * scaleFactor_;
    for (int i = 0; i < nlevels_; ++i) {
        invScaleFactors_[i] = 1.0f / scaleFactors_[i];
        levelSigma2_[i] = scaleFactors_[i] * scaleFactors_[i];
        invLevelSigma2_[i] = 1.0f / levelSigma2_[i];
    }
    // Features per level
    nfeaturesPerLevel_.resize(nlevels_);
    float factor = 1.0f / scaleFactor_;
    float nDesiredFeaturesPerScale = nfeatures_ * (1 - factor) / (1 - std::pow(factor, nlevels_));
    int sumFeatures = 0;
    for (int level = 0; level < nlevels_ - 1; ++level) {
        nfeaturesPerLevel_[level] = std::round(nDesiredFeaturesPerScale);
        sumFeatures += nfeaturesPerLevel_[level];
        nDesiredFeaturesPerScale *= factor;
    }
    nfeaturesPerLevel_[nlevels_ - 1] = std::max(nfeatures_ - sumFeatures, 0);
    orb_ = cv::ORB::create();
}

void ORBExtractor::operator()(const cv::Mat& image, std::vector<cv::KeyPoint>& keypoints, cv::Mat& descriptors) {
    ComputePyramid(image);
    std::vector<std::vector<cv::KeyPoint>> allKeypoints;
    ComputeKeyPointsOctTree(allKeypoints);
    keypoints.clear();
    int total = 0;
    for (int level = 0; level < nlevels_; ++level) {
        total += (int)allKeypoints[level].size();
    }
    if (total == 0) {
        descriptors.release();
        return;
    }
    keypoints.reserve(total);
    for (int level = 0; level < nlevels_; ++level) {
        std::vector<cv::KeyPoint>& kps = allKeypoints[level];
        if (kps.empty())
            continue;
        for (auto& kp : kps) {
            kp.octave = level;
            keypoints.push_back(kp);
        }
    }
    // Compute descriptors
    orb_->compute(imagePyramid_[0], keypoints, descriptors);
}

void ORBExtractor::ComputePyramid(const cv::Mat& image) {
    imagePyramid_.resize(nlevels_);
    for (int level = 0; level < nlevels_; ++level) {
        float scale = scaleFactors_[level];
        cv::Size sz(cvRound(image.cols / scale), cvRound(image.rows / scale));
        if (level == 0)
            imagePyramid_[level] = image;
        else
            cv::resize(image, imagePyramid_[level], sz, 0, 0, cv::INTER_LINEAR);
    }
}

// OctTree node division (from OV2SLAM)
void ORBExtractor::Node::DivideNode(Node &n1, Node &n2, Node &n3, Node &n4) {
    const int halfX = std::ceil(static_cast<float>(UR.x - UL.x) / 2);
    const int halfY = std::ceil(static_cast<float>(BR.y - UL.y) / 2);
    n1.UL = UL;
    n1.UR = cv::Point2i(UL.x + halfX, UL.y);
    n1.BL = cv::Point2i(UL.x, UL.y + halfY);
    n1.BR = cv::Point2i(UL.x + halfX, UL.y + halfY);
    n2.UL = n1.UR;
    n2.UR = UR;
    n2.BL = n1.BR;
    n2.BR = cv::Point2i(UR.x, UR.y + halfY);
    n3.UL = n1.BL;
    n3.UR = n1.BR;
    n3.BL = BL;
    n3.BR = cv::Point2i(n1.BR.x, BL.y + halfY);
    n4.UL = n3.UR;
    n4.UR = n2.BR;
    n4.BL = n3.BR;
    n4.BR = BR;
    for (size_t i = 0; i < vKeys.size(); i++) {
        const cv::KeyPoint &kp = vKeys[i];
        if (kp.pt.x < n1.UR.x) {
            if (kp.pt.y < n1.BR.y)
                n1.vKeys.push_back(kp);
            else
                n3.vKeys.push_back(kp);
        } else {
            if (kp.pt.y < n1.BR.y)
                n2.vKeys.push_back(kp);
            else
                n4.vKeys.push_back(kp);
        }
    }
}

// OctTree-based feature distribution (from OV2SLAM)
std::vector<cv::KeyPoint> ORBExtractor::DistributeOctTree(const std::vector<cv::KeyPoint>& vToDistributeKeys, int minX, int maxX, int minY, int maxY, int N, int level) {
    // This is a direct adaptation of OV2SLAM's logic
    const int nIni = std::round(static_cast<float>(maxX - minX) / (maxY - minY));
    const float hX = static_cast<float>(maxX - minX) / nIni;
    std::list<ORBExtractor::Node> lNodes;
    std::vector<ORBExtractor::Node> vIniNodes(nIni);
    for (int i = 0; i < nIni; i++) {
        ORBExtractor::Node ni;
        ni.UL = cv::Point2i(hX * static_cast<float>(i), 0);
        ni.UR = cv::Point2i(hX * static_cast<float>(i + 1), 0);
        ni.BL = cv::Point2i(ni.UL.x, maxY - minY);
        ni.BR = cv::Point2i(ni.UR.x, maxY - minY);
        lNodes.push_back(ni);
        vIniNodes[i] = ni;
    }
    for (size_t i = 0; i < vToDistributeKeys.size(); i++) {
        const cv::KeyPoint &kp = vToDistributeKeys[i];
        lNodes.front().vKeys.push_back(kp); // Simplified: assign all to first node, OV2SLAM assigns by x
    }
    bool bFinish = false;
    int iteration = 0;
    std::vector<std::pair<int, ORBExtractor::Node*>> vSizeAndPointerToNode;
    while (!bFinish) {
        iteration++;
        vSizeAndPointerToNode.clear();
        for (auto it = lNodes.begin(); it != lNodes.end(); it++) {
            if (it->vKeys.size() == 1) {
                it->bNoMore = true;
                continue;
            } else if (it->vKeys.empty()) {
                lNodes.erase(it--);
                continue;
            }
            ORBExtractor::Node n1, n2, n3, n4;
            it->DivideNode(n1, n2, n3, n4);
            if (!n1.vKeys.empty()) lNodes.push_back(n1);
            if (!n2.vKeys.empty()) lNodes.push_back(n2);
            if (!n3.vKeys.empty()) lNodes.push_back(n3);
            if (!n4.vKeys.empty()) lNodes.push_back(n4);
            it = lNodes.erase(it);
            it--;
        }
        if ((int)lNodes.size() >= N || iteration > 10) bFinish = true;
    }
    std::vector<cv::KeyPoint> vResultKeys;
    vResultKeys.reserve(N);
    for (auto it = lNodes.begin(); it != lNodes.end(); it++) {
        std::vector<cv::KeyPoint> &vNodeKeys = it->vKeys;
        cv::KeyPoint* pKP = &vNodeKeys[0];
        float maxResponse = pKP->response;
        for (size_t k = 1; k < vNodeKeys.size(); k++) {
            if (vNodeKeys[k].response > maxResponse) {
                pKP = &vNodeKeys[k];
                maxResponse = vNodeKeys[k].response;
            }
        }
        vResultKeys.push_back(*pKP);
    }
    return vResultKeys;
}

// Update ComputeKeyPointsOctTree to use DistributeOctTree
void ORBExtractor::ComputeKeyPointsOctTree(std::vector<std::vector<cv::KeyPoint>>& allKeypoints) {
    allKeypoints.resize(nlevels_);
    for (int level = 0; level < nlevels_; ++level) {
        std::vector<cv::KeyPoint> keypoints;
        int nfeatures = nfeaturesPerLevel_[level];
        int fastTh = iniThFAST_;
        cv::FAST(imagePyramid_[level], keypoints, fastTh, true);
        if (keypoints.size() < nfeatures) {
            fastTh = minThFAST_;
            cv::FAST(imagePyramid_[level], keypoints, fastTh, true);
        }
        if ((int)keypoints.size() > nfeatures) {
            keypoints = DistributeOctTree(keypoints, 0, imagePyramid_[level].cols, 0, imagePyramid_[level].rows, nfeatures, level);
        }
        allKeypoints[level] = keypoints;
    }
} 