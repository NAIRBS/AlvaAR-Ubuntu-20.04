// ES6 module: StereoAlvaAR wrapper for stereo SLAM
// Usage:
//   import { StereoAlvaAR } from './alva_ar_stereo.js';
//   const alva = await StereoAlvaAR.Initialize(width, height);
//   const pose = alva.findStereoCameraPose(leftFrame, rightFrame);

const StereoAlvaAR = {
  async Initialize(width, height) {
    // Optionally, you could do any async setup here (e.g., wait for WASM ready)
    // For now, just return the API object
    return this;
  },

  findStereoCameraPose(leftFrame, rightFrame) {
    if (!window.Module || typeof Module.findStereoCameraPose !== 'function') {
      console.error('Emscripten Module or findStereoCameraPose not loaded');
      return null;
    }
    // Allocate memory for left and right images
    const leftPtr = Module._malloc(leftFrame.data.length);
    const rightPtr = Module._malloc(rightFrame.data.length);
    Module.HEAPU8.set(leftFrame.data, leftPtr);
    Module.HEAPU8.set(rightFrame.data, rightPtr);
    // Allocate memory for pose output (16 floats - same as monocular)
    const posePtr = Module._malloc(16 * 4);
    const ok = Module.findStereoCameraPose(leftPtr, rightPtr, posePtr);
    let pose = null;
    if (ok) {
      pose = new Float32Array(Module.HEAPF32.buffer, posePtr, 16).slice();
    }
    Module._free(leftPtr);
    Module._free(rightPtr);
    Module._free(posePtr);
    return pose;
  },

  reset() {
    if (window.Module && typeof Module.reset === 'function') {
      Module.reset();
    } else {
      console.warn('Stereo SLAM reset() not implemented.');
    }
  },

  getFramePoints() {
    if (window.Module && typeof Module.getStereoFramePoints === 'function') {
      // Allocate buffer for up to 4096 points (x, y pairs as int32)
      const maxPoints = 4096;
      const bufSize = maxPoints * 2 * 4; // 2 ints per point, 4 bytes per int
      const bufPtr = Module._malloc(bufSize);
      const numPoints = Module.getStereoFramePoints(bufPtr);
      const data = new Int32Array(Module.HEAP32.buffer, bufPtr, numPoints * 2);
      const points = [];
      for (let i = 0; i < numPoints; ++i) {
        points.push({ x: data[i * 2], y: data[i * 2 + 1] });
      }
      Module._free(bufPtr);
      return points;
    } else {
      console.warn('Stereo SLAM getFramePoints() not implemented.');
      return [];
    }
  },

  // Optionally, you can add more stereo-specific methods here
};

export { StereoAlvaAR }; 