# Pose Export and Ground Truth Comparison

This directory contains tools for exporting estimated poses and comparing them against ground truth data from the V1-01 Easy dataset.

## Files

- `V1-01-EASY-config.yaml` - Camera calibration parameters
- `left_camera.mp4` / `right_camera.mp4` - Stereo video files
- `cam0_groundtruth.csv` - Ground truth poses
- `compare_poses.py` - Python script for pose comparison analysis

## How to Use Pose Export

### 1. Run the Testing Application

1. Open `testing.html` in your browser
2. Click "Start" to begin the SLAM system
3. The system will automatically start capturing poses

### 2. Export Poses

1. Let the system run and capture poses (watch the "Poses captured" counter)
2. Click "Export Poses" button to download the CSV file
3. The exported file will be named `estimated_poses_YYYY-MM-DDTHH-MM-SS.csv`

### 3. Compare with Ground Truth

Use the Python comparison script:

```bash
cd examples/public/Testing/V1_01_easy
python compare_poses.py --gt cam0_groundtruth.csv --est estimated_poses_YYYY-MM-DDTHH-MM-SS.csv --output ./pose_analysis
```

This will generate:
- `pose_errors.png` - Translation and rotation error plots over time
- `trajectory_comparison.png` - 3D trajectory comparison
- Console output with error statistics

## CSV Format

Both ground truth and estimated poses use the same format:

```csv
timestamp_ns,filename,position_x,position_y,position_z,orientation_w,orientation_x,orientation_y,orientation_z,velocity_x,velocity_y,velocity_z
```

### Fields:
- `timestamp_ns`: Timestamp in nanoseconds
- `filename`: Frame filename
- `position_x,y,z`: 3D position in meters
- `orientation_w,x,y,z`: Quaternion orientation (w,x,y,z order)
- `velocity_x,y,z`: Velocity (set to 0.0 for estimated poses)

## Coordinate System

The poses are in the **camera coordinate system**, not Three.js coordinates:
- **X**: Right (positive X points right)
- **Y**: Down (positive Y points down) 
- **Z**: Forward (positive Z points forward)

This matches the ground truth format from the V1-01 Easy dataset.

## Analysis Results

The comparison script provides:

### Translation Errors
- Mean, standard deviation, max, min translation errors in meters
- Plots showing translation errors over time

### Rotation Errors  
- Mean, standard deviation, max, min rotation errors in degrees
- Plots showing rotation errors over time

### Trajectory Visualization
- 3D plot comparing ground truth vs estimated trajectories
- Shows overall trajectory accuracy

## Tips for Better Results

1. **Let the system initialize**: Wait for stable pose tracking before starting analysis
2. **Capture sufficient data**: Aim for at least 100-200 poses for meaningful statistics
3. **Check pose quality**: Look for smooth trajectories without sudden jumps
4. **Compare coordinate systems**: Ensure both datasets use the same coordinate convention

## Troubleshooting

- **No poses exported**: Check that the SLAM system is tracking (pose counter should increase)
- **Large errors**: Verify camera calibration parameters match the video resolution
- **Coordinate mismatch**: Ensure the pose conversion handles coordinate system differences correctly
