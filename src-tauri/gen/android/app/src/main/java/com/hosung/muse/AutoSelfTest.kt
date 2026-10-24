package com.hosung.muse

import android.app.Activity
import android.content.ComponentName
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.session.MediaControllerCompat
import android.util.Log

/**
 * Debug-only check of the Android Auto integration without a car: connects to MediaService
 * the same way Android Auto does, walks the browse tree and plays the first song of "모든 곡".
 * Run: adb shell am start -n com.hosung.muse/.MainActivity --ez muse_auto_selftest true
 * Results are logged with the tag "MuseAutoTest".
 */
object AutoSelfTest {
  private const val TAG = "MuseAutoTest"
  private var browser: MediaBrowserCompat? = null

  fun run(activity: Activity) {
    browser?.disconnect()
    lateinit var b: MediaBrowserCompat
    b = MediaBrowserCompat(activity, ComponentName(activity, MediaService::class.java), object : MediaBrowserCompat.ConnectionCallback() {
      override fun onConnected() {
        Log.i(TAG, "connected, root=${b.root}")
        b.subscribe(b.root, object : MediaBrowserCompat.SubscriptionCallback() {
          override fun onChildrenLoaded(parentId: String, children: MutableList<MediaBrowserCompat.MediaItem>) {
            Log.i(TAG, "tabs: " + children.joinToString { "${it.mediaId}=${it.description.title}" })
            b.subscribe("songs", object : MediaBrowserCompat.SubscriptionCallback() {
              override fun onChildrenLoaded(parentId: String, songs: MutableList<MediaBrowserCompat.MediaItem>) {
                Log.i(TAG, "songs: " + songs.joinToString { "${it.description.title} (${it.description.subtitle}, icon=${it.description.iconBitmap != null}, playable=${it.isPlayable})" })
                val first = songs.firstOrNull() ?: return
                val controller = MediaControllerCompat(activity, b.sessionToken)
                Log.i(TAG, "playFromMediaId ${first.mediaId}")
                controller.transportControls.playFromMediaId(first.mediaId, null)
                // One pass only: staying subscribed would replay whenever the library changes
                b.disconnect()
              }
            })
          }
        })
      }

      override fun onConnectionFailed() {
        Log.e(TAG, "connection failed")
      }
    }, null)
    browser = b
    b.connect()
  }
}
