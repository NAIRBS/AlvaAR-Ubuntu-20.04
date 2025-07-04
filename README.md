# AlvaAR (Now for Ubuntu 20.04)

AlvaAR is a realtime visual SLAM algorithm running as WebAssembly, in the browser. It is a heavily modified version of the [OV²SLAM](https://github.com/ov2slam/ov2slam) and [ORB-SLAM2](https://github.com/raulmur/ORB_SLAM2) projects. SLAM is the core building block of Augmented Reality applications focusing on world tracking.

![image](examples/public/assets/image.gif)

# This repository is ongoing development, planned enhancements are:
1. ORBSLAM2 to ORBSLAM3, specifically to support Fisheye lens (ORBSLAM3 exclusive)
2. Monocular Camera to Stereo Camera use
3. Pipe input from 2 ESP32 Webserver Cam Modules to build a prototype AR Headset (currently only accepts video.mp4 and single mobile phone camera input)

## File Change Notes
- The `build.sh` script in `/src/libs` has been adapted for Linux compatibility; the original codebase was developed for macOS.

- The file [`buildtests.in`](https://github.com/PX4/eigen/blob/master/scripts/buildtests.in) from the Eigen libs dependency folder was missing and has been added to this folder [`/src/libs/eigen/scripts`](https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04/tree/main/src/libs/eigen/scripts).

- The following CMakeLists files have been modified to avoid errors related to the `-march=native` flag (WebAssembly is based on a virtual machine and does not support this flag):
  - [`src/libs/obindex2/lib/CMakeLists.txt`](https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04/blob/main/src/libs/obindex2/lib/CMakeLists.txt)
  - [`src/libs/ibow_lcd/CMakeLists.txt`](https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04/blob/main/src/libs/ibow_lcd/CMakeLists.txt)
  - [`src/libs/opengv/CMakeLists.txt`](https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04/blob/main/src/libs/opengv/CMakeLists.txt)

- Updated port used in HTTPS to 8080 not 443 since its private, in [`/examples/server.js`](https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04/blob/main/examples/server.js)

## Ubuntu Specific Setup
```
    cd ~
    git clone https://github.com/NAIRBS/AlvaAR-Ubuntu-20.04

    sudo apt update
    sudo apt install build-essential cmake python3 python3-pip nodejs npm python-is-python3

    # In home directory
    git clone https://github.com/emscripten-core/emsdk.git
    cd emsdk

    # Fetch the latest version of the emsdk (not needed the first time you clone)
    git pull

    # Download and install the latest SDK tools.
    ./emsdk install 3.1.44

    # Make the "latest" SDK "active" for the current user. (writes .emscripten file)
    ./emsdk activate 3.1.44

    # Activate PATH and other environment variables in the current terminal
    source ~/emsdk/emsdk_env.sh

    # Check if emcc is active in current terminal
    emcc -v

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    source ~/.bashrc
    nvm --version

    nvm install 18
    nvm use 18
```

## Examples
The examples use [ThreeJS](https://threejs.org/) to apply and render the estimated camera pose to a 3d environment.  

[Video Demo](https://alanross.github.io/AlvaAR/examples/public/video.html): A desktop browser version using a video file as input.  
[Camera Demo](https://alanross.github.io/AlvaAR/examples/public/camera.html): The mobile version will access the device camera as input.

<img width="75" src="examples/public/assets/qr.png">

### Run with http server
To run the examples on your local machine, start a simple http server in the examples/ folder:

`$: python 2: python -m SimpleHTTPServer 8080` or   
`$: python 3: python -m http.server 8080` or  
`$: emrun --browser chrome ./`

Then open [http://localhost:8080/public/video.html](http://localhost:8080/public/video.html]) in your browser.

### Run with https server
To run the examples on another device in your local network, they must be served via https. For convenience, a simple https server was added to this project – do not use for production.

#### 1) Install server dependencies
```
    $: cd ./AlvaAR/examples/
    $: npm install
```

#### 2) Generate self-signed certificate
```
    $: cd ./AlvaAR/examples
    $: mkdir ssl/
    $: cd ssl/
    $: openssl req -nodes -new -x509 -keyout key.pem -out cert.pem
```

#### 3) Run
```
    $: cd ./AlvaAR/examples/
    $: nvm use 13.2
    $: npm start
``` 
Then open [https://YOUR_IP:443/video.html](https://YOUR_IP:443/video.html]) in your browser.
If met with a <b>ERR_CERT_INVALID</b> error in Chrome,
try typing <i>badidea</i> or <i>thisisunsafe</i> directly in Chrome on the same page.
Don’t do this unless the site is one you trust or develop.


## Usage

This code shows how to send image data to AlvaAR to compute the camera pose.

```javascript
import { AlvaAR } from 'alva_ar.js';

const videoOrWebcam = /*...*/;

const width = videoOrWebcam.width;
const height = videoOrWebcam.height;

const canvas = document.getElementById( 'canvas' );
const ctx = canvas.getContext( '2d' );

canvas.width = width;
canvas.height = height;

const alva = await AlvaAR.Initialize( width, height );

function loop()
{
    ctx.clearRect( 0, 0, width, height );
    ctx.drawImage( videoOrWebcam, 0, 0, width, height );
    
    const frame = ctx.getImageData( 0, 0, width, height );
    
    // cameraPose holds the rotation/translation information where the camera is estimated to be
    const cameraPose = alva.findCameraPose( frame );
    
    // planePose holds the rotation/translation information of a detected plane
    const planePose = alva.findPlane();
    
    // The tracked points in the frame
    const points = alva.getFramePoints();

    for( const p of points )
    {
        ctx.fillRect( p.x, p.y, 2, 2 );
    }
};
```


## Build

### Prerequisites

#### Emscripten
Ensure [Emscripten](https://emscripten.org/docs/getting_started/Tutorial.html) is installed and activated in your session.

```
    $: source [PATH]/emsdk/emsdk_env.sh 
    $: emcc -v
```

#### C++11 or Higher
Alva makes use of C++11 features and should thus be compiled with a C++11 or higher flag.

### Dependencies

| Dependency             | Description                                                                                                                                                                                                                                                                                                                                                                                                                         |
|------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Eigen3                 | Download Eigen 3.4. Find all releases [here](https://eigen.tuxfamily.org/index.php?title=Main_Page).This project has been tested with 3.4.0                                                                                                                                                                                                                                                                                         |
| OpenCV                 | Download OpenCV 4.5. Find all releases [here](https://opencv.org/releases/).This project has been tested with [4.5.5](https://github.com/opencv/opencv/archive/4.5.5.zip).                                                                                                                                                                                                                                                          |
| iBoW-LCD               | A modified version of [iBoW-LCD](https://github.com/emiliofidalgo/ibow-lcd) is included in the libs folder. It has been turned into a static shared lib. Same goes for [OBIndex2](https://github.com/emiliofidalgo/obindex2), the required dependency for iBoW-LCD. Check the lcdetector.h and lcdetector.cc files to see the modifications w.r.t. to the original code. Both CMakeList have been adjusted to work with Emscripten. |
| Sophus                 | [Sophus](https://github.com/strasdat/Sophus) is used for _*SE(3), SO(3)*_ elements representation.                                                                                                                                                                                                                                                                                                                                  |
| Ceres Solver           | [Ceres](https://github.com/ceres-solver/ceres-solver) is used for optimization related operations such as PnP, Bundle Adjustment or PoseGraph Optimization. Note that [Ceres dependencies](http://ceres-solver.org/installation.html) are still required.                                                                                                                                                                           |
| OpenGV                 | [OpenGV](https://github.com/laurentkneip/opengv) is used for Multi-View-Geometry (MVG) operations.                                                                                                                                                                                                                                                                                                                                  |

#### Build Dependencies
For convenience, a copy of all required libraries has been included in the libs/ folder. Run the following script to compile all libraries to wasm modules which can be linked into the main project.

```
    $: cd ./AlvaAR/src/libs/
    $: ./build.sh
```

#### Build Project

Run the following in your shell before invoking emcmake or emmake:

```
    $: [PATH]/emsdk/emsdk_env.sh
```

Then, run the following:

```
    $: cd ./AlvaAR/src/slam
    $: mkdir build/
    $: cd build/
    $: emcmake cmake .. 
    $: emmake make install
```


## Roadmap
- [ ] Improve the initialisation phase to be more stable and predictable.
- [ ] Move feature extraction and tracking to GPU.
- [ ] Blend visual SLAM with IMU data to increase robustness. 


## License

AlvaAR is released under the [GPLv3 license](https://www.gnu.org/licenses/gpl-3.0.txt).  

OV²SLAM and ORB-SLAM2 are both released under the [GPLv3 license](https://www.gnu.org/licenses/gpl-3.0.txt). Please see 3rd party dependency licenses in libs/.


## Contact

Alan Ross: [@alan_ross](https://twitter.com/alan_ross) or [me@aross.io]()  
Project: [https://github.com/alanross/AlvaAR](https://github.com/alanross/AlvaAR)