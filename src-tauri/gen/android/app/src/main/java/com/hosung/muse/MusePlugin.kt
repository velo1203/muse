package com.hosung.muse

import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLException
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

@InvokeArg
class RunArgs {
  lateinit var id: String
  var args: List<String> = emptyList()
}

@InvokeArg
class IdArgs {
  lateinit var id: String
}

@InvokeArg
class CopyArgs {
  lateinit var uri: String
  lateinit var dir: String
  lateinit var stem: String
}

/**
 * Native side called from Rust (src-tauri/src/android.rs): runs the bundled yt-dlp
 * (youtubedl-android) and copies files picked with the system file picker.
 */
@TauriPlugin
class MusePlugin(private val activity: Activity) : Plugin(activity) {
  private val pool = Executors.newCachedThreadPool()
  private val progress = ConcurrentHashMap<String, Float>()

  companion object {
    @Volatile private var ready = false
    private val initLock = Any()
  }

  /** Unpacks the Python runtime, yt-dlp and ffmpeg on first use (a few seconds, once per install). */
  private fun ensureInit() {
    if (ready) return
    synchronized(initLock) {
      if (ready) return
      val ctx = activity.applicationContext
      YoutubeDL.getInstance().init(ctx)
      FFmpeg.getInstance().init(ctx)
      ready = true
    }
  }

  @Command
  fun ytdlInit(invoke: Invoke) {
    pool.execute {
      try {
        ensureInit()
        invoke.resolve(JSObject())
      } catch (e: Exception) {
        invoke.reject(e.message ?: "yt-dlp를 준비하지 못했어요")
      }
    }
  }

  @Command
  fun ytdlRun(invoke: Invoke) {
    val args = invoke.parseArgs(RunArgs::class.java)
    pool.execute {
      val result = JSObject()
      try {
        ensureInit()
        val request = YoutubeDLRequest(emptyList<String>()).addCommands(args.args)
        val response = YoutubeDL.getInstance().execute(request, args.id) { p, _, _ -> progress[args.id] = p }
        result.put("out", response.out)
        result.put("err", response.err)
        result.put("exitCode", response.exitCode)
      } catch (e: YoutubeDLException) {
        // Non-zero exit: yt-dlp's error message is in the exception
        result.put("out", "")
        result.put("err", e.message ?: "yt-dlp 오류")
        result.put("exitCode", 1)
      } catch (e: Exception) {
        result.put("out", "")
        result.put("err", e.message ?: e.toString())
        result.put("exitCode", 1)
      } finally {
        progress.remove(args.id)
      }
      invoke.resolve(result)
    }
  }

  @Command
  fun ytdlProgress(invoke: Invoke) {
    val args = invoke.parseArgs(IdArgs::class.java)
    val out = JSObject()
    out.put("progress", (progress[args.id] ?: -1f).toDouble())
    invoke.resolve(out)
  }

  /**
   * Keeps the bundled yt-dlp current (YouTube changes often break old versions): swaps in the
   * latest release from GitHub when it differs from the installed one.
   */
  @Command
  fun ytdlUpdate(invoke: Invoke) {
    pool.execute {
      try {
        ensureInit()
        val target = File(activity.noBackupFilesDir, "youtubedl-android/yt-dlp/yt-dlp")
        // Version we installed last (the copy bundled in the APK has none, so it gets replaced once)
        val versionFile = File(target.parentFile, "yt-dlp.version")
        val latest = latestYtdlpTag()
        val current = versionFile.takeIf { it.isFile }?.readText()?.trim()
        var updated = false
        if (latest != current) {
          val tmp = File(target.parentFile, "yt-dlp.part")
          download("https://github.com/yt-dlp/yt-dlp/releases/download/$latest/yt-dlp", tmp)
          // Only swap in something that really is a yt-dlp build (a python zipapp starting with "#!")
          if (!looksLikeYtdlp(tmp)) {
            tmp.delete()
            throw IllegalStateException("받은 yt-dlp 파일이 올바르지 않아요")
          }
          if (!tmp.renameTo(target)) throw IllegalStateException("yt-dlp를 교체하지 못했어요")
          versionFile.writeText(latest)
          updated = true
        }
        val out = JSObject()
        out.put("version", latest)
        out.put("updated", updated)
        invoke.resolve(out)
      } catch (e: Exception) {
        Log.e("Muse", "yt-dlp update failed", e)
        invoke.reject(e.message ?: "yt-dlp 업데이트 실패")
      }
    }
  }

  /** Tag of the newest yt-dlp release (the `latest` page redirects to `/tag/<version>`). */
  private fun latestYtdlpTag(): String {
    val conn = URL("https://github.com/yt-dlp/yt-dlp/releases/latest").openConnection() as HttpURLConnection
    conn.instanceFollowRedirects = false
    conn.connectTimeout = 15000
    conn.readTimeout = 15000
    try {
      val location = conn.getHeaderField("Location") ?: throw IllegalStateException("최신 버전을 확인하지 못했어요")
      return location.substringAfterLast('/')
    } finally {
      conn.disconnect()
    }
  }

  /**
   * yt-dlp's zipapp is a shebang line followed by a zip. (Android's ZipFile refuses archives
   * with a prefix, so check the header and size instead of opening it.)
   */
  private fun looksLikeYtdlp(file: File): Boolean {
    if (file.length() < 1_000_000) return false
    val head = ByteArray(2)
    file.inputStream().use { it.read(head) }
    return head[0] == '#'.code.toByte() && head[1] == '!'.code.toByte()
  }

  private fun download(url: String, dest: File) {
    var link = URL(url)
    // Follow GitHub's redirects to its asset CDN
    repeat(5) {
      val conn = link.openConnection() as HttpURLConnection
      conn.instanceFollowRedirects = false
      conn.connectTimeout = 15000
      conn.readTimeout = 60000
      when (conn.responseCode) {
        in 300..399 -> {
          link = URL(link, conn.getHeaderField("Location"))
          conn.disconnect()
        }
        200 -> {
          conn.inputStream.use { input -> dest.outputStream().use { input.copyTo(it) } }
          conn.disconnect()
          return
        }
        else -> {
          conn.disconnect()
          throw IllegalStateException("yt-dlp 다운로드 실패 (HTTP ${conn.responseCode})")
        }
      }
    }
    throw IllegalStateException("yt-dlp 다운로드 실패 (리디렉션이 너무 많아요)")
  }

  /** Copies a content:// URI (from the file picker) to `<dir>/<stem>.<ext>`. */
  @Command
  fun copyUri(invoke: Invoke) {
    val args = invoke.parseArgs(CopyArgs::class.java)
    pool.execute {
      try {
        val uri = Uri.parse(args.uri)
        val resolver = activity.contentResolver
        var name = uri.lastPathSegment ?: "audio"
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
          if (c.moveToFirst()) c.getString(0)?.let { name = it }
        }
        val ext = name.substringAfterLast('.', "audio").lowercase()
        val dest = File(args.dir, "${args.stem}.$ext")
        dest.parentFile?.mkdirs()
        resolver.openInputStream(uri)?.use { input -> dest.outputStream().use { input.copyTo(it) } }
          ?: throw IllegalStateException("파일을 열 수 없어요")
        val out = JSObject()
        out.put("path", dest.absolutePath)
        out.put("name", name)
        invoke.resolve(out)
      } catch (e: Exception) {
        invoke.reject(e.message ?: "파일을 가져오지 못했어요")
      }
    }
  }
}
