#!/bin/bash
set -e

# Script to build the SLAM library in the current (slam) directory

BUILD_DIR=build

# Delete previous build
rm -rf $BUILD_DIR

# Create build directory if it doesn't exist
mkdir -p $BUILD_DIR
cd $BUILD_DIR

# Configure build
emcmake cmake .. 

# Install
emmake make install

echo "SLAM library built successfully in src/$BUILD_DIR/" 
