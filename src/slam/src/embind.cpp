#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <emscripten/emscripten.h>

#include "compat_boost17.h"
#include "system.hpp"
#include "stereo_slam_interface.hpp"

using namespace emscripten;

EMSCRIPTEN_BINDINGS(Module)
{
    class_<System>("System")
        .constructor()
        .function("configure", &System::configure)
        .function("reset", &System::reset)
        .function("findCameraPoseWithIMU", &System::findCameraPoseWithIMU, allow_raw_pointers())
        .function("findCameraPose", &System::findCameraPose, allow_raw_pointers())
        .function("findPlane", &System::findPlane)
        .function("getFramePoints", &System::getFramePoints);

    // OV2SLAM-style stereo SLAM interface
    function("setStereoCalibrationYAML", optional_override([](emscripten::val yamlString) {
        std::string yaml = yamlString.as<std::string>();
        setStereoCalibrationYAML(yaml.c_str(), yaml.size());
    }));
    function("findStereoCameraPose", &findStereoCameraPose, allow_raw_pointers());
    function("getStereoFrameKeypoints", &getStereoFrameKeypoints, allow_raw_pointers());
    function("getStereoFramePoints", &getStereoFramePoints, allow_raw_pointers());
    function("getStereoFramePoints3D", &getStereoFramePoints3D, allow_raw_pointers());
}