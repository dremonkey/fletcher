import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)

    let controller = window?.rootViewController as! FlutterViewController
    let channel = FlutterMethodChannel(
      name: "com.fletcher.fletcher/screen_state",
      binaryMessenger: controller.binaryMessenger
    )
    channel.setMethodCallHandler { (call, result) in
      if call.method == "isScreenLocked" {
        // iOS doesn't expose a clean "screen locked" API.
        // Use brightness == 0 as a heuristic (screen is off when locked).
        // Fallback: false means iOS will always start the background timeout,
        // which is acceptable since iOS kills backgrounded apps aggressively.
        let isLocked = UIScreen.main.brightness == 0
        result(isLocked)
      } else {
        result(FlutterMethodNotImplemented)
      }
    }

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
