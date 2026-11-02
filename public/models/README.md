# Bundled object detector

`efficientdet-lite0-int8-v1.tflite` is Google's EfficientDet-Lite0 int8 model,
version 1. It identifies COCO object categories. It does not identify arbitrary
objects, text, individual people, or room coordinates.

- Model: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite
- Publisher documentation: https://developers.google.com/edge/mediapipe/solutions/vision/object_detector
- TensorFlow model page: https://www.kaggle.com/models/tensorflow/efficientdet/tfLite/lite0-int8/1
- SHA-256: `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb`
- Size: 4,602,795 bytes.

The runtime is `@mediapipe/tasks-vision` 0.10.21 (Apache-2.0), installed from npm
and copied to a versioned public directory by `scripts/prepare_vision.mjs`.
The bundled runtime is modified only by adding a classic-worker export wrapper.
The upstream license is included in `LICENSE-MediaPipe.txt`.

Both model and runtime are served by the app. Camera pixels stay on the device
for this detector. The separate cloud-details path still uses the configured
API service when automatic recognition is enabled.
