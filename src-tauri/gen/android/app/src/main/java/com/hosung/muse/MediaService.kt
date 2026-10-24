package com.hosung.muse

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaBrowserCompat.MediaItem
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Keeps Muse playing in the background and exposes it to the system: media notification,
 * lock screen, headset / Bluetooth buttons and Android Auto (browsing the library from the car).
 * Playback itself stays in the webview (Web Audio); this service mirrors its state and forwards
 * controls back to it. Audio focus (calls, other apps) is handled by the webview itself —
 * requesting it here too would make it pause.
 */
class MediaService : MediaBrowserServiceCompat() {
  data class State(
    val title: String,
    val artist: String,
    val album: String,
    val cover: String?,
    val playing: Boolean,
    val position: Long,
    val duration: Long,
  )

  companion object {
    private const val CHANNEL = "playback"
    private const val NOTIFICATION_ID = 7
    private const val ROOT = "root"
    private val main = Handler(Looper.getMainLooper())
    private var instance: MediaService? = null
    private var latest: State? = null

    /** A control for the player that arrived while the app's page wasn't running yet. */
    @Volatile private var pending: String? = null

    /** Called from the webview whenever track or play state changes. */
    fun update(context: Context, json: JSONObject) {
      val state = State(
        title = json.optString("title"),
        artist = json.optString("artist"),
        album = json.optString("album"),
        cover = json.optString("cover").ifEmpty { null },
        playing = json.optBoolean("playing"),
        position = (json.optDouble("position", 0.0) * 1000).toLong(),
        duration = (json.optDouble("duration", 0.0) * 1000).toLong(),
      )
      main.post {
        latest = state
        val svc = instance
        if (svc != null) svc.render(state)
        else if (state.playing) ContextCompat.startForegroundService(context, Intent(context, MediaService::class.java))
      }
    }

    fun stop(context: Context) {
      main.post {
        latest = null
        context.stopService(Intent(context, MediaService::class.java))
      }
    }

    /** The library changed in the app: let Android Auto reload its lists. */
    fun libraryChanged() {
      main.post {
        instance?.let { svc -> listOf(ROOT, "liked", "songs", "recent", "playlists").forEach { svc.notifyChildrenChanged(it) } }
      }
    }

    /** Hands over a control that came in before the page was ready (see MainActivity.Bridge.ready). */
    fun takePending(): String? = pending.also { pending = null }

    /**
     * Sends a control (play, pause, next, prev, seek:<ms>, playId:<list>|<track>, search:<text>)
     * to the player in the webview.
     */
    fun dispatch(action: String) {
      val activity = MainActivity.current
      if (activity != null) {
        activity.runJs("window.__museMedia && window.__museMedia(${JSONObject.quote(action)})")
      } else {
        // Picked in the car with the app closed: open it and play once the page is up
        pending = action
        instance?.openApp()
      }
    }
  }

  private lateinit var session: MediaSessionCompat
  private var coverPath: String? = null
  private var coverBitmap: Bitmap? = null
  private var foreground = false

  private val noisy = object : BroadcastReceiver() {
    // Headphones unplugged / Bluetooth disconnected: pause instead of blasting the speaker
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) dispatch("pause")
    }
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "재생", NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
      })
    }
    session = MediaSessionCompat(this, "Muse").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = dispatch("play")
        override fun onPause() = dispatch("pause")
        override fun onSkipToNext() = dispatch("next")
        override fun onSkipToPrevious() = dispatch("prev")
        override fun onStop() = dispatch("pause")
        override fun onSeekTo(pos: Long) = dispatch("seek:$pos")
        // Android Auto: a song picked from the browse lists, or "OK Google, play … on Muse"
        override fun onPlayFromMediaId(mediaId: String, extras: Bundle?) = dispatch("playId:$mediaId")
        override fun onPlayFromSearch(query: String?, extras: Bundle?) = dispatch("search:${query.orEmpty()}")
      })
      isActive = true
    }
    sessionToken = session.sessionToken
    // Show something in the car before anything has played
    render(latest ?: State("Muse", "", "", null, false, 0, 0), notify = false)
    ContextCompat.registerReceiver(this, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Notification buttons and headset keys arrive here as MEDIA_BUTTON intents
    MediaButtonReceiver.handleIntent(session, intent)
    val state = latest ?: State("Muse", "", "", null, false, 0, 0)
    render(state, force = true)
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // App swiped away from recents: the webview player is gone, so stop too
    stopSelf()
  }

  override fun onDestroy() {
    instance = null
    unregisterReceiver(noisy)
    session.isActive = false
    session.release()
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  /** Opens the app so its player can start; if Android blocks that, explains it on the car screen. */
  private fun openApp() {
    val opened = runCatching {
      startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }.isSuccess
    if (!opened) {
      session.setPlaybackState(
        PlaybackStateCompat.Builder()
          .setState(PlaybackStateCompat.STATE_ERROR, 0, 0f)
          .setErrorMessage(PlaybackStateCompat.ERROR_CODE_APP_ERROR, "폰에서 뮤즈를 한 번 열어주세요")
          .build()
      )
    }
  }

  // ---------- Android Auto browsing ----------

  override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot =
    BrowserRoot(ROOT, null)

  override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaItem>>) {
    result.detach()
    Thread {
      val items = runCatching { children(parentId) }.getOrElse { mutableListOf() }
      result.sendResult(items)
    }.start()
  }

  /** The library as the app saved it (`<app data>/library.json`). */
  private fun library(): JSONObject? =
    runCatching { JSONObject(File(dataDir, "library.json").readText()) }.getOrNull()

  private fun children(parentId: String): MutableList<MediaItem> {
    if (parentId == ROOT) {
      // Android Auto shows the root's browsable children as tabs
      return mutableListOf(
        folder("liked", "좋아요 표시한 곡"),
        folder("songs", "모든 곡"),
        folder("recent", "최근 재생"),
        folder("playlists", "플레이리스트"),
      )
    }
    val lib = library() ?: return mutableListOf()
    val tracks = lib.optJSONArray("tracks") ?: JSONArray()
    val byId = HashMap<String, JSONObject>()
    for (i in 0 until tracks.length()) tracks.getJSONObject(i).let { byId[it.getString("id")] = it }

    if (parentId == "playlists") {
      val lists = lib.optJSONArray("playlists") ?: JSONArray()
      return (0 until lists.length()).map { i ->
        val p = lists.getJSONObject(i)
        folder("playlist:${p.getString("id")}", p.getString("name"), "${p.optJSONArray("trackIds")?.length() ?: 0}곡")
      }.toMutableList()
    }
    return trackIds(parentId, lib).mapNotNull { byId[it] }.map { song(parentId, it) }.toMutableList()
  }

  /** Track ids of a list, in the same order the app shows them. */
  private fun trackIds(listId: String, lib: JSONObject): List<String> {
    fun strings(a: JSONArray?) = a?.let { arr -> (0 until arr.length()).map { arr.getString(it) } } ?: emptyList()
    return when {
      listId == "liked" -> strings(lib.optJSONArray("liked"))
      listId == "songs" -> {
        val t = lib.optJSONArray("tracks") ?: JSONArray()
        (t.length() - 1 downTo 0).map { t.getJSONObject(it).getString("id") }
      }
      listId == "recent" -> {
        val h = lib.optJSONArray("history") ?: JSONArray()
        (h.length() - 1 downTo 0).map { h.getJSONObject(it).getString("trackId") }.distinct().take(50)
      }
      listId.startsWith("playlist:") -> {
        val id = listId.removePrefix("playlist:")
        val lists = lib.optJSONArray("playlists") ?: JSONArray()
        (0 until lists.length()).map { lists.getJSONObject(it) }.firstOrNull { it.getString("id") == id }
          ?.let { strings(it.optJSONArray("trackIds")) } ?: emptyList()
      }
      else -> emptyList()
    }
  }

  private fun folder(id: String, title: String, subtitle: String? = null) = MediaItem(
    MediaDescriptionCompat.Builder().setMediaId(id).setTitle(title).setSubtitle(subtitle).build(),
    MediaItem.FLAG_BROWSABLE,
  )

  private fun song(listId: String, t: JSONObject) = MediaItem(
    MediaDescriptionCompat.Builder()
      .setMediaId("$listId|${t.getString("id")}")
      .setTitle(t.optString("title"))
      .setSubtitle(t.optString("artist"))
      .setIconBitmap(thumbnail(t.optString("cover").ifEmpty { null }))
      .build(),
    MediaItem.FLAG_PLAYABLE,
  )

  /** Small cover for list rows (full-size bitmaps would be wasteful over the car connection). */
  private fun thumbnail(path: String?): Bitmap? {
    if (path == null || !File(path).isFile) return null
    return runCatching {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      var sample = 1
      while (bounds.outWidth / (sample * 2) >= 160) sample *= 2
      BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
    }.getOrNull()
  }

  // ---------- Now playing ----------

  private fun cover(path: String?): Bitmap? {
    if (path != coverPath) {
      coverPath = path
      coverBitmap = path?.let { runCatching { BitmapFactory.decodeFile(it) }.getOrNull() }
    }
    return coverBitmap
  }

  private fun render(state: State, force: Boolean = false, notify: Boolean = true) {
    session.setMetadata(
      MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, state.title)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, state.artist)
        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, state.album)
        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, state.duration)
        .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, cover(state.cover))
        .build()
    )
    session.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(
          PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_SEEK_TO or PlaybackStateCompat.ACTION_STOP or
            PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID or PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
        )
        .setState(
          if (state.playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
          state.position,
          if (state.playing) 1f else 0f,
        )
        .build()
    )
    if (!notify) return

    val notification = buildNotification(state)
    if (state.playing || force) {
      // Foreground while playing so Android doesn't kill the app with the screen off
      val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
      foreground = true
    }
    if (!state.playing && foreground) {
      // Paused: keep the notification (so it can be resumed) but let it be swiped away
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
      foreground = false
      getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    }
  }

  private fun buildNotification(state: State): Notification {
    val open = PendingIntent.getActivity(
      this, 0,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    fun action(icon: Int, title: String, key: Long) =
      NotificationCompat.Action(icon, title, MediaButtonReceiver.buildMediaButtonPendingIntent(this, key))
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_muse)
      .setContentTitle(state.title)
      .setContentText(state.artist)
      .setLargeIcon(cover(state.cover))
      .setContentIntent(open)
      .setDeleteIntent(MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_STOP))
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .addAction(action(android.R.drawable.ic_media_previous, "이전", PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
      .addAction(
        if (state.playing) action(android.R.drawable.ic_media_pause, "일시정지", PlaybackStateCompat.ACTION_PAUSE)
        else action(android.R.drawable.ic_media_play, "재생", PlaybackStateCompat.ACTION_PLAY)
      )
      .addAction(action(android.R.drawable.ic_media_next, "다음", PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
      .setStyle(MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
      .build()
  }
}
