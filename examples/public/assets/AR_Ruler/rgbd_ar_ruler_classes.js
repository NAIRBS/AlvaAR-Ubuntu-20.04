// Import THREE.js for 3D operations
import * as THREE from 'https://threejsfundamentals.org/threejs/resources/threejs/r132/build/three.module.js';

// AR Ruler Visualizer
export class ARRulerVisualizer {
  constructor(scene, sceneVisualizer = null) {
    this.scene = scene;
    this.sceneVisualizer = sceneVisualizer;
    this.startMarker = null;
    this.endMarker = null;
    this.measurementLine = null;
    this.scene3DStartMarker = null;
    this.scene3DEndMarker = null;
    this.scene3DMeasurementLine = null;
    
    // Plane visualization
    this.planeMesh = null;
    this.planeWireframe = null;
    this.planeWireframeMesh = null;
    this.scene3DPlaneMesh = null;
    this.scene3DPlaneWireframe = null;
    this.scene3DPlaneWireframeMesh = null;
  }

  createStartMarker(position) {
    if (this.startMarker) {
      this.scene.remove(this.startMarker);
    }
    
    const geometry = new THREE.SphereGeometry(0.01, 16, 16); // 10cm radius for 25cm scale
    const material = new THREE.MeshBasicMaterial({ 
      color: 0x00ff00,
      transparent: true,
      opacity: 0.8
    });
    this.startMarker = new THREE.Mesh(geometry, material);
    this.startMarker.position.copy(position);
    this.scene.add(this.startMarker);
    
    // Also create marker in 3D scene visualizer
    if (this.sceneVisualizer) {
      if (this.scene3DStartMarker) {
        this.sceneVisualizer.scene.remove(this.scene3DStartMarker);
      }
      
      const scene3DGeometry = new THREE.SphereGeometry(0.025, 16, 16); // 2.5cm radius for 25cm scale
      const scene3DMaterial = new THREE.MeshBasicMaterial({ 
        color: 0x00ff00,
        transparent: true,
        opacity: 0.9
      });
      this.scene3DStartMarker = new THREE.Mesh(scene3DGeometry, scene3DMaterial);
      this.scene3DStartMarker.position.copy(position);
      this.sceneVisualizer.scene.add(this.scene3DStartMarker);
    }
    
    if (window.debugCounter % 30 === 0) {
      console.log('Start marker created at:', position);
    }
  }

  createEndMarker(position) {
    if (this.endMarker) {
      this.scene.remove(this.endMarker);
    }
    
    const geometry = new THREE.SphereGeometry(0.01, 16, 16); // 10cm radius for 25cm scale
    const material = new THREE.MeshBasicMaterial({ 
      color: 0xff0000,
      transparent: true,
      opacity: 0.8
    });
    this.endMarker = new THREE.Mesh(geometry, material);
    this.endMarker.position.copy(position);
    this.scene.add(this.endMarker);
    
    // Also create marker in 3D scene visualizer
    if (this.sceneVisualizer) {
      if (this.scene3DEndMarker) {
        this.sceneVisualizer.scene.remove(this.scene3DEndMarker);
      }
      
      const scene3DGeometry = new THREE.SphereGeometry(0.025, 16, 16); // 2.5cm radius for 25cm scale
      const scene3DMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xff0000,
        transparent: true,
        opacity: 0.9
      });
      this.scene3DEndMarker = new THREE.Mesh(scene3DGeometry, scene3DMaterial);
      this.scene3DEndMarker.position.copy(position);
      this.sceneVisualizer.scene.add(this.scene3DEndMarker);
    }
    
    if (window.debugCounter % 30 === 0) {
      console.log('End marker created at:', position);
    }
  }

  updateMeasurementLine(startPos, endPos, distance) {
    if (this.measurementLine) {
      this.scene.remove(this.measurementLine);
    }
    
    const geometry = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);
    const material = new THREE.LineBasicMaterial({ 
      color: this.getDistanceColor(distance),
      linewidth: 5,
      transparent: true,
      opacity: 0.9
    });
    this.measurementLine = new THREE.Line(geometry, material);
    this.scene.add(this.measurementLine);
    
    // Also create line in 3D scene visualizer
    if (this.sceneVisualizer) {
      if (this.scene3DMeasurementLine) {
        this.sceneVisualizer.scene.remove(this.scene3DMeasurementLine);
      }
      
      const scene3DGeometry = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);
      const scene3DMaterial = new THREE.LineBasicMaterial({ 
        color: this.getDistanceColor(distance),
        linewidth: 3,
        transparent: true,
        opacity: 0.8
      });
      this.scene3DMeasurementLine = new THREE.Line(scene3DGeometry, scene3DMaterial);
      this.sceneVisualizer.scene.add(this.scene3DMeasurementLine);
    }
    
    if (window.debugCounter % 30 === 0) {
      console.log('Measurement line updated:', startPos, 'to', endPos, 'distance:', distance);
    }
  }

  getDistanceColor(distance) {
    if (distance < 1) return 0x00ff00; // Green for close
    if (distance < 3) return 0xffff00; // Yellow for medium
    return 0xff0000; // Red for far
  }

  clearMarkers() {
    if (this.startMarker) {
      this.scene.remove(this.startMarker);
      this.startMarker = null;
    }
    if (this.endMarker) {
      this.scene.remove(this.endMarker);
      this.endMarker = null;
    }
    if (this.measurementLine) {
      this.scene.remove(this.measurementLine);
      this.measurementLine = null;
    }
    
    // Also clear 3D scene visualizer markers
    if (this.sceneVisualizer) {
      if (this.scene3DStartMarker) {
        this.sceneVisualizer.scene.remove(this.scene3DStartMarker);
        this.scene3DStartMarker = null;
      }
      if (this.scene3DEndMarker) {
        this.sceneVisualizer.scene.remove(this.scene3DEndMarker);
        this.scene3DEndMarker = null;
      }
      if (this.scene3DMeasurementLine) {
        this.sceneVisualizer.scene.remove(this.scene3DMeasurementLine);
        this.scene3DMeasurementLine = null;
      }
    }
  }

  // Create plane visualization
  createPlaneVisualization(plane) {
    // Remove existing plane visualization
    this.clearPlaneVisualization();
    
    // Create a large plane mesh to represent the detected plane
    const planeSize = 0.25; // 25cm x 25cm plane (0.25m = 25cm)
    const geometry = new THREE.PlaneGeometry(planeSize, planeSize);
    
    // Create material with transparency for the plane
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00, // Green
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide
    });
    
    // Create plane mesh
    this.planeMesh = new THREE.Mesh(geometry, material);
    
    // Create wireframe geometry for the internal grid
    const wireframeGeometry = new THREE.PlaneGeometry(planeSize, planeSize, 5, 5); // 5x5 grid for 25cm plane
    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff00, // Green
      transparent: true,
      opacity: 0.8,
      linewidth: 1
    });
    
    // Create wireframe mesh with internal grid lines
    this.planeWireframe = new THREE.WireframeGeometry(wireframeGeometry);
    this.planeWireframeMesh = new THREE.LineSegments(this.planeWireframe, wireframeMaterial);
    
    // Position and orient the plane
    // The plane normal defines the orientation
    const planeNormal = plane.normal.clone();
    const planePoint = plane.point.clone();
    
    // Position both plane and wireframe at the detected point
    this.planeMesh.position.copy(planePoint);
    this.planeWireframeMesh.position.copy(planePoint);
    
    // Orient both to match the detected normal
    // Create a quaternion that rotates the default plane normal (0,0,1) to the detected normal
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(defaultNormal, planeNormal);
    this.planeMesh.quaternion.copy(quaternion);
    this.planeWireframeMesh.quaternion.copy(quaternion);
    
    // Add both to scene
    this.scene.add(this.planeMesh);
    this.scene.add(this.planeWireframeMesh);
    
    // Also create plane in 3D scene visualizer
    if (this.sceneVisualizer) {
      const scene3DGeometry = new THREE.PlaneGeometry(planeSize, planeSize);
      const scene3DMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide
      });
      
      this.scene3DPlaneMesh = new THREE.Mesh(scene3DGeometry, scene3DMaterial);
      this.scene3DPlaneMesh.position.copy(planePoint);
      this.scene3DPlaneMesh.quaternion.copy(quaternion);
      this.sceneVisualizer.scene.add(this.scene3DPlaneMesh);
      
      // Add wireframe to 3D scene visualizer
      const scene3DWireframeGeometry = new THREE.PlaneGeometry(planeSize, planeSize, 20, 20);
      const scene3DWireframeMaterial = new THREE.LineBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.6,
        linewidth: 1
      });
      
      this.scene3DPlaneWireframe = new THREE.WireframeGeometry(scene3DWireframeGeometry);
      this.scene3DPlaneWireframeMesh = new THREE.LineSegments(this.scene3DPlaneWireframe, scene3DWireframeMaterial);
      this.scene3DPlaneWireframeMesh.position.copy(planePoint);
      this.scene3DPlaneWireframeMesh.quaternion.copy(quaternion);
      this.sceneVisualizer.scene.add(this.scene3DPlaneWireframeMesh);
    }
    
    console.log('Plane visualization created with normal:', planeNormal, 'at point:', planePoint);
  }

  // Clear plane visualization
  clearPlaneVisualization() {
    console.log('🧹 Clearing plane visualization...');
    
    // Clear main scene plane mesh
    if (this.planeMesh) {
      this.scene.remove(this.planeMesh);
      if (this.planeMesh.geometry) this.planeMesh.geometry.dispose();
      if (this.planeMesh.material) this.planeMesh.material.dispose();
      this.planeMesh = null;
      console.log('✅ Main scene plane mesh cleared');
    }
    
    // Clear main scene wireframe mesh
    if (this.planeWireframeMesh) {
      this.scene.remove(this.planeWireframeMesh);
      if (this.planeWireframe) this.planeWireframe.dispose();
      if (this.planeWireframeMesh.material) this.planeWireframeMesh.material.dispose();
      this.planeWireframeMesh = null;
      this.planeWireframe = null;
      console.log('✅ Main scene wireframe mesh cleared');
    }
    
    // Clear 3D scene plane mesh
    if (this.scene3DPlaneMesh && this.sceneVisualizer) {
      this.sceneVisualizer.scene.remove(this.scene3DPlaneMesh);
      if (this.scene3DPlaneMesh.geometry) this.scene3DPlaneMesh.geometry.dispose();
      if (this.scene3DPlaneMesh.material) this.scene3DPlaneMesh.material.dispose();
      this.scene3DPlaneMesh = null;
      console.log('✅ 3D scene plane mesh cleared');
    }
    
    // Clear 3D scene wireframe mesh
    if (this.scene3DPlaneWireframeMesh && this.sceneVisualizer) {
      this.sceneVisualizer.scene.remove(this.scene3DPlaneWireframeMesh);
      if (this.scene3DPlaneWireframe) this.scene3DPlaneWireframe.dispose();
      if (this.scene3DPlaneWireframeMesh.material) this.scene3DPlaneWireframeMesh.material.dispose();
      this.scene3DPlaneWireframeMesh = null;
      this.scene3DPlaneWireframe = null;
      console.log('✅ 3D scene wireframe mesh cleared');
    }
    
    console.log('🧹 Plane visualization clearing complete');
  }
}

// Measurement UI Controller
export class MeasurementUI {
  constructor() {
    this.distanceDisplay = document.getElementById('distance-display');
    this.statusDisplay = document.getElementById('status-display');
    this.startButton = document.getElementById('place-marker');
    this.endButton = document.getElementById('end-measurement');
    this.resetButton = document.getElementById('reset-measurement');
    this.drawPlaneButton = document.getElementById('draw-plane');
    
    this.onStartMarkerRequested = null;
    this.onEndMeasurementRequested = null;
    this.onResetRequested = null;
    this.onDrawPlaneRequested = null;
    this.onClearPlaneRequested = null;
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.startButton.addEventListener('click', () => {
      if (this.onStartMarkerRequested) {
        this.onStartMarkerRequested();
      }
    });
    
    this.endButton.addEventListener('click', () => {
      if (this.onEndMeasurementRequested) {
        this.onEndMeasurementRequested();
      }
    });
    
    this.resetButton.addEventListener('click', () => {
      if (this.onResetRequested) {
        this.onResetRequested();
      }
    });
    
    this.drawPlaneButton.addEventListener('click', () => {
      if (this.drawPlaneButton.classList.contains('plane-active')) {
        // Clear existing plane
        if (this.onClearPlaneRequested) {
          this.onClearPlaneRequested();
          this.resetDrawPlaneButton();
        }
      } else {
        // Draw new plane
        if (this.onDrawPlaneRequested) {
          const success = this.onDrawPlaneRequested();
          this.updateDrawPlaneButton(success);
        }
      }
    });
  }

  updateDistance(distance) {
    this.distanceDisplay.textContent = `${distance.toFixed(3)} meters`;
  }

  updateStatus(status) {
    if (this.statusDisplay) {
      this.statusDisplay.textContent = status;
    }
  }

  updateDrawPlaneButton(success) {
    if (success) {
      this.drawPlaneButton.textContent = 'Clear Plane';
      this.drawPlaneButton.style.background = '#28a745';
      this.drawPlaneButton.classList.add('plane-active');
    } else {
      this.drawPlaneButton.textContent = 'Failed ✗';
      this.drawPlaneButton.style.background = '#dc3545';
      // Reset after 1 second instead of 2
      setTimeout(() => {
        this.resetDrawPlaneButton();
      }, 1000);
    }
  }

  resetDrawPlaneButton() {
    this.drawPlaneButton.textContent = 'Draw Plane';
    this.drawPlaneButton.style.background = '#007bff';
    this.drawPlaneButton.classList.remove('plane-active');
  }
}
