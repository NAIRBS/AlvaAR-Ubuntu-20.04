cmake_minimum_required(VERSION 3.1 FATAL_ERROR)
project(ibow_lcd LANGUAGES CXX)

# Setting build type to Release
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
message(STATUS "Build type: " ${CMAKE_BUILD_TYPE})

# Setting the flags for profiling information or not
if(CMAKE_BUILD_TYPE MATCHES Release)
  message(STATUS "Setting Release options")
  set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wall -O3")
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall -O3")
elseif(CMAKE_BUILD_TYPE MATCHES Debug)
  message(STATUS "Setting Debug options")
  set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wall -O1 -pg")
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall -O1 -pg")
endif()

# Check C++11 or C++0x support
include(CheckCXXCompilerFlag)
CHECK_CXX_COMPILER_FLAG("-std=c++11" COMPILER_SUPPORTS_CXX11)
CHECK_CXX_COMPILER_FLAG("-std=c++0x" COMPILER_SUPPORTS_CXX0X)
if(COMPILER_SUPPORTS_CXX11)
   set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -std=c++11")
   message(STATUS "Using flag -std=c++11.")
elseif(COMPILER_SUPPORTS_CXX0X)
   set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -std=c++0x")
   message(STATUS "Using flag -std=c++0x.")
else()
   message(FATAL_ERROR "The compiler ${CMAKE_CXX_COMPILER} has no C++11 support.
                         Please use a different C++ compiler.")
endif()

# Printing the compiling flags
message(STATUS "Compiler flags: ${CMAKE_CXX_FLAGS}")

# Other packages
find_package(OpenCV REQUIRED) # OpenCV

include_directories(include
                    external
                    ${OpenCV_INCLUDE_DIRS}
                    ${PROJECT_SOURCE_DIR}/../obindex2/lib/include/
                    )

### Targets ###
# Library
add_library(lcdetector
            include/ibow_lcd/island.h
            src/lcdetector.cc)

target_link_libraries(lcdetector
                      ${OpenCV_LIBRARIES}
                      ${PROJECT_SOURCE_DIR}/../obindex2/build/lib/libobindex2.a
                      )

set_target_properties(lcdetector PROPERTIES LINK_FLAGS "${CMAKE_CXX_FLAGS}")

install(TARGETS lcdetector DESTINATION ${CMAKE_INSTALL_PREFIX})
install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_PREFIX}/include)
