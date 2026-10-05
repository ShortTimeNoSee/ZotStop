import Capacitor

class ZotStopViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ZotStopNativePlugin())
    }
}
