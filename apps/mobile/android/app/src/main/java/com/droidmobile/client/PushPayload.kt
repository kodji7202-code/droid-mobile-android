package com.droidmobile.client

/**
 * The opaque payload the FCM bridge sends: only the event kind and the daemon session id.
 * The system shows the push itself, so the app meets this data in two places: the extras of
 * the intent that a tap launches, and the tags the bridge puts on the notification.
 */
object PushPayload {
    const val EXTRA_KIND = "kind"
    const val EXTRA_SESSION_ID = "sessionId"

    private const val KIND_PERMISSION = "permission_prompt"
    private const val KIND_IDLE = "idle_prompt"
    private const val KIND_STOP = "stop"
    private val SESSION_ID = Regex("^[A-Za-z0-9._-]{1,128}$")

    /** Notification channel a push of this kind belongs to, or null for an unknown kind. */
    fun channelOf(kind: String?): String? = when (kind) {
        KIND_PERMISSION -> NotificationChannels.APPROVALS_ID
        KIND_IDLE, KIND_STOP -> NotificationChannels.TURNS_ID
        else -> null
    }

    /**
     * Session to open for a tap on a pushed notification, read from the launch intent's string
     * extras. Null when the intent is not a push or carries an id that is not a daemon session id.
     */
    fun sessionIdOf(extra: (String) -> String?): String? {
        if (channelOf(extra(EXTRA_KIND)) == null) return null
        return extra(EXTRA_SESSION_ID)?.takeIf { SESSION_ID.matches(it) }
    }

    /** Tag the bridge gives the system notification of an approval push; the app cancels it by this tag. */
    fun approvalsTag(sessionId: String) = "approvals:$sessionId"
}
