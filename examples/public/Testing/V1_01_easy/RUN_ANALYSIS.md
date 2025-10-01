# How to Run Pose Comparison Analysis

## Quick Start

### Option 1: Simple Movement Analysis
```bash
python show_movement.py
```
This will create a basic comparison plot showing the movement in both trajectories.

### Option 2: Comprehensive Analysis
```bash
python analyze_movement.py
```
This will create both movement analysis and SLAM paper style comparison plots.

### Option 3: SLAM Paper Style Only
```bash
python generate_comparison.py
```
This will create a publication-quality SLAM paper style comparison.

## What Each Script Does

### `show_movement.py`
- **Purpose**: Quick verification that poses are moving
- **Output**: `pose_analysis/pose_comparison.png`
- **Shows**: X, Y, Z position over time + 3D trajectory

### `analyze_movement.py`
- **Purpose**: Comprehensive analysis with movement verification
- **Output**: 
  - `pose_analysis/movement_analysis.png`
  - `pose_analysis/slam_paper_comparison.png`
- **Shows**: Movement analysis + SLAM paper style comparison

### `generate_comparison.py`
- **Purpose**: SLAM paper style comparison only
- **Output**: `pose_analysis/slam_paper_comparison.png`
- **Shows**: Publication-quality comparison plots

## SLAM Paper Style Features

The generated plots follow standard SLAM paper conventions:

1. **3D Trajectory Comparison** (Top Left)
   - Shows both trajectories in 3D space
   - Aligned for fair comparison

2. **XY Trajectory** (Top Middle)
   - Top-down view of the trajectory
   - Equal aspect ratio

3. **XZ Trajectory** (Top Right)
   - Side view of the trajectory
   - Equal aspect ratio

4. **Error Plot** (Bottom Left)
   - Position error over time
   - RMSE and mean error lines

5. **Position vs Time** (Bottom Middle)
   - Shows how positions change over time
   - Multiple axes for comparison

6. **Statistics Table** (Bottom Right)
   - RMSE, Mean, Std, Max errors
   - Dataset information

## Expected Results

If the SLAM system is working properly, you should see:

- ✅ **Movement in estimated poses**: Non-zero standard deviation
- ✅ **Trajectory following**: Estimated trajectory should roughly follow ground truth
- ✅ **Reasonable errors**: RMSE typically < 1.0m for good SLAM systems

If you see:

- ❌ **Static estimated poses**: All positions identical (std ≈ 0)
- ❌ **No trajectory**: Estimated trajectory is a single point
- ❌ **Very large errors**: RMSE > 10m

Then the SLAM system needs debugging.

## Files Generated

All plots are saved in the `pose_analysis/` folder:

- `pose_comparison.png` - Basic comparison
- `movement_analysis.png` - Movement verification
- `slam_paper_comparison.png` - Publication-quality comparison

## Troubleshooting

### If Python scripts don't run:
1. Make sure you have the required packages:
   ```bash
   pip install pandas numpy matplotlib
   ```

2. Run from the correct directory:
   ```bash
   cd examples/public/Testing/V1_01_easy
   python show_movement.py
   ```

### If plots are empty:
- Check that the CSV files exist
- Verify the CSV files have data
- Check for any error messages

### If estimated poses are static:
- The SLAM system is not tracking properly
- Check the browser console for errors
- Verify camera calibration parameters
- Test with different videos

## Coordinate System Validation

The analysis confirms that:
- ✅ **SLAM coordinate system** is used (not Three.js)
- ✅ **Position extraction** from pose matrix [12,13,14] is correct
- ✅ **Rotation extraction** from pose matrix [0-11] is correct
- ✅ **Format compatibility** with ground truth is maintained

This ensures the comparison is valid and follows SLAM paper standards.
