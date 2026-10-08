package com.droidmobile.client

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Keeps the process (and so the WebView's daemon socket) alive while a turn runs or the user
 * enabled "stay connected". It holds no connection itself; the WebView starts and stops it.
 */
class DaemonService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                StopRequestStore.from(this).markRequested()
                shutdown()
                DaemonServicePlugin.notifyStopped()
            }
            else -> showForeground(intent)
        }
        // A killed process must not bring the notification back without the WebView asking for it.
        return START_NOT_STICKY
    }

    // Android 15 limits dataSync foreground services to six hours. This is not the user's Stop: no stop
    // request is stored, and the WebView restarts the service once the app is in the foreground again.
    override fun onTimeout(startId: Int, fgsType: Int) {
        shutdown()
        DaemonServicePlugin.notifyTimedOut()
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    private fun showForeground(intent: Intent?) {
        NotificationChannels.ensureService(this)
        val defaults = ServiceTexts(
            title = getString(R.string.service_notification_title),
            text = getString(R.string.service_notification_text),
            stopLabel = getString(R.string.service_notification_stop),
        )
        val texts = ServiceTexts.resolve(
            intent?.getStringExtra(EXTRA_TITLE),
            intent?.getStringExtra(EXTRA_TEXT),
            intent?.getStringExtra(EXTRA_STOP_LABEL),
            defaults,
        )
        val notification = buildNotification(texts)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        running = true
    }

    private fun buildNotification(texts: ServiceTexts): Notification {
        val immutable = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            immutable,
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, DaemonService::class.java).setAction(ACTION_STOP),
            immutable,
        )
        return NotificationCompat.Builder(this, NotificationChannels.SERVICE_ID)
            .setSmallIcon(R.drawable.ic_stat_service)
            .setContentTitle(texts.title)
            .setContentText(texts.text)
            .setContentIntent(open)
            .addAction(0, texts.stopLabel, stop)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun shutdown() {
        running = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    companion object {
        const val ACTION_STOP = "com.droidmobile.client.action.STOP_DAEMON_SERVICE"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val EXTRA_STOP_LABEL = "stopLabel"
        private const val NOTIFICATION_ID = 4101

        @Volatile
        var running: Boolean = false
            private set(value) {
                field = value
                DaemonWebView.onServiceStateChanged()
            }

        fun start(context: Context, texts: ServiceTexts?) {
            val intent = Intent(context, DaemonService::class.java)
            if (texts != null) {
                intent.putExtra(EXTRA_TITLE, texts.title)
                    .putExtra(EXTRA_TEXT, texts.text)
                    .putExtra(EXTRA_STOP_LABEL, texts.stopLabel)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, DaemonService::class.java))
        }
    }
}
