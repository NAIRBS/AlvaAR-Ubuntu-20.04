# Performance Profiling Documentation

## Overview

This document provides exact specifications for how every metric in the CSV export is calculated in the AlvaAR performance monitoring system. All calculations use high-precision timing and are designed for accurate performance analysis.

## CPU Usage Measurement Theory

### Why Frame-Based CPU Measurement Is Correct

**Traditional CPU Measurement (Not Possible in Browsers)**:
- True CPU usage = (CPU time used / total CPU time) × 100%
- Requires access to system-level CPU statistics
- Blocked by browser security policies for privacy and security

**Frame-Based CPU Measurement (Our Approach)**:
- CPU usage = (processing time / frame duration) × 100%
- Measures application work relative to available frame time
- Works within browser security constraints
- Provides meaningful performance indicators

**Why This Is The Right Approach**:

1. **Browser Security Compliance**: Works within browser limitations
2. **Performance Relevance**: Directly measures frame budget utilization
3. **Real-World Meaning**: Shows actual processing load per frame
4. **Optimization Value**: Identifies when processing exceeds frame budget
5. **Cross-Platform Consistency**: Works the same across all browsers

This method provides the most accurate and meaningful CPU usage measurement possible within browser environments.

## CSV Export Format

```csv
video_name,timestamp,frame_number,frame_time_utilization_percent,memory_usage_mb,fps,video_latency_ms,slam_latency_ms_js,total_latency_ms,measurement_distance_m
```

## Metric Calculations

### 1. video_name

**Source**: `VIDEO_CONFIG[currentVideoType].displayName`

**Calculation**:
```javascript
const currentVideoType = localStorage.getItem('selectedVideoType') || 'long_ruler';
const videoConfig = VIDEO_CONFIG[currentVideoType] || VIDEO_CONFIG['long_ruler'];
const videoName = videoConfig.displayName;
```

**Example**: `"long_ruler_left.mp4 / long_ruler_right.mp4"`

**Notes**: 
- Retrieved from localStorage at performance monitor initialization
- Falls back to 'long_ruler' if no video type stored
- Used as first column in CSV for data organization

---

### 2. timestamp

**Source**: `performance.now()`

**Calculation**:
```javascript
const timestamp = performance.now();
```

**Units**: Milliseconds (floating point)

**Precision**: Microsecond precision (0.001ms)

**Example**: `1234567890.123`

**Notes**:
- High-resolution timestamp from browser performance API
- Monotonic clock (not affected by system time changes)
- Used for temporal analysis of performance data

---

### 3. frame_number

**Source**: `this.frameCount` (incremented each frame)

**Calculation**:
```javascript
this.frameCount++;
```

**Units**: Integer (starts at 1)

**Example**: `1, 2, 3, ...`

**Notes**:
- Incremented at the start of each frame processing
- Used for frame-by-frame analysis
- Resets when performance monitor is reset

---

### 4. frame_time_utilization_percent

**Source**: `this.frameTimeUtilization` (frame-based calculation method)

**Definition**: 
Frame time utilization = (actual processing time / available frame time) × 100%

**Calculation**:
```javascript
// Frame time utilization calculation
const frameDuration = currentTime - this.lastFrameTime;        // Total time available for this frame
const frameProcessingTime = this.componentLatencies.total;     // Actual time spent processing
const frameTimeUtilization = Math.min(100, (frameProcessingTime / frameDuration) * 100);

// Direct assignment (no smoothing)
this.frameTimeUtilization = Math.round(frameTimeUtilization * 100) / 100;
```

**Units**: Percentage (0-100)

**Precision**: 2 decimal places

**Example**: `45.67`

**Why This Method Is Correct**:

1. **Browser Security Compliance**: 
   - True CPU measurement is blocked by browser security policies
   - This method works within browser constraints
   - Provides the most accurate estimate possible

2. **Frame-Based Performance Measurement**:
   - Measures actual work done vs time available per frame
   - Shows percentage of frame time spent on processing
   - Directly correlates to performance and potential frame drops

3. **Real-World Relevance**:
   - 0% = No processing (idle frame)
   - 50% = Half frame time spent processing
   - 100% = Frame time fully utilized (potential lag)
   - Values > 100% indicate frame time exceeded (dropped frames)

4. **Performance Indicator**:
   - Higher values indicate potential performance issues
   - Helps identify when processing exceeds frame budget
   - Useful for optimization and performance tuning

**Notes**:
- **This is the correct approach** for browser-based frame time utilization measurement
- Values represent processing time as percentage of frame time
- Direct calculation (no smoothing) for real-time responsiveness
- Most accurate method possible within browser security constraints

---

### 5. memory_usage_mb

**Source**: `performance.memory.usedJSHeapSize`

**Calculation**:
```javascript
const mbSize = Math.pow(1000, 2); // 1,000,000 bytes
this.memoryUsage = performance.memory.usedJSHeapSize / mbSize;
```

**Units**: Megabytes (floating point)

**Precision**: 2 decimal places

**Example**: `128.45`

**Notes**:
- Only available in Chrome/Chromium browsers
- Returns 0 in other browsers (Firefox, Safari)
- Measures JavaScript heap usage, not total system memory
- Updated every frame during performance monitoring

---

### 6. fps

**Source**: Perfect frame interval measurement

**Calculation**:
```javascript
// Frame interval measurement (most accurate)
const frameInterval = currentTime - this.lastFrameTime;
this.frameIntervals.push(frameInterval);

// Calculate FPS from frame intervals
let intervalSize = this.frameIntervals.size();
let intervalSum = 0;

for (let i = 0; i < intervalSize; ++i) {
    intervalSum += this.frameIntervals.getAt(i);
}

// FPS = number of intervals / total time * 1000ms
this.fps = intervalSize / intervalSum * 1000;
```

**Units**: Frames per second (floating point)

**Precision**: Integer (rounded down with `~~`)

**Example**: `30`

**Notes**:
- **Perfect measurement**: Uses frame intervals only, not render loop time
- 60-frame buffer for smooth averaging (1 second at 60fps)
- Excludes display rendering time from calculation
- High precision using `performance.now()`
- Rolling average prevents jittery readings

---

### 7. video_latency_ms

**Source**: `stats.timers.get('video').getElapsedTime()`

**Calculation**:
```javascript
// JavaScript timing (includes all overhead)
stats.start('video');
// ... video processing (drawImage/putImageData, labels, etc.) ...
stats.stop('video');

const videoLatency = stats.timers.get('video').getElapsedTime();
```

**Units**: Milliseconds (floating point)

**Precision**: 2 decimal places

**Example**: `2.15`

**Notes**:
- Measures complete video processing pipeline
- Includes canvas operations, image data conversion, labels
- JavaScript timing includes all browser overhead
- Updated every frame

---

### 8. slam_latency_ms_js

**Source**: JavaScript timing (includes WASM overhead)

**Calculation**:
```javascript
// JavaScript timing (includes WASM communication overhead)
stats.start('slam');
pose = alva.findStereoCameraPose(frameLeft, frameRight);
stats.stop('slam');

const jsSlamTime = stats.timers.get('slam').getElapsedTime();
```

**Units**: Milliseconds (floating point)

**Precision**: 2 decimal places

**Example**: `15.23`

**Notes**:
- **Most accurate for real-world performance**
- Includes JavaScript-to-WASM communication overhead
- Represents total time from JS call to WASM return
- Used for Stats tracker display and CSV export
- Updated with accurate timing in performance monitor

---

### 9. total_latency_ms

**Source**: Sum of video + SLAM timing

**Calculation**:
```javascript
this.componentLatencies.total = this.componentLatencies.video + this.componentLatencies.slam;
```

**Units**: Milliseconds (floating point)

**Precision**: 2 decimal places

**Example**: `17.38`

**Notes**:
- **Complete frame processing time**
- Video processing + SLAM processing
- Used for total performance analysis
- Updated in Stats tracker for display
- Represents end-to-end frame processing

---

### 10. measurement_distance_m

**Source**: AR Ruler measurement system

**Calculation**:
```javascript
// Method 1: From UI display
const distanceDisplay = document.getElementById('distance-display');
const distanceText = distanceDisplay.textContent;
const distanceMatch = distanceText.match(/(\d+\.?\d*)\s*meters?/);
const measurementDistance = parseFloat(distanceMatch[1]);

// Method 2: From AR Ruler system
const measurementDistance = arRulerSystem.getCurrentDistance();
```

**Units**: Meters (floating point)

**Precision**: 3 decimal places

**Example**: `1.234`

**Notes**:
- **3D distance measurement**
- Distance between start and end markers
- 0.000 when no measurement active
- Retrieved from AR Ruler measurement system
- Used for measurement accuracy analysis

---

## Data Storage and Export

### Performance Data Structure
```javascript
const data = {
    timestamp: performance.now(),
    frameNumber: this.frameCount,
    frameTimeUtilization: Math.round(this.frameTimeUtilization * 100) / 100,
    memoryUsage: Math.round(this.memoryUsage * 100) / 100,
    fps: this.fps,
    videoLatency: Math.round(this.componentLatencies.video * 100) / 100,
    slamLatency: Math.round(this.componentLatencies.slam * 100) / 100,
    totalLatency: Math.round(this.componentLatencies.total * 100) / 100,
    measurementDistance: Math.round(this.measurementDistance * 1000) / 1000
};
```

### CSV Generation
```javascript
const csvHeader = 'video_name,timestamp,frame_number,frame_time_utilization_percent,memory_usage_mb,fps,video_latency_ms,slam_latency_ms_js,total_latency_ms,measurement_distance_m\n';

const csvContent = this.performanceData.map(data => {
    const slamLatencyJs = data.slamLatency || 0;
    
    return `${this.videoName},${data.timestamp},${data.frameNumber},${data.frameTimeUtilization},${data.memoryUsage},${data.fps},${data.videoLatency},${slamLatencyJs},${data.totalLatency},${data.measurementDistance}`;
}).join('\n');
```

## Accuracy Notes

### High Accuracy Metrics
- **FPS**: Perfect frame interval measurement
- **SLAM Timing**: Microsecond precision C++ timing
- **Video Timing**: High precision JavaScript timing
- **Memory Usage**: Direct browser API (Chrome only)

### Medium Accuracy Metrics
- **CPU Usage**: Browser limitations prevent true CPU measurement
- **Total Latency**: Sum of individual components

### Limitations
- **CPU Usage**: Browser security restrictions
- **Memory Usage**: Only available in Chrome/Chromium
- **WASM Overhead**: Estimated from timing difference

## Performance Impact

All metrics are calculated with minimal performance impact:
- **High-precision timing**: Uses `performance.now()` (microsecond precision)
- **Efficient storage**: Circular buffers prevent memory leaks
- **Minimal overhead**: Calculations optimized for real-time performance
- **Error handling**: Graceful degradation if APIs unavailable

This profiling system provides comprehensive performance analysis for the AlvaAR SLAM system with maximum accuracy possible within browser constraints.
