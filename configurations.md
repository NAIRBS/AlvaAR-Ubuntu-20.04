# AlvaAR Configuration Documentation

## Overview

AlvaAR is a real-time visual SLAM algorithm running as WebAssembly, based on OV²SLAM and ORB-SLAM2. It supports monocular, stereo, and RGBD inputs for AR applications in web browsers.

## OV²SLAM Configuration

AlvaAR uses a heavily modified version of OV²SLAM ([https://github.com/ov2slam/ov2slam](https://github.com/ov2slam/ov2slam)) with hardcoded configuration parameters rather than external parameter files.

### Configuration Modes

OV²SLAM provides three configuration modes:
- **FAST**: Optimized for speed, lower accuracy
- **AVERAGE**: Balanced performance and accuracy  
- **ACCURATE**: Highest accuracy, slower performance

### AlvaAR's Hybrid Configuration

AlvaAR implements a **modified ACCURATE configuration** with additional optimizations for real-time web performance:

| Parameter | FAST | AVERAGE | ACCURATE | AlvaAR (Modified) |
|-----------|------|---------|----------|-------------------|
| `frameMaxCellSize_` | 50 | 45 | 35 | **35** ✅ |
| `claheEnabled_` | false | false | true | **false** ❌ |
| `mapKeyframeFilteringRatio` | 0.9 | 0.9 | 0.95 | **0.95** ✅ |
| `p3pEnabled_` | true | false | false | **true** ❌ |

### AlvaAR-Specific Optimizations

- **Grid-based keypoint detection**: Uses `grid_cell_size = 40` (same as monocular)
- **Enhanced feature density**: `grid_max_per_cell = 2` (allows 2 features per cell)
- **Quality threshold**: `grid_quality = 0.001` (selective feature detection)
- **Maximum keypoints**: `max_total_kps = 320` (increased for better tracking)
- **Monocular keypoints**: ~192 keypoints for 640x480 (cell size 40)
- **Stereo keypoints**: ~320 keypoints for 640x480 (enhanced detection)
- **Watchdog timers**: 100ms timeout for frame processing
- **Fast monocular approach**: Optimized for real-time browser performance



## HTML Examples Configuration Table

| File | Input Source | SLAM Type | Resolution | Frame Format | Notes |
|------|-------------|-----------|------------|--------------|-------|
| `camera.html` | Web camera | Monocular | Dynamic | Single camera | Live webcam input |
| `video.html` | Video file | Monocular | Dynamic | Single camera | Video file input |
| `rgbd_video_mono.html` | Video file | Monocular | 1280x480 | Single camera | RGBD video monocular |
| `rgbd_live_mono_640x480.html` | RGBD WebSocket | Monocular | 640x480 | Dual display (L+R) | Stereo input, monocular SLAM |
| `esp32_live_mono.html` | ESP32-CAM WebSocket | Monocular | 960x320 | Single camera | ESP32 camera stream |
| `esp32_video_mono.html` | Video file | Monocular | Dynamic | Single camera | ESP32 video demo |
| `rgbd_video_stereo.html` | Video file | Stereo | 640x480 | Dual camera | RGBD stereo video |
| `rgbd_live_stereo_640x480.html` | RGBD WebSocket | Stereo | 640x480 | Dual camera | Live RGBD stereo |
| `esp32_live_stereo.html` | ESP32-CAM WebSocket | Stereo | Dynamic | Dual camera | ESP32 stereo stream |
| `esp32_video_stereo.html` | Video file | Stereo | Dynamic | Dual camera | ESP32 stereo video |
| `esp32_live_stereo_3d_viewer.html` | ESP32-CAM WebSocket | Stereo | Dynamic | Dual camera | ESP32 3D viewer |
| `imu.html` | Phone Camera + IMU | Monocular + IMU | Dynamic | Single camera | IMU integration |

### Key Configuration Details

#### Resolution-Specific Files
- **960x320**: `esp32_live_mono.html` (ESP32-CAM)
- **640x480**: `rgbd_live_stereo_640x480.html`, `rgbd_live_mono_640x480.html`, `rgbd_video_mono.html`, `rgbd_video_stereo.html`
- **Dynamic**: `video.html`, `camera.html`, `esp32_live_stereo.html`, `esp32_video_mono.html`, `esp32_video_stereo.html`, `esp32_live_stereo_3d_viewer.html`, `imu.html` (adapt to input)

#### Input Sources
- **RGBD WebSocket**: Real-time camera streams via WebSocket (ROS2)
- **ESP32-CAM WebSocket**: ESP32 camera module streams (480x360 resolution)
- **Video files**: Pre-recorded video files
- **Web camera**: Live browser camera access

#### SLAM Types
- **Monocular**: Single camera pose estimation (no metric scale)
- **Stereo**: Dual camera pose estimation (metric scale recovery)
- **Monocular + IMU**: Single camera with IMU data

#### Pose Format
- **All files now use 16-element format**: 4x4 transformation matrix
- **Standardized across monocular and stereo**: Ensures compatibility

#### Keypoint Configuration
- **Monocular SLAM**: Uses automatic calculation with `frameMaxCellSize_ = 40`
- **Stereo SLAM**: Uses grid-based detection with `grid_cell_size = 40` (same as monocular)
- **Enhanced density**: `grid_max_per_cell = 2` allows more features per cell
- **Maximum keypoints**: `max_total_kps = 320` for better tracking stability
- **Resolution adaptive**: Keypoint count scales automatically with image resolution
- **Consistent logic**: Both monocular and stereo use similar detection methods

## Technical Notes

### Coordinate Systems
- **Camera-to-World (Twc)**: Standard SLAM output format
- **World-to-Camera (Tcw)**: Inverse transformation for AR visualization
- **JavaScript transformations**: Applied in `alva_ar_three.js` for Three.js compatibility

### Performance Optimizations
- **Watchdog timers**: Prevent frame processing from exceeding 100ms
- **Grid-based keypoint detection**: Efficient feature distribution across image grid
- **Enhanced feature density**: More keypoints per cell for better tracking
- **Memory management**: Persistent buffer allocation to reduce malloc overhead
- **Quality filtering**: Selective feature detection for optimal performance

### Debugging Features
- **Extensive logging**: Debug statements in C++ for troubleshooting
- **Memory safety**: Zero-initialized pose buffers
- **Error handling**: Graceful degradation on SLAM failures

## File Structure

```
examples/public/
├── assets/                    # JavaScript libraries and assets
├── sandbox/                   # Development/testing files
├── *.html                     # Main demo files
└── configurations.md          # This documentation file
```

## Usage Notes

1. **WebSocket Setup**: ROS2 camera streams require WebSocket server at `ws://localhost:8765`
2. **YAML Configuration**: Stereo demos load calibration from `./assets/d345i_640x480.yaml`
3. **Browser Compatibility**: Requires WebAssembly support and WebGL
4. **Performance**: Optimized for real-time AR applications in browsers
5. **Memory Management**: Automatic cleanup of WASM memory allocations

## Troubleshooting

### Common Issues
1. **"Unknown pose format"**: Ensure all HTML files use 16-element pose allocation
2. **Memory access errors**: Check for proper pose buffer initialization
3. **WebSocket connection**: Verify ROS2 camera stream is running
4. **Performance issues**: Monitor frame processing times with debug logs
5. **Keypoint count variations**: Keypoint count varies with image resolution and cell size configuration

### Debug Logs
Enable debug logging in C++ files to trace execution:
```cpp
std::cerr << "[StereoSLAM] DEBUG: Function entry" << std::endl;
```

This documentation covers the key technical details and configurations used in AlvaAR's implementation of OV²SLAM for web-based AR applications.
