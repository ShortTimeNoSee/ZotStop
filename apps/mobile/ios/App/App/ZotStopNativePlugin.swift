import Capacitor
import CoreHaptics
import CoreLocation
import UIKit
import UserNotifications

@objc(ZotStopNativePlugin)
public final class ZotStopNativePlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "ZotStopNativePlugin"
    public let jsName = "ZotStopNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "locate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "feedback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    private let manager = CLLocationManager()
    private let rideManager = CLLocationManager()
    private var pendingLocation: CAPPluginCall?
    private var pendingStart: CAPPluginCall?
    private var bestLocation: CLLocation?
    private var timeout: Timer?
    private var tracking = false
    private var hapticEngine: CHHapticEngine?
    private var rideActive = false
    private var ridePhone = false
    private var ridePlan: [String: Any] = [:]

    override public func load() {
        DispatchQueue.main.async {
            self.manager.delegate = self
            self.manager.allowsBackgroundLocationUpdates = false
            self.manager.pausesLocationUpdatesAutomatically = true
            NotificationCenter.default.addObserver(self, selector: #selector(self.stopForBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        timeout?.invalidate()
        hapticEngine?.stop(completionHandler: nil)
    }

    @objc public func locate(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.locateOnMain(call) }
    }

    private func locateOnMain(_ call: CAPPluginCall) {
        guard prepare(call) else { return }
        cancelPending("Location request replaced")
        tracking = false
        manager.stopUpdatingLocation()
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = kCLDistanceFilterNone
        pendingLocation = call
        bestLocation = nil
        timeout = Timer.scheduledTimer(withTimeInterval: 12, repeats: false) { [weak self] _ in
            self?.finishLocation()
        }
        authorizeOrStart()
    }

    @objc public func startTracking(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.startTrackingOnMain(call) }
    }

    private func startTrackingOnMain(_ call: CAPPluginCall) {
        guard prepare(call) else { return }
        cancelPending("Location request replaced")
        manager.stopUpdatingLocation()
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 8
        tracking = true
        pendingStart = call
        authorizeOrStart()
    }

    @objc public func stopTracking(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopLocation()
            call.resolve()
        }
    }

    @objc public func feedback(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.feedbackOnMain(call) }
    }

    private func feedbackOnMain(_ call: CAPPluginCall) {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            call.resolve()
            return
        }
        do {
            if hapticEngine == nil {
                hapticEngine = try CHHapticEngine()
                hapticEngine?.isAutoShutdownEnabled = true
                hapticEngine?.playsHapticsOnly = true
            }
            guard let engine = hapticEngine else { call.resolve(); return }
            try engine.start()
            let intensity = min(1, max(0.15, call.getFloat("intensity", 0.35)))
            let pulses = min(3, max(1, call.getInt("pulses", 1)))
            let events = (0..<pulses).map { index in
                CHHapticEvent(eventType: .hapticTransient, parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: pulses > 1 ? 0.7 : 0.3)
                ], relativeTime: TimeInterval(index) * 0.16)
            }
            let pattern = try CHHapticPattern(events: events, parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            hapticEngine = nil
        }
        call.resolve()
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager === rideManager {
            if ridePhone && (manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse) { beginRideUpdates() }
            return
        }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            if pendingLocation != nil || pendingStart != nil { beginUpdates() }
        case .denied, .restricted:
            failLocation("Location access is off. Enable it in Settings to use your location.")
        default:
            break
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last(where: { $0.horizontalAccuracy >= 0 && abs($0.timestamp.timeIntervalSinceNow) < 10 }) else { return }
        if manager === rideManager {
            if UIApplication.shared.applicationState != .active { publishRide(title: "This phone", body: "Still following your position toward \(ridePlan["stopName"] as? String ?? "your stop").") }
            return
        }
        if pendingLocation != nil {
            if let current = bestLocation {
                if location.horizontalAccuracy < current.horizontalAccuracy { bestLocation = location }
            } else {
                bestLocation = location
            }
            if location.horizontalAccuracy <= 35 || manager.accuracyAuthorization == .reducedAccuracy { finishLocation() }
        }
        if tracking {
            notifyListeners("location", data: locationData(location))
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if manager === rideManager { return }
        if (error as? CLError)?.code == .locationUnknown { return }
        failLocation("Location is unavailable right now.")
    }

    private func prepare(_ call: CAPPluginCall) -> Bool {
        guard CLLocationManager.locationServicesEnabled() else {
            call.reject("Location services are off on this device.")
            return false
        }
        guard UIApplication.shared.applicationState == .active else {
            call.reject("Open ZotStop to use your location.")
            return false
        }
        guard manager.authorizationStatus != .denied && manager.authorizationStatus != .restricted else {
            call.reject("Location access is off. Enable it in Settings to use your location.")
            return false
        }
        return true
    }

    private func authorizeOrStart() {
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        else { beginUpdates() }
    }

    private func beginUpdates() {
        manager.startUpdatingLocation()
        pendingStart?.resolve()
        pendingStart = nil
    }

    private func finishLocation() {
        manager.stopUpdatingLocation()
        timeout?.invalidate()
        timeout = nil
        guard let call = pendingLocation else { return }
        pendingLocation = nil
        if let bestLocation { call.resolve(locationData(bestLocation)) }
        else { call.reject("A close location could not be found. Try again outdoors.") }
        bestLocation = nil
    }

    private func failLocation(_ message: String) {
        manager.stopUpdatingLocation()
        if tracking { notifyListeners("location", data: ["error": message]) }
        tracking = false
        timeout?.invalidate()
        timeout = nil
        pendingLocation?.reject(message)
        pendingStart?.reject(message)
        pendingLocation = nil
        pendingStart = nil
        bestLocation = nil
    }

    private func cancelPending(_ message: String) {
        timeout?.invalidate()
        timeout = nil
        pendingLocation?.reject(message)
        pendingStart?.reject(message)
        pendingLocation = nil
        pendingStart = nil
        bestLocation = nil
    }

    private func stopLocation() {
        manager.stopUpdatingLocation()
        tracking = false
        cancelPending("Location stopped")
    }

    @objc private func stopForBackground() {
        stopLocation()
    }

    private func locationData(_ location: CLLocation) -> [String: Any] {
        ["lat": location.coordinate.latitude, "lon": location.coordinate.longitude, "accuracy": location.horizontalAccuracy]
    }

    @objc public func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.startRide(call) }
    }

    @objc public func sync(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "ZotStop"
        let body = call.getString("body") ?? ""
        DispatchQueue.main.async {
            guard self.rideActive else { call.resolve(); return }
            self.publishRide(title: title, body: body)
            call.resolve()
        }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.endRide()
            call.resolve()
        }
    }

    @objc public func status(_ call: CAPPluginCall) {
        call.resolve(["running": rideActive])
    }

    private func startRide(_ call: CAPPluginCall) {
        guard let raw = call.getString("plan"), let data = raw.data(using: .utf8), let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            call.reject("The ride could not be started")
            return
        }
        ridePlan = json
        ridePhone = (json["mode"] as? String) == "phone"
        rideActive = true
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        if ridePhone {
            rideManager.delegate = self
            rideManager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            rideManager.pausesLocationUpdatesAutomatically = false
            if rideManager.authorizationStatus == .notDetermined { rideManager.requestWhenInUseAuthorization() }
            if rideManager.authorizationStatus == .authorizedWhenInUse { rideManager.requestAlwaysAuthorization() }
            beginRideUpdates()
        }
        publishRide(title: "ZotStop", body: "\(json["letter"] as? String ?? "") Line to \(json["stopName"] as? String ?? "your stop")")
        let alwaysDeclined = rideManager.authorizationStatus == .denied || rideManager.authorizationStatus == .restricted || rideManager.authorizationStatus == .authorizedWhenInUse
        call.resolve(["backgroundLocation": !ridePhone || !alwaysDeclined])
    }

    private func beginRideUpdates() {
        guard ridePhone && rideActive else { return }
        rideManager.allowsBackgroundLocationUpdates = rideManager.authorizationStatus == .authorizedAlways
        rideManager.startUpdatingLocation()
    }

    private func endRide() {
        rideActive = false
        ridePhone = false
        rideManager.stopUpdatingLocation()
        rideManager.allowsBackgroundLocationUpdates = false
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["zotstop-ride"])
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["zotstop-ride"])
    }

    private func publishRide(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if #available(iOS 15.0, *) { content.interruptionLevel = .timeSensitive }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "zotstop-ride", content: content, trigger: nil))
    }
}
