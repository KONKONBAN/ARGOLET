package expo.modules.argoletscanner

import android.app.Activity
import android.graphics.BitmapFactory
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val REQUEST_SCAN = 46201

/**
 * Google's document scanner (ML Kit, the one in Google Drive): finds the page edges, corrects the
 * perspective, lets the person crop, rotate, apply a filter and clean stains, page after page.
 */
class ArgoletScannerModule : Module() {
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("ArgoletScanner")

    Function("isAvailable") {
      val context = appContext.reactContext ?: return@Function false
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }

    AsyncFunction("scan") { options: Map<String, Any?>, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("E_NO_ACTIVITY", "Không mở được trình quét", null)
        return@AsyncFunction
      }
      if (pending != null) {
        promise.reject("E_BUSY", "Trình quét đang mở", null)
        return@AsyncFunction
      }
      val limit = (options["pageLimit"] as? Number)?.toInt() ?: 20
      val scannerOptions = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(true)
        .setPageLimit(limit)
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build()
      GmsDocumentScanning.getClient(scannerOptions)
        .getStartScanIntent(activity)
        .addOnSuccessListener { sender ->
          pending = promise
          try {
            activity.startIntentSenderForResult(sender, REQUEST_SCAN, null, 0, 0, 0)
          } catch (e: Exception) {
            pending = null
            promise.reject("E_SCAN", e.message ?: "Không mở được trình quét", e)
          }
        }
        .addOnFailureListener { e ->
          promise.reject("E_SCAN", e.message ?: "Không mở được trình quét", e)
        }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_SCAN) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      if (payload.resultCode != Activity.RESULT_OK) {
        promise.resolve(emptyList<Map<String, Any>>())
        return@OnActivityResult
      }
      val result = GmsDocumentScanningResult.fromActivityResultIntent(payload.data)
      val resolver = appContext.reactContext?.contentResolver
      val pages = result?.pages?.map { page ->
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        try {
          resolver?.openInputStream(page.imageUri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        } catch (_: Exception) {
        }
        mapOf(
          "uri" to page.imageUri.toString(),
          "width" to bounds.outWidth.coerceAtLeast(0),
          "height" to bounds.outHeight.coerceAtLeast(0),
        )
      } ?: emptyList()
      promise.resolve(pages)
    }
  }
}
