import ExpoModulesCore
import UIKit
import VisionKit

/// The iPhone's own document scanner (the one in Notes and Files): finds the page edges, corrects
/// the perspective, removes shadows and scans page after page. Pages come back as JPEG files.
public class ArgoletScannerModule: Module {
  private var session: ScanSession?

  public func definition() -> ModuleDefinition {
    Name("ArgoletScanner")

    Function("isAvailable") { () -> Bool in
      VNDocumentCameraViewController.isSupported
    }

    AsyncFunction("scan") { (options: [String: Any], promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else {
        promise.reject("E_UNSUPPORTED", "Thiết bị không hỗ trợ trình quét tài liệu")
        return
      }
      guard self.session == nil else {
        promise.reject("E_BUSY", "Trình quét đang mở")
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("E_NO_VIEW", "Không mở được trình quét")
        return
      }
      let limit = (options["pageLimit"] as? Int) ?? 20
      let quality = CGFloat((options["quality"] as? Double) ?? 0.85)
      let session = ScanSession(limit: limit, quality: quality) { [weak self] result in
        self?.session = nil
        switch result {
        case .success(let pages): promise.resolve(pages)
        case .failure(let error): promise.reject("E_SCAN", error.localizedDescription)
        }
      }
      self.session = session
      let controller = VNDocumentCameraViewController()
      controller.delegate = session
      controller.modalPresentationStyle = .fullScreen
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)
  }
}

private final class ScanSession: NSObject, VNDocumentCameraViewControllerDelegate {
  private let limit: Int
  private let quality: CGFloat
  private let done: (Result<[[String: Any]], Error>) -> Void

  init(limit: Int, quality: CGFloat, done: @escaping (Result<[[String: Any]], Error>) -> Void) {
    self.limit = limit
    self.quality = quality
    self.done = done
  }

  func documentCameraViewController(
    _ controller: VNDocumentCameraViewController,
    didFinishWith scan: VNDocumentCameraScan
  ) {
    var pages: [[String: Any]] = []
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("argolet-scans", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let stamp = Int(Date().timeIntervalSince1970 * 1000)
    for index in 0..<min(scan.pageCount, limit) {
      let image = scan.imageOfPage(at: index)
      guard let data = image.jpegData(compressionQuality: quality) else { continue }
      let url = folder.appendingPathComponent("chung-tu-\(stamp)-\(index + 1).jpg")
      do {
        try data.write(to: url)
        pages.append([
          "uri": url.absoluteString,
          "width": Int(image.size.width * image.scale),
          "height": Int(image.size.height * image.scale),
        ])
      } catch {
        continue
      }
    }
    controller.dismiss(animated: true) { self.done(.success(pages)) }
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true) { self.done(.success([])) }
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    controller.dismiss(animated: true) { self.done(.failure(error)) }
  }
}
