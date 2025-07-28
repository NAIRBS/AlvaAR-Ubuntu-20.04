#pragma once

#include <iomanip>
#include <deque>
#include <fstream>
#include "map_manager.hpp"

class Optimizer
{

public:
    Optimizer(std::shared_ptr<State> state, std::shared_ptr<MapManager> mapManager) : state_(state), mapManager_(mapManager)
    {
    }

    void localBA(Frame &newFrame);
    // Local bundle adjustment (adapted from OV2SLAM)
    void localBundleAdjustment(std::vector<std::shared_ptr<Frame>>& localKeyframes, std::vector<std::shared_ptr<MapPoint>>& localMapPoints);

private:
    std::shared_ptr<State> state_;
    std::shared_ptr<MapManager> mapManager_;
};