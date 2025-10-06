// Import all the necessary functions and classes
import { MONOCULAR_SCALE_FACTOR, waitForEmscriptenModule, parseCalibrationYAML, drawPlaneOutlineOnFrame, ARRulerSystem } from './rgbd_ar_ruler_script.js';
import { ARRulerVisualizer, MeasurementUI } from './rgbd_ar_ruler_classes.js';

// Mobile detection function
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
         (window.innerWidth <= 768 && window.innerHeight <= 1024);
}

// Enforce horizontal view for mobile
function enforceHorizontalView() {
  if (isMobileDevice()) {
    // Lock screen orientation to landscape
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(err => {
        console.log('Could not lock orientation:', err);
      });
    }
    
    // Add CSS to enforce landscape view
    const style = document.createElement('style');
    style.textContent = `
      @media screen and (orientation: portrait) {
        body::before {
          content: "Please rotate your device to landscape mode for the best experience";
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.9);
          color: white;
          padding: 20px;
          border-radius: 10px;
          z-index: 10000;
          text-align: center;
          font-size: 18px;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

// Global variables for video management
let mediaLeft, mediaRight;
let sceneVisualizer; // Make sceneVisualizer global so refreshVisualizer can access it

// Panel visibility state - hidden by default on mobile
let panelsVisible = !isMobileDevice();

// Function to load selected video
async function loadSelectedVideo(videoType, Video) {
  console.log('🎬 Loading video type:', videoType);
  
  // RELOAD PAGE when changing video selection for complete reset
  console.log('🔄 Reloading page for new video...');
  
  // Store the selected video type in localStorage for persistence
  localStorage.setItem('selectedVideoType', videoType);
  
  // Reload the page to completely reset everything
  window.location.reload();
  return; // Exit early since page is reloading
}

// 🎬 VIDEO CONFIGURATION - ADD NEW VIDEOS HERE ONLY!
const VIDEO_CONFIG = {
  // 'v2_ruler': {
  //   leftFile: 'Indoor_Videos/Obsolete/Indoor_Lighted_HF_small_ruler_left.mp4',
  //   rightFile: 'Indoor_Videos/Obsolete/Indoor_Lighted_HF_small_ruler_right.mp4',
  //   displayName: 'Indoor_Lighted_HF_small_ruler'
  // },
  // 'long_ruler': {
  //   leftFile: 'Indoor_Videos/Obsolete/Indoor_Lighted_HF_long_ruler_left.mp4',
  //   rightFile: 'Indoor_Videos/Obsolete/Indoor_Lighted_HF_long_ruler_right.mp4',
  //   displayName: 'Indoor_Lighted_HF_long_ruler'
  // },
  '1. light_desk_HF_40cm': {
    leftFile: 'Indoor_Videos/Desk-left-light-40cm.mp4',
    rightFile: 'Indoor_Videos/Desk-right-light-40cm.mp4',
    displayName: '1. light_desk_HF_40cm'
  },
  '2. dark_desk_HF_40cm': {
    leftFile: 'Indoor_Videos/Desk-left-dark-40cm.mp4',
    rightFile: 'Indoor_Videos/Desk-right-dark-40cm.mp4',
    displayName: '2. dark_desk_HF_40cm'
  },
  '3. light_storeroom_HF_35cm': {
    leftFile: 'Indoor_Videos/Storeroom_left_light_35cm.mp4',
    rightFile: 'Indoor_Videos/Storeroom_right_light_35cm.mp4',
    displayName: '3. light_storeroom_HF_35cm'
  },
  '4. dark_storeroom_HF_35cm': {
    leftFile: 'Indoor_Videos/Storeroom_left_dark_35cm.mp4',
    rightFile: 'Indoor_Videos/Storeroom_right_dark_35cm.mp4',
    displayName: '4. dark_storeroom_HF_35cm'
  },
  '5. light_corridor_LF_35cm': {
    leftFile: 'Indoor_Videos/corridor_left_light_35cm.mp4',
    rightFile: 'Indoor_Videos/corridor_right_light_35cm.mp4',
    displayName: '5. light_corridor_LF_35cm'
  },
  '6. dark_corridor_LF_35cm': {
    leftFile: 'Indoor_Videos/corridor_left_dark_35cm.mp4',
    rightFile: 'Indoor_Videos/corridor_right_dark_35cm.mp4',
    displayName: '6. dark_corridor_LF_35cm'
  },
  '7. light_balcony_LF_35cm': {
    leftFile: 'Indoor_Videos/Balcony_left_light_35cm.mp4',
    rightFile: 'Indoor_Videos/Balcony_right_light_35cm.mp4',
    displayName: '7. light_balcony_LF_35cm'
  },
  '8. dark_balcony_LF_35cm': {
    leftFile: 'Indoor_Videos/Balcony_left_dark_35cm.mp4',
    rightFile: 'Indoor_Videos/Balcony_right_dark_35cm.mp4',
    displayName: '8. dark_balcony_LF_35cm'
  },
  '9. dark_alley_LF_150cm': {
    leftFile: 'Outdoor_Videos/Alley_left_dark_150cm.mp4',
    rightFile: 'Outdoor_Videos/Alley_right_dark_150cm.mp4',
    displayName: '9. dark_alley_LF_150cm'
  },
  '10. dark_carpark_LF_66cm': {
    leftFile: 'Outdoor_Videos/Carpark_left_dark_66cm.mp4',
    rightFile: 'Outdoor_Videos/Carpark_right_dark_66cm.mp4',
    displayName: '10. dark_carpark_LF_66cm'
  },
  '11. dark_walkway_LF_150cm': {
    leftFile: 'Outdoor_Videos/Walkway_left_dark_150cm.mp4',
    rightFile: 'Outdoor_Videos/Walkway_right_dark_150cm.mp4',
    displayName: '11. dark_walkway_LF_150cm'
  },
  '12. dark_pillar_LF_150cm': {
    leftFile: 'Outdoor_Videos/Pillar_left_dark_150cm.mp4',
    rightFile: 'Outdoor_Videos/Pillar_right_dark_150cm.mp4',
    displayName: '12. dark_pillar_LF_150cm'
  }
};

// Function to update splash screen text based on video selection
function updateSplashScreenText(videoType) {
  console.log('🎬 Updating splash screen text for video type:', videoType);
  
  const fallbackKey = Object.keys(VIDEO_CONFIG)[0];
  const config = VIDEO_CONFIG[videoType] || VIDEO_CONFIG[fallbackKey];
  const videoText = `RGBD Video AR Ruler - Distance Measurement \\A Using pre-recorded RGBD stereo video \\A (${config.displayName}) \\A \\A 📏 INTERACTIONS: \\A • Click LEFT FRAME first time: Place GREEN start marker \\A • Click LEFT FRAME second time: Place RED end marker \\A • Click LEFT FRAME third time: Clear all \\A \\A 🔄 Auto-loop • 📹 Dropdown for video • 👁️ Eye button for extended UI`;
  
  console.log('🎬 Setting splash text to:', videoText);
  
  // Remove any existing splash screen style
  const existingStyle = document.getElementById('splash-screen-style');
  if (existingStyle) {
    existingStyle.remove();
  }
  
  // Update the CSS content property
  const style = document.createElement('style');
  style.id = 'splash-screen-style';
  style.textContent = `
    #overlay::before {
      content: "${videoText}";
      font-size: 14px;
      line-height: 1.4;
    }
  `;
  document.head.appendChild(style);
  
  console.log('📝 Updated splash screen text for:', videoType);
}

// Function to generate dropdown options dynamically
function generateVideoDropdownOptions() {
  const dropdown = document.getElementById('video-dropdown');
  if (!dropdown) return;
  
  // Clear existing options
  dropdown.innerHTML = '';
  
  // Add options from VIDEO_CONFIG
  Object.entries(VIDEO_CONFIG).forEach(([key, config]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = config.displayName;
    dropdown.appendChild(option);
  });
}

// Function to actually load videos (used after page reload)
async function loadVideoByType(videoType, Video) {
  console.log('🎬 Loading video type:', videoType);
  
  // Get video configuration
  const config = VIDEO_CONFIG[videoType];
  if (!config) {
    console.warn('Unknown video type:', videoType);
    return;
  }
  
  // Build video paths
  const leftVideoPath = `./assets/AR_Ruler/${config.leftFile}`;
  const rightVideoPath = `./assets/AR_Ruler/${config.rightFile}`;
  
  try {
    // Initialize new videos
    mediaLeft = await Video.Initialize(leftVideoPath);
    mediaRight = await Video.Initialize(rightVideoPath);
    
    // Start playing
    mediaLeft.el.play();
    mediaLeft.el.loop = true;
    mediaRight.el.play();
    mediaRight.el.loop = true;
    
    console.log('✅ Videos loaded successfully:', leftVideoPath, rightVideoPath);
    
    // Set up loop detection for the new videos
    setupVideoLoopDetection();
    
  } catch (error) {
    console.error('❌ Error loading videos:', error);
  }
}

// Function to set up video loop detection
function setupVideoLoopDetection() {
  if (!mediaLeft || !mediaLeft.el) return;
  
  // Remove existing event listeners
  mediaLeft.el.removeEventListener('ended', handleVideoLoop);
  mediaLeft.el.removeEventListener('timeupdate', handleTimeUpdate);
  
  // Add new event listeners
  mediaLeft.el.addEventListener('ended', handleVideoLoop);
  
  let lastTimeLeft = 0;
  let loopDetectedLeft = false;
  
  function handleVideoLoop() {
    console.log('Video looped (ended event) - refreshing visualizer');
    refreshVisualizer();
  }
  
  function handleTimeUpdate() {
    const currentTime = mediaLeft.el.currentTime;
    // Detect if video jumped back to start (loop occurred)
    if (currentTime < lastTimeLeft && lastTimeLeft > 1.0 && !loopDetectedLeft) {
      console.log('Video looped (timeupdate detection) - refreshing visualizer');
      refreshVisualizer();
      loopDetectedLeft = true;
    } else if (currentTime > lastTimeLeft) {
      loopDetectedLeft = false;
    }
    lastTimeLeft = currentTime;
  }
  
  mediaLeft.el.addEventListener('timeupdate', handleTimeUpdate);
}

// Function to refresh/clear the visualizer when video loops
function refreshVisualizer() {
  if (!sceneVisualizer) return;
  
  console.log('Video looped - resetting everything...');
  
  // Clear all feature points
  if (sceneVisualizer.featurePoints) {
    for (const point of sceneVisualizer.featurePoints) {
      sceneVisualizer.scene.remove(point);
    }
    sceneVisualizer.featurePoints = [];
  }
  
  // Clear existing plane visualization
  if (sceneVisualizer.planeWireframeMesh) {
    sceneVisualizer.scene.remove(sceneVisualizer.planeWireframeMesh);
    sceneVisualizer.planeWireframeMesh = null;
  }
  
  // Clear existing 3D plane wireframe
  if (sceneVisualizer.scene3DPlaneWireframeMesh) {
    sceneVisualizer.scene.remove(sceneVisualizer.scene3DPlaneWireframeMesh);
    sceneVisualizer.scene3DPlaneWireframeMesh = null;
  }
  
  // Reset feature geometry and material
  if (sceneVisualizer.featureGeometry) {
    sceneVisualizer.featureGeometry.dispose();
    sceneVisualizer.featureGeometry = null;
  }
  if (sceneVisualizer.featureMaterial) {
    sceneVisualizer.featureMaterial.dispose();
    sceneVisualizer.featureMaterial = null;
  }
  
  console.log('Reset complete');
}

async function main(Module, Stats, ARSimpleView, ARSimpleMap, Video, THREE, isLiveMode = false, PerformanceMonitor = null) {
  // Enforce horizontal view for mobile devices
  enforceHorizontalView();
  
  // Mobile scaling - calculate scale to make video half the display
  function calculateMobileScale() {
    const container = document.getElementById('container');
    const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (container && isMobile) {
      // Get the original video dimensions (640x480)
      const originalWidth = 640;
      const originalHeight = 480;
      
      // Calculate half the display height (shorter dimension in landscape)
      const halfDisplayWidth = window.innerWidth * 0.5;
      
      // Calculate scale needed to make video width = half display height
      const scale = halfDisplayWidth / originalWidth;
      
      // Apply the calculated scale
      container.style.transform = `scale(${scale})`;
      container.style.transformOrigin = 'top left';
      
      // Show right frame on mobile by setting showRightCamera to true
      if (typeof showRightCamera !== 'undefined') {
        showRightCamera = true;
        console.log('Mobile: Enabled right camera display');
      }
      
      console.log('Mobile scale applied:', {
        displayHeight: window.innerHeight,
        halfDisplayWeight: halfDisplayWidth,
        originalWidth: originalWidth,
        calculatedScale: scale,
        appliedTransform: container.style.transform
      });
    } else if (container && !isMobile) {
      // Reset transform for desktop
      container.style.transform = '';
      console.log('Desktop detected - removed mobile scaling');
    }
  }
  
  // Apply mobile scaling with delay to ensure container exists
  setTimeout(calculateMobileScale, 500);
  window.addEventListener('resize', calculateMobileScale);
  
  const $container = document.getElementById('container');
  const $visualizerContainer = document.getElementById('visualizer-panel');
  const $view = document.createElement('div');
  const $canvas = document.createElement('canvas');
  const $overlay = document.getElementById('overlay');
  const $start = document.getElementById('start_button');
  const $splash = document.getElementById('splash');
  const splashFadeTime = 800;

  // Set up video dropdown event listener immediately (before start button)
  const videoDropdown = document.getElementById('video-dropdown');
  if (videoDropdown) {
    // Generate dropdown options dynamically from VIDEO_CONFIG
    generateVideoDropdownOptions();
    
    // Set initial dropdown value and splash screen text
    const storedVideoType = localStorage.getItem('selectedVideoType');
    const firstKey = Object.keys(VIDEO_CONFIG)[0];
    const initialVideoType = (storedVideoType && VIDEO_CONFIG[storedVideoType]) ? storedVideoType : firstKey;
    
    console.log('🎬 Initial setup - storedVideoType:', storedVideoType);
    console.log('🎬 Initial setup - initialVideoType:', initialVideoType);
    
    // Set dropdown value
    videoDropdown.value = initialVideoType;
    console.log('🎬 Set dropdown value to:', videoDropdown.value);
    
    // Update splash screen text
    updateSplashScreenText(initialVideoType);
    
    // Set up event listener for dropdown changes
    videoDropdown.addEventListener('change', async (event) => {
      const selectedVideo = event.target.value;
      console.log('🎬 Video selection changed to:', selectedVideo);
      console.log('🎬 Current dropdown value:', videoDropdown.value);
      
      // Store the selected video type in localStorage for persistence
      localStorage.setItem('selectedVideoType', selectedVideo);
      console.log('🎬 Stored in localStorage:', localStorage.getItem('selectedVideoType'));
      
      // Update splash screen text immediately
      updateSplashScreenText(selectedVideo);
      
      // Reload the page immediately to apply the new video selection
      console.log('🔄 Reloading page for new video selection...');
      window.location.reload();
    });
  }

  // Set up panel toggle functionality
  const togglePanelsBtn = document.getElementById('toggle-panels');
  if (togglePanelsBtn) {
    // Set initial button state based on mobile detection
    if (panelsVisible) {
      togglePanelsBtn.textContent = '👁️';
      togglePanelsBtn.title = 'Hide Panels';
    } else {
      togglePanelsBtn.textContent = '❌';
      togglePanelsBtn.classList.add('panels-hidden');
      togglePanelsBtn.title = 'Show Panels';
    }
    
    togglePanelsBtn.addEventListener('click', () => {
      panelsVisible = !panelsVisible;
      
      const measurementPanel = document.getElementById('measurement-panel');
      const visualizerPanel = document.getElementById('visualizer-panel');
      
      if (panelsVisible) {
        // Show panels
        if (measurementPanel) {
          measurementPanel.style.display = 'flex';
        }
        if (visualizerPanel) {
          visualizerPanel.style.display = 'block';
        }
        togglePanelsBtn.textContent = '👁️';
        togglePanelsBtn.classList.remove('panels-hidden');
        togglePanelsBtn.title = 'Hide Panels';
      } else {
        // Hide panels
        if (measurementPanel) {
          measurementPanel.style.display = 'none';
        }
        if (visualizerPanel) {
          visualizerPanel.style.display = 'none';
        }
        togglePanelsBtn.textContent = '❌';
        togglePanelsBtn.classList.add('panels-hidden');
        togglePanelsBtn.title = 'Show Panels';
      }
      
      console.log('Panels visibility toggled:', panelsVisible ? 'visible' : 'hidden');
    });
  }

  let alva, view, stats;
  let arRulerSystem, visualizer, measurementUI;
  let performanceMonitor = null;
  
  // Make AR Ruler System and Measurement UI globally accessible for reset
  window.arRulerSystem = null;
  window.measurementUI = null;
  
  // Click state management for left frame clicks
  let clickState = 'idle'; // 'idle', 'start_placed', 'end_placed'
  
  // Function to show measurement info (3D visualizer only)
  function showMeasurementInfo(startPoint, endPoint, distance) {
    // Only create 3D text display in visualizer
    create3DMeasurementDisplay(startPoint, endPoint, distance);
  }
  
  // Function to hide measurement info
  function hideMeasurementInfo() {
    // Remove 3D text display
    remove3DMeasurementDisplay();
  }
  
  // 3D measurement display variables
  let measurement3DText = null;
  let measurement3DLine = null;
  
  // Store the current midpoint position for left frame panel
  let currentMidpoint = null;
  
  // Measurement panel offset above the measurement line (in meters)
  const MEASUREMENT_PANEL_OFFSET = 0.10;
  
  
  // Function to create 3D measurement display
  function create3DMeasurementDisplay(startPoint, endPoint, distance) {
    if (!sceneVisualizer) return;
    
    // Remove existing 3D measurement display
    remove3DMeasurementDisplay();
    
    // Create 3D text for distance
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 1024;
    canvas.height = 256;
    
    context.fillStyle = '#000000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#00ff00';
    context.font = 'Bold 180px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // Show live distance or final distance
    if (endPoint) {
      context.fillText(`${distance.toFixed(3)}m`, canvas.width / 2, canvas.height / 2);
    } else {
      context.fillText(`LIVE: ${distance.toFixed(3)}m`, canvas.width / 2, canvas.height / 2);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ 
      map: texture, 
      transparent: true, 
      side: THREE.DoubleSide 
    });
    const geometry = new THREE.PlaneGeometry(0.4, 0.16);
    measurement3DText = new THREE.Mesh(geometry, material);
    
    // Position text at midpoint of measurement line
    let textPosition;
    if (endPoint) {
      // Use actual midpoint between start and end markers
      textPosition = {
        x: (startPoint.x + endPoint.x) / 2,
        y: (startPoint.y + endPoint.y) / 2 + 0.15, // Higher above the line
        z: (startPoint.z + endPoint.z) / 2
      };
    } else {
      // For live measurements, position will be updated by updateMeasurement method
      // Use start point as initial position
      textPosition = {
        x: startPoint.x,
        y: startPoint.y + 0.15,
        z: startPoint.z
      };
    }
    measurement3DText.position.set(textPosition.x, textPosition.y, textPosition.z);
    sceneVisualizer.scene.add(measurement3DText);
    
    // Store the midpoint for left frame panel (without the Y offset)
    currentMidpoint = {
      x: textPosition.x,
      y: textPosition.y - 0.15, // Remove the Y offset to get actual midpoint
      z: textPosition.z
    };
    
    // Create 3D line connecting start and end points (only if end marker exists)
    if (endPoint) {
      const points = [
        new THREE.Vector3(startPoint.x, startPoint.y, startPoint.z),
        new THREE.Vector3(endPoint.x, endPoint.y, endPoint.z)
      ];
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const lineMaterial = new THREE.LineBasicMaterial({ 
        color: 0x00ff00, 
        linewidth: 3,
        transparent: true,
        opacity: 0.8
      });
      measurement3DLine = new THREE.Line(lineGeometry, lineMaterial);
      sceneVisualizer.scene.add(measurement3DLine);
    }
    
    console.log('3D measurement display created');
  }
  
  // Function to update 3D text position for live measurements
  function update3DTextPosition(startPoint, currentEndPoint) {
    if (measurement3DText && sceneVisualizer) {
      // Calculate midpoint between start marker and current position
      const textPosition = {
        x: (startPoint.x + currentEndPoint.x) / 2,
        y: (startPoint.y + currentEndPoint.y) / 2 + 0.15, // Higher above the line
        z: (startPoint.z + currentEndPoint.z) / 2
      };
      measurement3DText.position.set(textPosition.x, textPosition.y, textPosition.z);
      
      // Store the midpoint for left frame panel (without the Y offset)
      currentMidpoint = {
        x: textPosition.x,
        y: textPosition.y - 0.15, // Remove the Y offset to get actual midpoint
        z: textPosition.z
      };
    }
  }
  
  // Function to remove 3D measurement display
  function remove3DMeasurementDisplay() {
    if (sceneVisualizer) {
      if (measurement3DText) {
        sceneVisualizer.scene.remove(measurement3DText);
        if (measurement3DText.geometry) measurement3DText.geometry.dispose();
        if (measurement3DText.material) measurement3DText.material.dispose();
        measurement3DText = null;
      }
      if (measurement3DLine) {
        sceneVisualizer.scene.remove(measurement3DLine);
        if (measurement3DLine.geometry) measurement3DLine.geometry.dispose();
        if (measurement3DLine.material) measurement3DLine.material.dispose();
        measurement3DLine = null;
      }
      // Clear stored midpoint
      currentMidpoint = null;
    }
  }
  
  
  // Function to get 3D world midpoint of measurement line
  function getMeasurementMidpoint(startPoint, endPoint) {
    return {
      x: (startPoint.x + endPoint.x) / 2,
      y: (startPoint.y + endPoint.y) / 2 + 0.05, // Slight upward offset to hover above the measurement line
      z: (startPoint.z + endPoint.z) / 2
    };
  }

  // Function to draw measurement info panel on left frame (using same logic as markers)
  function drawMeasurementInfoOnFrame(ctx, startPoint, endPoint, pose, leftCameraIntrinsics) {
    console.log('drawMeasurementInfoOnFrame called with:', {startPoint, endPoint, pose: !!pose, leftCameraIntrinsics: !!leftCameraIntrinsics});
    
    // Calculate distance
    const distance = Math.sqrt(
      Math.pow(endPoint.x - startPoint.x, 2) + 
      Math.pow(endPoint.y - startPoint.y, 2) + 
      Math.pow(endPoint.z - endPoint.z, 2)
    );
    
    console.log('Calculated distance:', distance);
  // Always draw the measurement panel at the top-right of the LEFT frame
  const panelWidth = 200;
  const panelHeight = 80;
  const margin = 10;
  const panelX = 640 - margin - panelWidth; // Left frame width is 640
  const panelY = margin;
  
  // Draw black background panel
  ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
  
  // Draw green border
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 3;
  ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);
  
  // Draw distance text
  ctx.save();
  ctx.fillStyle = '#00ff00';
  ctx.font = 'Bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${distance.toFixed(3)}m`, panelX + panelWidth/2, panelY + panelHeight/2);
  ctx.restore();
  }
  
  // Live mode variables
  let latestFrameBitmapLeft = null;
  let latestFrameBitmapRight = null;
  let showRightCamera = false;
  let image_width = 640;
  let image_height = 480;

  // WebSocket error display functions
  function showWebSocketError(message) {
    // Remove any existing error message
    hideWebSocketError();
    
    // Create error message element
    const errorDiv = document.createElement('div');
    errorDiv.id = 'websocket-error';
    errorDiv.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #dc3545;
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      font-family: 'Helvetica', sans-serif;
      font-size: 14px;
      font-weight: bold;
      text-align: center;
      max-width: 500px;
      word-wrap: break-word;
    `;
    errorDiv.textContent = message;
    
    // Add to document
    document.body.appendChild(errorDiv);
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
      hideWebSocketError();
    }, 10000);
  }

  function hideWebSocketError() {
    const existingError = document.getElementById('websocket-error');
    if (existingError) {
      existingError.remove();
    }
  }

  // WebSocket connection for live camera feed
  function connectWebSocketFrameStream(callback) {
    const ws = new WebSocket("ws://localhost:8765");
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      console.log("✅ Connected to WebSocket video stream");
      // Hide any previous error messages
      hideWebSocketError();
    };
    ws.onerror = err => {
      console.error("❌ WebSocket error:", err);
      showWebSocketError("Failed to connect to live camera stream. Please ensure the camera server is running on localhost:8765");
    };
    ws.onclose = () => {
      console.warn("⚠️ WebSocket connection closed");
      showWebSocketError("Live camera connection lost. Attempting to reconnect...");
    };
    ws.onmessage = async event => {
      try {
        const arrayBuffer = event.data;
        const view = new Uint8Array(arrayBuffer);
        const sourceTag = String.fromCharCode(view[0]); // 'L' or 'R'
        const jpegData = view.slice(1);
        const blob = new Blob([jpegData], { type: 'image/jpeg' });
        const bitmap = await createImageBitmap(blob);
        callback(sourceTag, bitmap);
      } catch (err) {
        console.error("❌ Error processing WebSocket frame:", err);
      }
    };
  }

  async function demoStream() {
    const ModuleInstance = await Module();
    await waitForEmscriptenModule(ModuleInstance);
    
    // Initialize performance monitor if available
    if (PerformanceMonitor) {
      performanceMonitor = new PerformanceMonitor();
      
      // Set video name for CSV export
      const stored = localStorage.getItem('selectedVideoType');
      const defaultKey = Object.keys(VIDEO_CONFIG)[0];
      const currentVideoType = (stored && VIDEO_CONFIG[stored]) ? stored : defaultKey;
      const videoConfig = VIDEO_CONFIG[currentVideoType];
      performanceMonitor.setVideoName(videoConfig.displayName);
      
      performanceMonitor.init();
      console.log('Performance monitor initialized with video:', videoConfig.displayName);
    }
    
    // Fetch the YAML file and set it in the WASM module
    const yamlResponse = await fetch('./assets/d345i_640x480.yaml');
    const yamlText = await yamlResponse.text();
    if (typeof ModuleInstance.setStereoCalibrationYAML === 'function') {
      ModuleInstance.setStereoCalibrationYAML(yamlText);
    } else {
      console.error('setStereoCalibrationYAML is not available on the Module instance.');
    }
    
    // Parse calibration data from YAML for 3D point projection
    let leftCameraIntrinsics = null;
    try {
      leftCameraIntrinsics = parseCalibrationYAML(yamlText);
      console.log('Parsed left camera intrinsics:', leftCameraIntrinsics);
    } catch (e) {
      console.error('Failed to parse calibration YAML:', e);
    }
    
           // Persistent buffer allocation
     const leftFrameSize = 640 * 480 * 4;
     const framepointsBufSize = 4096 * 4;
     const leftPtr = ModuleInstance._malloc(leftFrameSize);
     const rightPtr = ModuleInstance._malloc(leftFrameSize);
     const framepointsBuf = ModuleInstance._malloc(framepointsBufSize);
    
    window.addEventListener('unload', () => {
      ModuleInstance._free(leftPtr);
      ModuleInstance._free(rightPtr);
      ModuleInstance._free(framepointsBuf);
    });
    
    alva = {
      findStereoCameraPose(leftFrame, rightFrame) {
        if (!ModuleInstance || typeof ModuleInstance.findStereoCameraPose !== 'function') {
          console.error('Emscripten Module or findStereoCameraPose not loaded');
          return null;
        }
        ModuleInstance.HEAPU8.set(leftFrame.data, leftPtr);
        ModuleInstance.HEAPU8.set(rightFrame.data, rightPtr);
        const posePtr = ModuleInstance._malloc(16 * 4);
        const ok = ModuleInstance.findStereoCameraPose(leftPtr, rightPtr, posePtr);
        let pose = null;
        if (ok) {
          pose = new Float32Array(ModuleInstance.HEAPF32.buffer, posePtr, 16).slice();
        }
        ModuleInstance._free(posePtr);
        return pose;
      },
      reset() {
        if (typeof ModuleInstance.reset === 'function') {
          ModuleInstance.reset();
        }
      },
      getFrameKeypoints() {
        if (typeof ModuleInstance.getStereoFrameKeypoints === 'function') {
          const n = 4096;
          const buf = ModuleInstance._malloc(n * 4 * 2); // 2 ints per point
          const numPoints = ModuleInstance.getStereoFrameKeypoints(buf);
          const arr = new Int32Array(ModuleInstance.HEAP32.buffer, buf, numPoints * 2);
          const result = [];
          for (let i = 0; i < numPoints; ++i) {
            result.push({ x: arr[i * 2], y: arr[i * 2 + 1] });
          }
          ModuleInstance._free(buf);
          return result;
        }
        return [];
      },
      getFramePoints() {
        if (typeof ModuleInstance.getStereoFramePoints === 'function') {
          const n = 4096;
          const buf = ModuleInstance._malloc(n * 4 * 3); // 3 floats per 3D point
          const numPoints = ModuleInstance.getStereoFramePoints(buf);
          const arr = new Float32Array(ModuleInstance.HEAPF32.buffer, buf, numPoints * 3);
          const result = [];
          for (let i = 0; i < numPoints; ++i) {
            result.push(new THREE.Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]));
          }
          ModuleInstance._free(buf);
          return result;
        }
        return [];
      },
      getFramePoints3D() {
        if (typeof ModuleInstance.getStereoFramePoints3D === 'function') {
          const n = 4096;
          const buf = ModuleInstance._malloc(n * 4 * 3); // 3 floats per 3D point
          const numPoints = ModuleInstance.getStereoFramePoints3D(buf);
          const arr = new Float32Array(ModuleInstance.HEAPF32.buffer, buf, numPoints * 3);
          const result = [];
          for (let i = 0; i < numPoints; ++i) {
            result.push(new THREE.Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]));
          }
          ModuleInstance._free(buf);
          return result;
        }
        return [];
      }
    };

    // Load video sources based on mode
    if (isLiveMode) {
      // Live mode: Connect to WebSocket stream
      console.log("🎥 Starting live camera mode");
      connectWebSocketFrameStream((source, bitmap) => {
        if (source === 'L') latestFrameBitmapLeft = bitmap;
        else if (source === 'R') latestFrameBitmapRight = bitmap;
      });
    } else {
      // Video mode: Load pre-recorded videos
      console.log("🎬 Starting video mode");
      
      // Video dropdown is already set up at the beginning of main()
      
      // Check for stored video selection or use default
      const storedVideoType = localStorage.getItem('selectedVideoType');
      const defaultKey = Object.keys(VIDEO_CONFIG)[0];
      const videoTypeToLoad = (storedVideoType && VIDEO_CONFIG[storedVideoType]) ? storedVideoType : defaultKey;
      
      // Clear the stored selection after reading it
      localStorage.removeItem('selectedVideoType');
      
      // Load the selected video
      await loadVideoByType(videoTypeToLoad, Video);
    }

           // Restrict $view overlay to left image only
     $view.style.position = 'absolute';
     $view.style.left = '0px';
     $view.style.top = '0px';
     $view.style.width = '640px';
     $view.style.height = '480px';
     $view.style.zIndex = '10';
     // Initialize 3D Scene Visualizer using ARSimpleMap like stereo visualizer
    sceneVisualizer = new ARSimpleMap($visualizerContainer, 400, 480);
    const camRenderer = new ARSimpleView($view, 640, 480, sceneVisualizer);
    
    // Make the camera helper bigger and red (like stereo visualizer)
    setTimeout(() => {
      if (sceneVisualizer.camHelper) {
        sceneVisualizer.camHelper.scale.set(1, 1, 1); // Make the camera frustum bigger
        sceneVisualizer.camHelper.visible = true; // Ensure it's visible
        sceneVisualizer.camHelper.material.color.setHex(0xff0000); // Red color
        sceneVisualizer.camHelper.material.needsUpdate = true;
        
        console.log('Camera helper scaled, made visible, and colored red');
      } else {
        console.log('Camera helper not found');
      }
    }, 100);
    
    // Store references for later use
    view = camRenderer;
    
    // Initialize AR Ruler system
    arRulerSystem = new ARRulerSystem();
    visualizer = new ARRulerVisualizer(view.scene, sceneVisualizer);
    measurementUI = new MeasurementUI();
    
    // Make them globally accessible for reset functionality
    window.arRulerSystem = arRulerSystem;
    window.measurementUI = measurementUI;
    
    // Add toggle button for right camera visibility
    const toggleRightCameraBtn = document.getElementById('toggle-right-camera');
    if (toggleRightCameraBtn) {
      // Set initial button text based on default state (hidden)
      toggleRightCameraBtn.textContent = 'Show Right Camera';
      
      toggleRightCameraBtn.addEventListener('click', () => {
        showRightCamera = !showRightCamera;
        toggleRightCameraBtn.textContent = showRightCamera ? 'Hide Right Camera' : 'Show Right Camera';
      });
    }
    
     // Test: Ensure the nearest distance display is visible
     const nearestDisplay = document.getElementById('nearest-distance-display');
     if (nearestDisplay) {
       nearestDisplay.textContent = 'Nearest: Ready...';
       nearestDisplay.style.display = 'block';
       nearestDisplay.style.visibility = 'visible';
       console.log('✅ Found nearest-distance-display element during initialization');
     } else {
       console.error('❌ nearest-distance-display element NOT FOUND during initialization!');
       // Let's check what's actually in the DOM
       const measurementPanel = document.getElementById('measurement-panel');
       if (measurementPanel) {
         // console.log('Measurement panel HTML:', measurementPanel.innerHTML);
       } else {
         console.error('measurement-panel not found either!');
       }
     }
     
     // Test: Check again after a delay to see if element appears
     setTimeout(() => {
       const delayedTest = document.getElementById('nearest-distance-display');
       if (delayedTest) {
         console.log('✅ Found nearest-distance-display element after delay');
         delayedTest.textContent = 'Nearest: Found after delay!';
       } else {
         console.error('❌ nearest-distance-display element still not found after delay!');
       }
     }, 1000);
     
     arRulerSystem.initialize(visualizer, measurementUI, view.camera, alva);
    
    // Add coordinate system indicator at the origin (1 unit = 25cm)
    const originAxes = new THREE.AxesHelper(0.25);
    originAxes.position.set(0, 0, 0);
    sceneVisualizer.scene.add(originAxes);
    
    // Add camera frustum visualization for pose debugging
    let cameraFrustum = null;
    let cameraMarker = null;
    function createCameraFrustum(position, rotation, fov = 60, aspect = 640/480, near = 0.1, far = 10) {
      // Remove existing frustum
      if (cameraFrustum) {
        sceneVisualizer.scene.remove(cameraFrustum);
      }
      
      // Remove existing camera marker
      if (cameraMarker) {
        sceneVisualizer.scene.remove(cameraMarker);
      }
      
      // Camera frustum removed - only showing position marker
      
      // Add camera position marker (smaller dot)
      const cameraMarkerGeometry = new THREE.SphereGeometry(0.005, 8, 8); // Much smaller: 0.005 instead of 0.02
      const cameraMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      cameraMarker = new THREE.Mesh(cameraMarkerGeometry, cameraMarkerMaterial);
      cameraMarker.position.copy(position);
      sceneVisualizer.scene.add(cameraMarker);
      
      return cameraFrustum;
    }
    
    // Store the createCameraFrustum function globally for use in render loop
    window.createCameraFrustum = createCameraFrustum;
    
    // Add ambient lighting to make objects more visible
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    sceneVisualizer.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    sceneVisualizer.scene.add(directionalLight);
    
    // Add a status indicator text
    const statusCanvas = document.createElement('canvas');
    const statusContext = statusCanvas.getContext('2d');
    statusCanvas.width = 256;
    statusCanvas.height = 64;
    statusContext.fillStyle = '#333333';
    statusContext.font = 'Bold 20px Arial';
    statusContext.textAlign = 'center';
    statusContext.fillText('WAITING FOR', 128, 32);
    statusContext.fillText('SLAM POSE', 128, 56);
    
    const statusTexture = new THREE.CanvasTexture(statusCanvas);
    const statusGeometry = new THREE.PlaneGeometry(4, 1);
    const statusMaterial = new THREE.MeshBasicMaterial({ 
      map: statusTexture, 
      transparent: true, 
      side: THREE.DoubleSide 
    });
    const statusLabel = new THREE.Mesh(statusGeometry, statusMaterial);
    statusLabel.position.set(0, 2, 0);
    sceneVisualizer.scene.add(statusLabel);
    sceneVisualizer.statusLabel = statusLabel;

    // Setup UI callbacks
    measurementUI.onStartMarkerRequested = () => {
      if (latestPose) {
        arRulerSystem.placeStartMarker(latestPose);
        clickState = 'start_placed'; // Update click state when button is used
        
        // Live measurement will be handled by updateMeasurement in render loop
      }
    };
    
    measurementUI.onEndMeasurementRequested = () => {
      if (latestPose) {
        const finalDistance = arRulerSystem.placeEndMarker(latestPose);
        clickState = 'end_placed'; // Update click state when button is used
        console.log('Final measurement completed:', finalDistance.toFixed(3), 'meters');
        
        // Show measurement info panel
        showMeasurementInfo(arRulerSystem.startPoint, arRulerSystem.endPoint, finalDistance);
      }
    };
    
    measurementUI.onResetRequested = () => {
      arRulerSystem.resetMeasurement();
      clickState = 'idle'; // Reset click state when reset button is clicked
      hideMeasurementInfo(); // Hide measurement info panel
    };
    
    measurementUI.onDrawPlaneRequested = () => {
      return arRulerSystem.drawNewPlane();
    };
    
    measurementUI.onClearPlaneRequested = () => {
      arRulerSystem.clearPlane();
    };
    
    measurementUI.onMarkerDistanceChanged = (distance) => {
      // Update existing markers when slider value changes
      if (latestPose) {
        arRulerSystem.updateMarkerPositions(latestPose);
      }
    };

    stats = Stats;
    stats.add('total');
    stats.add('video');
    stats.add('slam');

    $container.appendChild($canvas);
    $container.appendChild($view);
    document.body.appendChild(stats.el);

    document.body.addEventListener("click", () => alva.reset(), false);
    
    // Add click handler for left frame overlay
    const leftFrameOverlay = document.getElementById('left-frame-click-overlay');
    if (leftFrameOverlay) {
      leftFrameOverlay.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent body click from triggering alva.reset()
        
        if (!latestPose) {
          console.log('No valid pose available for marker placement');
          return;
        }
        
        console.log('Left frame clicked, current state:', clickState);
        
        switch (clickState) {
          case 'idle':
            // 1st click: Place start marker
            console.log('Placing start marker...');
            arRulerSystem.placeStartMarker(latestPose);
            clickState = 'start_placed';
            if (measurementUI) {
              measurementUI.updateStatus('Start marker placed - click to place end marker');
            }
            
            // Live measurement will be handled by updateMeasurement in render loop
            break;
            
          case 'start_placed':
            // 2nd click: Place end marker
            console.log('Placing end marker...');
            const finalDistance = arRulerSystem.placeEndMarker(latestPose);
            clickState = 'end_placed';
            if (measurementUI) {
              measurementUI.updateStatus(`Measurement complete: ${finalDistance.toFixed(3)}m`);
            }
            console.log('Final measurement completed:', finalDistance.toFixed(3), 'meters');
            
            // Show measurement info panel
            showMeasurementInfo(arRulerSystem.startPoint, arRulerSystem.endPoint, finalDistance);
            break;
            
          case 'end_placed':
            // 3rd click: Clear all markers
            console.log('Clearing all markers...');
            arRulerSystem.resetMeasurement();
            clickState = 'idle';
            if (measurementUI) {
              measurementUI.updateStatus('Place start marker');
            }
            hideMeasurementInfo(); // Hide measurement info panel
            break;
      }
    });
  }
  
  // Set initial panel visibility based on mobile detection
  const measurementPanel = document.getElementById('measurement-panel');
  const visualizerPanel = document.getElementById('visualizer-panel');
  if (measurementPanel) {
    measurementPanel.style.display = panelsVisible ? 'flex' : 'none';
  }
  if (visualizerPanel) {
    visualizerPanel.style.display = panelsVisible ? 'block' : 'none';
  }

    let latestPose = null;
    let firstFrame = true;

    // Function to refresh/clear the visualizer when video loops
    function refreshVisualizer() {
      if (!sceneVisualizer) return;
      
      console.log('Video looped - resetting everything...');
      
      // Clear all feature points
      if (sceneVisualizer.featurePoints) {
        sceneVisualizer.featurePoints.forEach(point => {
          sceneVisualizer.scene.remove(point);
          if (point.geometry) point.geometry.dispose();
          if (point.material) point.material.dispose();
        });
        sceneVisualizer.featurePoints = [];
      }
      
      // Reset camera helper
      if (sceneVisualizer.camHelper) {
        sceneVisualizer.camHelper.visible = false;
        sceneVisualizer.camHelper.position.set(0, 0, 0);
        sceneVisualizer.camHelper.quaternion.set(0, 0, 0, 1);
      }
      
      // Reset view
      if (view) {
        view.reset();
        view.camera.position.set(0, 0, 0);
        view.camera.quaternion.set(0, 0, 0, 1);
      }
      
      // Reset SLAM system
      if (alva && alva.reset) {
        alva.reset();
      }
      
      // Reset AR Ruler system
      if (arRulerSystem) {
        arRulerSystem.resetMeasurement();
        arRulerSystem.startPoint = null;
        arRulerSystem.endPoint = null;
        arRulerSystem.measurementMode = 'idle';
        arRulerSystem.detectedPlane = null;
        arRulerSystem.usePlaneMode = false;
        arRulerSystem.planePoints = [];
      }
      
      // Reset UI
      if (measurementUI) {
        measurementUI.reset();
      }
      
      // Reset click state
      clickState = 'idle';
      
      // Hide measurement info
      hideMeasurementInfo();
      
      // Clear pose tracking
      firstFrame = true;
      latestPose = null;
      window.lastValidPose = null;
      window.poseHistory = [];
      window.debugCounter = 0;
      window.featureDebugCounter = 0;
      
      // Dispose of shared resources
      if (sceneVisualizer.featureGeometry) {
        sceneVisualizer.featureGeometry.dispose();
        sceneVisualizer.featureGeometry = null;
      }
      if (sceneVisualizer.featureMaterial) {
        sceneVisualizer.featureMaterial.dispose();
        sceneVisualizer.featureMaterial = null;
      }
      
      console.log('Reset complete');
    }

    // Function to update the 3D scene visualizer - simplified like stereo visualizer
    function updateSceneVisualizer(pose) {
      if (!sceneVisualizer || !view) return;
      
      // Apply MONOCULAR_SCALE_FACTOR to pose translation for right visualizer
      const scaledPose = [...pose]; // Create a copy of the pose array
      if (MONOCULAR_SCALE_FACTOR !== 1.0) {
        // Scale the translation components (indices 12, 13, 14)
        scaledPose[12] *= MONOCULAR_SCALE_FACTOR;
        scaledPose[13] *= MONOCULAR_SCALE_FACTOR;
        scaledPose[14] *= MONOCULAR_SCALE_FACTOR;
      }
      
      // Apply scaled pose to right visualizer
      view.updateCameraPose(scaledPose);
      
      // Debug: Log detailed coordinate information (only occasionally to prevent memory leaks)
      if (window.debugCounter === undefined) window.debugCounter = 0;
      window.debugCounter++;
      if (window.debugCounter % 60 === 0) { // Log every 60 frames (2 seconds at 30fps)
        console.log('=== MONOCULAR POSE DEBUG (Frame ' + window.debugCounter + ') ===');
        if (pose.length === 16) {
          console.log('Monocular pose (direct):', {x: pose[12].toFixed(3), y: pose[13].toFixed(3), z: pose[14].toFixed(3)});
        }
        console.log('Camera position:', view.camera.position);
        console.log('Using monocular SLAM pose directly (no scaling)');
      }
      
      // Update last valid pose for tracking
      if (window.lastValidPose) {
        window.lastValidPose = [...pose];
      } else {
        // Initialize tracking variables
        window.lastValidPose = [...pose];
      }
      
      // Ensure camera helper is visible, scaled, and colored red when pose is detected
      if (sceneVisualizer.camHelper) {
        sceneVisualizer.camHelper.visible = true;
        if (sceneVisualizer.camHelper.scale.x !== 1) {
          sceneVisualizer.camHelper.scale.set(1, 1, 1);
        }
        if (sceneVisualizer.camHelper.material.color.getHex() !== 0xff0000) {
          sceneVisualizer.camHelper.material.color.setHex(0xff0000);
          sceneVisualizer.camHelper.material.needsUpdate = true;
        }
      }
      
      // Update status label
      if (sceneVisualizer.statusLabel) {
        const statusCanvas = sceneVisualizer.statusLabel.material.map.image;
        const statusContext = statusCanvas.getContext('2d');
        statusContext.clearRect(0, 0, statusCanvas.width, statusCanvas.height);
        statusContext.fillStyle = '#00aa00';
        statusContext.font = 'Bold 20px Arial';
        statusContext.textAlign = 'center';
        statusContext.fillText('TRACKING', 128, 32);
        statusContext.fillText('ACTIVE', 128, 56);
        sceneVisualizer.statusLabel.material.map.needsUpdate = true;
      }
      
      // Debug: Log detailed coordinate information (only occasionally to prevent memory leaks)
      if (window.debugCounter === undefined) window.debugCounter = 0;
      window.debugCounter++;
      if (window.debugCounter % 150 === 0) { // Log every 150 frames (5 seconds at 30fps)
        console.log('=== COORDINATE DEBUG (Frame ' + window.debugCounter + ') ===');
        if (pose.length === 16) {
          console.log('Pose matrix translation (raw):', {x: pose[12], y: pose[13], z: pose[14]});
        }
        console.log('Camera position:', view.camera.position);
      }
      
      // No pose clamping - use raw SLAM poses directly
      
      // Visualize 3D feature points
      visualizeFeaturePoints();
    }
    
    // Function to visualize 3D feature points from SLAM
    function visualizeFeaturePoints() {
      if (!sceneVisualizer || !alva.getFramePoints3D) return;
      
      // Get 3D points from SLAM system
      const points3D = alva.getFramePoints3D();
      if (!points3D || points3D.length === 0) return;
      
      // Debug: Log feature point information (only occasionally to prevent memory leaks)
      if (window.featureDebugCounter === undefined) window.featureDebugCounter = 0;
      window.featureDebugCounter++;
      if (window.featureDebugCounter % 120 === 0) { // Log every 120 frames (4 seconds at 30fps)
        console.log('=== FEATURE POINTS DEBUG (Frame ' + window.featureDebugCounter + ') ===');
        console.log('Number of feature points:', points3D.length);
      }
      
      // Clear previous feature points and dispose of Three.js resources
      if (sceneVisualizer.featurePoints) {
        sceneVisualizer.featurePoints.forEach(point => {
          sceneVisualizer.scene.remove(point);
          // Dispose of geometry and material to prevent memory leaks
          if (point.geometry) point.geometry.dispose();
          if (point.material) point.material.dispose();
        });
      }
      sceneVisualizer.featurePoints = [];
      
      // Create shared geometry and material to reduce memory usage
      if (!sceneVisualizer.featureGeometry) { // FEATURE POINT SIZE
        //sceneVisualizer.featureGeometry = new THREE.SphereGeometry(0.2, 8, 8); // Increased from 0.02 to 0.05
        sceneVisualizer.featureGeometry = new THREE.SphereGeometry(0.004*MONOCULAR_SCALE_FACTOR, 8, 8); // Increased from 0.02 to 0.05
      }
      if (!sceneVisualizer.featureMaterial) {
        sceneVisualizer.featureMaterial = new THREE.MeshBasicMaterial({ 
          color: 0xff6600,
          transparent: true,
          opacity: 0.8
        });
      }
      
      // Create new feature points (limit to avoid performance issues)
      const maxPoints = Math.min(points3D.length, 200);
      for (let i = 0; i < maxPoints; i++) {
        const point3D = points3D[i];
        
        // Create sphere using shared geometry and material
        const sphere = new THREE.Mesh(sceneVisualizer.featureGeometry, sceneVisualizer.featureMaterial);
        // Apply the SAME coordinate transformation as the camera to maintain consistency
        // This matches the transformation in AlvaARConnectorTHREE: (x, -y, -z)
        sphere.position.set(point3D.x, -point3D.y, -point3D.z);
        
        sceneVisualizer.scene.add(sphere);
        sceneVisualizer.featurePoints.push(sphere);
      }
    }

    function render() {
      stats.next();
      stats.start('total');

               const spacing = 0;
       const boxWidth = image_width;
       const boxHeight = image_height;
       const width = showRightCamera ? (image_width * 2 + spacing) : image_width;
       const height = image_height;
       $canvas.width = width;
       $canvas.height = height;
       
       // Update container width to match canvas
       $container.style.width = width + 'px';
       
      const ctx = $canvas.getContext('2d');
      ctx.clearRect(0, 0, $canvas.width, $canvas.height);

      let frameLeft = null;
      let frameRight = null;
      let pose = null;

      if (!document.hidden) {
        if (isLiveMode) {
          // Live mode: Use WebSocket frames
          if (latestFrameBitmapLeft && latestFrameBitmapRight) {
            // Convert bitmaps to ImageData for processing
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = image_width;
            tempCanvas.height = image_height;
            
            tempCtx.drawImage(latestFrameBitmapLeft, 0, 0, image_width, image_height);
            frameLeft = tempCtx.getImageData(0, 0, image_width, image_height);
            
            tempCtx.clearRect(0, 0, image_width, image_height);
            tempCtx.drawImage(latestFrameBitmapRight, 0, 0, image_width, image_height);
            frameRight = tempCtx.getImageData(0, 0, image_width, image_height);
          } else {
            requestAnimationFrame(render);
            return;
          }
        } else {
          // Video mode: Use video elements
          frameLeft = mediaLeft.getImageData();
          frameRight = mediaRight.getImageData();
        }

        if (!frameLeft || !frameRight || !frameLeft.data.length || !frameRight.data.length) {
          requestAnimationFrame(render);
          return;
        }

        if (frameLeft && frameRight) {
          stats.start('video');
          
          if (isLiveMode) {
            // Live mode: Draw bitmaps directly - always draw left camera at original size
            ctx.drawImage(latestFrameBitmapLeft, 0, 0, image_width, image_height);
            if (showRightCamera) {
              ctx.drawImage(latestFrameBitmapRight, image_width + spacing, 0, image_width, image_height);
            }
          } else {
            // Video mode: Draw ImageData - always draw left camera at original size
            ctx.putImageData(frameLeft, 0, 0);
            if (showRightCamera) {
              ctx.putImageData(frameRight, image_width + spacing, 0);
            }
          }
          
          // Add camera labels
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(0, 0, 170, 25);
          ctx.fillStyle = "white";
          ctx.font = "16px Helvetica";
          ctx.fillText("Left Camera (Stereo)", 10, 18);

          if (showRightCamera) {
            // Save context state
            ctx.save();
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillRect(640, 0, 120, 25);
            ctx.fillStyle = "white";
            ctx.fillText("Right Camera", 650, 18);
            // Restore context state
            ctx.restore();
          }
          
          stats.stop('video');
          stats.start('slam');
          
          if (frameLeft && frameRight && frameLeft.data.length && frameRight.data.length) {
            if (firstFrame) {
              alva.reset();  // Reset LK tracker on first valid frame
              firstFrame = false;
            }
            pose = alva.findStereoCameraPose(frameLeft, frameRight);
          }
          stats.stop('slam');
          
          if (pose) {
            latestPose = pose;
            
            // Update live measurement display if only start marker is placed
            if (arRulerSystem && arRulerSystem.startPoint && !arRulerSystem.endPoint) {
              // Use AR Ruler system's updateMeasurement method for accurate live measurements
              arRulerSystem.updateMeasurement(pose);
              
              // Update 3D text position to midpoint for live measurements
              const { position: cameraPosition } = arRulerSystem.getCameraTransform(pose);
              const markerDistance = arRulerSystem.ui ? arRulerSystem.ui.getMarkerDistance() : 0.0;
              const { direction } = arRulerSystem.getCameraTransform(pose);
              const currentEndPoint = arRulerSystem.raycastToWorld(cameraPosition, direction, 10.0, markerDistance);
              update3DTextPosition(arRulerSystem.startPoint, currentEndPoint);
            }
            
            // Apply MONOCULAR_SCALE_FACTOR to pose translation for right visualizer
            const scaledPose = [...pose]; // Create a copy of the pose array
            if (MONOCULAR_SCALE_FACTOR !== 1.0) {
              // Scale the translation components (indices 12, 13, 14)
              scaledPose[12] *= MONOCULAR_SCALE_FACTOR;
              scaledPose[13] *= MONOCULAR_SCALE_FACTOR;
              scaledPose[14] *= MONOCULAR_SCALE_FACTOR;
            }
            
            // Use the standard ARSimpleView updateCameraPose method like stereo visualizer
            view.updateCameraPose(scaledPose);
            
            // Update AR Ruler measurement
            arRulerSystem.updateMeasurement(pose);
            
            // Calculate and display nearest distance
            const { position, direction } = arRulerSystem.getCameraTransform(pose);
            //console.log('Calculating nearest distance for position:', position, 'direction:', direction);
            const nearestDistance = arRulerSystem.calculateNearestDistance(position, direction);
            //console.log('Calculated nearest distance:', nearestDistance);
            
             // Always update the display directly
             let nearestDisplay = document.getElementById('nearest-distance-display');
             if (nearestDisplay) {
               nearestDisplay.textContent = `Nearest: ${nearestDistance.toFixed(3)} meters`;
             } else {
               console.error('nearest-distance-display element not found! Creating it...');
               // Try to create the element
               const measurementPanel = document.getElementById('measurement-panel');
               if (measurementPanel) {
                 const newElement = document.createElement('div');
                 newElement.id = 'nearest-distance-display';
                 newElement.textContent = `Nearest: ${nearestDistance.toFixed(3)} meters (CREATED)`;
                 newElement.style.cssText = 'font-size: 1.2rem; font-weight: bold; text-align: center; margin: 0 0 10px 0; padding: 10px; background: #e8f5e8; border-radius: 8px; border: 2px solid #28a745; color: #155724; display: block; min-height: 40px;';
                 
                 // Insert after distance-display
                 const distanceDisplay = document.getElementById('distance-display');
                 if (distanceDisplay && distanceDisplay.nextSibling) {
                   measurementPanel.insertBefore(newElement, distanceDisplay.nextSibling);
                 } else {
                   measurementPanel.appendChild(newElement);
                 }
                 console.log('Created nearest-distance-display element');
               } else {
                 console.error('measurement-panel not found either!');
               }
             }
            
            if (measurementUI) {
              measurementUI.updateNearestDistance(nearestDistance);
            }
            
            // Update 3D point count in status
            if (arRulerSystem && arRulerSystem.alva && arRulerSystem.alva.getFramePoints3D) {
              const points3D = arRulerSystem.alva.getFramePoints3D();
              const pointCount = points3D ? points3D.length : 0;
              if (pointCount > 0 && window.debugCounter % 60 === 0) {
                console.log(`📊 Current 3D points: ${pointCount} (need 20+ for plane detection)`);
              }
            }
            
            // Update 3D Scene Visualizer
            updateSceneVisualizer(pose);
          } else {
            view.lostCamera();
          }

          // Draw 3D stereo frame points projected onto left camera
          if (pose && alva.getFramePoints) {
            const points3D = alva.getFramePoints();
            if (points3D && points3D.length > 0) {
              // Use parsed calibration data from YAML file
              let fx = 525, fy = 525, cx = 320, cy = 240; // Default fallback values
              
              if (leftCameraIntrinsics) {
                fx = leftCameraIntrinsics.fx;
                fy = leftCameraIntrinsics.fy;
                cx = leftCameraIntrinsics.cx;
                cy = leftCameraIntrinsics.cy;
              } else {
                // Fallback: try to get from WASM module if YAML parsing failed
                if (typeof ModuleInstance.getLeftCameraIntrinsics === 'function') {
                  try {
                    const intrinsics = ModuleInstance.getLeftCameraIntrinsics();
                    if (intrinsics && intrinsics.length >= 4) {
                      fx = intrinsics[0];
                      fy = intrinsics[1];
                      cx = intrinsics[2];
                      cy = intrinsics[3];
                    }
                  } catch (e) {
                    console.log('Could not get camera intrinsics from module, using defaults');
                  }
                }
              }
              
              // Debug: Log calibration info occasionally
              if (window.debugCounter % 120 === 0) {
                console.log('Using camera intrinsics from YAML:', {fx, fy, cx, cy});
                console.log('Projecting', points3D.length, '3D points to 2D');
              }
              
              for (const point3D of points3D) {
                // Use 3D points directly as they are already in camera coordinates from getStereoFramePoints
                // No transformation needed since C++ backend sends camera coordinates
                
                // Project camera coordinates to 2D image coordinates using pinhole camera model
                if (point3D.z > 0.1) { // Only points in front of camera
                  const x = (point3D.x * fx / point3D.z) + cx;
                  const y = (point3D.y * fy / point3D.z) + cy;
                
                  // Only draw points that are in front of camera and within image bounds
                  if (x >= 0 && x < 640 && y >= 0 && y < 480) {
                    // Color based on depth (closer = brighter, farther = darker)
                    const depth = Math.min(point3D.z / 5.0, 1.0); // Use camera Z coordinate for depth
                    const intensity = Math.floor(255 * (1.0 - depth)); // Closer points are brighter
                    
                    // Use different colors for different depth ranges
                    if (point3D.z < 1.0) {
                      ctx.fillStyle = `rgb(255, ${intensity}, ${intensity})`; // Red for very close
                    } else if (point3D.z < 2.0) {
                      ctx.fillStyle = `rgb(${intensity}, 255, ${intensity})`; // Green for close
                    } else {
                      ctx.fillStyle = `rgb(${intensity}, ${intensity}, 255)`; // Blue for far
                    }
                    
                    // Size based on depth (closer = larger)
                    const size = Math.max(1, Math.floor(4 * (1.0 - depth)));
                    ctx.fillRect(x - size/2, y - size/2, size, size);
                  }
                }
              }
            }
          } else {
            // No fallback - only show triangulated 3D points
            // If no 3D points available, left frame shows only the camera feed
            console.log('No triangulated 3D points available - showing camera feed only');
          }

          // Render start and end markers in left frame (moved outside 3D points condition)
          if (arRulerSystem && pose) {
            // Get camera transform from pose for world-to-camera transformation
            const { position: cameraPosition, direction: cameraDirection } = arRulerSystem.getCameraTransform(pose);

            // Create camera quaternion from pose matrix with AlvaAR coordinate transformation
            const rotationMatrix = new THREE.Matrix4().fromArray(pose);
            const cameraQuaternion = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
            cameraQuaternion.set(-cameraQuaternion.x, cameraQuaternion.y, cameraQuaternion.z, cameraQuaternion.w);

            // Create world-to-camera transformation matrix (inverse of camera pose)
            const cameraInverseMatrix = new THREE.Matrix4();
            cameraInverseMatrix.compose(cameraPosition, cameraQuaternion, new THREE.Vector3(1, 1, 1)).invert();

            // Update 3D camera frustum visualization for pose debugging
            if (window.createCameraFrustum) {
              window.createCameraFrustum(cameraPosition, cameraQuaternion);
            }
            
            // Debug: Display camera pose information
            if (window.debugCounter % 60 === 0) { // Log every 60 frames (about once per second)
              console.log('=== CAMERA POSE DEBUG ===');
              console.log('Camera position (world):', cameraPosition);
              console.log('Camera direction (world):', cameraDirection);
              console.log('Pose matrix translation:', pose[12], pose[13], pose[14]);
              console.log('Camera quaternion:', cameraQuaternion);
            }

            // Get camera intrinsics for marker projection
            let fx = 525, fy = 525, cx = 320, cy = 240; // Default fallback values
            
            if (leftCameraIntrinsics) {
              fx = leftCameraIntrinsics.fx;
              fy = leftCameraIntrinsics.fy;
              cx = leftCameraIntrinsics.cx;
              cy = leftCameraIntrinsics.cy;
            }

            // Render start marker if it exists
            if (arRulerSystem.startPoint) {
              // Transform world coordinates to camera coordinates (reverse of C++ backend)
              // C++ backend does: pt_world = current_pose * pt_camera
              // Frontend does: pt_camera = current_pose.inverse() * pt_world
              const worldPoint = new THREE.Vector3(arRulerSystem.startPoint.x, arRulerSystem.startPoint.y, arRulerSystem.startPoint.z);
              const cameraPoint = worldPoint.clone().applyMatrix4(cameraInverseMatrix);

              // Project camera coordinates to 2D image coordinates using pinhole camera model
              if (cameraPoint.z > 0.1) { // Only points in front of camera
                const x = (cameraPoint.x * fx / cameraPoint.z) + cx;
                const y = (cameraPoint.y * fy / cameraPoint.z) + cy;
                
                // Only draw if within image bounds
                if (x >= 0 && x < 640 && y >= 0 && y < 480) {
                  // Save context state before drawing start marker
                  ctx.save();
                  // Draw green circle for start marker
                  ctx.fillStyle = '#00ff00';
                  ctx.beginPath();
                  ctx.arc(x, y, 8, 0, 2 * Math.PI);
                  ctx.fill();
                  
                  // Draw white border
                  ctx.strokeStyle = '#ffffff';
                  ctx.lineWidth = 2;
                  ctx.stroke();
                  // Restore context state after drawing start marker
                  ctx.restore();
                }
              }
            }

            // Render end marker if it exists
            if (arRulerSystem.endPoint) {
              // Transform world coordinates to camera coordinates
              const worldPoint = new THREE.Vector3(arRulerSystem.endPoint.x, arRulerSystem.endPoint.y, arRulerSystem.endPoint.z);
              const cameraPoint = worldPoint.clone().applyMatrix4(cameraInverseMatrix);

              // Project camera coordinates to 2D image coordinates using pinhole camera model
              if (cameraPoint.z > 0.1) { // Only points in front of camera
                const x = (cameraPoint.x * fx / cameraPoint.z) + cx;
                const y = (cameraPoint.y * fy / cameraPoint.z) + cy;
                
                // Only draw if within image bounds
                if (x >= 0 && x < 640 && y >= 0 && y < 480) {
                  // Save context state before drawing end marker
                  ctx.save();
                  // Draw red circle for end marker
                  ctx.fillStyle = '#ff0000';
                  ctx.beginPath();
                  ctx.arc(x, y, 8, 0, 2 * Math.PI);
                  ctx.fill();
                  
                  // Draw white border
                  ctx.strokeStyle = '#ffffff';
                  ctx.lineWidth = 2;
                  ctx.stroke();
                  // Restore context state after drawing end marker
                  ctx.restore();
                }
              }
            }

            // Draw measurement panel at top-right of left frame if start marker exists
            if (arRulerSystem.startPoint) {
              // Get distance from UI (which is updated by updateMeasurement method)
              let distance = 0;
              if (arRulerSystem.ui && arRulerSystem.ui.distanceDisplay) {
                const distanceText = arRulerSystem.ui.distanceDisplay.textContent;
                const distanceMatch = distanceText.match(/(\d+\.?\d*)/);
                if (distanceMatch) {
                  distance = parseFloat(distanceMatch[1]);
                }
              }
            
              // Always draw the panel at the top-right of the left frame
              const panelWidth = 120;
              const panelHeight = 50;
              const margin = 10;
              const panelX = 640 - margin - panelWidth; // Left frame width is 640
              const panelY = margin;
              
              // Draw black background panel
              ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
              ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
              
              // Draw green border
              ctx.strokeStyle = '#00ff00';
              ctx.lineWidth = 3;
              ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);
              
              // Draw distance text
              ctx.save();
              ctx.fillStyle = '#00ff00';
              ctx.font = 'Bold 24px Arial';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(`${distance.toFixed(3)}m`, panelX + panelWidth/2, panelY + panelHeight/2);
              ctx.restore();
            }
          }

          // Draw detected plane outline on left frame if plane mode is enabled
          if (arRulerSystem && arRulerSystem.usePlaneMode && arRulerSystem.detectedPlane && pose) {
            drawPlaneOutlineOnFrame(ctx, arRulerSystem.detectedPlane, pose, leftCameraIntrinsics);
          }
          
                     } else if (frameLeft) {
          if (isLiveMode && latestFrameBitmapLeft) {
            ctx.drawImage(latestFrameBitmapLeft, 0, 0, image_width, image_height);
          } else {
            ctx.putImageData(frameLeft, 0, 0);
          }
           ctx.fillStyle = "rgba(0,0,0,0.6)";
           ctx.fillRect(0, 0, 110, 25);
           ctx.fillStyle = "white";
           ctx.font = "16px Helvetica";
           ctx.fillText("Left Camera", 10, 18);
         }
         if (frameRight && showRightCamera) {
          if (isLiveMode && latestFrameBitmapRight) {
            ctx.drawImage(latestFrameBitmapRight, image_width + spacing, 0, image_width, image_height);
          } else {
            ctx.putImageData(frameRight, image_width + spacing, 0);
          }
          // Save context state
          ctx.save();
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(640, 0, 120, 25);
          ctx.fillStyle = "white";
          ctx.font = "16px Helvetica";
          ctx.fillText("Right Camera", 650, 18);
          // Restore context state
          ctx.restore();
         }
         ctx.beginPath();
         ctx.moveTo(image_width, 0);
         ctx.lineTo(image_width, image_height);
         ctx.strokeStyle = "#333";
         ctx.lineWidth = 2;
         ctx.stroke();
      }
      
      // Update performance monitor
      if (performanceMonitor) {
        let measurementDistance = 0;
        if (arRulerSystem) {
          // Try to get distance from the measurement UI if available
          const distanceDisplay = document.getElementById('distance-display');
          if (distanceDisplay && distanceDisplay.textContent) {
            const distanceText = distanceDisplay.textContent;
            const distanceMatch = distanceText.match(/(\d+\.?\d*)\s*meters?/);
            if (distanceMatch) {
              measurementDistance = parseFloat(distanceMatch[1]);
            }
          }
          
          // Fallback to getCurrentDistance method
          if (measurementDistance === 0) {
            measurementDistance = arRulerSystem.getCurrentDistance();
          }
        }
        // Pass ModuleInstance for accurate C++ timing
        performanceMonitor.updateFrame(stats, measurementDistance, ModuleInstance);
      }
      
      stats.stop('total');
      stats.render();
      requestAnimationFrame(render);
    }
    render();
  }

  setTimeout(() => {
    $splash.remove();
    $start.addEventListener('click', () => {
      $overlay.remove();
      
      // Show the container and panels when application starts
      const container = document.getElementById('container');
      const measurementPanel = document.getElementById('measurement-panel');
      const visualizerPanel = document.getElementById('visualizer-panel');
      
      if (container) {
        container.style.display = 'block';
      }
      if (measurementPanel) {
        measurementPanel.style.display = panelsVisible ? 'flex' : 'none';
      }
      if (visualizerPanel) {
        visualizerPanel.style.display = panelsVisible ? 'block' : 'none';
      }
      
      demoStream();
    }, { once: true });
  }, splashFadeTime);
}

// Export the main function so it can be imported and called
export { main };
