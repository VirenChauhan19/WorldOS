/* Local inference only. Images never leave this worker through a network call. */
let detector;
self.onmessage=async({data})=>{
  if(data.type==='init'){
    try{
      const start=performance.now();
      importScripts('./vision-runtime/0.10.21/vision.js');
      const {FilesetResolver,ObjectDetector}=self.WorldOSVision;
      const files=await FilesetResolver.forVisionTasks(new URL('./vision-runtime/0.10.21/wasm',self.location.href).href);
      detector=await ObjectDetector.createFromOptions(files,{
        baseOptions:{modelAssetPath:new URL('./models/efficientdet-lite0-int8-v1.tflite',self.location.href).href,delegate:'CPU'},
        runningMode:'VIDEO',scoreThreshold:.55,maxResults:8,
      });
      // Compile and warm the graph before the first camera frame arrives.
      detector.detectForVideo(new OffscreenCanvas(320,320),1);
      self.postMessage({type:'ready',loadMs:performance.now()-start});
    }catch{self.postMessage({type:'error',message:'Fast labels could not start on this device.'});}
    return;
  }
  if(data.type==='frame'){
    try{
      if(!detector)throw new Error('Detector not ready');
      const start=performance.now();
      const result=detector.detectForVideo(data.image,data.at);
      self.postMessage({type:'result',id:data.id,detections:result.detections,latencyMs:performance.now()-start});
    }catch{self.postMessage({type:'error',message:'Fast labels stopped. AI recognition is still available.'});}
    finally{data.image?.close();}
  }
};
