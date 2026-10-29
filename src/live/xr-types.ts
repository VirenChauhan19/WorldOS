// The browser's native WebXR objects. Kept local because DOM TypeScript types
// do not consistently include WebXR; no polyfill or synthetic tracking is used.
export interface XRPoint { x: number; y: number; z: number }
export interface XRTransform {
  position: XRPoint;
  matrix: Float32Array;
  inverse: { matrix: Float32Array };
}
export interface XRSpaceLike extends EventTarget {}
export interface XRViewLike { projectionMatrix: Float32Array; transform: XRTransform }
export interface XRHitTestSourceLike { cancel(): void }
export interface XRPlaneLike {
  planeSpace: XRSpaceLike;
  polygon: readonly XRPoint[];
  orientation: 'horizontal' | 'vertical' | null;
  semanticLabel?: string;
  lastChangedTime: number;
}
export interface XRMeshLike {
  meshSpace: XRSpaceLike;
  vertices: Float32Array;
  semanticLabel?: string;
  lastChangedTime: number;
}
export interface XRFrameLike {
  getViewerPose(space: XRSpaceLike): { views: XRViewLike[]; emulatedPosition?: boolean } | null;
  getHitTestResults(source: XRHitTestSourceLike): { getPose(space: XRSpaceLike): { transform: XRTransform; emulatedPosition?: boolean } | null }[];
  detectedPlanes?: ReadonlySet<XRPlaneLike>;
  detectedMeshes?: ReadonlySet<XRMeshLike>;
  getPose?(space: XRSpaceLike, baseSpace: XRSpaceLike): { transform: XRTransform; emulatedPosition?: boolean } | null;
}
export interface XRLayerLike {
  framebuffer: WebGLFramebuffer | null;
  getViewport(view: XRViewLike): { x: number; y: number; width: number; height: number } | null;
}
export interface XRSessionLike extends EventTarget {
  visibilityState: 'visible' | 'visible-blurred' | 'hidden';
  domOverlayState?: { type: string };
  requestReferenceSpace(type: 'viewer' | 'local' | 'local-floor'): Promise<XRSpaceLike>;
  requestHitTestSource(options: { space: XRSpaceLike; entityTypes: ['plane'] }): Promise<XRHitTestSourceLike>;
  updateRenderState(state: { baseLayer: XRLayerLike }): void;
  requestAnimationFrame(callback: (time: number, frame: XRFrameLike) => void): number;
  cancelAnimationFrame(handle: number): void;
  end(): Promise<void>;
}
export interface XRSystemLike {
  isSessionSupported(mode: 'immersive-ar'): Promise<boolean>;
  requestSession(mode: 'immersive-ar', options: {
    requiredFeatures: string[];
    optionalFeatures: string[];
    domOverlay: { root: HTMLElement };
  }): Promise<XRSessionLike>;
}
export interface XRLayerConstructor {
  new(session: XRSessionLike, context: WebGLRenderingContext, options: { alpha: boolean }): XRLayerLike;
}
