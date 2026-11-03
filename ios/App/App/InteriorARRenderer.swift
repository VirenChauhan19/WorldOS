import ARKit
import CoreFoundation
import RealityKit
import UIKit
import simd

/// A rendering surface for the existing web scene designer. All entry points and
/// ARSession delegate callbacks run on the main queue. Coordinates are metres;
/// rotations are the designer's clockwise degrees, not RealityKit radians.
final class InteriorARRenderer: NSObject, ARSessionDelegate {
    struct RendererError: LocalizedError {
        let code: String
        let message: String
        var errorDescription: String? { message }
    }

    private struct MeshInput: Hashable {
        let vertices: [Float]
        let color: [Float]
    }

    private struct Asset: Hashable {
        let width: Float
        let depth: Float
        let height: Float
        let meshes: [MeshInput]
    }

    private struct ObjectInput {
        let id: String
        let asset: Asset
        let position: SIMD3<Float>
        let rotation: Float
    }

    private struct SceneInput {
        let objects: [ObjectInput]
        let selectedID: String?
        let preview: Asset?
        let previewRotation: Float
    }

    private struct Geometry {
        let mesh: MeshResource
        let materials: [Material]
        let ghostMaterials: [Material]
        let outline: MeshResource
        let minimum: SIMD3<Float>
        let maximum: SIMD3<Float>
    }

    private struct PlacedObject {
        let anchor: ARAnchor
        let entity: AnchorEntity
        let model: ModelEntity
        let outline: ModelEntity
        var input: ObjectInput
        var geometry: Geometry
    }

    private let view: ARView
    private let onState: ([String: Any]) -> Void
    private var objects: [String: PlacedObject] = [:]
    private var geometryCache: [Asset: Geometry] = [:]
    private var selectedID: String?
    private var previewAsset: Asset?
    private var previewAnchor: AnchorEntity?
    private var previewModel: ModelEntity?
    private var previewRotation: Float = 0
    private var placementPosition: SIMD3<Float>?
    private var isRunning = false
    private var isInterrupted = false
    private var needsResetAcknowledgement = true
    private var resetTimestamp: TimeInterval = 0
    private var lastFrameTimestamp: TimeInterval = 0
    private var lastSampleTimestamp: TimeInterval = 0
    private var lastStateTimestamp: TimeInterval = 0
    private var lastStateKey = ""
    private var watchdog: Timer?

    private static let maximumObjects = 24
    private static let maximumMeshes = 4096
    private static let maximumObjectTriangles = 20_000
    private static let maximumSceneTriangles = 160_000
    private static let frameLifetime: TimeInterval = 0.5
    private static let stateInterval: TimeInterval = 0.1

    init(view: ARView, onState: @escaping ([String: Any]) -> Void) {
        self.view = view
        self.onState = onState
        super.init()
    }

    deinit {
        watchdog?.invalidate()
    }

    func start() {
        precondition(Thread.isMainThread)
        guard ARWorldTrackingConfiguration.isSupported else {
            onState(["phase": "ended", "canSelect": false,
                     "message": "World tracking is not supported on this device."])
            return
        }
        watchdog?.invalidate()
        isRunning = true
        view.automaticallyConfigureSession = false
        view.session.delegateQueue = .main
        view.session.delegate = self
        resetWorld(message: "Move iPhone slowly to find a floor or tabletop.")
        let timer = Timer(timeInterval: 0.15, repeats: true) { [weak self] _ in
            guard let self = self, self.isRunning, !self.isInterrupted else { return }
            // Frame callbacks can stop entirely when the camera is unavailable.
            // A timer therefore also revokes poses and hides the placed models.
            if self.lastFrameTimestamp > 0 &&
                CACurrentMediaTime() - self.lastFrameTimestamp >= Self.frameLifetime {
                self.showUnavailable(message: "Tracking paused. Hold iPhone steady and scan the room.")
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        watchdog = timer
    }

    func stop() {
        precondition(Thread.isMainThread)
        let wasRunning = isRunning
        isRunning = false
        watchdog?.invalidate()
        watchdog = nil
        view.session.pause()
        view.session.delegate = nil
        clearScene()
        geometryCache.removeAll()
        needsResetAcknowledgement = true
        isInterrupted = false
        lastFrameTimestamp = 0
        if wasRunning {
            emit(phase: "ended", message: "AR session ended.", canSelect: false, force: true)
        }
    }

    /// Validates and prepares the complete update before mutating the live scene.
    /// Empty objects acknowledge a new origin; saved poses are never rehydrated.
    func updateScene(_ payload: [String: Any]) throws {
        precondition(Thread.isMainThread)
        guard isRunning else { throw issue("AR_ENDED", "The AR session has ended.") }
        let scene = try parseScene(payload)
        if needsResetAcknowledgement && !scene.objects.isEmpty {
            throw issue("AR_RESET", "The AR origin changed. Clear placed objects before continuing.")
        }
        let changesPlacement = scene.objects.contains { input in
            guard let old = objects[input.id] else { return true }
            return old.input.position != input.position || old.input.rotation != input.rotation
        }
        if changesPlacement && !hasFreshTracking {
            throw issue("AR_TRACKING", "Wait for fresh camera tracking before placing or moving furniture.")
        }

        var nextCache: [Asset: Geometry] = [:]
        var assets = scene.objects.map { $0.asset }
        if let preview = scene.preview { assets.append(preview) }
        do {
            for asset in assets where nextCache[asset] == nil {
                nextCache[asset] = try geometryCache[asset] ?? makeGeometry(asset)
            }
        } catch let error as RendererError {
            throw error
        } catch {
            throw issue("AR_UPDATE_FAILED", "Could not create the furniture geometry: \(error.localizedDescription)")
        }

        // Keep fully validated resources even if tracking expires during mesh
        // preparation. A recovery retry can then apply them without rebuilding.
        // This cache remains bounded to the latest 24 objects and one preview;
        // already placed models retain their own resources independently.
        geometryCache = nextCache
        // Mesh creation is synchronous and may take time on an older iPhone.
        // Recheck camera freshness after that work, before accepting a new pose.
        if changesPlacement && !hasFreshTracking {
            throw issue("AR_TRACKING", "Camera tracking changed. Scan the room before placing furniture.")
        }
        let retainedIDs = Set(scene.objects.map { $0.id })
        for id in Array(objects.keys) where !retainedIDs.contains(id) {
            removeObject(id)
        }
        for input in scene.objects {
            guard let geometry = nextCache[input.asset] else { continue }
            if var old = objects[input.id], old.input.position == input.position {
                // Color, catalog, and dimension edits keep the original tracked
                // ARAnchor. Repeated JS snapshots cannot undo ARKit refinement.
                if old.input.asset != input.asset {
                    old.model.model = ModelComponent(mesh: geometry.mesh, materials: geometry.materials)
                    old.outline.model = ModelComponent(mesh: geometry.outline, materials: [outlineMaterial()])
                    old.geometry = geometry
                }
                old.model.orientation = orientation(degrees: input.rotation)
                old.input = input
                objects[input.id] = old
            } else {
                removeObject(input.id)
                objects[input.id] = makeObject(input, geometry: geometry)
            }
        }
        selectedID = scene.selectedID
        previewRotation = scene.previewRotation
        if scene.preview != previewAsset {
            previewModel?.removeFromParent()
            previewModel = nil
            if let asset = scene.preview, let geometry = nextCache[asset] {
                if previewAnchor == nil {
                    let anchor = AnchorEntity(world: SIMD3<Float>.zero)
                    view.scene.addAnchor(anchor)
                    previewAnchor = anchor
                }
                let model = ModelEntity(mesh: geometry.mesh, materials: geometry.ghostMaterials)
                model.name = "interior-preview"
                model.isEnabled = false
                previewAnchor?.addChild(model)
                previewModel = model
            }
            previewAsset = scene.preview
        }
        needsResetAcknowledgement = false
        for (id, object) in objects { object.outline.isEnabled = id == selectedID }
        if let frame = view.session.currentFrame {
            updateFrame(frame, force: true)
        } else {
            setModelsVisible(false)
        }
    }

    /// Selects the nearest rendered object with a ray/OBB intersection. Bounds
    /// follow each actual RealityKit anchor transform, including ARKit updates.
    func select(normalizedX: Double, normalizedY: Double) -> String? {
        precondition(Thread.isMainThread)
        guard hasFreshTracking, normalizedX.isFinite, normalizedY.isFinite,
              (0...1).contains(normalizedX), (0...1).contains(normalizedY),
              view.bounds.width > 0, view.bounds.height > 0 else { return nil }
        let point = CGPoint(x: view.bounds.minX + CGFloat(normalizedX) * view.bounds.width,
                            y: view.bounds.minY + CGFloat(normalizedY) * view.bounds.height)
        guard let ray = view.ray(through: point) else { return nil }
        var closest: (id: String, distance: Float)?
        for (id, object) in objects where object.entity.isAnchored && object.model.isEnabled {
            let inverse = simd_inverse(object.model.transformMatrix(relativeTo: nil))
            let localOrigin = inverse * SIMD4<Float>(ray.origin, 1)
            let localDirection = inverse * SIMD4<Float>(ray.direction, 0)
            let origin = SIMD3<Float>(localOrigin.x, localOrigin.y, localOrigin.z)
            let direction = SIMD3<Float>(localDirection.x, localDirection.y, localDirection.z)
            let padding = SIMD3<Float>(repeating: 0.008)
            if let distance = rayBox(origin: origin, direction: direction,
                                     minimum: object.geometry.minimum - padding,
                                     maximum: object.geometry.maximum + padding),
               closest == nil || distance < closest!.distance {
                closest = (id, distance)
            }
        }
        return closest?.id
    }

    // MARK: - AR session lifetime and placement freshness

    private var hasFreshTracking: Bool {
        guard isRunning, !isInterrupted, let frame = view.session.currentFrame,
              frame.timestamp >= resetTimestamp,
              CACurrentMediaTime() - frame.timestamp >= 0,
              CACurrentMediaTime() - frame.timestamp < Self.frameLifetime,
              case .normal = frame.camera.trackingState else { return false }
        return true
    }

    private func resetWorld(message: String) {
        clearScene()
        geometryCache.removeAll()
        needsResetAcknowledgement = true
        isInterrupted = false
        resetTimestamp = CACurrentMediaTime()
        lastFrameTimestamp = 0
        lastSampleTimestamp = 0
        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal]
        configuration.environmentTexturing = .automatic
        // LiDAR enhances occlusion when available; it is never a prerequisite.
        view.environment.sceneUnderstanding.options.remove(.occlusion)
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            configuration.sceneReconstruction = .mesh
            view.environment.sceneUnderstanding.options.insert(.occlusion)
        }
        view.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        emit(phase: "searching", message: message, canSelect: false, reset: true, force: true)
    }

    private func clearScene() {
        for id in Array(objects.keys) { removeObject(id) }
        if let previewAnchor = previewAnchor { view.scene.removeAnchor(previewAnchor) }
        previewAnchor = nil
        previewModel = nil
        previewAsset = nil
        previewRotation = 0
        placementPosition = nil
        selectedID = nil
    }

    private func removeObject(_ id: String) {
        guard let object = objects.removeValue(forKey: id) else { return }
        view.scene.removeAnchor(object.entity)
        view.session.remove(anchor: object.anchor)
    }

    private func makeObject(_ input: ObjectInput, geometry: Geometry) -> PlacedObject {
        var transform = matrix_identity_float4x4
        transform.columns.3 = SIMD4<Float>(input.position, 1)
        let anchor = ARAnchor(name: "interior:\(input.id)", transform: transform)
        view.session.add(anchor: anchor)
        let entity = AnchorEntity(anchor: anchor)
        let model = ModelEntity(mesh: geometry.mesh, materials: geometry.materials)
        model.name = input.id
        model.orientation = orientation(degrees: input.rotation)
        let outline = ModelEntity(mesh: geometry.outline, materials: [outlineMaterial()])
        outline.name = "interior-selection"
        outline.isEnabled = false
        model.addChild(outline)
        entity.addChild(model)
        view.scene.addAnchor(entity)
        return PlacedObject(anchor: anchor, entity: entity, model: model, outline: outline,
                            input: input, geometry: geometry)
    }

    private func orientation(degrees: Float) -> simd_quatf {
        // Shared furnitureMeshes rotates +X toward +Z for a positive angle.
        simd_quatf(angle: -degrees * .pi / 180, axis: SIMD3<Float>(0, 1, 0))
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard isRunning, !isInterrupted, frame.timestamp >= resetTimestamp else { return }
        lastFrameTimestamp = frame.timestamp
        updateFrame(frame, force: false)
    }

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        guard isRunning, !isInterrupted else { return }
        if case .normal = camera.trackingState { return }
        showUnavailable(message: trackingMessage(camera.trackingState))
    }

    func sessionWasInterrupted(_ session: ARSession) {
        guard isRunning else { return }
        isInterrupted = true
        showUnavailable(message: "AR was interrupted. Return to the camera to start a fresh scan.")
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        guard isRunning else { return }
        // A resumed camera may have an unrelated world origin. Notify the web
        // designer to clear its coordinates before it can submit another object.
        resetWorld(message: "AR restarted. Scan the room and place your furniture again.")
    }

    func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool { false }

    func session(_ session: ARSession, didFailWithError error: Error) {
        guard isRunning else { return }
        isRunning = false
        watchdog?.invalidate()
        watchdog = nil
        session.pause()
        session.delegate = nil
        clearScene()
        geometryCache.removeAll()
        emit(phase: "ended", message: "AR stopped: \(error.localizedDescription)", canSelect: false, force: true)
    }

    private func updateFrame(_ frame: ARFrame, force: Bool) {
        guard isRunning, !isInterrupted, frame.timestamp >= resetTimestamp else { return }
        guard hasFreshTracking, case .normal = frame.camera.trackingState else {
            showUnavailable(message: trackingMessage(frame.camera.trackingState))
            return
        }
        let now = CACurrentMediaTime()
        guard force || now - lastSampleTimestamp >= Self.stateInterval else { return }
        lastSampleTimestamp = now
        setModelsVisible(true)
        let center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        var hit: ARRaycastResult?
        if view.bounds.width > 0 && view.bounds.height > 0 {
            // Prefer observed plane geometry; estimated horizontal surfaces also
            // work on ordinary iPhones without a depth sensor.
            hit = view.raycast(from: center, allowing: .existingPlaneGeometry, alignment: .horizontal).first
            if hit == nil {
                hit = view.raycast(from: center, allowing: .estimatedPlane, alignment: .horizontal).first
            }
        }
        if let hit = hit {
            let column = hit.worldTransform.columns.3
            let position = SIMD3<Float>(column.x, column.y, column.z)
            let cameraColumn = frame.camera.transform.columns.3
            let camera = SIMD3<Float>(cameraColumn.x, cameraColumn.y, cameraColumn.z)
            if isBounded(position, limit: 50), simd_distance(position, camera) <= 8 {
                placementPosition = position
                previewModel?.position = position
                previewModel?.orientation = orientation(degrees: previewRotation)
                previewModel?.isEnabled = !needsResetAcknowledgement
                if needsResetAcknowledgement {
                    emit(phase: "searching", message: "Preparing a fresh AR scene.", canSelect: false, force: true)
                    return
                }
                emit(phase: "ready", message: "Surface found. Place furniture or tap an object to edit it.",
                     canSelect: !objects.isEmpty, force: true)
                return
            }
        }
        placementPosition = nil
        previewModel?.isEnabled = false
        emit(phase: "searching", message: "Aim at a nearby floor or tabletop to place furniture.",
             canSelect: !objects.isEmpty, force: true)
    }

    private func showUnavailable(message: String) {
        placementPosition = nil
        setModelsVisible(false)
        emit(phase: "tracking-lost", message: message, canSelect: false)
    }

    private func setModelsVisible(_ visible: Bool) {
        for object in objects.values { object.model.isEnabled = visible }
        if !visible { previewModel?.isEnabled = false }
    }

    private func trackingMessage(_ state: ARCamera.TrackingState) -> String {
        switch state {
        case .notAvailable: return "Camera tracking is unavailable. Hold iPhone steady."
        case .normal: return "Waiting for a fresh camera frame."
        case .limited(let reason):
            switch reason {
            case .initializing: return "Move iPhone slowly to scan the room."
            case .excessiveMotion: return "Move iPhone more slowly to restore tracking."
            case .insufficientFeatures: return "Aim at a well-lit, textured area to restore tracking."
            case .relocalizing: return "Scan the room to restore camera tracking."
            @unknown default: return "Hold iPhone steady to restore tracking."
            }
        }
    }

    private func emit(phase: String, message: String, canSelect: Bool,
                      reset: Bool = false, force: Bool = false) {
        let key = "\(phase)|\(canSelect)|\(message)"
        let hasPose = phase == "ready" && placementPosition != nil && !needsResetAcknowledgement
        let now = CACurrentMediaTime()
        // Even unchanged searching/limited states are a camera heartbeat for
        // the web watchdog. Limit repeated limited-frame callbacks to 10 Hz;
        // tracking transitions still revoke placement immediately.
        guard force || reset || key != lastStateKey || now - lastStateTimestamp >= Self.stateInterval else { return }
        lastStateTimestamp = now
        lastStateKey = key
        var state: [String: Any] = ["phase": phase, "canSelect": canSelect, "message": message]
        if reset { state["reset"] = true }
        if hasPose, let position = placementPosition {
            state["pose"] = ["position": ["x": Double(position.x), "y": Double(position.y), "z": Double(position.z)],
                             "rotation": Double(previewRotation)] as [String: Any]
        }
        onState(state)
    }

    // MARK: - Bounded bridge input

    private func parseScene(_ payload: [String: Any]) throws -> SceneInput {
        guard let rows = payload["objects"] as? [[String: Any]], rows.count <= Self.maximumObjects else {
            throw issue("AR_UPDATE_FAILED", "An AR scene supports at most 24 objects.")
        }
        var ids = Set<String>()
        var triangleCount = 0
        var parsed: [ObjectInput] = []
        for row in rows {
            let id = try string(row["id"], field: "object ID", maximum: 160)
            guard ids.insert(id).inserted else { throw issue("AR_UPDATE_FAILED", "Object IDs must be unique.") }
            let asset = try parseAsset(row, totalTriangles: &triangleCount)
            guard let position = row["position"] as? [String: Any] else {
                throw issue("AR_UPDATE_FAILED", "An object needs a world position.")
            }
            let vector = SIMD3<Float>(try number(position["x"], field: "position x", limit: 50),
                                      try number(position["y"], field: "position y", limit: 50),
                                      try number(position["z"], field: "position z", limit: 50))
            let rotation = try number(row["rotation"], field: "rotation", limit: 360_000)
            parsed.append(ObjectInput(id: id, asset: asset, position: vector,
                                      rotation: normalizedDegrees(rotation)))
        }
        var selectedID: String?
        if let value = payload["selectedId"], !(value is NSNull) {
            selectedID = try string(value, field: "selection", maximum: 160)
            guard ids.contains(selectedID!) else { throw issue("AR_UPDATE_FAILED", "The selected object does not exist.") }
        }
        var preview: Asset?
        if let value = payload["preview"], !(value is NSNull) {
            guard let row = value as? [String: Any] else { throw issue("AR_UPDATE_FAILED", "Invalid furniture preview.") }
            preview = try parseAsset(row, totalTriangles: &triangleCount)
        }
        let rotation = try number(payload["previewRotation"] ?? 0, field: "preview rotation", limit: 360_000)
        return SceneInput(objects: parsed, selectedID: selectedID, preview: preview,
                          previewRotation: normalizedDegrees(rotation))
    }

    private func parseAsset(_ payload: [String: Any], totalTriangles: inout Int) throws -> Asset {
        guard let item = payload["item"] as? [String: Any],
              let rows = payload["meshes"] as? [[String: Any]], !rows.isEmpty,
              rows.count <= Self.maximumMeshes else {
            throw issue("AR_UPDATE_FAILED", "Furniture must include a bounded mesh and item definition.")
        }
        _ = try string(item["id"], field: "item ID", maximum: 160)
        _ = try string(item["kind"], field: "item kind", maximum: 80)
        _ = try string(item["label"], field: "item label", maximum: 160)
        let color = try string(item["color"], field: "item color", maximum: 7)
        guard color.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil else {
            throw issue("AR_UPDATE_FAILED", "Furniture colors must be six-digit hex colors.")
        }
        let width = try number(item["width"], field: "width", limit: 30)
        let depth = try number(item["depth"], field: "depth", limit: 30)
        let height = try number(item["height"], field: "height", limit: 30)
        guard min(width, min(depth, height)) >= 0.01 else {
            throw issue("AR_UPDATE_FAILED", "Furniture dimensions must be between 0.01 and 30 metres.")
        }
        var meshes: [MeshInput] = []
        var objectTriangles = 0
        var alphaValues = Set<Float>()
        for row in rows {
            guard let rawVertices = row["vertices"] as? [Any], !rawVertices.isEmpty,
                  rawVertices.count % 9 == 0,
                  rawVertices.count <= Self.maximumObjectTriangles * 9,
                  let rawColor = row["color"] as? [Any], rawColor.count == 4 else {
                throw issue("AR_UPDATE_FAILED", "Furniture meshes need complete XYZ triangles and RGBA colors.")
            }
            let count = rawVertices.count / 9
            objectTriangles += count
            totalTriangles += count
            guard objectTriangles <= Self.maximumObjectTriangles, totalTriangles <= Self.maximumSceneTriangles else {
                throw issue("AR_UPDATE_FAILED", "The AR scene exceeds the mesh complexity limit.")
            }
            let rgba = try rawColor.map { try number($0, field: "mesh color", limit: 1) }
            guard rgba.allSatisfy({ $0 >= 0 }) else { throw issue("AR_UPDATE_FAILED", "Mesh colors must be between zero and one.") }
            alphaValues.insert(rgba[3])
            guard alphaValues.count <= 16 else { throw issue("AR_UPDATE_FAILED", "A furniture item has too many transparency groups.") }
            var vertices: [Float] = []
            vertices.reserveCapacity(rawVertices.count)
            for (index, value) in rawVertices.enumerated() {
                let coordinate = try number(value, field: "mesh vertex", limit: 31)
                // The shared catalog is centered in X/Z and starts at floor Y=0.
                // A small margin tolerates round-off at procedural leaf edges.
                let axis = index % 3
                let lower: Float = axis == 1 ? -0.02 : -(axis == 0 ? width : depth) / 2 - 0.02
                let upper: Float = axis == 1 ? height + 0.02 : (axis == 0 ? width : depth) / 2 + 0.02
                guard coordinate >= lower, coordinate <= upper else {
                    throw issue("AR_UPDATE_FAILED", "Furniture mesh exceeds its declared dimensions.")
                }
                vertices.append(coordinate)
            }
            meshes.append(MeshInput(vertices: vertices, color: rgba))
        }
        return Asset(width: width, depth: depth, height: height, meshes: meshes)
    }

    private func string(_ value: Any?, field: String, maximum: Int) throws -> String {
        guard let value = value as? String, !value.isEmpty, value.count <= maximum else {
            throw issue("AR_UPDATE_FAILED", "Invalid \(field).")
        }
        return value
    }

    private func number(_ value: Any?, field: String, limit: Double) throws -> Float {
        guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
              value.doubleValue.isFinite, abs(value.doubleValue) <= limit else {
            throw issue("AR_UPDATE_FAILED", "Invalid \(field).")
        }
        return value.floatValue
    }

    private func normalizedDegrees(_ value: Float) -> Float {
        let remainder = value.truncatingRemainder(dividingBy: 360)
        return remainder < 0 ? remainder + 360 : remainder
    }

    private func issue(_ code: String, _ message: String) -> RendererError {
        RendererError(code: code, message: message)
    }

    private func isBounded(_ value: SIMD3<Float>, limit: Float) -> Bool {
        value.x.isFinite && value.y.isFinite && value.z.isFinite &&
            abs(value.x) <= limit && abs(value.y) <= limit && abs(value.z) <= limit
    }

    // MARK: - Shared catalog geometry, batched with a color palette

    private func makeGeometry(_ asset: Asset) throws -> Geometry {
        var palette: [UInt32] = []
        var paletteIndices: [UInt32: Int] = [:]
        var alphaValues: [Float] = []
        var alphaIndices: [Float: UInt32] = [:]
        for mesh in asset.meshes {
            let rgb = packedRGB(mesh.color)
            if paletteIndices[rgb] == nil {
                paletteIndices[rgb] = palette.count
                palette.append(rgb)
            }
            if alphaIndices[mesh.color[3]] == nil {
                alphaIndices[mesh.color[3]] = UInt32(alphaValues.count)
                alphaValues.append(mesh.color[3])
            }
        }
        let texture = try paletteTexture(palette)
        var positions: [SIMD3<Float>] = []
        var normals: [SIMD3<Float>] = []
        var uvs: [SIMD2<Float>] = []
        var materialIndices: [UInt32] = []
        let vertexCount = asset.meshes.reduce(0) { $0 + $1.vertices.count / 3 }
        positions.reserveCapacity(vertexCount)
        normals.reserveCapacity(vertexCount)
        uvs.reserveCapacity(vertexCount)
        materialIndices.reserveCapacity(vertexCount / 3)
        var minimum = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
        var maximum = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
        for mesh in asset.meshes {
            let paletteIndex = paletteIndices[packedRGB(mesh.color)]!
            let uv = SIMD2<Float>((Float(paletteIndex) + 0.5) / Float(palette.count), 0.5)
            let materialIndex = alphaIndices[mesh.color[3]]!
            for i in stride(from: 0, to: mesh.vertices.count, by: 9) {
                let a = SIMD3<Float>(mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2])
                let b = SIMD3<Float>(mesh.vertices[i + 3], mesh.vertices[i + 4], mesh.vertices[i + 5])
                let c = SIMD3<Float>(mesh.vertices[i + 6], mesh.vertices[i + 7], mesh.vertices[i + 8])
                let cross = simd_cross(b - a, c - a)
                guard simd_length_squared(cross) > 1e-16 else { continue }
                let normal = simd_normalize(cross)
                for vertex in [a, b, c] {
                    positions.append(vertex)
                    normals.append(normal)
                    uvs.append(uv)
                    minimum = simd_min(minimum, vertex)
                    maximum = simd_max(maximum, vertex)
                }
                materialIndices.append(materialIndex)
            }
        }
        guard !positions.isEmpty else { throw issue("AR_UPDATE_FAILED", "Furniture contains no visible triangles.") }
        var descriptor = MeshDescriptor(name: "interior-furniture")
        descriptor.positions = MeshBuffers.Positions(positions)
        descriptor.normals = MeshBuffers.Normals(normals)
        descriptor.textureCoordinates = MeshBuffers.TextureCoordinates(uvs)
        descriptor.primitives = .triangles((0..<positions.count).map { UInt32($0) })
        descriptor.materials = .perFace(materialIndices)
        let resource = try MeshResource.generate(from: [descriptor])
        // A single palette-textured opaque material batches all catalog colors,
        // even for plants with hundreds of separately colored source meshes.
        let materials: [Material] = alphaValues.map { paletteMaterial(texture, alpha: $0) }
        let ghostMaterials: [Material] = alphaValues.map { paletteMaterial(texture, alpha: $0 * 0.32) }
        return Geometry(mesh: resource, materials: materials, ghostMaterials: ghostMaterials,
                        outline: try makeOutline(minimum: minimum, maximum: maximum),
                        minimum: minimum, maximum: maximum)
    }

    private func packedRGB(_ color: [Float]) -> UInt32 {
        let r = UInt32((color[0] * 255).rounded())
        let g = UInt32((color[1] * 255).rounded())
        let b = UInt32((color[2] * 255).rounded())
        return r << 16 | g << 8 | b
    }

    private func paletteTexture(_ colors: [UInt32]) throws -> TextureResource {
        var pixels: [UInt8] = []
        pixels.reserveCapacity(colors.count * 4)
        for color in colors {
            pixels.append(UInt8((color >> 16) & 255))
            pixels.append(UInt8((color >> 8) & 255))
            pixels.append(UInt8(color & 255))
            pixels.append(255)
        }
        let data = Data(pixels)
        guard let provider = CGDataProvider(data: data as CFData),
              let image = CGImage(width: colors.count, height: 1, bitsPerComponent: 8,
                                  bitsPerPixel: 32, bytesPerRow: colors.count * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: false,
                                  intent: .defaultIntent) else {
            throw issue("AR_UPDATE_FAILED", "Could not create furniture colors.")
        }
        // No mipmaps: every triangle samples exactly the center of one palette
        // texel, so neighboring furniture colors must never be averaged together.
        return try TextureResource.generate(from: image, options: .init(semantic: .color, mipmapsMode: .none))
    }

    private func paletteMaterial(_ texture: TextureResource, alpha: Float) -> PhysicallyBasedMaterial {
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: .white, texture: .init(texture))
        material.roughness = .init(floatLiteral: 0.82)
        material.metallic = .init(floatLiteral: 0)
        // Source geometry also serves a double-sided WebGL renderer.
        material.faceCulling = .none
        if alpha < 1 { material.blending = .transparent(opacity: .init(floatLiteral: alpha)) }
        return material
    }

    private func outlineMaterial() -> UnlitMaterial {
        UnlitMaterial(color: UIColor(red: 0.42, green: 0.89, blue: 0.86, alpha: 1))
    }

    private func makeOutline(minimum: SIMD3<Float>, maximum: SIMD3<Float>) throws -> MeshResource {
        let padding = SIMD3<Float>(repeating: 0.009)
        let low = minimum - padding
        let high = maximum + padding
        let thickness: Float = 0.003
        var vertices: [SIMD3<Float>] = []
        // Twelve narrow rods form a single mesh, keeping selected bounds legible
        // without a solid overlay or a separate draw call for each edge.
        for axis in 0..<3 {
            let other = (0..<3).filter { $0 != axis }
            for first in 0..<2 {
                for second in 0..<2 {
                    var center = (low + high) / 2
                    center[other[0]] = first == 0 ? low[other[0]] : high[other[0]]
                    center[other[1]] = second == 0 ? low[other[1]] : high[other[1]]
                    var size = SIMD3<Float>(repeating: thickness)
                    size[axis] = high[axis] - low[axis] + thickness
                    appendBox(center: center, size: size, to: &vertices)
                }
            }
        }
        var descriptor = MeshDescriptor(name: "interior-selection-bounds")
        descriptor.positions = MeshBuffers.Positions(vertices)
        descriptor.primitives = .triangles((0..<vertices.count).map { UInt32($0) })
        return try MeshResource.generate(from: [descriptor])
    }

    private func appendBox(center: SIMD3<Float>, size: SIMD3<Float>, to vertices: inout [SIMD3<Float>]) {
        let a = center - size / 2
        let b = center + size / 2
        let corners: [SIMD3<Float>] = [
            [a.x, a.y, a.z], [b.x, a.y, a.z], [b.x, b.y, a.z], [a.x, b.y, a.z],
            [a.x, a.y, b.z], [b.x, a.y, b.z], [b.x, b.y, b.z], [a.x, b.y, b.z]
        ]
        let indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
                       0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
                       0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]
        vertices.append(contentsOf: indices.map { corners[$0] })
    }

    private func rayBox(origin: SIMD3<Float>, direction: SIMD3<Float>,
                        minimum: SIMD3<Float>, maximum: SIMD3<Float>) -> Float? {
        guard isBounded(origin, limit: 150), isBounded(direction, limit: 2) else { return nil }
        var near: Float = 0
        var far: Float = 100
        for axis in 0..<3 {
            if abs(direction[axis]) < 1e-7 {
                if origin[axis] < minimum[axis] || origin[axis] > maximum[axis] { return nil }
            } else {
                let first = (minimum[axis] - origin[axis]) / direction[axis]
                let second = (maximum[axis] - origin[axis]) / direction[axis]
                near = max(near, min(first, second))
                far = min(far, max(first, second))
                if near > far { return nil }
            }
        }
        return near
    }
}
